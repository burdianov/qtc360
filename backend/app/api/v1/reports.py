"""Report generation: docxtpl fills Word templates, LibreOffice converts to PDF."""
import io
import subprocess
import tempfile
from pathlib import Path
from typing import Any
from uuid import UUID

from docxtpl import DocxTemplate, InlineImage
from docx.shared import Mm
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel as PydanticModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.doc_template import DocTemplate
from app.models.document import Document
from app.models.user import User
from app.services.signature import render_signature, get_available_fonts

router = APIRouter(prefix="/reports", tags=["reports"])


# ─── Template Management ─────────────────────────────────────────────────────


@router.post("/templates/upload", status_code=201)
async def upload_template(
    project_id: UUID,
    doc_type: str,
    name: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    _: Any = Depends(get_current_user),
):
    """Upload a new DOCX template."""
    if not file.filename or not file.filename.endswith(".docx"):
        raise HTTPException(status_code=400, detail="Only .docx files allowed")

    data = await file.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 10MB)")

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

    template = DocTemplate(
        project_id=project_id,
        doc_type=doc_type.upper(),
        name=name,
        file=data,
        filename=file.filename,
        version=version,
        is_active=True,
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
    _: Any = Depends(get_current_user),
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
    _: Any = Depends(get_current_user),
):
    """Download the original DOCX template."""
    result = await db.execute(
        select(DocTemplate).where(DocTemplate.id == template_id, DocTemplate.is_deleted == False)  # noqa: E712
    )
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    return Response(
        content=template.file,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{template.filename}"'},
    )


@router.delete("/templates/{template_id}", status_code=204)
async def delete_template(
    template_id: UUID,
    db: AsyncSession = Depends(get_db),
    _: Any = Depends(get_current_user),
):
    """Delete a template (hard delete)."""
    result = await db.execute(
        select(DocTemplate).where(DocTemplate.id == template_id, DocTemplate.is_deleted == False)  # noqa: E712
    )
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    await db.delete(template)
    await db.commit()


# ─── Signature Fonts ──────────────────────────────────────────────────────────


@router.get("/signature-fonts")
async def list_signature_fonts():
    """List available signature fonts."""
    return get_available_fonts()


@router.get("/signature-preview")
async def preview_signature(
    name: str,
    font_id: str = "dancing_script",
    color: str = "#1a237e",
):
    """Preview a signature rendering."""
    png = render_signature(name, font_id, color=color)
    return Response(content=png, media_type="image/png")


# ─── Report Generation ───────────────────────────────────────────────────────


class GenerateReportRequest(PydanticModel):
    document_id: UUID
    project_id: UUID


@router.post("/generate/{doc_type}")
async def generate_report(
    doc_type: str,
    body: GenerateReportRequest,
    db: AsyncSession = Depends(get_db),
    _: Any = Depends(get_current_user),
):
    """Generate PDF from document data + active Word template."""
    # Get active template for this project
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

    # Get document data with relationships
    doc_result = await db.execute(
        select(Document)
        .where(Document.id == body.document_id, Document.is_deleted == False)  # noqa: E712
        .options(
            selectinload(Document.discipline),
            selectinload(Document.project),
            selectinload(Document.site_engineer),
            selectinload(Document.qaqc_engineer),
        )
    )
    document = doc_result.scalar_one_or_none()
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")

    # Build context from document
    context = _build_context(document)

    # Fill template (with signature images)
    docx_bytes = _fill_template(template.file, context, document)

    # Convert to PDF
    pdf_bytes = _convert_to_pdf(docx_bytes)

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{doc_type.upper()}_{document.ref_no or "draft"}.pdf"'},
    )


# ─── Health Check ─────────────────────────────────────────────────────────────


@router.get("/pdf-engine/health")
async def pdf_engine_health():
    """Check LibreOffice is available and can convert DOCX to PDF."""
    try:
        # Create a minimal DOCX
        from docx import Document as DocxDoc
        doc = DocxDoc()
        doc.add_paragraph("Health check")
        buf = io.BytesIO()
        doc.save(buf)
        test_docx = buf.getvalue()

        # Try conversion
        pdf = _convert_to_pdf(test_docx)
        if pdf and len(pdf) > 0:
            return {"status": "healthy", "pdf_engine": "libreoffice", "pdf_size": len(pdf)}
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"PDF engine unhealthy: {str(e)}")


