"""Report generation, CRS PDF, health check, and latest-PDF endpoints."""

import io
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel as PydanticModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.deps import (
    assert_user_in_project,
    get_current_user,
    require_permission,
)
from app.core.types import BUNDLE_KINDS, DEFAULT_SIG_CONFIG
from app.models.doc_template import DocTemplate
from app.models.document import Document
from app.models.user import User
from app.services.storage import storage
from app.api.v1.reports.helpers import (
    _build_context,
    _fill_template,
    _stamp_vector_signatures,
    _merge_attachments_with_status,
    _convert_to_pdf,
    _load_date_format,
    _safe_filename_for_disposition,
    logger,
)

router = APIRouter()


class GenerateReportRequest(PydanticModel):
    document_id: UUID
    project_id: UUID
    template_id: UUID | None = None


# ── Generate report ──────────────────────────────────────────────────────────

@router.post("/generate/{doc_type}")
async def generate_report(
    doc_type: str,
    body: GenerateReportRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("reports.generate")),
):
    """Generate PDF from document data + Word template. Appends attachments."""
    await assert_user_in_project(user, body.project_id)
    if body.template_id:
        result = await db.execute(
            select(DocTemplate).where(
                DocTemplate.id == body.template_id, DocTemplate.is_deleted == False  # noqa: E712
            )
        )
    else:
        result = await db.execute(
            select(DocTemplate).where(
                DocTemplate.project_id == body.project_id,
                DocTemplate.doc_type == doc_type.upper(),
                DocTemplate.is_active == True,  # noqa: E712
                DocTemplate.is_deleted == False,  # noqa: E712
            )
        )
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(
            status_code=404, detail=f"No active {doc_type.upper()} template"
        )
    if template.project_id != body.project_id:
        raise HTTPException(
            status_code=400, detail="Template does not belong to this project"
        )

    doc_result = await db.execute(
        select(Document)
        .where(Document.id == body.document_id, Document.is_deleted == False)  # noqa: E712
        .options(
            selectinload(Document.discipline),
            selectinload(Document.project),
            selectinload(Document.site_engineer).selectinload(User.designation),
            selectinload(Document.qaqc_engineer).selectinload(User.designation),
        )
    )
    document = doc_result.scalar_one_or_none()
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    if document.project_id != body.project_id:
        raise HTTPException(
            status_code=400, detail="Document does not belong to this project"
        )

    await _load_date_format(db)

    context = _build_context(document)
    docx_bytes = _fill_template(template.file, context, document)
    pdf_bytes = await _convert_to_pdf(docx_bytes)

    import json as _json
    from app.models.user_preference import UserPreference

    _user_sig_cfgs = {}
    for inspector in [document.site_engineer, document.qaqc_engineer]:
        if inspector:
            pref_result = await db.execute(
                select(UserPreference).where(
                    UserPreference.user_id == inspector.id,
                    UserPreference.key == "signature_display",
                    UserPreference.is_deleted == False,  # noqa: E712
                )
            )
            pref = pref_result.scalar_one_or_none()
            if pref and pref.value:
                try:
                    v = pref.value
                    if isinstance(v, str):
                        v = _json.loads(v)
                    _user_sig_cfgs[str(inspector.id)] = {**DEFAULT_SIG_CONFIG, **v}
                except Exception:
                    _user_sig_cfgs[str(inspector.id)] = DEFAULT_SIG_CONFIG
            else:
                _user_sig_cfgs[str(inspector.id)] = DEFAULT_SIG_CONFIG

    pdf_bytes = _stamp_vector_signatures(
        pdf_bytes, document, DEFAULT_SIG_CONFIG, _user_sig_cfgs
    )

    from app.models.document_attachment import DocumentAttachment

    att_result = await db.execute(
        select(DocumentAttachment)
        .where(
            DocumentAttachment.document_id == body.document_id,
            DocumentAttachment.kind.in_(BUNDLE_KINDS),
            DocumentAttachment.is_deleted == False, )  # noqa: E712
        .order_by(DocumentAttachment.sort_order, DocumentAttachment.id)
    )
    attachments = att_result.scalars().all()

    ref = document.reference_no or "draft"
    rev = int(document.revision_no or 0)
    pdf_filename = f"{ref}_{rev:02d}.pdf"

    if attachments:
        try:
            pdf_bytes, missing = _merge_attachments_with_status(pdf_bytes, attachments)
        except ValueError as e:
            raise HTTPException(status_code=413, detail=str(e))
        if missing:
            safe_missing = [m.replace("\r", " ").replace("\n", " ") for m in missing]
            return Response(
                content=pdf_bytes,
                media_type="application/pdf",
                headers={
                    "Content-Disposition": f"inline; {_safe_filename_for_disposition(pdf_filename)}",
                    "X-Missing-Attachments": ", ".join(safe_missing),
                },
            )

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"inline; {_safe_filename_for_disposition(pdf_filename)}"
        },
    )


