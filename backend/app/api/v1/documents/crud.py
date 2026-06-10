"""Core CRUD endpoints for documents — list, get, create, update, delete,
resubmit, start-new-revision, and the rejected-for-revision list."""

from datetime import datetime, timezone
from uuid import UUID

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Body,
    Depends,
    HTTPException,
    Query,
    status,
)
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import (
    assert_user_in_project,
    get_current_user,
    require_permission,
    require_project_access,
)
from app.core.types import DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT
from app.models.document import Document
from app.models.document_approval_round import DocumentApprovalRound
from app.models.document_attachment import document_assets
from app.models.user import User
from app.schemas.document import (
    DocumentCreate,
    DocumentUpdate,
    DocumentResponse,
)
from app.services.commissioning import (
    recalculate_requirements_for_document,
    recalculate_requirement_status,
)
from app.services.audit import record_audit
from app.api.v1.documents.helpers import (
    allocate_serial,
    format_reference,
    auto_create_ref_config,
    purge_document_storage,
)

router = APIRouter()


# ── Rejected-for-revision ────────────────────────────────────────────────────

@router.get("/rejected-for-revision")
async def list_rejected_for_revision(
    project_id: UUID = Query(...),
    document_type: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_project_access()),
):
    """List rejected documents available for revision (not yet superseded by a newer revision)."""
    from sqlalchemy.orm import selectinload

    query = (
        select(Document)
        .options(selectinload(Document.discipline))
        .where(
            Document.project_id == project_id,
            Document.status == "rejected",
            Document.is_deleted == False,  # noqa: E712
        )
        .order_by(Document.document_type, Document.reference_no)
    )
    if document_type:
        query = query.where(Document.document_type == document_type.upper())
    result = await db.execute(query)
    docs = result.scalars().all()

    # Exclude docs that already have a newer revision
    out = []
    for doc in docs:
        newer = (
            await db.execute(
                select(func.count())
                .select_from(Document)
                .where(
                    Document.reference_no == doc.reference_no,
                    Document.revision_no > doc.revision_no,
                    Document.project_id == project_id,
                    Document.is_deleted == False,  # noqa: E712
                    Document.status != "superseded",
                )
            )
        ).scalar()
        if not newer:
            out.append(doc)

    # Group by discipline
    grouped: dict[str, list[dict]] = {}
    for doc in out:
        disc_name = doc.discipline.name if doc.discipline else "No Discipline"
        grouped.setdefault(disc_name, []).append(
            {
                "id": str(doc.id),
                "reference_no": doc.reference_no,
                "revision_no": doc.revision_no,
                "title": doc.title,
                "document_type": doc.document_type,
                "discipline_id": str(doc.discipline_id) if doc.discipline_id else None,
            }
        )
    return grouped


# ── List / Get ───────────────────────────────────────────────────────────────

@router.get("", response_model=list[DocumentResponse])
async def list_documents(
    project_id: UUID = Query(...),
    document_type: str | None = Query(None),
    status_filter: str | None = Query(None, alias="status"),
    discipline_id: UUID | None = Query(None),
    has_comments: bool = Query(False),
    skip: int = Query(0, ge=0),
    limit: int = Query(DEFAULT_PAGE_LIMIT, ge=1, le=MAX_PAGE_LIMIT),
    paginated: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_project_access()),
):
    stmt = select(Document).where(
        Document.is_deleted == False,  # noqa: E712
        Document.project_id == project_id,
    )
    if document_type:
        stmt = stmt.where(Document.document_type == document_type)
    if status_filter:
        stmt = stmt.where(Document.status == status_filter)
    if discipline_id:
        stmt = stmt.where(Document.discipline_id == discipline_id)
    if has_comments:
        stmt = stmt.where(
            Document.id.in_(
                select(DocumentApprovalRound.document_id).where(
                    DocumentApprovalRound.comments.isnot(None),
                    DocumentApprovalRound.comments != "",
                )
            )
        )
    stmt = stmt.order_by(Document.created_at.desc(), Document.id.desc())
    if paginated:
        from sqlalchemy import func as sa_func

        count_result = await db.execute(
            select(sa_func.count()).select_from(stmt.subquery())
        )
        total = count_result.scalar() or 0
        result = await db.execute(stmt.offset(skip).limit(limit))
        return {"items": result.scalars().all(), "total": total}
    stmt = stmt.offset(skip).limit(limit)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/{doc_id}", response_model=DocumentResponse)