# ─── Internal helpers ─────────────────────────────────────────────────────────


def _build_context(document: Document) -> dict:
    """Build template context from a Document model."""
    ctx = {
        "ref_no": document.number or "",
        "revision": str(document.revision or 0),
        "prj_no": "",
        "date": document.inspection_date.strftime("%d/%m/%Y") if document.inspection_date else "",
        "subject": document.title or "",
        "description_of_inspection": document.description or "",
        "gen_loc": document.location or "",
        "floor_level_room": document.floor_level or "",
        "appr_rams": document.rams_ref or "",
        "dwg_ref": document.drawing_ref or "",
    }

    # Discipline checkboxes
    doc_discipline = ""
    if document.discipline:
        doc_discipline = (document.discipline.name or "").lower().replace(" ", "_").replace("/", "_")

    def cb(selected: bool) -> str:
        return "\u2611" if selected else "\u2610"

    ctx["arch_cb"] = cb("architectural" in doc_discipline)
    ctx["civil_struct_cb"] = cb("civil" in doc_discipline or "structural" in doc_discipline)
    ctx["mechanical_cb"] = cb("mechanical" in doc_discipline)
    ctx["electrical_cb"] = cb("electrical" in doc_discipline)
    ctx["plumbing_cb"] = cb("plumbing" in doc_discipline)
    ctx["firefighting_cb"] = cb("firefighting" in doc_discipline or "fire" in doc_discipline)
    ctx["others_cb"] = cb("others" in doc_discipline or "other" in doc_discipline)

    # Inspector fields
    for i, inspector in enumerate([document.site_engineer, document.qaqc_engineer], start=1):
        if inspector:
            ctx[f"inspected_by_{i}"] = inspector.full_name
            ctx[f"designation_{i}"] = inspector.position or ""
            ctx[f"date_{i}"] = document.signed_at.strftime("%d/%m/%Y") if document.signed_at else ""
            ctx[f"time_{i}"] = document.signed_at.strftime("%H:%M") if document.signed_at else ""
            ctx[f"remarks_{i}"] = ""
        else:
            ctx[f"inspected_by_{i}"] = ""
            ctx[f"designation_{i}"] = ""
            ctx[f"date_{i}"] = ""
            ctx[f"time_{i}"] = ""
            ctx[f"remarks_{i}"] = ""

    # Project number
    if document.project:
        ctx["prj_no"] = document.project.code or ""
        ctx["nm"] = document.project.external_code or ""

    return ctx


def _fill_template(template_bytes: bytes, context: dict, document: Document) -> bytes:
    """Fill a DOCX template with context data and signature images."""
    doc = DocxTemplate(io.BytesIO(template_bytes))

    # Render signature images for inspectors
    for i, inspector in enumerate([document.site_engineer, document.qaqc_engineer], start=1):
        key = f"insp_sign_{i}"
        if inspector:
            font_id = inspector.signature_font or "dancing_script"
            sig_name = inspector.signature_text or inspector.full_name
            sig_png = render_signature(sig_name, font_id)
            context[key] = InlineImage(doc, io.BytesIO(sig_png), height=Mm(10))
        else:
            context[key] = ""

    doc.render(context)
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def _convert_to_pdf(docx_bytes: bytes) -> bytes:
    """Convert DOCX to PDF using LibreOffice headless."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        docx_path = Path(tmp_dir) / "document.docx"
        docx_path.write_bytes(docx_bytes)

        cmd = [
            settings.libreoffice_path,
            "--headless",
            "--convert-to", "pdf",
            "--outdir", tmp_dir,
            str(docx_path),
        ]
        proc = subprocess.run(cmd, capture_output=True, timeout=60)
        if proc.returncode != 0:
            raise HTTPException(
                status_code=500,
                detail=f"LibreOffice conversion failed: {proc.stderr.decode()[:200]}",
            )

        pdf_path = Path(tmp_dir) / "document.pdf"
        if not pdf_path.exists():
            raise HTTPException(status_code=500, detail="PDF not generated")
        return pdf_path.read_bytes()
