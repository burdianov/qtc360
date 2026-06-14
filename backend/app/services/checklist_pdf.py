"""Generate checklist PDF using reportlab — same header as CRS."""

from __future__ import annotations

import base64
import io

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.app_setting import AppSetting
from app.models.contractor import Contractor
from app.models.project_approver import ProjectApprover


async def generate_checklist_pdf(db: AsyncSession, document, checklist) -> bytes:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib import colors
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.utils import ImageReader
    from reportlab.platypus import Table, TableStyle, Paragraph
    from reportlab.pdfgen import canvas

    project = document.project
    requirement_name = (
        checklist.requirement_template.name if checklist.requirement_template else ""
    )
    responses = sorted(checklist.responses, key=lambda r: r.display_order)

    # Load header image
    header_setting = (
        await db.execute(
            select(AppSetting).where(AppSetting.key == f"crs_header_image_{project.id}")
        )
    ).scalar_one_or_none()

    # Load contractor for the project
    contractor = (
        await db.execute(
            select(Contractor)
            .where(Contractor.project_id == project.id, Contractor.is_deleted == False)  # noqa: E712
            .limit(1)
        )
    ).scalar_one_or_none()

    # Load project approvers for this doc type
    approvers_result = await db.execute(
        select(ProjectApprover)
        .where(
            ProjectApprover.project_id == project.id,
            ProjectApprover.document_type == document.document_type,
        )
        .options(
            selectinload(ProjectApprover.approver),
            selectinload(ProjectApprover.approver_title),
        )
        .order_by(ProjectApprover.approver_order)
    )
    project_approvers = approvers_result.scalars().all()

    # Client name
    client_name = ""
    if project.client_id:
        from app.models.client import Client

        client = await db.get(Client, project.client_id)
        if client:
            client_name = client.name

    buf = io.BytesIO()
    width, height = A4
    c = canvas.Canvas(buf, pagesize=A4)
    y = height - 5 * mm

    # ─── Header image ────────────────────────────────────────────────────
    if header_setting and header_setting.value:
        try:
            from PIL import Image as PILImage

            img_data = base64.b64decode(header_setting.value)
            img = PILImage.open(io.BytesIO(img_data))
            img_w, img_h = img.size
            max_w = width - 20 * mm
            ratio = min(max_w / img_w, 35 * mm / img_h)
            draw_w, draw_h = img_w * ratio, img_h * ratio
            c.drawImage(
                ImageReader(io.BytesIO(img_data)), 10 * mm, y - draw_h, draw_w, draw_h
            )
            y -= draw_h + 4 * mm
        except Exception:
            pass

    y -= 4 * mm

    # ─── Title ───────────────────────────────────────────────────────────
    c.setFont("Helvetica-Bold", 11)
    title_text = f"Checklist for {requirement_name}"
    c.drawCentredString(width / 2, y, title_text)
    y -= 8 * mm

    # ─── Info row: Project / Client / Approvers / Contractor ─────────────
    left_margin = 12 * mm
    c.setFont("Helvetica", 9)

    info_table_data = [
        [
            "Project Title",
            "Client",
            "MEP Consultant / Technical Advisor",
            "Main Contractor",
        ],
        [
            project.name,
            client_name,
            " / ".join(a.approver.name for a in project_approvers if a.approver)
            if project_approvers
            else "",
            contractor.name if contractor else "",
        ],
    ]
    info_col_w = (width - 24 * mm) / 4
    info_table = Table(info_table_data, colWidths=[info_col_w] * 4)
    info_table.setStyle(
        TableStyle(
            [
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 8),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    tw, th = info_table.wrap(width - 24 * mm, y)
    info_table.drawOn(c, left_margin, y - th)
    y -= th + 3 * mm

    # ─── Location row ────────────────────────────────────────────────────
    location = document.location or ""
    if location:
        c.setFont("Helvetica-Bold", 8)
        c.drawString(left_margin, y, "Location/Area:")
        c.setFont("Helvetica", 8)
        c.drawString(left_margin + 25 * mm, y, location)
        y -= 5 * mm

    # ─── Reference info ──────────────────────────────────────────────────
    c.setFont("Helvetica", 8)
    c.drawString(
        left_margin,
        y,
        f"Ref: {document.reference_no}    Rev: {document.revision_no or 0}",
    )
    y -= 6 * mm

    # ─── Checklist table ─────────────────────────────────────────────────
    cell_style = ParagraphStyle("cell", fontSize=8, leading=10)
    header_style = ParagraphStyle(
        "hdr", fontSize=8, leading=10, fontName="Helvetica-Bold", alignment=1
    )

    # Header: SN | Activities/Items to be Inspected | YES | NO | Notes
    table_data = [
        [
            Paragraph("Sl. No.", header_style),
            Paragraph("Activities / Items to be Inspected", header_style),
            Paragraph("YES", header_style),
            Paragraph("NO", header_style),
            Paragraph("Notes", header_style),
        ]
    ]

    for idx, resp in enumerate(responses, 1):
        check_yes = "\u2713" if resp.response == "yes" else ""
        check_no = "\u2713" if resp.response == "no" else ""
        notes_text = resp.notes or ""
        table_data.append(
            [
                Paragraph(str(idx), ParagraphStyle("sn", fontSize=8, alignment=1)),
                Paragraph(resp.item_text, cell_style),
                Paragraph(check_yes, ParagraphStyle("chk", fontSize=8, alignment=1)),
                Paragraph(check_no, ParagraphStyle("chk", fontSize=8, alignment=1)),
                Paragraph(notes_text, cell_style),
            ]
        )

    available_w = width - 24 * mm
    notes_col_w = 40 * mm
    col_widths = [12 * mm, available_w - 12 * mm - 30 * mm - notes_col_w, 15 * mm, 15 * mm, notes_col_w]
    t = Table(table_data, colWidths=col_widths, repeatRows=1)
    t.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
                ("BACKGROUND", (0, 0), (-1, 0), colors.Color(0.92, 0.92, 0.92)),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("LEFTPADDING", (0, 0), (-1, -1), 3),
            ]
        )
    )

    # Multi-page support: split table if it doesn't fit
    tw, th = t.wrap(available_w, y - 15 * mm)
    if th <= y - 15 * mm:
        t.drawOn(c, left_margin, y - th)
        y -= th + 4 * mm
    else:
        # Use platypus for multi-page
        # Fallback: draw what fits, new page for rest
        t.drawOn(c, left_margin, 15 * mm)
        y = 15 * mm

    # ─── Comments ────────────────────────────────────────────────────────
    if checklist.comments:
        if y < 40 * mm:
            c.showPage()
            y = height - 15 * mm
        c.setFont("Helvetica-Bold", 8)
        c.drawString(left_margin, y, "Comments/Remarks:")
        y -= 4 * mm
        c.setFont("Helvetica", 8)
        for line in (checklist.comments or "").split("\n"):
            c.drawString(left_margin, y, line[:120])
            y -= 3.5 * mm

    # ─── Signature section ───────────────────────────────────────────────
    if y < 50 * mm:
        c.showPage()
        y = height - 15 * mm

    y -= 8 * mm

    # Build signature parties: Contractor + Approvers
    sig_parties = []
    if contractor:
        sig_parties.append(contractor.name)
    for pa in project_approvers:
        if pa.approver_title:
            sig_parties.append(pa.approver_title.title)
        elif pa.approver:
            sig_parties.append(pa.approver.name)
    if not sig_parties:
        sig_parties = ["Main Contractor", "Consultant", "Technical Advisor"]

    sig_col_w = (width - 24 * mm) / len(sig_parties)
    sig_table_data = [
        [
            Paragraph(
                p,
                ParagraphStyle(
                    "sp", fontSize=8, fontName="Helvetica-Bold", alignment=1
                ),
            )
            for p in sig_parties
        ],
        [Paragraph("Name:", ParagraphStyle("sl", fontSize=8)) for _ in sig_parties],
        [Paragraph("Sign:", ParagraphStyle("sl", fontSize=8)) for _ in sig_parties],
        [Paragraph("Date:", ParagraphStyle("sl", fontSize=8)) for _ in sig_parties],
    ]
    sig_table = Table(
        sig_table_data,
        colWidths=[sig_col_w] * len(sig_parties),
        rowHeights=[6 * mm, 10 * mm, 10 * mm, 10 * mm],
    )
    sig_table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
            ]
        )
    )
    stw, sth = sig_table.wrap(width - 24 * mm, y)
    sig_table.drawOn(c, left_margin, y - sth)

    c.save()
    buf.seek(0)
    return buf.getvalue()