async def get_document(
    doc_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from sqlalchemy.orm import selectinload

    result = await db.execute(
        select(Document)
        .where(Document.id == doc_id, Document.is_deleted == False)  # noqa: E712
        .options(selectinload(Document.assets))
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    await assert_user_in_project(user, doc.project_id)
    resp = DocumentResponse.model_validate(doc)
    resp.asset_ids = [a.id for a in doc.assets] if doc.assets else []
    return resp


# ── Create ───────────────────────────────────────────────────────────────────

@router.post("", response_model=DocumentResponse, status_code=status.HTTP_201_CREATED)
async def create_document(
    body: DocumentCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("documents.submit")),
):
    """Create a document. The reference number is allocated server-side."""
    await assert_user_in_project(user, body.project_id)

    data = body.model_dump(exclude={"asset_ids", "revision_of_id"})

    if not body.discipline_id:
        raise HTTPException(
            status_code=400,
            detail="Discipline is required.",
        )

    from app.models.discipline import Discipline

    disc = (
        await db.execute(
            select(Discipline).where(
                Discipline.id == body.discipline_id,
                Discipline.project_id == body.project_id,
                Discipline.is_deleted == False,  # noqa: E712
            )
        )
    ).scalar_one_or_none()
    if not disc:
        raise HTTPException(
            status_code=400,
            detail="Discipline not found in this project",
        )

    config, serial = await allocate_serial(
        db,
        project_id=body.project_id,
        doc_type=body.document_type,
        discipline_id=body.discipline_id,
    )
    if config is None:
        config = await auto_create_ref_config(
            db,
            project_id=body.project_id,
            doc_type=body.document_type,
        )

    data["reference_no"] = format_reference(
        config,
        doc_type=body.document_type,
        discipline_code=disc.code,
        serial=serial,
    )
    data["revision_no"] = 0

    if body.revision_of_id:
        old_doc = (
            await db.execute(
                select(Document)
                .where(
                    Document.id == body.revision_of_id,
                    Document.is_deleted == False,  # noqa: E712
                )
                .with_for_update()
            )
        ).scalar_one_or_none()
        if not old_doc:
            raise HTTPException(
                status_code=404,
                detail="Source document for revision not found",
            )
        if old_doc.status != "rejected":
            raise HTTPException(
                status_code=400,
                detail="Can only create revision of a rejected document",
            )
        data["reference_no"] = old_doc.reference_no
        data["revision_no"] = old_doc.revision_no + 1
        old_doc.status = "superseded"

    doc = Document(**data, created_by=user.id)

    if doc.document_type in ("FAT", "CRS"):
        doc.status = "approved"
    db.add(doc)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Reference number collision — please retry. If this keeps happening, contact an admin.",
        )

    if body.asset_ids:
        for aid in body.asset_ids:
            await db.execute(
                document_assets.insert().values(document_id=doc.id, asset_id=aid)
            )

    await record_audit(
        db,
        user_id=user.id,
        action="create",
        entity_type="document",
        entity_id=doc.id,
        summary=f"Created {doc.document_type} '{doc.reference_no}' rev {doc.revision_no}",
    )
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=409, detail="Reference number collision — please retry."
        )
    await db.refresh(doc)
    # Re-fetch with assets loaded so asset_ids is populated in the response.
    from sqlalchemy.orm import selectinload

    result = await db.execute(
        select(Document)
        .where(Document.id == doc.id)
        .options(selectinload(Document.assets))
    )
    doc_with_assets = result.scalar_one()
    resp = DocumentResponse.model_validate(doc_with_assets)
    resp.asset_ids = [a.id for a in doc_with_assets.assets]
    # Pre-generate the main PDF in the background so the first download is fast
    from app.api.v1.documents.attachments import pre_warm_main_pdf_cache

    background_tasks.add_task(pre_warm_main_pdf_cache, doc.id)
    return resp


# ── Update ───────────────────────────────────────────────────────────────────

