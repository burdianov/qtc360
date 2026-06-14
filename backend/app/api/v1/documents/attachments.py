"""Document-level attachment endpoints — list, upload, delete, reorder,
and the merged PDF bundle download."""

import uuid
from pathlib import Path as FilePath
from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Query,
    UploadFile,
    status,
)
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import async_session_factory, get_db
from app.core.deps import (
    get_current_user,
    require_permission,
)
from app.core.types import (
    ALLOWED_ATTACHMENT_SUFFIXES,
    ALLOWED_ATTACHMENT_MIMES,
    MAX_ATTACHMENT_BYTES,
    MAX_ATTACHMENTS_PER_DOC,
    _mb,
)
from app.models.document import Document
from app.models.document_attachment import DocumentAttachment
from app.models.user import User
from app.services.storage import storage
from app.api.v1.documents.helpers import load_doc_for_attachment, build_download_filename

router = APIRouter()


# ── List attachments ─────────────────────────────────────────────────────────

@router.get("/{doc_id}/attachments")
async def list_attachments(
    doc_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await load_doc_for_attachment(db, doc_id, user)
    result = await db.execute(
        select(DocumentAttachment)
        .where(
            DocumentAttachment.document_id == doc_id,
            DocumentAttachment.kind.in_(["user", "checklist"]),
            DocumentAttachment.is_deleted == False,  # noqa: E712
        )
        .order_by(
            DocumentAttachment.sort_order,
            DocumentAttachment.id,
        )
    )
    return [
        {
            "id": str(a.id),
            "filename": a.filename,
            "size": a.size,
            "sort_order": a.sort_order,
            "content_type": a.content_type,
            "kind": a.kind,
        }
        for a in result.scalars().all()
    ]


# ── Upload attachment ────────────────────────────────────────────────────────

@router.post("/{doc_id}/attachments", status_code=201)
async def upload_attachment(
    doc_id: UUID,
    file: UploadFile = File(...),
    insert_after_page: int = Query(
        None,
        ge=0,
        description="Page number after which to insert (0-indexed, optional)",
    ),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("documents.edit")),
):
    await load_doc_for_attachment(db, doc_id, user)

    suffix = FilePath(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_ATTACHMENT_SUFFIXES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type {suffix!r}. Allowed: {sorted(ALLOWED_ATTACHMENT_SUFFIXES)}",
        )
    declared_mime = (file.content_type or "").lower().split(";", 1)[0].strip()
    if declared_mime and declared_mime not in ALLOWED_ATTACHMENT_MIMES:
        raise HTTPException(
            status_code=400, detail=f"Unsupported MIME type {declared_mime!r}"
        )

    data = await file.read()
    if len(data) > MAX_ATTACHMENT_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"File too large (max {_mb(MAX_ATTACHMENT_BYTES)}MB)",
        )
    if len(data) == 0:
        raise HTTPException(status_code=400, detail="Empty file")

    count_result = await db.execute(
        select(func.count())
        .select_from(DocumentAttachment)
        .where(
            DocumentAttachment.document_id == doc_id,
            DocumentAttachment.is_deleted == False,  # noqa: E712
        )
    )
    existing_count = count_result.scalar() or 0
    if existing_count >= MAX_ATTACHMENTS_PER_DOC:
        raise HTTPException(
            status_code=400,
            detail=f"Maximum of {MAX_ATTACHMENTS_PER_DOC} attachments per document",
        )

    file_id = str(uuid.uuid4())
    storage_key = f"attachments/{doc_id}/{file_id}{suffix}"
    storage.save(storage_key, data)

    att = DocumentAttachment(
        document_id=doc_id,
        filename=file.filename or "unnamed",
        storage_path=storage_key,
        content_type=declared_mime or "application/octet-stream",
        size=len(data),
        sort_order=existing_count,
        insert_after_page=insert_after_page,
    )
    db.add(att)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Conflict — please retry")
    await db.refresh(att)
    return {
        "id": str(att.id),
        "filename": att.filename,
        "size": att.size,
        "insert_after_page": att.insert_after_page,
    }


# ── Delete attachment ────────────────────────────────────────────────────────

@router.delete("/{doc_id}/attachments/{att_id}", status_code=204)
async def delete_attachment(
    doc_id: UUID,
    att_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("documents.edit")),
):
    await load_doc_for_attachment(db, doc_id, user)
    result = await db.execute(
        select(DocumentAttachment).where(
            DocumentAttachment.id == att_id, DocumentAttachment.document_id == doc_id
        )
    )
    att = result.scalar_one_or_none()
    if not att:
        raise HTTPException(status_code=404, detail="Attachment not found")
    storage_path = att.storage_path
    att.is_deleted = True
    await db.commit()
    if storage_path:
        try:
            storage.delete(storage_path)
        except Exception:
            pass


# ── Download single attachment ────────────────────────────────────────────────

