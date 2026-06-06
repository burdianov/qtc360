"""Report generation: docxtpl fills Word templates, LibreOffice converts to PDF."""
import io
import logging
import tempfile
from pathlib import Path
from typing import Any
from urllib.parse import quote
from uuid import UUID

from docxtpl import DocxTemplate
from docx.shared import Mm
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from jinja2.sandbox import SandboxedEnvironment
from jinja2 import TemplateSyntaxError, Undefined
from pydantic import BaseModel as PydanticModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.database import get_db
from app.core.types import DEFAULT_SIGNATURE_FONT, DEFAULT_SIGNATURE_COLOR, FONTS_DIR, LIBREOFFICE_TIMEOUT, GOTENBERG_TIMEOUT, DEFAULT_DATE_FORMAT, MAX_BUNDLE_BYTES, _mb
from app.services.storage import storage
from app.core.deps import (
    assert_user_in_project,
    get_current_user,
    require_permission,
    require_project_access,
)
from app.models.doc_template import DocTemplate
from app.models.document import Document
from app.models.user import User
from app.services.signature import render_signature, get_available_fonts

router = APIRouter(prefix="/reports", tags=["reports"])

logger = logging.getLogger(__name__)

# Date format cache (loaded once per process from DB)
_date_format_cache: str | None = None


async def _load_date_format(db: AsyncSession) -> str:
    global _date_format_cache
    if _date_format_cache is None:
        from app.models.app_setting import AppSetting
        result = await db.execute(select(AppSetting).where(AppSetting.key == "date_format"))
        item = result.scalar_one_or_none()
        _date_format_cache = item.value if item else DEFAULT_DATE_FORMAT
    return _date_format_cache


_FORMAT_MAP = {
    "DD.MM.YYYY": "%d.%m.%Y",
    "MM/DD/YYYY": "%m/%d/%Y",
    "YYYY-MM-DD": "%Y-%m-%d",
    "DD-MM-YYYY": "%d-%m-%Y",
    "DD/MM/YYYY": "%d/%m/%Y",
}


def _format_date(dt, fmt: str | None = None) -> str:
    if not dt:
        return ""
    from datetime import date as date_cls, datetime as dt_cls
    if isinstance(dt, str):
        try:
            dt = dt_cls.fromisoformat(dt)
        except ValueError:
            return dt
    py_fmt = _FORMAT_MAP.get(fmt or _date_format_cache or DEFAULT_DATE_FORMAT, "%d.%m.%Y")
    return dt.strftime(py_fmt)


def _safe_filename_for_disposition(name: str) -> str:
    """Build a safe Content-Disposition filename, blocking header-splitting via CR/LF."""
    safe_ascii = "".join(c if 32 <= ord(c) < 127 and c not in '"\\' else "_" for c in name)
    encoded = quote(name, safe="")
    return f'filename="{safe_ascii}"; filename*=UTF-8\'\'{encoded}'


# ─── Template Management ─────────────────────────────────────────────────────


@router.post("/templates/upload", status_code=201)
async def upload_template(
    project_id: UUID,
    doc_type: str,
    name: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("reports.templates")),
):
    """Upload a new DOCX template."""
    await assert_user_in_project(user, project_id)
    if not file.filename or not file.filename.lower().endswith(".docx"):
        raise HTTPException(status_code=400, detail="Only .docx files allowed")

    data = await file.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 10MB)")
    if len(data) == 0:
        raise HTTPException(status_code=400, detail="Empty file")

    # Validate template placeholders
    try:
        from docxtpl import DocxTemplate
        tpl = DocxTemplate(io.BytesIO(data))
        env = SandboxedEnvironment(undefined=Undefined)
        env.parse(tpl.get_xml())
    except TemplateSyntaxError as e:
        raise HTTPException(status_code=400, detail=f"Template placeholder error: {e.message}. Use underscores in variable names (e.g. {{{{ delivery_notes }}}} not {{{{ delivery notes }}}}).")
    except Exception:
        pass  # Non-Jinja errors (e.g. corrupt DOCX) will be caught later

    # Deactivate previous active templates for this project+doc_type
    result = await db.execute(
        select(DocTemplate).where(
            DocTemplate.project_id == project_id,
            DocTemplate.doc_type == doc_type.upper(),
            DocTemplate.is_active == True,  # noqa: E712
            DocTemplate.is_deleted == False,  # noqa: E712
        )
    )
    for old in result.scalars().all():
        old.is_active = False

    # Get next version
    ver_result = await db.execute(
        select(DocTemplate).where(
            DocTemplate.project_id == project_id,
            DocTemplate.doc_type == doc_type.upper(),
            DocTemplate.is_deleted == False,  # noqa: E712
        )
    )
    version = len(ver_result.scalars().all()) + 1

    # Auto-detect cover page count by converting the template to PDF and
    # counting pages. Used by the external approval workflow to split returned
    # PDFs into cover + per-page attachments.
    from app.services.pdf import count_pages_in_docx
    cover_pages = count_pages_in_docx(data)

    template = DocTemplate(
        project_id=project_id,
        doc_type=doc_type.upper(),
        name=name,
        file=data,
        filename=file.filename,
        version=version,
        is_active=True,
        cover_page_count=cover_pages,
    )
    db.add(template)
    await db.commit()
    await db.refresh(template)
    return {"id": str(template.id), "name": name, "version": version}


