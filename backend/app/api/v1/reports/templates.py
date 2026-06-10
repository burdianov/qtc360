"""Template management and signature preview endpoints."""

import io
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import (
    assert_user_in_project,
    get_current_user,
    require_permission,
    require_project_access,
)
from app.core.types import (
    DEFAULT_SIGNATURE_FONT,
    DEFAULT_SIGNATURE_COLOR,
    MAX_TEMPLATE_BYTES,
    _mb,
)
from app.models.doc_template import DocTemplate
from app.models.user import User
from app.services.signature import render_signature, get_available_fonts
from app.api.v1.reports.helpers import _safe_filename_for_disposition

router = APIRouter()


# ── Template upload ──────────────────────────────────────────────────────────

@router.post("/templates/upload", status_code=201)
async def upload_template(
    project_id: UUID,
    doc_type: str,
    name: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("reports.templates")),
):
    """Upload a DOCX or XLSX template."""
    await assert_user_in_project(user, project_id)
    fname = (file.filename or "").lower()
    if fname.endswith(".docx"):
        file_format = "docx"
    elif fname.endswith(".xlsx"):
        file_format = "xlsx"
    else:
        raise HTTPException(
            status_code=400, detail="Only .docx and .xlsx files allowed"
        )

    data = await file.read()
    if len(data) > MAX_TEMPLATE_BYTES:
        raise HTTPException(
            status_code=400, detail=f"File too large (max {_mb(MAX_TEMPLATE_BYTES)}MB)"
        )
    if len(data) == 0:
        raise HTTPException(status_code=400, detail="Empty file")

    if file_format == "docx":
        try:
            from docxtpl import DocxTemplate
            from jinja2.sandbox import SandboxedEnvironment
            from jinja2 import TemplateSyntaxError, Undefined

            tpl = DocxTemplate(io.BytesIO(data))
            env = SandboxedEnvironment(undefined=Undefined)
            env.parse(tpl.get_xml())
        except TemplateSyntaxError as e:
            raise HTTPException(
                status_code=400,
                detail=f"Template placeholder error: {e.message}. Use underscores in variable names (e.g. {{{{ delivery_notes }}}} not {{{{ delivery notes }}}}).",
            )
        except Exception:
            pass

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

    ver_result = await db.execute(
        select(DocTemplate).where(
            DocTemplate.project_id == project_id,
            DocTemplate.doc_type == doc_type.upper(),
            DocTemplate.is_deleted == False,  # noqa: E712
        )
    )
    version = len(ver_result.scalars().all()) + 1

    cover_pages = 1
    if file_format == "docx":
        from app.services.pdf import count_pages_in_docx

        cover_pages = count_pages_in_docx(data)

    template = DocTemplate(
        project_id=project_id,
        doc_type=doc_type.upper(),
        name=name,
        file=data,
        filename=file.filename,
        file_format=file_format,
        version=version,
        is_active=True,
        cover_page_count=cover_pages,
    )
    db.add(template)
    await db.commit()
    await db.refresh(template)
    return {
        "id": str(template.id),
        "name": name,
        "version": version,
        "file_format": file_format,
    }


# ── Template list ────────────────────────────────────────────────────────────

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
    result = await db.execute(
        q.order_by(DocTemplate.doc_type, DocTemplate.version.desc())
    )
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


# ── Template download ────────────────────────────────────────────────────────

@router.get("/templates/{template_id}/download")
async def download_template(
    template_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Download the original DOCX template."""
    from fastapi.responses import Response

    result = await db.execute(
        select(DocTemplate).where(
            DocTemplate.id == template_id, DocTemplate.is_deleted == False  # noqa: E712
        )
    )
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    await assert_user_in_project(user, template.project_id)
    return Response(
        content=template.file,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={
            "Content-Disposition": f"attachment; {_safe_filename_for_disposition(template.filename or 'template.docx')}"
        },
    )


# ── Template delete ──────────────────────────────────────────────────────────

@router.delete("/templates/{template_id}", status_code=204)
async def delete_template(
    template_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("reports.templates")),
):
    """Delete a template (hard delete)."""
    result = await db.execute(
        select(DocTemplate).where(
            DocTemplate.id == template_id, DocTemplate.is_deleted == False  # noqa: E712
        )
    )
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    await assert_user_in_project(user, template.project_id)
    await db.delete(template)
    await db.commit()


# ── Signature fonts ──────────────────────────────────────────────────────────

@router.get("/signature-fonts")
async def list_signature_fonts(_: User = Depends(get_current_user)):
    """List available signature fonts."""
    return get_available_fonts()


# ── Signature preview ────────────────────────────────────────────────────────

@router.get("/signature-preview")
async def preview_signature(
    name: str,
    font_id: str = DEFAULT_SIGNATURE_FONT,
    color: str = DEFAULT_SIGNATURE_COLOR,
):
    """Preview a signature rendering."""
    from fastapi.responses import Response

    if len(name) > 200:
        raise HTTPException(status_code=400, detail="Name too long")
    import re as _re

    if not _re.fullmatch(r"#[0-9A-Fa-f]{6}", color or ""):
        color = DEFAULT_SIGNATURE_COLOR
    png = render_signature(name, font_id, color=color)
    return Response(content=png, media_type="image/png")