# ── Health check ─────────────────────────────────────────────────────────────

@router.get("/pdf-engine/health")
async def pdf_engine_health(_: User = Depends(get_current_user)):
    """Check LibreOffice is available and can convert DOCX to PDF."""
    try:
        from docx import Document as DocxDoc

        doc = DocxDoc()
        doc.add_paragraph("Health check")
        buf = io.BytesIO()
        doc.save(buf)
        test_docx = buf.getvalue()
        pdf = await _convert_to_pdf(test_docx)
        if pdf and len(pdf) > 0:
            return {
                "status": "healthy",
                "pdf_engine": "libreoffice",
                "pdf_size": len(pdf),
            }
        raise HTTPException(status_code=503, detail="PDF engine returned empty output")
    except HTTPException:
        raise
    except Exception:
        logger.exception("PDF engine health check failed")
        raise HTTPException(status_code=503, detail="PDF engine unhealthy")


# ── Latest PDF ───────────────────────────────────────────────────────────────

@router.get("/latest-pdf/{document_id}")
async def get_latest_pdf(
    document_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Return the latest PDF for a document based on its approval chain state."""
    from app.models.document_approval_round import DocumentApprovalRound

    doc = await db.get(Document, document_id)
    if not doc or doc.is_deleted:
        raise HTTPException(status_code=404, detail="Document not found")
    await assert_user_in_project(user, doc.project_id)

    rounds_result = await db.execute(
        select(DocumentApprovalRound)
        .where(DocumentApprovalRound.document_id == document_id)
        .order_by(
            DocumentApprovalRound.approver_order.desc(),
            DocumentApprovalRound.round_no.desc(),
        )
    )
    rounds = rounds_result.scalars().all()

    for rnd in rounds:
        if rnd.returned_file_path:
            data = storage.read(rnd.returned_file_path)
            if data:
                rev = str(doc.revision_no or 0).zfill(2)
                fname = f"{doc.reference_no}_{rev}.pdf"
                return Response(
                    content=data,
                    media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="{fname}"'},
                )
        if rnd.submitted_file_path:
            data = storage.read(rnd.submitted_file_path)
            if data:
                rev = str(doc.revision_no or 0).zfill(2)
                fname = f"{doc.reference_no}_{rev}.pdf"
                return Response(
                    content=data,
                    media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="{fname}"'},
                )

    raise HTTPException(
        status_code=404,
        detail="No approval files available. Use POST /reports/generate/{doc_type} to create a PDF.",
    )


# ── CRS PDF generation ──────────────────────────────────────────────────────

@router.post("/generate-crs")
async def generate_crs_pdf(
    body: GenerateReportRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("reports.generate")),
):
    """Generate CRS PDF directly using reportlab (no DOCX template)."""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.pdfgen import canvas
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.platypus import Table, TableStyle, Paragraph
    from reportlab.lib import colors
    from app.models.app_setting import AppSetting

    await assert_user_in_project(user, body.project_id)

    doc_result = await db.execute(
        select(Document)
        .where(Document.id == body.document_id, Document.is_deleted == False)  # noqa: E712
        .options(selectinload(Document.project))
    )
    document = doc_result.scalar_one_or_none()
    if not document or document.document_type != "CRS":
        raise HTTPException(status_code=404, detail="CRS document not found")

    crs = document.crs_data or {}
    rows = crs.get("rows", [])
    subject = document.title or ""
    approver_status = crs.get("approver_status", "")

    header_setting = (
        await db.execute(
            select(AppSetting).where(
                AppSetting.key == f"crs_header_image_{body.project_id}"
            )
        )
    ).scalar_one_or_none()

    buf = io.BytesIO()
    width, height = A4
    c = canvas.Canvas(buf, pagesize=A4)
    y = height - 5 * mm

    if header_setting and header_setting.value:
        try:
            import base64

            img_data = base64.b64decode(header_setting.value)
            from reportlab.lib.utils import ImageReader
            from PIL import Image as PILImage

            img = PILImage.open(io.BytesIO(img_data))
            img_w, img_h = img.size
            max_w = width - 20 * mm
            ratio = min(max_w / img_w, 35 * mm / img_h)
            draw_w, draw_h = img_w * ratio, img_h * ratio
            c.drawImage(
                ImageReader(io.BytesIO(img_data)), 10 * mm, y - draw_h, draw_w, draw_h
            )
            y -= draw_h + 6 * mm
        except Exception:
            pass

    y -= 10 * mm

    c.setFont("Helvetica-Bold", 14)
    c.drawCentredString(width / 2, y, document.project.name if document.project else "")
    y -= 8 * mm

    c.setFont("Helvetica-Bold", 13)
    c.drawCentredString(width / 2, y, "CXM's COMMENTS RESPONSE SHEET")
    y -= 13 * mm

    c.setFont("Helvetica", 11)
    c.drawString(15 * mm, y, f"Reference: {document.reference_no}")
    c.drawString(width - 60 * mm, y, f"Revision: {document.revision_no}")
    y -= 6 * mm

    c.drawString(15 * mm, y, f"Subject: {subject}")
    y -= 10 * mm

    if rows and len(rows) > 0:
        styles = getSampleStyleSheet()
        cell_style = ParagraphStyle(
            "cell", parent=styles["Normal"], fontSize=10, leading=12
        )
        cell_center = ParagraphStyle(
            "cellcenter", parent=styles["Normal"], fontSize=10, leading=12, alignment=1
        )
        header_center = ParagraphStyle(
            "headercenter",
            parent=styles["Normal"],
            fontSize=10,
            leading=12,
            fontName="Helvetica-Bold",
            alignment=1,
        )

        table_data = [
            [
                Paragraph("SN", header_center),
                Paragraph("CXM's Comments", header_center),
                Paragraph("Status", header_center),
                Paragraph("Responses to CXM's Comments", header_center),
            ]
        ]
        for row in rows:
            comment_text = str(row.get("comment", "") or "").replace("\n", "<br/>")
            response_text = str(row.get("response", "") or "").replace("\n", "<br/>")
            status_text = str(row.get("status", "") or approver_status or "")
            table_data.append(
                [
                    Paragraph(str(row.get("sn", "")), cell_center),
                    Paragraph(comment_text, cell_style),
                    Paragraph(status_text, cell_center),
                    Paragraph(response_text, cell_style),
                ]
            )

        available_w = width - 30 * mm
        col_widths = [
            10 * mm,
            (available_w - 10 * mm - 16 * mm) / 2,
            16 * mm,
            (available_w - 10 * mm - 16 * mm) / 2,
        ]
        t = Table(table_data, colWidths=col_widths, repeatRows=1)
        t.setStyle(
            TableStyle(
                [
                    ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
                    ("BACKGROUND", (0, 0), (-1, 0), colors.Color(0.9, 0.9, 0.9)),
                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                    ("TOPPADDING", (0, 0), (-1, -1), 6),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ]
            )
        )

        tw, th = t.wrap(available_w, y - 15 * mm)
        if th > y - 15 * mm:
            c.showPage()
            y = height - 15 * mm
            tw, th = t.wrap(available_w, y - 15 * mm)
        t.drawOn(c, 15 * mm, y - th)

    c.save()
    buf.seek(0)
    fname = f"{document.reference_no}_{int(document.revision_no or 0):02d}.pdf"
    return Response(
        content=buf.getvalue(),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )
