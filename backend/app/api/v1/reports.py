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
from pydantic import BaseModel as PydanticModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.database import get_db
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
        _date_format_cache = item.value if item else "DD.MM.YYYY"
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
    py_fmt = _FORMAT_MAP.get(fmt or _date_format_cache or "DD.MM.YYYY", "%d.%m.%Y")
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
    font_id: str = "dancing_script",
    color: str = "#1a237e",
):
    """Preview a signature rendering."""
    if len(name) > 200:
        raise HTTPException(status_code=400, detail="Name too long")
    # Validate color is a #RRGGBB hex string.
    import re as _re
    if not _re.fullmatch(r"#[0-9A-Fa-f]{6}", color or ""):
        color = "#1a237e"
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

    # Stamp vector signatures onto the PDF (resolution-independent)
    pdf_bytes = _stamp_vector_signatures(pdf_bytes, document)

    # Append attachments as additional pages
    from app.models.document_attachment import DocumentAttachment
    att_result = await db.execute(
        select(DocumentAttachment)
        .where(DocumentAttachment.document_id == body.document_id, DocumentAttachment.is_deleted == False)  # noqa: E712
        .order_by(DocumentAttachment.sort_order, DocumentAttachment.id)
    )
    attachments = att_result.scalars().all()

    pdf_filename = f"{doc_type.upper()}_{document.reference_no or 'draft'}"
    if document.revision_no > 0:
        from app.models.app_setting import AppSetting as AS2
        rev_fmt_result = await db.execute(select(AS2).where(AS2.key == "revision_suffix_format"))
        rev_fmt_row = rev_fmt_result.scalar_one_or_none()
        rev_fmt = rev_fmt_row.value if rev_fmt_row else "{ref}-REV-{rev}"
        pdf_filename = rev_fmt.replace("{ref}", pdf_filename).replace("{rev}", str(document.revision_no))
    pdf_filename += ".pdf"

    if attachments:
        pdf_bytes, missing = _merge_attachments_with_status(pdf_bytes, attachments)
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
    if document.discipline:
        doc_discipline = (document.discipline.name or "").lower().replace(" ", "_").replace("/", "_")

    def cb(selected: bool) -> str:
        return "[X]" if selected else "[  ]"

    ctx["arch_cb"] = cb("architectural" in doc_discipline) + " Architectural"
    ctx["civil_struct_cb"] = cb("civil" in doc_discipline or "structural" in doc_discipline) + " Civil/Structural"
    ctx["mechanical_cb"] = cb("mechanical" in doc_discipline) + " Mechanical"
    ctx["electrical_cb"] = cb("electrical" in doc_discipline) + " Electrical"
    ctx["plumbing_cb"] = cb("plumbing" in doc_discipline) + " Plumbing"
    ctx["firefighting_cb"] = cb("firefighting" in doc_discipline or "fire" in doc_discipline) + " Firefighting"
    ctx["others_cb"] = cb("others" in doc_discipline or "other" in doc_discipline) + " Others"

    ctx["arch"] = f"{ctx['arch_cb']} Architectural"
    ctx["civil_struct"] = f"{ctx['civil_struct_cb']} Civil/Structural"
    ctx["mechanical"] = f"{ctx['mechanical_cb']} Mechanical"
    ctx["electrical"] = f"{ctx['electrical_cb']} Electrical"
    ctx["plumbing"] = f"{ctx['plumbing_cb']} Plumbing"
    ctx["firefighting"] = f"{ctx['firefighting_cb']} Firefighting"
    ctx["others"] = f"{ctx['others_cb']} Others"

    for i, inspector in enumerate([document.site_engineer, document.qaqc_engineer], start=1):
        if inspector:
            ctx[f"inspected_by_{i}"] = inspector.full_name
            ctx[f"designation_{i}"] = inspector.designation.name if inspector.designation else ""
        else:
            ctx[f"inspected_by_{i}"] = ""
            ctx[f"designation_{i}"] = ""
        ctx[f"date_{i}"] = getattr(document, f"inspector_date_{i}", "") or ""
        ctx[f"time_{i}"] = getattr(document, f"inspector_time_{i}", "") or ""
        ctx[f"remarks_{i}"] = getattr(document, f"remarks_{i}", "") or ""

    if document.project:
        ctx["prj_no"] = document.project.code or ""
        ctx["ec"] = document.project.external_code or ""
        ctx["nm"] = document.project.external_code or ""

    ctx["discipline"] = document.discipline.name if document.discipline else ""

    # MIR-specific placeholders
    ctx["delivery notes"] = document.delivery_note or ""
    ctx["material_submittals"] = document.material_submittals or ""
    ctx["qty"] = document.qty or ""
    # MIR uses single inspector format
    ctx["inspected by"] = ctx.get("inspected_by_1", "")
    ctx["inspected_by_sign"] = ctx.get("insp_sign_1", "") if hasattr(document, "site_engineer_signed") and document.site_engineer_signed else ""
    ctx["ins_date"] = ctx.get("date_1", "")
    ctx["ins_time"] = ctx.get("time_1", "")

    return ctx