@router.patch("/{doc_id}", response_model=DocumentResponse)
async def update_document(
    doc_id: UUID,
    body: DocumentUpdate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("documents.edit")),
):
    result = await db.execute(
        select(Document)
        .where(Document.id == doc_id, Document.is_deleted == False)  # noqa: E712
        .with_for_update()
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    await assert_user_in_project(user, doc.project_id)

    old_status = doc.status
    updates = body.model_dump(exclude_unset=True, exclude={"asset_ids"})

    if (
        "status" in updates
        and updates["status"]
        and updates["status"] != old_status
        and doc.document_type not in ("FAT", "CRS")
    ):
        from app.schemas.document import VALID_STATUS_TRANSITIONS

        allowed = VALID_STATUS_TRANSITIONS.get(old_status, set())
        if updates["status"] not in allowed:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid status transition: {old_status} → {updates['status']}. Allowed: {sorted(allowed) or 'none'}",
            )

    for k, v in updates.items():
        setattr(doc, k, v)
    doc.updated_by = user.id

    if body.asset_ids is not None:
        await db.execute(
            document_assets.delete().where(document_assets.c.document_id == doc_id)
        )
        for aid in body.asset_ids:
            await db.execute(
                document_assets.insert().values(document_id=doc.id, asset_id=aid)
            )

    if doc.status != old_status:
        await record_audit(
            db,
            user_id=user.id,
            action="update",
            entity_type="document",
            entity_id=doc.id,
            summary=f"Status changed {old_status} → {doc.status} on {doc.reference_no}",
        )

    if doc.status != old_status and doc.status in (
        "approved",
        "approved_with_comments",
        "rejected",
    ):
        await recalculate_requirements_for_document(db, doc.id)

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Conflict — please retry")
    await db.refresh(doc)
    # Pre-generate the main PDF in the background so the first download is fast
    from app.api.v1.documents.attachments import pre_warm_main_pdf_cache

    background_tasks.add_task(pre_warm_main_pdf_cache, doc.id)
    return doc


# ── Resubmit ─────────────────────────────────────────────────────────────────