@router.get("/templates")
async def list_templates(
    project_id: UUID,
    doc_type: str | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_project_access()),
):
    """List all templates for a project, optionally filtered by doc_type."""
    q = select(DocTemplate).where(
        DocTemplate.project_id == project_id,
        DocTemplate.is_deleted == False,  # noqa: E712
    )
    if doc_type:
        q = q.where(DocTemplate.doc_type == doc_type.upper())
    result = await db.execute(q.order_by(DocTemplate.doc_type, DocTemplate.version.desc()))
    return [
        {
            "id": str(t.id),
            "doc_type": t.doc_type,
            "name": t.name,
            "filename": t.filename,
            "version": t.version,
            "is_active": t.is_active,
            "created_at": t.created_at.isoformat() if t.created_at else None,
        }
        for t in result.scalars().all()
    ]


@router.get("/templates/{template_id}/download")
async def download_template(
    template_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Download the original DOCX template."""
    result = await db.execute(
        select(DocTemplate).where(DocTemplate.id == template_id, DocTemplate.is_deleted == False)  # noqa: E712
    )
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    await assert_user_in_project(user, template.project_id)
    return Response(
        content=template.file,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f"attachment; {_safe_filename_for_disposition(template.filename or 'template.docx')}"},
    )


@router.delete("/templates/{template_id}", status_code=204)
async def delete_template(
    template_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("reports.templates")),
):
    """Delete a template (hard delete)."""
    result = await db.execute(
        select(DocTemplate).where(DocTemplate.id == template_id, DocTemplate.is_deleted == False)  # noqa: E712
    )
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    await assert_user_in_project(user, template.project_id)
    await db.delete(template)
    await db.commit()


# ─── Signature Fonts ──────────────────────────────────────────────────────────


@router.get("/signature-fonts")
async def list_signature_fonts(_: User = Depends(get_current_user)):
    """List available signature fonts."""
    return get_available_fonts()


@router.get("/signature-preview")
async def preview_signature(
    name: str,
    font_id: str = DEFAULT_SIGNATURE_FONT,
    color: str = DEFAULT_SIGNATURE_COLOR,
):
    """Preview a signature rendering."""
    if len(name) > 200:
        raise HTTPException(status_code=400, detail="Name too long")
    # Validate color is a #RRGGBB hex string.
    import re as _re
    if not _re.fullmatch(r"#[0-9A-Fa-f]{6}", color or ""):
        color = DEFAULT_SIGNATURE_COLOR
    png = render_signature(name, font_id, color=color)
    return Response(content=png, media_type="image/png")


# ─── Report Generation ───────────────────────────────────────────────────────


class GenerateReportRequest(PydanticModel):
    document_id: UUID
    project_id: UUID
    template_id: UUID | None = None


@router.post("/generate/{doc_type}")
async def generate_report(
    doc_type: str,
    body: GenerateReportRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("reports.generate")),
):
    """Generate PDF from document data + Word template. Appends attachments."""
    await assert_user_in_project(user, body.project_id)
    # Get template (specific or active)
    if body.template_id:
        result = await db.execute(
            select(DocTemplate).where(DocTemplate.id == body.template_id, DocTemplate.is_deleted == False)  # noqa: E712
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
        raise HTTPException(status_code=404, detail=f"No active {doc_type.upper()} template")
    if template.project_id != body.project_id:
        raise HTTPException(status_code=400, detail="Template does not belong to this project")

    # Get document data with relationships
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
        raise HTTPException(status_code=400, detail="Document does not belong to this project")

    # Load date format setting
    await _load_date_format(db)

    # Build context from document
    context = _build_context(document)

    # Fill template (with signature images only for signed inspectors)
    docx_bytes = _fill_template(template.file, context, document)

    # Convert to PDF
    pdf_bytes = await _convert_to_pdf(docx_bytes)

    # Load signature config from app_settings
    import json as _json
    from app.models.app_setting import AppSetting
    _sig_default = {"font_size": 36, "cell_width": 75, "x_offset": -0.3, "color": "#1a237e"}
    _sig_setting = (await db.execute(select(AppSetting).where(AppSetting.key == "signature_config"))).scalar_one_or_none()
    _sig_cfg = _sig_default
    if _sig_setting:
        try:
            _sig_cfg = _json.loads(_sig_setting.value).get(document.document_type, _sig_default)
        except Exception:
            pass

    # Stamp vector signatures onto the PDF
    pdf_bytes = _stamp_vector_signatures(pdf_bytes, document, _sig_cfg)

    # Append attachments as additional pages
    from app.models.document_attachment import DocumentAttachment
    att_result = await db.execute(
        select(DocumentAttachment)
        .where(DocumentAttachment.document_id == body.document_id, DocumentAttachment.kind == "user", DocumentAttachment.is_deleted == False)  # noqa: E712
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
            # Sanitize each missing filename so it can't break the response header.
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
        headers={"Content-Disposition": f"inline; {_safe_filename_for_disposition(pdf_filename)}"},
    )


# ─── Health Check ─────────────────────────────────────────────────────────────


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
            return {"status": "healthy", "pdf_engine": "libreoffice", "pdf_size": len(pdf)}
        raise HTTPException(status_code=503, detail="PDF engine returned empty output")
    except HTTPException:
        raise
    except Exception:
        logger.exception("PDF engine health check failed")
        raise HTTPException(status_code=503, detail="PDF engine unhealthy")


# ─── CRS PDF Generation ──────────────────────────────────────────────────────


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

    # Load header image from app_settings
    header_setting = (await db.execute(
        select(AppSetting).where(AppSetting.key == f"crs_header_image_{body.project_id}")
    )).scalar_one_or_none()

    buf = io.BytesIO()
    width, height = A4
    c = canvas.Canvas(buf, pagesize=A4)
    y = height - 5 * mm  # Start higher (was 15mm)

    # 1. Header image
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
            c.drawImage(ImageReader(io.BytesIO(img_data)), 10 * mm, y - draw_h, draw_w, draw_h)
            y -= draw_h + 6 * mm
        except Exception:
            pass

    # Extra spacing after header
    y -= 10 * mm

    # 2. Project name
    c.setFont("Helvetica-Bold", 14)
    c.drawCentredString(width / 2, y, document.project.name if document.project else "")
    y -= 8 * mm

    # 3. Title
    c.setFont("Helvetica-Bold", 13)
    c.drawCentredString(width / 2, y, "CXM's COMMENTS RESPONSE SHEET")
    y -= 13 * mm

    # 4. Reference and revision
    c.setFont("Helvetica", 11)
    c.drawString(15 * mm, y, f"Reference: {document.reference_no}")
    c.drawString(width - 60 * mm, y, f"Revision: {document.revision_no}")
    y -= 6 * mm

    # 5. Subject
    c.drawString(15 * mm, y, f"Subject: {subject}")
    y -= 10 * mm

    # 6. Table (4 columns: SN, CXM's Comments, Status, Responses)
    if rows and len(rows) > 0:
        styles = getSampleStyleSheet()
        cell_style = ParagraphStyle("cell", parent=styles["Normal"], fontSize=10, leading=12)
        cell_center = ParagraphStyle("cellcenter", parent=styles["Normal"], fontSize=10, leading=12, alignment=1)
        header_style = ParagraphStyle("header", parent=styles["Normal"], fontSize=10, leading=12, fontName="Helvetica-Bold")
        header_center = ParagraphStyle("headercenter", parent=styles["Normal"], fontSize=10, leading=12, fontName="Helvetica-Bold", alignment=1)

        table_data = [
            [Paragraph("SN", header_center), Paragraph("CXM's Comments", header_center),
             Paragraph("Status", header_center), Paragraph("Responses to CXM's Comments", header_center)]
        ]
        for row in rows:
            comment_text = str(row.get("comment", "") or "").replace("\n", "<br/>")
            response_text = str(row.get("response", "") or "").replace("\n", "<br/>")
            status_text = str(row.get("status", "") or approver_status or "")
            table_data.append([
                Paragraph(str(row.get("sn", "")), cell_center),
                Paragraph(comment_text, cell_style),
                Paragraph(status_text, cell_center),
                Paragraph(response_text, cell_style),
            ])

        available_w = width - 30 * mm
        col_widths = [10 * mm, (available_w - 10 * mm - 16 * mm) / 2, 16 * mm, (available_w - 10 * mm - 16 * mm) / 2]
        t = Table(table_data, colWidths=col_widths, repeatRows=1)
        t.setStyle(TableStyle([
            ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
            ("BACKGROUND", (0, 0), (-1, 0), colors.Color(0.9, 0.9, 0.9)),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ]))

        tw, th = t.wrap(available_w, y - 15 * mm)
        if th > y - 15 * mm:
            c.showPage()
            y = height - 15 * mm
            tw, th = t.wrap(available_w, y - 15 * mm)
        t.drawOn(c, 15 * mm, y - th)

    c.save()
    buf.seek(0)
    fname = f"{document.reference_no}_{int(document.revision_no or 0):02d}.pdf"
    return Response(content=buf.getvalue(), media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{fname}"'})


# ─── Internal helpers ─────────────────────────────────────────────────────────


def _build_context(document: Document) -> dict:
    """Build template context from a Document model."""
    ctx = {
        "ref_no": document.reference_no or "",
        "revision": str(document.revision_no or 0),
        "prj_no": "",
        "date": _format_date(document.inspection_date),
        "subject": document.title or "",
        "description_of_inspection": document.description or "",
        "gen_loc": document.location or "",
        "floor_level_room": document.floor_level or "",
        "appr_rams": document.rams_ref or "",
        "dwg_ref": document.drawing_ref or "",
    }

    doc_discipline = ""
    disc_code = ""
    if document.discipline:
        doc_discipline = (document.discipline.name or "").lower()
        disc_code = (document.discipline.code or "").upper()

    def cb(selected: bool) -> str:
        return "☒" if selected else "☐"

    # Discipline checkboxes — match by code or name substring
    ctx["arch_cb"] = cb(disc_code == "AR" or "architectural" in doc_discipline) + " Architectural"
    ctx["civil_struct_cb"] = cb(disc_code == "CS" or "civil" in doc_discipline or "structural" in doc_discipline) + " Civil/Structural"
    ctx["mechanical_cb"] = cb(disc_code == "MC" or "mechanical" in doc_discipline) + " Mechanical"
    ctx["electrical_cb"] = cb(disc_code == "EL" or "electrical" in doc_discipline) + " Electrical"
    ctx["plumbing_cb"] = cb(disc_code == "PL" or "plumbing" in doc_discipline) + " Plumbing"
    ctx["firefighting_cb"] = cb(disc_code == "FF" or "fire" in doc_discipline) + " Fire Fighting"
    ctx["others_cb"] = cb(disc_code == "OT" or "other" in doc_discipline) + " Others"

    for i, inspector in enumerate([document.site_engineer, document.qaqc_engineer], start=1):
        if inspector:
            name = inspector.full_name
            desig = inspector.designation.name if inspector.designation else ""
            ctx[f"inspected_by_{i}"] = name
            ctx[f"designation_{i}"] = desig
        else:
            ctx[f"inspected_by_{i}"] = ""
            ctx[f"designation_{i}"] = ""
        ctx[f"date_{i}"] = _format_date(document.inspector_date_1)
        ctx[f"time_{i}"] = document.inspector_time_1 or ""

    if document.project:
        ctx["prj_no"] = document.project.code or ""
        ctx["ec"] = document.project.external_code or ""
        ctx["nm"] = document.project.external_code or ""

    ctx["discipline"] = document.discipline.name if document.discipline else ""

    # MIR-specific placeholders
    ctx["delivery_notes"] = document.delivery_note or ""
    ctx["delivery_note"] = document.delivery_note or ""
    ctx["material_submittals"] = document.material_submittals or ""
    ctx["materials_description"] = document.description or ""
    ctx["qty"] = document.qty or ""
    ctx["location"] = document.location or ""
    ctx["inspected_by"] = ctx.get("inspected_by_1", "")
    ctx["ins_date"] = ctx.get("date_1", "")
    ctx["ins_time"] = ctx.get("time_1", "")
    ctx["signatory_date"] = ctx.get("date_1", "")

    return ctx


def _fill_template(template_bytes: bytes, context: dict, document: Document) -> bytes:
    """Fill a DOCX template with context data, using a sandboxed Jinja env.
    Signatures use SIGMARK markers that are later replaced with vector text on the PDF.
    """
    doc = DocxTemplate(io.BytesIO(template_bytes))

    signed_flags = [document.site_engineer_signed, document.qaqc_engineer_signed]
    for i, inspector in enumerate([document.site_engineer, document.qaqc_engineer], start=1):
        key = f"insp_sign_{i}"
        if inspector and signed_flags[i - 1]:
            context[key] = f"SIGMARK{i}"
        else:
            context[key] = ""

    # MIR uses inspected_by_sign instead of insp_sign_1
    context["inspected_by_sign"] = context.get("insp_sign_1", "")

    sandbox_env = SandboxedEnvironment(undefined=Undefined)
    try:
        doc.render(context, jinja_env=sandbox_env)
    except TemplateSyntaxError as e:
        raise HTTPException(status_code=400, detail=f"Template syntax error at line {e.lineno}: {e.message}. Check your DOCX template placeholders (use underscores, not spaces).")
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def _stamp_vector_signatures(pdf_bytes: bytes, document: Document, sig_cfg: dict | None = None) -> bytes:
    """Overlay vector text signatures onto the PDF using reportlab.
    Finds the signature marker text and draws the signature font text at that location.
    Reads sizing/positioning from sig_cfg dict.
    """
    if not sig_cfg:
        sig_cfg = {"font_size": 36, "cell_width": 75, "x_offset": -0.3, "color": "#1a237e"}
    from reportlab.pdfgen import canvas
    from reportlab.lib.pagesizes import letter
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from pypdf import PdfReader, PdfWriter
    import fitz  # PyMuPDF

    signed_flags = [document.site_engineer_signed, document.qaqc_engineer_signed]
    inspectors = [document.site_engineer, document.qaqc_engineer]

    # Collect signature info
    sigs_to_stamp: list[dict] = []
    for i, inspector in enumerate(inspectors, start=1):
        if inspector and signed_flags[i - 1]:
            sig_name = inspector.signature_text or inspector.full_name
            font_id = inspector.signature_font or DEFAULT_SIGNATURE_FONT
            marker = f"SIGMARK{i}"
            sigs_to_stamp.append({"marker": marker, "name": sig_name, "font_id": font_id})

    if not sigs_to_stamp:
        return pdf_bytes

    # Register signature fonts with reportlab
    fonts_dir = FONTS_DIR
    from app.services.signature import SIGNATURE_FONTS
    registered_fonts: set[str] = set()
    for sig in sigs_to_stamp:
        fid = sig["font_id"]
        if fid not in registered_fonts:
            font_file = SIGNATURE_FONTS.get(fid, SIGNATURE_FONTS["dancing_script"])
            font_path = fonts_dir / font_file
            try:
                pdfmetrics.registerFont(TTFont(fid, str(font_path)))
            except Exception:
                pass
            registered_fonts.add(fid)

    # Use PyMuPDF to find marker text positions
    pdf_doc = fitz.open(stream=pdf_bytes, filetype="pdf")

    for sig in sigs_to_stamp:
        marker = sig["marker"]
        for page_idx in range(len(pdf_doc)):
            page = pdf_doc[page_idx]
            instances = page.search_for(marker)
            if instances:
                # Take the first instance
                rect = instances[0]
                sig["page"] = page_idx
                sig["x"] = rect.x0
                sig["y"] = rect.y0
                sig["width"] = rect.width
                sig["height"] = rect.height
                sig["page_height"] = page.rect.height
                # Redact the marker text (white it out)
                for inst in instances:
                    page.add_redact_annot(inst, fill=(1, 1, 1))
                page.apply_redactions()
                break

    # Save the redacted PDF
    redacted_bytes = pdf_doc.tobytes()
    pdf_doc.close()

    # Now overlay vector signatures using reportlab
    reader = PdfReader(io.BytesIO(redacted_bytes))
    writer = PdfWriter()

    for page_idx in range(len(reader.pages)):
        page = reader.pages[page_idx]
        page_width = float(page.mediabox.width)
        page_height = float(page.mediabox.height)

        # Check if any signature goes on this page
        page_sigs = [s for s in sigs_to_stamp if s.get("page") == page_idx]

        if page_sigs:
            # Create overlay with reportlab
            overlay_buf = io.BytesIO()
            c = canvas.Canvas(overlay_buf, pagesize=(page_width, page_height))

            for sig in page_sigs:
                font_id = sig["font_id"]
                name = sig["name"]
                # PyMuPDF coords: origin top-left; reportlab: origin bottom-left
                x = sig["x"] - sig["width"] * sig_cfg["x_offset"]
                y = page_height - sig["y"] - sig["height"]
                # Scale signature to fill the cell
                cell_width = sig_cfg["cell_width"]
                font_size = sig_cfg["font_size"]
                try:
                    c.setFont(font_id, font_size)
                except Exception:
                    c.setFont("Helvetica", font_size)
                # Scale down to fit within cell_width
                from reportlab.pdfbase.pdfmetrics import stringWidth
                text_width = stringWidth(name, font_id, font_size)
                if text_width > cell_width and text_width > 0:
                    font_size = font_size * (cell_width / text_width)
                    try:
                        c.setFont(font_id, font_size)
                    except Exception:
                        c.setFont("Helvetica", font_size)
                # Parse color
                color_hex = sig_cfg["color"]
                r = int(color_hex[1:3], 16) / 255
                g = int(color_hex[3:5], 16) / 255
                b = int(color_hex[5:7], 16) / 255
                c.setFillColorRGB(r, g, b)
                c.drawString(x, y, name)

            c.save()
            overlay_buf.seek(0)

            # Merge overlay onto page
            overlay_reader = PdfReader(overlay_buf)
            page.merge_page(overlay_reader.pages[0])

        writer.add_page(page)

    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def _insert_signatures_fitted(docx_bytes: bytes, sig_data: dict[str, bytes]) -> bytes:
    """Replace signature placeholder text in table cells with fitted images."""
    from docx import Document as DocxDoc
    from docx.shared import Emu
    from PIL import Image as PILImage

    doc = DocxDoc(io.BytesIO(docx_bytes))

    placeholders = {f"__SIG_PLACEHOLDER_{i}__": key for i, key in enumerate(sig_data.keys(), start=1)}
    processed = set()

    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                cell_text = cell.text.strip()
                if cell_text in placeholders and id(cell) not in processed:
                    processed.add(id(cell))
                    sig_key = placeholders[cell_text]
                    png_bytes = sig_data[sig_key]

                    max_w = cell.width if cell.width else Mm(40)
                    max_h = row.height if row.height else Mm(10)
                    max_w_in = max_w / 914400
                    max_h_in = max_h / 914400

                    img = PILImage.open(io.BytesIO(png_bytes))
                    img_w, img_h = img.size
                    img_ratio = img_w / img_h
                    box_ratio = max_w_in / max_h_in

                    pad = 0.8
                    if img_ratio > box_ratio:
                        width = int(max_w * pad)
                        height = int(width / img_ratio)
                    else:
                        height = int(max_h * pad)
                        width = int(height * img_ratio)

                    for p in cell.paragraphs:
                        for run in p.runs:
                            run.text = ""
                    paragraph = cell.paragraphs[0]
                    paragraph.alignment = 1
                    run = paragraph.add_run()
                    run.add_picture(io.BytesIO(png_bytes), width=width, height=height)

    out = io.BytesIO()
    doc.save(out)
    return out.getvalue()


async def _convert_to_pdf(docx_bytes: bytes) -> bytes:
    """Convert DOCX to PDF via Gotenberg (preferred) or LibreOffice fallback."""
    import asyncio
    import httpx

    # Try Gotenberg first
    gotenberg_url = settings.gotenberg_url.rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=GOTENBERG_TIMEOUT) as client:
            resp = await client.post(
                f"{gotenberg_url}/forms/libreoffice/convert",
                files={"files": ("document.docx", docx_bytes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
            )
            if resp.status_code == 200:
                return resp.content
            logger.warning("Gotenberg returned %s, falling back to local LibreOffice", resp.status_code)
    except Exception as e:
        logger.warning("Gotenberg unavailable (%s), falling back to local LibreOffice", e)

    # Fallback: local LibreOffice
    libre = settings.libreoffice_path
    with tempfile.TemporaryDirectory() as tmp_dir:
        docx_path = Path(tmp_dir) / "document.docx"
        docx_path.write_bytes(docx_bytes)

        cmd = [
            libre, "--headless", "--norestore", "--nologo",
            "--nofirststartwizard", "--convert-to", "pdf",
            "--outdir", tmp_dir, str(docx_path),
        ]
        try:
            import subprocess
            proc = await asyncio.to_thread(
                subprocess.run, cmd, capture_output=True, timeout=LIBREOFFICE_TIMEOUT,
            )
        except FileNotFoundError:
            raise HTTPException(status_code=500, detail="PDF engine not configured (Gotenberg down, LibreOffice not found)")
        except subprocess.TimeoutExpired:
            raise HTTPException(status_code=500, detail="PDF generation timed out")
        if proc.returncode != 0:
            logger.error("LibreOffice exited %s; stderr=%r", proc.returncode, proc.stderr[-500:] if proc.stderr else b"")
            raise HTTPException(status_code=500, detail="Report generation failed")

        pdf_path = Path(tmp_dir) / "document.pdf"
        if not pdf_path.exists():
            raise HTTPException(status_code=500, detail="PDF not generated")
        return pdf_path.read_bytes()


def _merge_attachments_with_status(main_pdf: bytes, attachments) -> tuple[bytes, list[str]]:
    """Merge attachment files from web server storage into the main PDF.

    Raises:
        ValueError: if the total input size (main + all attachments) exceeds
            MAX_BUNDLE_BYTES. Callers should translate this into HTTP 413.
    """
    try:
        from pypdf import PdfReader, PdfWriter
    except ImportError:
        return main_pdf, []

    running_total = len(main_pdf)

    writer = PdfWriter()
    reader = PdfReader(io.BytesIO(main_pdf))
    for page in reader.pages:
        writer.add_page(page)

    missing_files = []
    for att in attachments:
        if not storage.exists(att.storage_path):
            missing_files.append(att.filename)
            continue

        att_bytes = storage.read(att.storage_path)
        running_total += len(att_bytes)
        if running_total > MAX_BUNDLE_BYTES:
            raise ValueError(
                f"Bundle too large (>{_mb(MAX_BUNDLE_BYTES)}MB limit). "
                "Reduce the number or size of attachments."
            )
        suffix = Path(att.storage_path).suffix.lower()
        if suffix == ".pdf":
            try:
                att_reader = PdfReader(io.BytesIO(att_bytes))
                for page in att_reader.pages:
                    writer.add_page(page)
            except Exception:
                logger.exception("Failed to read attachment PDF %s", att.storage_path)
                missing_files.append(att.filename)
        elif suffix in (".jpg", ".jpeg", ".png"):
            try:
                from PIL import Image as PILImage
                from reportlab.lib.pagesizes import A4
                from reportlab.pdfgen import canvas as rl_canvas
                from reportlab.lib.utils import ImageReader

                img = PILImage.open(io.BytesIO(att_bytes))
                img_buf = io.BytesIO()
                c = rl_canvas.Canvas(img_buf, pagesize=A4)
                max_w, max_h = A4[0] - 72, A4[1] - 72
                ratio = min(max_w / img.width, max_h / img.height)
                w, h = img.width * ratio, img.height * ratio
                c.drawImage(ImageReader(io.BytesIO(att_bytes)), 36, A4[1] - h - 36, w, h)
                c.save()
                img_buf.seek(0)
                img_reader = PdfReader(img_buf)
                for page in img_reader.pages:
                    writer.add_page(page)
            except Exception:
                logger.exception("Failed to render attachment image %s", file_path)
                missing_files.append(att.filename)
        else:
            missing_files.append(att.filename)

    output = io.BytesIO()
    writer.write(output)

    return output.getvalue(), missing_files

