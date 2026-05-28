"""Report generation: docxtpl fills Word templates, LibreOffice converts to PDF."""
import io
import logging
import subprocess
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

    # Build context from document
    context = _build_context(document)

    # Fill template (with signature images only for signed inspectors)
    docx_bytes = _fill_template(template.file, context, document)

    # Convert to PDF
    pdf_bytes = _convert_to_pdf(docx_bytes)

    # Append attachments as additional pages
    from app.models.document_attachment import DocumentAttachment
    att_result = await db.execute(
        select(DocumentAttachment)
        .where(DocumentAttachment.document_id == body.document_id, DocumentAttachment.is_deleted == False)  # noqa: E712
        .order_by(DocumentAttachment.sort_order, DocumentAttachment.id)
    )
    attachments = att_result.scalars().all()

    pdf_filename = f"{doc_type.upper()}_{document.reference_no or 'draft'}.pdf"

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
        pdf = _convert_to_pdf(test_docx)
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
        "date": document.inspection_date.strftime("%d/%m/%Y") if document.inspection_date else "",
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
            ctx[f"date_{i}"] = document.submitted_date.strftime("%d/%m/%Y") if document.submitted_date else ""
            ctx[f"time_{i}"] = document.submitted_date.strftime("%H:%M") if document.submitted_date else ""
            ctx[f"remarks_{i}"] = ""
        else:
            ctx[f"inspected_by_{i}"] = ""
            ctx[f"designation_{i}"] = ""
            ctx[f"date_{i}"] = ""
            ctx[f"time_{i}"] = ""
            ctx[f"remarks_{i}"] = ""

    if document.project:
        ctx["prj_no"] = document.project.code or ""
        ctx["ec"] = document.project.external_code or ""
        ctx["nm"] = document.project.external_code or ""

    ctx["discipline"] = document.discipline.name if document.discipline else ""

    return ctx


def _fill_template(template_bytes: bytes, context: dict, document: Document) -> bytes:
    """Fill a DOCX template with context data and signature images, using a sandboxed Jinja env."""
    doc = DocxTemplate(io.BytesIO(template_bytes))

    sig_data: dict[str, bytes] = {}
    signed_flags = [document.site_engineer_signed, document.qaqc_engineer_signed]
    for i, inspector in enumerate([document.site_engineer, document.qaqc_engineer], start=1):
        key = f"insp_sign_{i}"
        if inspector and signed_flags[i - 1]:
            font_id = inspector.signature_font or "dancing_script"
            sig_name = inspector.signature_text or inspector.full_name
            sig_data[key] = render_signature(sig_name, font_id)
            context[key] = f"__SIG_PLACEHOLDER_{i}__"
        else:
            context[key] = ""

    sandbox_env = SandboxedEnvironment()
    doc.render(context, jinja_env=sandbox_env)
    buf = io.BytesIO()
    doc.save(buf)

    if sig_data:
        buf = io.BytesIO(_insert_signatures_fitted(buf.getvalue(), sig_data))

    return buf.getvalue()


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


def _convert_to_pdf(docx_bytes: bytes) -> bytes:
    """Convert DOCX to PDF using LibreOffice headless."""
    libre = settings.libreoffice_path
    with tempfile.TemporaryDirectory() as tmp_dir:
        docx_path = Path(tmp_dir) / "document.docx"
        docx_path.write_bytes(docx_bytes)

        cmd = [
            libre,
            "--headless",
            "--norestore",
            "--nologo",
            "--nofirststartwizard",
            "--convert-to", "pdf",
            "--outdir", tmp_dir,
            str(docx_path),
        ]
        try:
            proc = subprocess.run(cmd, capture_output=True, timeout=60)
        except FileNotFoundError:
            logger.exception("LibreOffice binary not found at %s", libre)
            raise HTTPException(status_code=500, detail="PDF engine not configured")
        except subprocess.TimeoutExpired:
            logger.error("LibreOffice conversion timed out")
            raise HTTPException(status_code=500, detail="PDF generation timed out")
        if proc.returncode != 0:
            logger.error("LibreOffice exited %s; stderr=%r", proc.returncode, proc.stderr[-500:] if proc.stderr else b"")
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