@router.post("/{doc_id}/resubmit", response_model=DocumentResponse)
async def resubmit_document(
    doc_id: UUID,
    body: dict | None = Body(None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("documents.submit")),
):
    """Resubmit a rejected document — resets the same revision back to draft.

    Accepts optional ``title`` and ``remarks_1`` in the JSON body to update
    the document before it re-enters draft.  Existing approval rounds are
    soft-deleted so the document can be re-signed and re-submitted.
    """
    from sqlalchemy import update as sa_update
    from sqlalchemy.orm import selectinload

    result = await db.execute(
        select(Document)
        .where(Document.id == doc_id, Document.is_deleted == False)  # noqa: E712
        .with_for_update()
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    await assert_user_in_project(user, doc.project_id)
    if doc.status != "rejected":
        raise HTTPException(
            status_code=400, detail="Only rejected documents can be resubmitted"
        )

    # Reset the same document back to draft — keep the same id + revision_no.
    doc.status = "draft"
    doc.site_engineer_signed = False
    doc.qaqc_engineer_signed = False
    doc.current_approver_order = None
    if body:
        if "title" in body and body["title"] is not None:
            doc.title = body["title"]
        if "remarks_1" in body:
            doc.remarks_1 = body["remarks_1"]
    doc.updated_by = user.id

    # Soft-delete previous approval rounds so the document can be re-submitted.
    await db.execute(
        sa_update(DocumentApprovalRound)
        .where(
            DocumentApprovalRound.document_id == doc.id,
            DocumentApprovalRound.is_deleted == False,  # noqa: E712
        )
        .values(is_deleted=True)
    )

    await record_audit(
        db,
        user_id=user.id,
        action="update",
        entity_type="document",
        entity_id=doc.id,
        summary=f"Resubmitted {doc.document_type} '{doc.reference_no}' rev {doc.revision_no}",
    )
    await db.commit()
    await db.refresh(doc)
    # Re-fetch with assets loaded so asset_ids is populated.
    result = await db.execute(
        select(Document)
        .where(Document.id == doc.id)
        .options(selectinload(Document.assets))
    )
    doc_with_assets = result.scalar_one()
    resp = DocumentResponse.model_validate(doc_with_assets)
    resp.asset_ids = [a.id for a in doc_with_assets.assets]
    return resp


# ── Delete ───────────────────────────────────────────────────────────────────

@router.delete("/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(
    doc_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("documents.delete")),
):
    """Delete or supersede a document.

    - If submitted to at least one approver: SUPERSEDE (mark superseded)
    - If NOT submitted: HARD DELETE
    """
    from app.models.document_attachment import DocumentAttachment
    from app.models.commissioning import DocumentRequirementLink

    result = await db.execute(
        select(Document)
        .where(Document.id == doc_id, Document.is_deleted == False)  # noqa: E712
        .with_for_update()
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    await assert_user_in_project(user, doc.project_id)

    is_admin = user.is_superuser or any(
        r.name in ("admin", "super_admin") for r in (user.roles or [])
    )
    is_creator = doc.created_by == user.id
    if not (is_admin or is_creator):
        raise HTTPException(
            status_code=403,
            detail="Only the document creator or an administrator can delete/supersede this document",
        )

    rounds_result = await db.execute(
        select(DocumentApprovalRound).where(
            DocumentApprovalRound.document_id == doc.id,
            DocumentApprovalRound.is_deleted == False,  # noqa: E712
        )
    )
    has_been_submitted = rounds_result.scalar_one_or_none() is not None
    submitted_statuses = {
        "with_approver_1",
        "with_approver_2",
        "approver_1_returned",
        "approved",
        "approved_with_comments",
        "rejected",
    }
    is_submitted = has_been_submitted or doc.status in submitted_statuses

    if is_submitted:
        await purge_document_storage(db, doc.id)
        doc.status = "superseded"
        doc.is_deleted = True
        await recalculate_requirements_for_document(db, doc_id)
        await record_audit(
            db,
            user_id=user.id,
            action="supersede",
            entity_type="document",
            entity_id=doc.id,
            summary=f"Superseded {doc.document_type} '{doc.reference_no}' (was submitted to approver)",
        )
    else:
        await purge_document_storage(db, doc.id)

        ar_ids_result = await db.execute(
            select(DocumentRequirementLink.asset_requirement_id)
            .where(
                DocumentRequirementLink.document_id == doc.id,
                DocumentRequirementLink.is_deleted == False,  # noqa: E712
            )
            .distinct()
        )
        affected_ar_ids = [row[0] for row in ar_ids_result.all()]

        from sqlalchemy import delete as sa_delete

        await db.execute(
            sa_delete(DocumentAttachment).where(
                DocumentAttachment.document_id == doc.id,
            )
        )
        await db.execute(
            sa_delete(document_assets).where(
                document_assets.c.document_id == doc.id,
            )
        )
        await db.execute(
            sa_delete(DocumentRequirementLink).where(
                DocumentRequirementLink.document_id == doc.id,
            )
        )
        await db.execute(sa_delete(Document).where(Document.id == doc.id))

        for ar_id in affected_ar_ids:
            await recalculate_requirement_status(db, ar_id)

        await record_audit(
            db,
            user_id=user.id,
            action="delete",
            entity_type="document",
            entity_id=doc.id,
            summary=f"Deleted {doc.document_type} '{doc.reference_no}' (was not submitted; serial preserved)",
        )

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Conflict — please retry")


# ── Start New Revision ───────────────────────────────────────────────────────

@router.post(
    "/{doc_id}/start-new-revision", response_model=DocumentResponse, status_code=201
)
async def start_new_revision(
    doc_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("documents.edit")),
):
    """After a status-C decision, close the current revision and start a fresh draft."""
    doc = (
        await db.execute(
            select(Document)
            .where(Document.id == doc_id, Document.is_deleted == False)  # noqa: E712
            .with_for_update()
        )
    ).scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    await assert_user_in_project(user, doc.project_id)

    if doc.status not in ("rejected", "approved", "approved_with_comments"):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot start new revision from status {doc.status!r}",
        )

    new_doc = Document(
        project_id=doc.project_id,
        document_type=doc.document_type,
        reference_no=doc.reference_no,
        title=doc.title,
        description=doc.description,
        revision_no=doc.revision_no + 1,
        discipline_id=doc.discipline_id,
        location=doc.location,
        floor_level=doc.floor_level,
        rams_ref=doc.rams_ref,
        drawing_ref=doc.drawing_ref,
        delivery_note=doc.delivery_note,
        asset_type_id=doc.asset_type_id,
        created_by=user.id,
    )
    db.add(new_doc)
    await db.flush()

    assets_result = await db.execute(
        document_assets.select().where(document_assets.c.document_id == doc.id)
    )
    for row in assets_result.all():
        await db.execute(
            document_assets.insert().values(
                document_id=new_doc.id, asset_id=row.asset_id
            )
        )

    doc.status = "superseded"
    doc.updated_by = user.id

    await record_audit(
        db,
        user_id=user.id,
        action="update",
        entity_type="document",
        entity_id=new_doc.id,
        summary=f"Started revision {new_doc.revision_no} of {new_doc.document_type} '{new_doc.reference_no}'",
    )
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Conflict — please retry")
    await db.refresh(new_doc)
    return new_doc