@router.get("/{doc_id}/attachments/{att_id}")
async def download_attachment(
    doc_id: UUID,
    att_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Download a single attachment file."""
    from fastapi.responses import Response

    await load_doc_for_attachment(db, doc_id, user)
    result = await db.execute(
        select(DocumentAttachment).where(
            DocumentAttachment.id == att_id,
            DocumentAttachment.document_id == doc_id,
            DocumentAttachment.is_deleted == False,  # noqa: E712
        )
    )
    att = result.scalar_one_or_none()
    if not att:
        raise HTTPException(status_code=404, detail="Attachment not found")

    try:
        data = storage.read(att.storage_path)
    except Exception:
        raise HTTPException(status_code=404, detail="Attachment file not found on storage")

    return Response(
        content=data,
        media_type=att.content_type or "application/octet-stream",
        headers={"Content-Disposition": f'inline; filename="{att.filename}"'},
    )


# ── Reorder attachments ──────────────────────────────────────────────────────

@router.patch("/{doc_id}/attachments/reorder")
async def reorder_attachments(
    doc_id: UUID,
    body: list[UUID],
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("documents.edit")),
):
    """Reorder attachments. Body is ordered list of attachment IDs."""
    from sqlalchemy import update as sa_update

    await load_doc_for_attachment(db, doc_id, user)

    for i, att_id in enumerate(body):
        await db.execute(
            sa_update(DocumentAttachment)
            .where(
                DocumentAttachment.id == att_id,
                DocumentAttachment.document_id == doc_id,
            )
            .values(sort_order=i)
        )
    await db.commit()
    return {"status": "ok"}


# ── Download document bundle ─────────────────────────────────────────────────

CACHE_KIND = "generated_main"  # attachment kind for cached main-PDF bytes


async def _get_or_generate_cached_main_pdf(
    db: AsyncSession, doc, template
) -> bytes:
    """Return main PDF bytes, using cache when not stale.

    Caches the raw filled template PDF (before signature stamping) as a
    DocumentAttachment with kind=CACHE_KIND.  Subsequent downloads skip the slow
    Gotenberg round-trip as long as the document hasnʼt been modified.
    """
    from datetime import timezone

    # Look for an existing cache entry that is still fresh
    existing = (
        await db.execute(
            select(DocumentAttachment)
            .where(
                DocumentAttachment.document_id == doc.id,
                DocumentAttachment.kind == CACHE_KIND,
                DocumentAttachment.is_deleted == False,  # noqa: E712
            )
            .order_by(DocumentAttachment.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()

    doc_updated = doc.updated_at
    if doc_updated.tzinfo is None:
        doc_updated = doc_updated.replace(tzinfo=timezone.utc)

    if existing and existing.created_at is not None:
        cache_created = existing.created_at
        if cache_created.tzinfo is None:
            cache_created = cache_created.replace(tzinfo=timezone.utc)
        if cache_created >= doc_updated:
            cached_bytes = storage.read(existing.storage_path)
            if cached_bytes:
                return cached_bytes

    # Generate fresh PDF via Gotenberg
    from app.api.v1.reports import _build_context, _fill_template, _convert_to_pdf

    context = _build_context(doc)
    docx_bytes = _fill_template(template.file, context, doc)
    pdf_bytes = await _convert_to_pdf(docx_bytes)

    # Persist as cache (replace any stale entry)
    storage_key = f"attachments/{doc.id}/_cached_main.pdf"
    storage.save(storage_key, pdf_bytes)

    if existing:
        existing.storage_path = storage_key
        existing.filename = "_cached_main.pdf"
        existing.size = len(pdf_bytes)
        existing.created_at = func.now()
    else:
        cache = DocumentAttachment(
            document_id=doc.id,
            filename="_cached_main.pdf",
            storage_path=storage_key,
            content_type="application/pdf",
            size=len(pdf_bytes),
            sort_order=-1,
            kind=CACHE_KIND,
        )
        db.add(cache)
    await db.commit()

    return pdf_bytes


@router.get("/{doc_id}/bundle")
async def download_document_bundle(
    doc_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Download the complete merged PDF bundle for a document."""
    from fastapi.responses import Response
    from sqlalchemy.orm import selectinload
    from app.models.doc_template import DocTemplate
    from app.api.v1.reports import (
        _build_context,
        _fill_template,
        _convert_to_pdf,
        _stamp_vector_signatures,
    )

    doc = (
        await db.execute(
            select(Document)
            .where(Document.id == doc_id, Document.is_deleted == False)  # noqa: E712
            .options(
                selectinload(Document.discipline),
                selectinload(Document.project),
                selectinload(Document.site_engineer).selectinload(User.designation),
                selectinload(Document.qaqc_engineer).selectinload(User.designation),
            )
        )
    ).scalar_one_or_none()
    from app.core.deps import assert_user_in_project

    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    await assert_user_in_project(user, doc.project_id)

    if doc.template_id:
        template = (
            await db.execute(
                select(DocTemplate).where(DocTemplate.id == doc.template_id)
            )
        ).scalar_one_or_none()
    else:
        template = (
            await db.execute(
                select(DocTemplate).where(
                    DocTemplate.project_id == doc.project_id,
                    DocTemplate.doc_type == doc.document_type,
                    DocTemplate.is_active == True,  # noqa: E712
                    DocTemplate.is_deleted == False,  # noqa: E712
                )
            )
        ).scalar_one_or_none()
    if not template:
        raise HTTPException(
            status_code=404, detail="No template found for this document type"
        )

    # Use cached main PDF when available (skips slow Gotenberg conversion on
    # repeated downloads of the same document revision).
    main_pdf_bytes = await _get_or_generate_cached_main_pdf(db, doc, template)

    import json as _json
    from app.models.app_setting import AppSetting
    from app.models.user_preference import UserPreference
    from app.core.types import DEFAULT_SIG_CONFIG

    _sig_default = {
        "font_size": 36,
        "cell_width": 75,
        "x_offset": -0.3,
        "color": "#1a237e",
    }
    _sig_setting = (
        await db.execute(select(AppSetting).where(AppSetting.key == "signature_config"))
    ).scalar_one_or_none()
    _sig_cfg = _sig_default
    if _sig_setting:
        try:
            _sig_cfg = _json.loads(_sig_setting.value).get(
                doc.document_type, _sig_default
            )
        except Exception:
            pass

    # Load per-user signature display preferences (position/size adjustments)
    # so the download respects the same tweaks the preview uses.
    _user_sig_cfgs: dict[str, dict] = {}
    for inspector in [doc.site_engineer, doc.qaqc_engineer]:
        if inspector:
            _pref = (
                await db.execute(
                    select(UserPreference).where(
                        UserPreference.user_id == inspector.id,
                        UserPreference.key == "signature_display",
                        UserPreference.is_deleted == False,  # noqa: E712
                    )
                )
            ).scalar_one_or_none()
            if _pref and _pref.value:
                try:
                    v = _pref.value
                    if isinstance(v, str):
                        v = _json.loads(v)
                    _user_sig_cfgs[str(inspector.id)] = {**DEFAULT_SIG_CONFIG, **v}
                except Exception:
                    _user_sig_cfgs[str(inspector.id)] = DEFAULT_SIG_CONFIG
            else:
                _user_sig_cfgs[str(inspector.id)] = DEFAULT_SIG_CONFIG

    main_pdf_bytes = _stamp_vector_signatures(
        main_pdf_bytes, doc, _sig_cfg, _user_sig_cfgs
    )

    attachments_result = await db.execute(
        select(DocumentAttachment)
        .where(
            DocumentAttachment.document_id == doc_id,
            DocumentAttachment.kind.in_(["user", "checklist"]),
            DocumentAttachment.is_deleted == False,  # noqa: E712
        )
        .order_by(DocumentAttachment.sort_order)
    )
    attachments = attachments_result.scalars().all()

    if not attachments:
        fname = await build_download_filename(db, doc)
        return Response(
            content=main_pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{fname}"'},
        )

    from app.api.v1.reports import _merge_attachments_with_status

    try:
        merged_pdf, _ = _merge_attachments_with_status(main_pdf_bytes, attachments)
    except ValueError as e:
        raise HTTPException(status_code=413, detail=str(e))

    fname = await build_download_filename(db, doc)
    return Response(
        content=merged_pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


async def pre_warm_main_pdf_cache(doc_id: uuid.UUID):
    """Background task: pre-generate the cached main PDF after document save.

    Import-friendly — opens its own DB session so it can be used from any
    BackgroundTasks context without session conflicts.
    """
    import logging
    from app.models.doc_template import DocTemplate

    logger = logging.getLogger(__name__)
    async with async_session_factory() as db:
        try:
            doc = (
                await db.execute(
                    select(Document)
                    .where(Document.id == doc_id, Document.is_deleted == False)  # noqa: E712
                    .options(
                        selectinload(Document.discipline),
                        selectinload(Document.project),
                        selectinload(Document.site_engineer).selectinload(User.designation),
                        selectinload(Document.qaqc_engineer).selectinload(User.designation),
                    )
                )
            ).scalar_one_or_none()
            if not doc:
                return

            if doc.template_id:
                template = (
                    await db.execute(
                        select(DocTemplate).where(DocTemplate.id == doc.template_id)
                    )
                ).scalar_one_or_none()
            else:
                template = (
                    await db.execute(
                        select(DocTemplate).where(
                            DocTemplate.project_id == doc.project_id,
                            DocTemplate.doc_type == doc.document_type,
                            DocTemplate.is_active == True,  # noqa: E712
                            DocTemplate.is_deleted == False,  # noqa: E712
                        )
                    )
                ).scalar_one_or_none()
            if not template:
                return

            await _get_or_generate_cached_main_pdf(db, doc, template)
        except Exception:
            logger.exception("Background main-PDF cache warm failed for %s", doc_id)