def _fill_template(template_bytes: bytes, context: dict, document: Document) -> bytes:
    """Fill a DOCX template with context data, using a sandboxed Jinja env.
    Signatures are NOT embedded as images here — they are stamped as vector text
    onto the final PDF by _stamp_vector_signatures().
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

    sandbox_env = SandboxedEnvironment()
    doc.render(context, jinja_env=sandbox_env)
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def _stamp_vector_signatures(pdf_bytes: bytes, document: Document) -> bytes:
    """Overlay vector text signatures onto the PDF using reportlab.
    Finds the signature marker text and draws the signature font text at that location.
    """
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
            font_id = inspector.signature_font or "dancing_script"
            marker = f"SIGMARK{i}"
            sigs_to_stamp.append({"marker": marker, "name": sig_name, "font_id": font_id})

    if not sigs_to_stamp:
        return pdf_bytes

    # Register signature fonts with reportlab
    fonts_dir = Path(__file__).parent.parent.parent / "fonts"
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
                x = sig["x"]
                y = page_height - sig["y"] - sig["height"]
                # Draw signature text — fit within both cell height and width
                font_size = sig["height"] * 0.8
                try:
                    c.setFont(font_id, font_size)
                except Exception:
                    c.setFont("Helvetica", font_size)
                # Scale down if text is wider than available cell width
                cell_width = page_width * 0.3  # typical signature cell is ~30% of page width
                # Measure text width at current font size
                from reportlab.pdfbase.pdfmetrics import stringWidth
                text_width = stringWidth(name, font_id, font_size)
                if text_width > cell_width and text_width > 0:
                    font_size = font_size * (cell_width / text_width)
                    try:
                        c.setFont(font_id, font_size)
                    except Exception:
                        c.setFont("Helvetica", font_size)
                # Parse color
                color_hex = "#1a237e"
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
        async with httpx.AsyncClient(timeout=30) as client:
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
            proc = await asyncio.create_subprocess_exec(
                *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            )
            _, stderr = await asyncio.wait_for(proc.communicate(), timeout=60)
        except FileNotFoundError:
            raise HTTPException(status_code=500, detail="PDF engine not configured (Gotenberg down, LibreOffice not found)")
        except asyncio.TimeoutError:
            proc.kill()
            raise HTTPException(status_code=500, detail="PDF generation timed out")
        if proc.returncode != 0:
            logger.error("LibreOffice exited %s; stderr=%r", proc.returncode, stderr[-500:] if stderr else b"")
            raise HTTPException(status_code=500, detail="Report generation failed")

        pdf_path = Path(tmp_dir) / "document.pdf"
        if not pdf_path.exists():
            raise HTTPException(status_code=500, detail="PDF not generated")
        return pdf_path.read_bytes()


def _merge_attachments_with_status(main_pdf: bytes, attachments) -> tuple[bytes, list[str]]:
    """Merge attachment files from web server storage into the main PDF."""
    try:
        from pypdf import PdfReader, PdfWriter
    except ImportError:
        return main_pdf, []

    writer = PdfWriter()
    reader = PdfReader(io.BytesIO(main_pdf))
    for page in reader.pages:
        writer.add_page(page)

    upload_root = settings.upload_dir_abs
    missing_files = []
    for att in attachments:
        # Resolve the storage path against the upload root and reject path traversal.
        candidate = (upload_root / att.storage_path).resolve()
        try:
            candidate.relative_to(upload_root)
        except ValueError:
            logger.warning("Attachment %s escapes upload_dir; skipping", att.id)
            missing_files.append(att.filename)
            continue
        file_path = candidate
        if not file_path.exists():
            missing_files.append(att.filename)
            continue

        suffix = file_path.suffix.lower()
        if suffix == ".pdf":
            try:
                att_reader = PdfReader(str(file_path))
                for page in att_reader.pages:
                    writer.add_page(page)
            except Exception:
                logger.exception("Failed to read attachment PDF %s", file_path)
                missing_files.append(att.filename)
        elif suffix in (".jpg", ".jpeg", ".png"):
            try:
                from PIL import Image as PILImage
                from reportlab.lib.pagesizes import A4
                from reportlab.pdfgen import canvas as rl_canvas
                from reportlab.lib.utils import ImageReader

                img = PILImage.open(str(file_path))
                img_buf = io.BytesIO()
                c = rl_canvas.Canvas(img_buf, pagesize=A4)
                max_w, max_h = A4[0] - 72, A4[1] - 72
                ratio = min(max_w / img.width, max_h / img.height)
                w, h = img.width * ratio, img.height * ratio
                c.drawImage(ImageReader(str(file_path)), 36, A4[1] - h - 36, w, h)
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

