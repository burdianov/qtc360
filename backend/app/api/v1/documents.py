import uuid
from datetime import datetime, timezone
from uuid import UUID
from pathlib import Path as FilePath

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Path,
    Query,
    UploadFile,
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
from app.models.document import Document
from app.models.document_attachment import document_assets
from app.models.document_approval_round import DocumentApprovalRound
from app.models.reference_number_config import ReferenceNumberConfig
from app.models.user import User
from app.schemas.document import (
    DocumentCreate,
    DocumentUpdate,
    DocumentResponse,
    DocumentApprovalRoundResponse,
    OCRExtractRequest,
    OCRExtractResponse,
    SubmitToApproverRequest,
)
from app.services.commissioning import recalculate_requirements_for_document
from app.services.audit import record_audit
from app.services.storage import storage
from app.models.reference_number_counter import ReferenceNumberCounter

router = APIRouter(prefix="/documents", tags=["documents"])


# ─── helpers ─────────────────────────────────────────────────────────────────

from app.core.types import (  # noqa: E402
    ALLOWED_ATTACHMENT_SUFFIXES,
    ALLOWED_ATTACHMENT_MIMES,
    MAX_ATTACHMENT_BYTES,
    MAX_ATTACHMENTS_PER_DOC,
    DEFAULT_PAGE_LIMIT,
    MAX_PAGE_LIMIT,
    MAX_APPROVERS,
    _mb,
)


async def _build_download_filename(db: AsyncSession, doc: "Document") -> str:
    """Build PDF download filename as REFERENCE_NO_REVISION.pdf."""
    ref = doc.reference_no or "document"
    rev = int(doc.revision_no or 0)
    return f"{ref}_{rev:02d}.pdf"


async def _purge_document_storage(db: AsyncSession, doc_id: UUID) -> int:
    """Best-effort delete every file on disk that belongs to this document.

    Covers:
    - All DocumentAttachment rows (doc-level, round-level, returned_pdf)
    - Approval round files that are NOT in DocumentAttachment
      (remarks.pdf, plus returned_file_path if no DocumentAttachment row exists)
    - The entire ``responses/{doc_id}/`` folder (S1, R1, S2, R2, ...)

    Returns the number of files we attempted to unlink. Each unlink is
    wrapped in try/except — we never want storage cleanup to abort a delete.
    """
    from app.models.document_attachment import DocumentAttachment

    keys: set[str] = set()

    att_result = await db.execute(
        select(DocumentAttachment).where(DocumentAttachment.document_id == doc_id)
    )
    for att in att_result.scalars().all():
        if att.storage_path:
            keys.add(att.storage_path)

    rounds_result = await db.execute(
        select(DocumentApprovalRound).where(
            DocumentApprovalRound.document_id == doc_id,
        )
    )
    for round_ in rounds_result.scalars().all():
        if round_.returned_file_path:
            keys.add(round_.returned_file_path)
        if round_.remarks_file_path:
            keys.add(round_.remarks_file_path)
        if round_.submitted_file_path:
            keys.add(round_.submitted_file_path)

    for key in keys:
        try:
            storage.delete(key)
        except Exception:
            pass  # Best-effort; missing file is acceptable

    # PR2: also wipe responses/{doc_id}/ (catches the case where a
    # round was created but the doc was deleted before the S or R
    # file was recorded in the column — unlikely but possible).
    from app.services.approval_files import purge_doc_responses

    try:
        purge_doc_responses(str(doc_id))
    except Exception:
        pass

    return len(keys)


async def _allocate_serial(
    db: AsyncSession,
    *,
    project_id: UUID,
    doc_type: str,
    discipline_id: UUID,
) -> tuple[ReferenceNumberConfig | None, int]:
    doc_type = doc_type.upper()
    config_result = await db.execute(
        select(ReferenceNumberConfig)
        .where(
            ReferenceNumberConfig.project_id == project_id,
            ReferenceNumberConfig.doc_type == doc_type,
            ReferenceNumberConfig.is_deleted == False, )  # noqa: E712
        .with_for_update()
    )
    config = config_result.scalar_one_or_none()
    if config is None:
        return None, 0

    counter_result = await db.execute(
        select(ReferenceNumberCounter)
        .where(
            ReferenceNumberCounter.project_id == project_id,
            ReferenceNumberCounter.doc_type == doc_type,
            ReferenceNumberCounter.discipline_id == discipline_id,
        )
        .with_for_update()
    )
    counter = counter_result.scalar_one_or_none()

    if counter is None:
        counter = ReferenceNumberCounter(
            project_id=project_id,
            doc_type=doc_type,
            discipline_id=discipline_id,
            next_serial=config.serial_start or 1,
        )
        db.add(counter)
        await db.flush()

    serial = int(counter.next_serial)
    counter.next_serial = serial + 1
    return config, serial


def _format_reference(
    config: ReferenceNumberConfig | None,
    *,
    doc_type: str,
    discipline_code: str,
    serial: int,
    fallback_serial: int = 1,
) -> str:
    """Render a reference number from the configured pattern. Allowed placeholders only."""
    if config is None:
        return f"{doc_type}-{fallback_serial:04d}"
    return config.pattern.format(
        project_code=config.project_code,
        contractor_code=config.contractor_code,
        discipline_code=discipline_code,
        doc_type=doc_type,
        serial=serial,
    )


async def _auto_create_ref_config(
    db: AsyncSession,
    *,
    project_id: UUID,
    doc_type: str,
) -> ReferenceNumberConfig:
    """Create a default ReferenceNumberConfig for (project, doc_type) when
    none exists. Lets the discipline-scoped counter have a starting point
    even for a project's very first document of a given type."""
    from app.models.project import Project

    project = (
        await db.execute(select(Project).where(Project.id == project_id))
    ).scalar_one()
    code = (getattr(project, "code", None) or "PROJ")[:50]
    config = ReferenceNumberConfig(
        project_id=project_id,
        doc_type=doc_type,
        pattern="{project_code}-{contractor_code}-{discipline_code}-{doc_type}-{serial:04d}",
        project_code=code,
        contractor_code="",
        serial_start=1,
    )
    db.add(config)
    await db.flush()
    return config


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
        Document.project_id == project_id
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
    # Tie-break by id so paging is stable across rows with equal created_at.
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


# ─── PR2: per-stage file download ────────────────────────────────────────
#
# Stage name is exactly the file name on disk: S1, R1, S2, R2, ...
# Exposed as a single path-param endpoint so the frontend can build the
# URL with one string substitution.

_STAGE_PATTERN = r"^S[1-9]\d*$|^R[1-9]\d*$"


@router.get("/{doc_id}/files/{stage}")
async def download_stage_file(
    doc_id: UUID,
    stage: str = Path(..., pattern=_STAGE_PATTERN, description="S1, R1, S2, R2, ..."),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Download a per-stage file for this document's approval cycle.

    ``stage`` is the literal file name without the ``.pdf`` extension:
    ``S1`` for the first submission, ``R1`` for the first response, etc.

    Returns the PDF bytes. 404 if the document doesn't exist, 403 if
    the user isn't in the project, 404 again if the stage file is
    missing (e.g. S2 on a 1-approver cycle, or R2 not yet recorded).
    """
    from fastapi.responses import Response
    from app.services.approval_files import (
        submitted_path,
        returned_path,
    )

    doc = (
        await db.execute(
            select(Document).where(Document.id == doc_id, Document.is_deleted == False)  # noqa: E712
        )
    ).scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    await assert_user_in_project(user, doc.project_id)

    if stage.startswith("S"):
        key = submitted_path(str(doc.id), int(stage[1:]))
    else:
        key = returned_path(str(doc.id), int(stage[1:]))

    if not storage.exists(key):
        raise HTTPException(
            status_code=404,
            detail=f"Stage file {stage!r} is not available for this document yet",
        )

    return Response(
        content=storage.read(key),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{stage}.pdf"',
            "Cache-Control": "private, no-cache",
        },
    )


@router.post("", response_model=DocumentResponse, status_code=status.HTTP_201_CREATED)
async def create_document(
    body: DocumentCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("documents.submit")),
):
    """Create a document. The reference number is allocated server-side,
    under a row lock on the per-(project, doc_type, discipline) counter.
    The client never sends a reference_no."""
    await assert_user_in_project(user, body.project_id)

    data = body.model_dump(exclude={"asset_ids", "revision_of_id"})

    # Discipline is mandatory — we need it to allocate the right counter.
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

    # Allocate a serial atomically. For revisions we still use the allocator
    # to bump the discipline counter (it locks the row), then *discard* the
    # formatted reference and copy the parent's reference instead. This
    # keeps the count of WIRs in a discipline consistent with reality.
    config, serial = await _allocate_serial(
        db,
        project_id=body.project_id,
        doc_type=body.document_type,
        discipline_id=body.discipline_id,
    )
    if config is None:
        # No config for (project, doc_type) — auto-create one with defaults
        # so the discipline counter has a starting point.
        config = await _auto_create_ref_config(
            db,
            project_id=body.project_id,
            doc_type=body.document_type,
        )

    data["reference_no"] = _format_reference(
        config,
        doc_type=body.document_type,
        discipline_code=disc.code,
        serial=serial,
    )
    data["revision_no"] = 0

    # Revision: discard the freshly-allocated reference, inherit the
    # parent's reference, increment revision_no. The parent's reference
    # is taken from a server-side lookup, not from the client.
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

    # FAT and CRS documents are records — no approval workflow, always "approved"
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
    return doc


@router.patch("/{doc_id}", response_model=DocumentResponse)
async def update_document(
    doc_id: UUID,
    body: DocumentUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("documents.edit")),
):
    result = await db.execute(
        select(Document)
        .where(Document.id == doc_id, Document.is_deleted == False)  # noqa: E712
        .with_for_update()  # noqa: E712
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    await assert_user_in_project(user, doc.project_id)

    old_status = doc.status
    updates = body.model_dump(exclude_unset=True, exclude={"asset_ids"})

    # Validate status transition if status is being changed
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

    # If status changed, recalculate linked requirements (same transaction).
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
    return doc


@router.post("/{doc_id}/resubmit", response_model=DocumentResponse)
async def resubmit_document(
    doc_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("documents.submit")),
):
    """Resubmit a rejected document with incremented revision."""
    result = await db.execute(
        select(Document)
        .where(Document.id == doc_id, Document.is_deleted == False)  # noqa: E712
        .with_for_update()  # noqa: E712
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    await assert_user_in_project(user, doc.project_id)
    if doc.status != "rejected":
        raise HTTPException(
            status_code=400, detail="Only rejected documents can be resubmitted"
        )

    # Mark current as superseded
    doc.status = "superseded"
    await db.flush()

    # Create new revision (carries the same reference_no but incremented revision_no;
    # the unique constraint includes revision_no, so this is safe).
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

    # Copy asset links
    assets_result = await db.execute(
        document_assets.select().where(document_assets.c.document_id == doc_id)
    )
    for row in assets_result.all():
        await db.execute(
            document_assets.insert().values(
                document_id=new_doc.id, asset_id=row.asset_id
            )
        )

    # Approval rounds are NOT copied — each new revision starts fresh and
    # progresses through the approver chain again. The chain itself is
    # configured per project + doc_type on ProjectApprover and resolved
    # at "Submit to Approver N" time (Phase 2).

    await record_audit(
        db,
        user_id=user.id,
        action="update",
        entity_type="document",
        entity_id=new_doc.id,
        summary=f"Resubmitted {new_doc.document_type} '{new_doc.reference_no}' rev {new_doc.revision_no}",
    )
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Conflict — please retry")
    await db.refresh(new_doc)
    return new_doc


@router.delete("/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(
    doc_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("documents.delete")),
):
    """Delete or supersede a document.

    Logic:
    - Only the document creator or admin/super_admin can delete/supersede
    - If document was submitted to at least one approver: SUPERSEDE
      (mark as superseded, keep the serial number incremented)
    - If document was NOT submitted: HARD DELETE
      (delete document + all attachments, do not reuse serial)
    """
    from app.models.document_attachment import DocumentAttachment
    from app.models.document_approval_round import DocumentApprovalRound

    result = await db.execute(
        select(Document)
        .where(Document.id == doc_id, Document.is_deleted == False)  # noqa: E712
        .with_for_update()
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    await assert_user_in_project(user, doc.project_id)

    # Authorization: only creator or admin/super_admin can delete/supersede
    is_admin = user.is_superuser or any(
        r.name in ("admin", "super_admin") for r in (user.roles or [])
    )
    is_creator = doc.created_by == user.id
    if not (is_admin or is_creator):
        raise HTTPException(
            status_code=403,
            detail="Only the document creator or an administrator can delete/supersede this document",
        )

    # Check if submitted to any approver
    rounds_result = await db.execute(
        select(DocumentApprovalRound).where(
            DocumentApprovalRound.document_id == doc.id,
            DocumentApprovalRound.is_deleted == False,  # noqa: E712
        )
    )
    has_been_submitted = rounds_result.scalar_one_or_none() is not None
    # Also consider explicit status states that imply submission
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
        # SUPERSEDE: mark as superseded (preserve serial number).
        # Free disk: all response/remarks/attachment files are no longer reachable
        # from the working state, so we best-effort unlink them.
        await _purge_document_storage(db, doc.id)
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
        # HARD DELETE: remove document and attachments; serial is not reused.
        #
        # Order matters: we must NOT call recalculate_requirements_for_document
        # before the link + document are gone — that path would otherwise see a
        # still-present, still-"approved" document and stamp the requirement
        # "achieved", which then survives the link/doc deletion as a stale
        # green dot in the inspection tracker with no evidence behind it. Snapshot the
        # affected requirement ids first, wipe the FK chain, then recalc each
        # requirement on its own (the doc row no longer exists, so the
        # document-scoped recalc helper would short-circuit).

        # Delete every owned file on disk before purging DB rows.
        await _purge_document_storage(db, doc.id)

        # Snapshot the asset_requirement ids we will need to recalc after the
        # links are gone.
        from app.models.commissioning import DocumentRequirementLink

        ar_ids_result = await db.execute(
            select(DocumentRequirementLink.asset_requirement_id)
            .where(
                DocumentRequirementLink.document_id == doc.id,
                DocumentRequirementLink.is_deleted == False,  # noqa: E712
            )
            .distinct()
        )
        affected_ar_ids = [row[0] for row in ar_ids_result.all()]

        # Hard delete attachments from DB
        from sqlalchemy import delete as sa_delete

        await db.execute(
            sa_delete(DocumentAttachment).where(
                DocumentAttachment.document_id == doc.id,
            )
        )

        # Hard delete document_assets links
        await db.execute(
            sa_delete(document_assets).where(
                document_assets.c.document_id == doc.id,
            )
        )

        # Hard delete the document-requirement links (live and previously
        # soft-deleted) — once the doc is gone these have nothing to point at.
        await db.execute(
            sa_delete(DocumentRequirementLink).where(
                DocumentRequirementLink.document_id == doc.id,
            )
        )

        # Hard delete the document itself
        await db.execute(sa_delete(Document).where(Document.id == doc.id))

        # Recalculate every affected requirement now that the doc + links are
        # truly gone. recalculate_requirements_for_document() would no-op here
        # (it short-circuits when the doc is missing), so we call the
        # per-requirement helper directly.
        from app.services.commissioning import recalculate_requirement_status

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


# --- Notifications ---


@router.post("/{doc_id}/notify-signatories")
async def notify_signatories(
    doc_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from app.models.notification import Notification
    from sqlalchemy.orm import selectinload

    result = await db.execute(
        select(Document)
        .options(selectinload(Document.discipline))
        .where(Document.id == doc_id, Document.is_deleted == False)  # noqa: E712
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    await assert_user_in_project(user, doc.project_id)

    if doc.created_by != user.id:
        raise HTTPException(
            status_code=403, detail="Only the document creator can notify signatories"
        )

    # Detect previously notified signatories by checking existing notifications for this doc
    existing_notifs = (
        (
            await db.execute(
                select(Notification).where(
                    Notification.link.contains(str(doc_id)),
                    Notification.title.like("Signature Required%"),
                    Notification.is_deleted == False,  # noqa: E712
                )
            )
        )
        .scalars()
        .all()
    )
    previously_notified_ids = {n.user_id for n in existing_notifs}

    link = f"/qaqc/{doc.document_type.lower()}/{doc_id}"
    disc_name = doc.discipline.name if doc.discipline else "—"
    notified = []

    msg = (
        f"You are requested to sign {doc.document_type} {doc.reference_no} (Rev {doc.revision_no}).\n"
        f"Subject: {doc.title}\n"
        f"Discipline: {disc_name}"
    )

    # Notify current signatories who haven't signed
    current_signatory_ids = set()
    for user_id, is_signed in [
        (doc.site_engineer_id, doc.site_engineer_signed),
        (doc.qaqc_engineer_id, doc.qaqc_engineer_signed),
    ]:
        if user_id:
            current_signatory_ids.add(user_id)
            if not is_signed and user_id != user.id:
                notification = Notification(
                    user_id=user_id,
                    project_id=doc.project_id,
                    title=f"Signature Required — {doc.reference_no}",
                    message=msg,
                    link=link,
                )
                db.add(notification)
                notified.append(str(user_id))

    # Notify removed signatories that they are no longer required
    removed_ids = previously_notified_ids - current_signatory_ids - {user.id}
    for removed_id in removed_ids:
        notification = Notification(
            user_id=removed_id,
            project_id=doc.project_id,
            title=f"Signature No Longer Required — {doc.reference_no}",
            message=(
                f"You are no longer required to sign {doc.document_type} {doc.reference_no} (Rev {doc.revision_no}).\n"
                f"Subject: {doc.title}\n"
                f"Discipline: {disc_name}"
            ),
            link=link,
        )
        db.add(notification)

    await db.commit()
    return {"notified": notified}


# --- Sign ---


@router.post("/{doc_id}/sign", response_model=DocumentResponse)
async def sign_document(
    doc_id: UUID,
    role: str = Query(..., pattern="^(site_engineer|qaqc_engineer)$"),
    on_behalf_of: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("documents.sign")),
):
    # Lock the row so two concurrent signers can't race past the "already signed" check.
    result = await db.execute(
        select(Document)
        .where(Document.id == doc_id, Document.is_deleted == False)  # noqa: E712
        .with_for_update()  # noqa: E712
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    await assert_user_in_project(user, doc.project_id)
    if doc.status != "draft":
        raise HTTPException(status_code=400, detail="Document is not in draft status")

    from app.models.signature_delegation import SignatureDelegation

    # Determine the signatory
    signatory_id = user.id
    if on_behalf_of:
        from uuid import UUID as _UUID

        try:
            behalf_uuid = _UUID(on_behalf_of)
        except (ValueError, TypeError):
            raise HTTPException(status_code=400, detail="Invalid on_behalf_of")
        if behalf_uuid != user.id:
            # Verify delegation exists
            deleg = await db.execute(
                select(SignatureDelegation).where(
                    SignatureDelegation.grantor_id == behalf_uuid,
                    SignatureDelegation.delegate_id == user.id,
                    SignatureDelegation.is_deleted == False,  # noqa: E712
                )
            )
            if not deleg.scalar_one_or_none():
                raise HTTPException(
                    status_code=403, detail="No delegation from this user"
                )
        signatory_id = behalf_uuid

    if role == "site_engineer":
        if doc.site_engineer_signed:
            raise HTTPException(status_code=400, detail="Already signed by inspector 1")
        doc.site_engineer_id = signatory_id
        doc.site_engineer_signed = True
    else:
        if doc.qaqc_engineer_signed:
            raise HTTPException(status_code=400, detail="Already signed by inspector 2")
        doc.qaqc_engineer_id = signatory_id
        doc.qaqc_engineer_signed = True

    # Auto-transition to internally_signed when all required sigs collected.
    # MIR has single signatory (site_engineer only), others need both.
    if doc.document_type == "MIR":
        if doc.site_engineer_signed:
            doc.status = "internally_signed"
            doc.submitted_date = datetime.now(timezone.utc)
    else:
        if doc.site_engineer_signed and doc.qaqc_engineer_signed:
            doc.status = "internally_signed"
            doc.submitted_date = datetime.now(timezone.utc)

    await record_audit(
        db,
        user_id=user.id,
        action="sign",
        entity_type="document",
        entity_id=doc.id,
        summary=f"Signed {doc.document_type} '{doc.reference_no}' as {role}",
    )

    # Notify grantor if signed on their behalf
    if signatory_id != user.id:
        from app.models.notification import Notification

        doc_type_lower = doc.document_type.lower()
        db.add(
            Notification(
                user_id=signatory_id,
                project_id=doc.project_id,
                title=f"Signed on your behalf — {doc.reference_no}",
                message=f"{user.full_name} signed {doc.document_type} '{doc.reference_no}' on your behalf.",
                link=f"/qaqc/{doc_type_lower}?doc={doc.id}",
            )
        )

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Conflict — please retry")
    await db.refresh(doc)
    return doc


@router.post("/{doc_id}/unsign", response_model=DocumentResponse)
async def unsign_document(
    doc_id: UUID,
    role: str = Query(..., pattern="^(site_engineer|qaqc_engineer)$"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("documents.sign")),
):
    result = await db.execute(
        select(Document)
        .where(Document.id == doc_id, Document.is_deleted == False)  # noqa: E712
        .with_for_update()  # noqa: E712
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    await assert_user_in_project(user, doc.project_id)
    if doc.status not in ("draft", "internally_signed"):
        raise HTTPException(
            status_code=400, detail="Cannot remove signature after submission"
        )

    if role == "site_engineer":
        if not doc.site_engineer_signed:
            raise HTTPException(status_code=400, detail="Not signed by inspector 1")
        doc.site_engineer_signed = False
    else:
        if not doc.qaqc_engineer_signed:
            raise HTTPException(status_code=400, detail="Not signed by inspector 2")
        doc.qaqc_engineer_signed = False

    # Revert to draft if it was internally_signed
    if doc.status == "internally_signed":
        doc.status = "draft"
        doc.submitted_date = None

    await record_audit(
        db,
        user_id=user.id,
        action="unsign",
        entity_type="document",
        entity_id=doc.id,
        summary=f"Removed signature from {doc.document_type} '{doc.reference_no}' as {role}",
    )
    await db.commit()
    await db.refresh(doc)
    return doc


# --- External Approval Workflow ---


@router.get(
    "/{doc_id}/approval-rounds", response_model=list[DocumentApprovalRoundResponse]
)
async def list_approval_rounds(
    doc_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    doc = (
        await db.execute(
            select(Document).where(Document.id == doc_id, Document.is_deleted == False)  # noqa: E712
        )
    ).scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    await assert_user_in_project(user, doc.project_id)
    rounds = (
        (
            await db.execute(
                select(DocumentApprovalRound)
                .where(
                    DocumentApprovalRound.document_id == doc_id,
                    DocumentApprovalRound.is_deleted == False,  # noqa: E712
                )
                .order_by(
                    DocumentApprovalRound.approver_order, DocumentApprovalRound.round_no
                )
            )
        )
        .scalars()
        .all()
    )
    return rounds


@router.post(
    "/{doc_id}/extract-preview",
    response_model=OCRExtractResponse,
)
async def extract_preview_region(
    doc_id: UUID,
    file: UploadFile = File(...),
    page: int = Query(..., ge=1),
    x: float = Query(...),
    y: float = Query(...),
    width: float = Query(..., gt=0),
    height: float = Query(..., gt=0),
    target_field: str = Query(...),
    force_ocr: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Stateless region extraction against an in-memory PDF.

    Called from the Record-Response dialog before save: the user has picked a
    file but no round exists yet. Once the round is saved, the persistent
    /approval-rounds/{round_id}/extract endpoint takes over.
    """
    from app.services.pdf import extract_region_text, normalize_date_text

    if target_field not in (
        "signatory_name",
        "response_date",
        "response_time",
        "comments",
    ):
        raise HTTPException(status_code=400, detail="Invalid target_field")

    doc = (
        await db.execute(
            select(Document).where(Document.id == doc_id, Document.is_deleted == False)  # noqa: E712
        )
    ).scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    await assert_user_in_project(user, doc.project_id)

    suffix = FilePath(file.filename or "").suffix.lower()
    if suffix != ".pdf":
        raise HTTPException(status_code=400, detail="File must be a PDF")
    data = await file.read()
    if len(data) > MAX_ATTACHMENT_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"File too large (max {_mb(MAX_ATTACHMENT_BYTES)}MB)",
        )
    if len(data) == 0:
        raise HTTPException(status_code=400, detail="Empty file")

    try:
        text, via = extract_region_text(
            data,
            page,
            (x, y, width, height),
            target_field=target_field,
            force_ocr=force_ocr,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if target_field == "response_date":
        normalized = normalize_date_text(text)
        if normalized:
            text = normalized
    return OCRExtractResponse(text=text, via=via)


@router.post(
    "/{doc_id}/submit-to-approver",
    response_model=DocumentApprovalRoundResponse,
    status_code=201,
)
async def submit_to_approver_endpoint(
    doc_id: UUID,
    payload: SubmitToApproverRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("documents.edit")),
):
    """Mirror an Aconex submission for the document to Approver N.

    Side effects:
    * Creates the round row (state-machine transition handled in service layer)
    * Assembles the S-round bundle (template + attachments for S1, or
      R{prev} + extras for S{N>=2}) and saves it to
      ``responses/{doc_id}/S{N}.pdf``
    * Stores the storage key on ``round.submitted_file_path`` + size

    If a previous round's response is password-protected and no
    usable password was supplied, returns 400 with
    ``detail.code == "PDF_PASSWORD_REQUIRED"`` so the frontend can
    render the password field.
    """
    from app.services.approval import submit_to_approver
    from app.services.approval_files import (
        assemble_submission_for_round,
        save_submission,
    )

    approver_order = payload.approver_order
    aconex_submitted_date = payload.aconex_submitted_date
    password = payload.password

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

    round_ = await submit_to_approver(db, doc, approver_order, None)

    # Save Aconex submission date if provided
    if aconex_submitted_date:
        from datetime import date as date_cls

        try:
            round_.aconex_submitted_date = date_cls.fromisoformat(aconex_submitted_date)
        except ValueError:
            raise HTTPException(
                status_code=400, detail="aconex_submitted_date must be ISO yyyy-MM-dd"
            )

    # Assemble the S-round bundle. This may raise 400 with
    # PDF_PASSWORD_REQUIRED; the round row is already created (state
    # machine has advanced) so the user can retry without losing
    # progress.
    bundle_bytes = await assemble_submission_for_round(
        db,
        doc,
        approver_order,
        password=password,
    )
    key, size = save_submission(str(doc.id), approver_order, bundle_bytes)
    round_.submitted_file_path = key
    round_.submitted_file_size = size

    await record_audit(
        db,
        user_id=user.id,
        action="submit",
        entity_type="document",
        entity_id=doc.id,
        summary=(
            f"Submitted {doc.document_type} '{doc.reference_no}' rev {doc.revision_no} "
            f"to approver {approver_order} ({size} bytes)"
        ),
    )
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Conflict — please retry")
    await db.refresh(round_)
    return round_


@router.post(
    "/{doc_id}/approval-rounds",
    response_model=DocumentApprovalRoundResponse,
    status_code=201,
)
async def record_response_endpoint(
    doc_id: UUID,
    approver_order: int = Query(..., ge=1, le=MAX_APPROVERS),
    decision_status_id: UUID = Query(...),
    signatory_name: str = Query("", max_length=255),
    response_date: str = Query("", description="ISO date yyyy-MM-dd"),
    response_time: str | None = Query(None, max_length=10),
    comments: str | None = Query(None, max_length=4000),
    aconex_received_date: str = Query("", description="ISO date yyyy-MM-dd"),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("documents.edit")),
):
    """Record a response from approver N: upload returned PDF as a single file."""
    from datetime import date as date_cls

    from app.services.approval import record_response
    from app.models.document_attachment import DocumentAttachment

    suffix = FilePath(file.filename or "").suffix.lower()
    if suffix != ".pdf":
        raise HTTPException(status_code=400, detail="Returned file must be a PDF")
    declared_mime = (file.content_type or "").lower().split(";", 1)[0].strip()
    if declared_mime and declared_mime != "application/pdf":
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

    parsed_date = None
    if response_date:
        try:
            parsed_date = date_cls.fromisoformat(response_date)
        except ValueError:
            raise HTTPException(
                status_code=400, detail="response_date must be ISO yyyy-MM-dd"
            )

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

    round_ = await record_response(
        db,
        doc,
        approver_order,
        decision_status_id,
        signatory_name or None,
        parsed_date,
        comments or None,
    )
    await db.flush()

    # PR2: write the R-round PDF to responses/{doc_id}/R{N}.pdf (one
    # file per stage, name maps directly to "which file is which stage").
    from app.services.approval_files import save_response

    storage_key, file_size, requires_password = save_response(
        str(doc.id),
        approver_order,
        data,
    )
    round_.returned_file_path = storage_key
    round_.returned_file_name = file.filename or "returned.pdf"
    round_.returned_file_locked = requires_password
    round_.response_time = response_time

    # Save Aconex received date
    if aconex_received_date:
        from datetime import date as date_cls2

        try:
            round_.aconex_received_date = date_cls2.fromisoformat(aconex_received_date)
        except ValueError:
            raise HTTPException(
                status_code=400, detail="aconex_received_date must be ISO yyyy-MM-dd"
            )

    # Save the returned PDF as a single attachment (so the existing UI
    # which lists DocumentAttachment rows continues to work).
    db.add(
        DocumentAttachment(
            document_id=doc.id,
            document_approval_round_id=round_.id,
            kind="returned_pdf",
            filename=f"Approver {approver_order} — Returned.pdf",
            storage_path=storage_key,
            content_type="application/pdf",
            size=file_size,
            sort_order=0,
        )
    )

    await record_audit(
        db,
        user_id=user.id,
        action="approval_response",
        entity_type="document",
        entity_id=doc.id,
        summary=(
            f"Recorded approver {approver_order} response on "
            f"{doc.document_type} '{doc.reference_no}' rev {doc.revision_no}"
        ),
    )
    if doc.status in ("approved", "approved_with_comments", "rejected"):
        await recalculate_requirements_for_document(db, doc.id)

    # Notify creator + signatories on rejection or approval
    if doc.status in ("rejected", "approved", "approved_with_comments"):
        from app.models.notification import Notification
        from sqlalchemy.orm import selectinload

        disc_result = await db.execute(
            select(Document)
            .options(selectinload(Document.discipline))
            .where(Document.id == doc.id)
        )
        doc_with_disc = disc_result.scalar_one()
        disc_name = doc_with_disc.discipline.name if doc_with_disc.discipline else "—"
        link = f"/qaqc/{doc.document_type.lower()}/{doc_id}"

        if doc.status == "rejected":
            title = f"Document Rejected — {doc.reference_no}"
            message = (
                f"{doc.document_type} {doc.reference_no} (Rev {doc.revision_no}) has been REJECTED by Approver {approver_order}.\n\n"
                f"Subject: {doc.title}\n"
                f"Discipline: {disc_name}\n"
                f"Signatory: {signatory_name or '—'}\n"
                f"Comments: {comments or 'None'}\n\n"
                f"Action required: Start a new revision to resubmit."
            )
        else:
            status_label = (
                "Approved" if doc.status == "approved" else "Approved with Comments"
            )
            title = f"Document {status_label} — {doc.reference_no}"
            message = (
                f"{doc.document_type} {doc.reference_no} (Rev {doc.revision_no}) has been {status_label.upper()}.\n\n"
                f"Subject: {doc.title}\n"
                f"Discipline: {disc_name}\n"
                f"Signatory: {signatory_name or '—'}\n"
                f"Comments: {comments or 'None'}"
            )

        recipients = {doc.created_by, doc.site_engineer_id, doc.qaqc_engineer_id} - {
            None
        }
        for uid in recipients:
            db.add(
                Notification(
                    user_id=uid,
                    project_id=doc.project_id,
                    title=title,
                    message=message,
                    link=link,
                )
            )

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Conflict — please retry")
    await db.refresh(round_)
    return round_


@router.put(
    "/{doc_id}/approval-rounds/{round_id}/file",
    status_code=200,
)
async def replace_round_file(
    doc_id: UUID,
    round_id: UUID,
    file: UploadFile = File(...),
    signatory_name: str | None = Form(None),
    response_date: str | None = Form(None),
    response_time: str | None = Form(None),
    comments: str | None = Form(None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("documents.edit")),
):
    """Replace the returned PDF for an approval round. Always overwrites all metadata."""
    from datetime import date as date_cls
    from app.models.document_attachment import DocumentAttachment

    suffix = FilePath(file.filename or "").suffix.lower()
    if suffix != ".pdf":
        raise HTTPException(status_code=400, detail="File must be a PDF")
    data = await file.read()
    if len(data) > MAX_ATTACHMENT_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"File too large (max {_mb(MAX_ATTACHMENT_BYTES)}MB)",
        )
    if len(data) == 0:
        raise HTTPException(status_code=400, detail="Empty file")

    doc = (
        await db.execute(
            select(Document).where(Document.id == doc_id, Document.is_deleted == False)  # noqa: E712
        )
    ).scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    await assert_user_in_project(user, doc.project_id)

    round_ = (
        await db.execute(
            select(DocumentApprovalRound).where(
                DocumentApprovalRound.id == round_id,
                DocumentApprovalRound.document_id == doc_id,
            )
        )
    ).scalar_one_or_none()
    if not round_:
        raise HTTPException(status_code=404, detail="Round not found")

    from app.services.approval_files import save_response

    storage_key, file_size, requires_password = save_response(
        str(doc.id),
        round_.approver_order,
        data,
    )
    round_.returned_file_path = storage_key
    round_.returned_file_name = file.filename or "returned.pdf"
    round_.returned_file_locked = requires_password

    # Always overwrite metadata (None/empty = clear)
    round_.signatory_name = signatory_name or None
    round_.comments = comments or None
    round_.response_time = response_time or None
    if response_date:
        try:
            round_.response_date = date_cls.fromisoformat(response_date)
        except ValueError:
            round_.response_date = None
    else:
        round_.response_date = None

    # Update the returned_pdf attachment
    att = (
        await db.execute(
            select(DocumentAttachment).where(
                DocumentAttachment.document_approval_round_id == round_id,
                DocumentAttachment.kind == "returned_pdf",
                DocumentAttachment.is_deleted == False,  # noqa: E712
            )
        )
    ).scalar_one_or_none()
    if att:
        att.storage_path = storage_key
        att.size = len(data)
        att.filename = f"Approver {round_.approver_order} — Returned.pdf"

    # Delete all user_attachment files for this round (new document = fresh start)
    user_atts = (
        (
            await db.execute(
                select(DocumentAttachment).where(
                    DocumentAttachment.document_approval_round_id == round_id,
                    DocumentAttachment.kind == "user_attachment",
                    DocumentAttachment.is_deleted == False,  # noqa: E712
                )
            )
        )
        .scalars()
        .all()
    )
    for ua in user_atts:
        try:
            storage.delete(ua.storage_path)
        except Exception:
            pass
        await db.delete(ua)

    await db.commit()
    return {"status": "replaced", "filename": round_.returned_file_name}


@router.post(
    "/{doc_id}/approval-rounds/{round_id}/extract",
    response_model=OCRExtractResponse,
)
async def extract_round_region(
    doc_id: UUID,
    round_id: UUID,
    body: OCRExtractRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Region-based text extraction from a returned PDF.

    Frontend draws a rectangle on the PDF preview (via PDF.js) and sends
    page + bbox here. Backend extracts text from that region and returns it
    for the user to confirm into a form field.
    """
    from app.services.pdf import extract_region_text, normalize_date_text

    doc = (
        await db.execute(
            select(Document).where(Document.id == doc_id, Document.is_deleted == False)  # noqa: E712
        )
    ).scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    await assert_user_in_project(user, doc.project_id)

    round_ = (
        await db.execute(
            select(DocumentApprovalRound).where(
                DocumentApprovalRound.id == round_id,
                DocumentApprovalRound.document_id == doc_id,
            )
        )
    ).scalar_one_or_none()
    if not round_ or not round_.returned_file_path:
        raise HTTPException(status_code=404, detail="Round or returned file not found")

    if not storage.exists(round_.returned_file_path):
        raise HTTPException(status_code=404, detail="Returned file is missing")

    if len(body.bbox) != 4:
        raise HTTPException(
            status_code=400, detail="bbox must be [x, y, width, height]"
        )

    try:
        text, via = extract_region_text(
            storage.read(round_.returned_file_path),
            body.page,
            tuple(body.bbox),
            target_field=body.target_field,
            force_ocr=body.force_ocr,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if body.target_field == "response_date":
        normalized = normalize_date_text(text)
        if normalized:
            text = normalized
    return OCRExtractResponse(text=text, via=via)


@router.post(
    "/{doc_id}/approval-rounds/{round_id}/remarks",
    response_model=DocumentApprovalRoundResponse,
)
async def upload_round_remarks(
    doc_id: UUID,
    round_id: UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("documents.edit")),
):
    """Attach an optional 'Our Remarks for Approver 2' file to an Approver-1 round
    that returned status B."""
    from app.services.approval import attach_remarks

    suffix = FilePath(file.filename or "").suffix.lower()
    if suffix != ".pdf":
        raise HTTPException(status_code=400, detail="Remarks file must be a PDF")
    data = await file.read()
    if len(data) > MAX_ATTACHMENT_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"File too large (max {_mb(MAX_ATTACHMENT_BYTES)}MB)",
        )
    if len(data) == 0:
        raise HTTPException(status_code=400, detail="Empty file")

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

    round_ = (
        await db.execute(
            select(DocumentApprovalRound).where(
                DocumentApprovalRound.id == round_id,
                DocumentApprovalRound.document_id == doc_id,
            )
        )
    ).scalar_one_or_none()
    if not round_:
        raise HTTPException(status_code=404, detail="Round not found")

    storage_key = f"approval-rounds/{round_.id}/remarks.pdf"
    storage.save(storage_key, data)

    await attach_remarks(db, doc, round_, storage_key, file.filename or "remarks.pdf")

    await record_audit(
        db,
        user_id=user.id,
        action="update",
        entity_type="document",
        entity_id=doc.id,
        summary=f"Added remarks to approver 1 round on '{doc.reference_no}'",
    )
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Conflict — please retry")
    await db.refresh(round_)
    return round_


@router.post(
    "/{doc_id}/approval-rounds/{round_id}/attachments",
    status_code=201,
)
async def upload_round_attachment(
    doc_id: UUID,
    round_id: UUID,
    file: UploadFile = File(...),
    insert_after_page: int | None = Query(
        None,
        ge=0,
        description="Page number after which to insert (0-indexed). Omit to upload without adding to bundle.",
    ),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("documents.edit")),
):
    """Upload an additional attachment to an approval round with page position.

    The attachment will be inserted after the specified page in the final merged bundle.
    insert_after_page is 0-indexed (0 = after first page of returned PDF).
    """
    from app.models.document_attachment import DocumentAttachment

    suffix = FilePath(file.filename or "").suffix.lower()
    if suffix not in (".pdf", ".png", ".jpg", ".jpeg"):
        raise HTTPException(
            status_code=400, detail="Attachment must be a PDF or image (PNG, JPG)"
        )
    allowed_mimes = {"application/pdf", "image/png", "image/jpeg"}
    declared_mime = (file.content_type or "").lower().split(";", 1)[0].strip()
    if declared_mime and declared_mime not in allowed_mimes:
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

    doc = (
        await db.execute(
            select(Document).where(Document.id == doc_id, Document.is_deleted == False)  # noqa: E712
        )
    ).scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    await assert_user_in_project(user, doc.project_id)

    round_ = (
        await db.execute(
            select(DocumentApprovalRound).where(
                DocumentApprovalRound.id == round_id,
                DocumentApprovalRound.document_id == doc_id,
            )
        )
    ).scalar_one_or_none()
    if not round_:
        raise HTTPException(status_code=404, detail="Round not found")

    # Get next sort order for this round
    count_result = await db.execute(
        select(func.count())
        .select_from(DocumentAttachment)
        .where(
            DocumentAttachment.document_approval_round_id == round_id,
            DocumentAttachment.kind == "user_attachment",
            DocumentAttachment.is_deleted == False,  # noqa: E712
        )
    )
    existing_count = count_result.scalar() or 0

    file_id = str(uuid.uuid4())
    storage_key = f"approval-rounds/{round_.id}/attachments/{file_id}.pdf"
    storage.save(storage_key, data)

    att = DocumentAttachment(
        document_id=doc.id,
        document_approval_round_id=round_.id,
        kind="user_attachment",
        filename=file.filename or "attachment.pdf",
        storage_path=storage_key,
        content_type="application/pdf",
        size=len(data),
        sort_order=existing_count,
        insert_after_page=insert_after_page,
    )
    db.add(att)

    await record_audit(
        db,
        user_id=user.id,
        action="create",
        entity_type="document",
        entity_id=doc.id,
        summary=f"Added attachment to approval round {round_.approver_order}",
    )
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


@router.get("/{doc_id}/approval-rounds/{round_id}/attachments")
async def list_round_attachments(
    doc_id: UUID,
    round_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """List all user_attachment files for a round."""
    from app.models.document_attachment import DocumentAttachment

    result = await db.execute(
        select(DocumentAttachment)
        .where(
            DocumentAttachment.document_approval_round_id == round_id,
            DocumentAttachment.kind == "user_attachment",
            DocumentAttachment.is_deleted == False,  # noqa: E712
        )
        .order_by(DocumentAttachment.sort_order)
    )
    atts = result.scalars().all()
    return [
        {
            "id": str(a.id),
            "filename": a.filename,
            "size": a.size,
            "insert_after_page": a.insert_after_page,
        }
        for a in atts
    ]


@router.patch("/{doc_id}/approval-rounds/{round_id}/attachments/{att_id}")
async def update_round_attachment(
    doc_id: UUID,
    round_id: UUID,
    att_id: UUID,
    body: dict,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("documents.edit")),
):
    """Set or clear insert_after_page on a round attachment."""
    from app.models.document_attachment import DocumentAttachment

    att = (
        await db.execute(
            select(DocumentAttachment).where(
                DocumentAttachment.id == att_id,
                DocumentAttachment.document_approval_round_id == round_id,
                DocumentAttachment.kind == "user_attachment",
                DocumentAttachment.is_deleted == False,  # noqa: E712
            )
        )
    ).scalar_one_or_none()
    if not att:
        raise HTTPException(status_code=404, detail="Attachment not found")

    if "insert_after_page" in body:
        att.insert_after_page = body["insert_after_page"]  # None = remove from bundle
    await db.commit()
    return {
        "id": str(att.id),
        "filename": att.filename,
        "insert_after_page": att.insert_after_page,
    }


@router.delete(
    "/{doc_id}/approval-rounds/{round_id}/attachments/{att_id}", status_code=204
)
async def delete_round_attachment(
    doc_id: UUID,
    round_id: UUID,
    att_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("documents.edit")),
):
    """Delete a round attachment (only if not in bundle)."""
    from app.models.document_attachment import DocumentAttachment

    att = (
        await db.execute(
            select(DocumentAttachment).where(
                DocumentAttachment.id == att_id,
                DocumentAttachment.document_approval_round_id == round_id,
                DocumentAttachment.kind == "user_attachment",
                DocumentAttachment.is_deleted == False,  # noqa: E712
            )
        )
    ).scalar_one_or_none()
    if not att:
        raise HTTPException(status_code=404, detail="Attachment not found")
    if att.insert_after_page is not None:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete attachment that is in the bundle. Remove from bundle first.",
        )

    # Hard delete file + record
    try:
        storage.delete(att.storage_path)
    except Exception:
        pass
    await db.delete(att)
    await db.commit()


@router.get("/{doc_id}/approval-rounds/{round_id}/bundle")
async def download_round_bundle(
    doc_id: UUID,
    round_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Download the complete merged PDF bundle for an approval round.

    Merges the returned PDF with all user-uploaded attachments at their
    specified page positions.
    """
    from fastapi.responses import Response
    from app.models.document_attachment import DocumentAttachment
    from app.services.pdf_merge import merge_pdf_bundle

    doc = (
        await db.execute(
            select(Document).where(Document.id == doc_id, Document.is_deleted == False)  # noqa: E712
        )
    ).scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    await assert_user_in_project(user, doc.project_id)

    round_ = (
        await db.execute(
            select(DocumentApprovalRound).where(
                DocumentApprovalRound.id == round_id,
                DocumentApprovalRound.document_id == doc_id,
            )
        )
    ).scalar_one_or_none()
    if not round_ or not round_.returned_file_path:
        raise HTTPException(status_code=404, detail="Round or returned file not found")

    if not storage.exists(round_.returned_file_path):
        raise HTTPException(status_code=404, detail="Returned file is missing")

    returned_pdf_bytes = storage.read(round_.returned_file_path)

    # Get only attachments that are in the bundle (have insert_after_page set)
    attachments_result = await db.execute(
        select(DocumentAttachment)
        .where(
            DocumentAttachment.document_approval_round_id == round_id,
            DocumentAttachment.kind == "user_attachment",
            DocumentAttachment.insert_after_page.isnot(None),
            DocumentAttachment.is_deleted == False,  # noqa: E712
        )
        .order_by(DocumentAttachment.insert_after_page, DocumentAttachment.sort_order)
    )
    attachments = attachments_result.scalars().all()

    # If no attachments, just return the returned PDF
    if not attachments:
        fname = await _build_download_filename(db, doc)
        return Response(
            content=returned_pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{fname}"'},
        )

    # Load attachment files and prepare for merging
    attachment_data = []
    for att in attachments:
        if not storage.exists(att.storage_path):
            continue
        att_bytes = storage.read(att.storage_path)
        attachment_data.append((att_bytes, att.insert_after_page or 0))

    # Merge PDFs
    try:
        merged_pdf = merge_pdf_bundle(returned_pdf_bytes, attachment_data)
    except ValueError as e:
        raise HTTPException(status_code=413, detail=str(e))

    fname = await _build_download_filename(db, doc)
    return Response(
        content=merged_pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@router.post(
    "/{doc_id}/start-new-revision", response_model=DocumentResponse, status_code=201
)
async def start_new_revision(
    doc_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("documents.edit")),
):
    """After a status-C decision, close the current revision and start a fresh draft.

    Marks the current revision as ``superseded`` and creates a new Document row
    with the same reference_no, revision_no + 1, all metadata copied, and asset
    links carried over. Approval rounds and attachments are NOT copied — they
    were specific to the rejected revision.
    """
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


# --- Attachments (stored on web server filesystem) ---


async def _load_doc_for_attachment(
    db: AsyncSession, doc_id: UUID, user: User
) -> Document:
    doc = (
        await db.execute(
            select(Document).where(Document.id == doc_id, Document.is_deleted == False)  # noqa: E712
        )
    ).scalar_one_or_none()  # noqa: E712
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    await assert_user_in_project(user, doc.project_id)
    return doc


@router.get("/{doc_id}/attachments")
async def list_attachments(
    doc_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from app.models.document_attachment import DocumentAttachment

    await _load_doc_for_attachment(db, doc_id, user)
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
    from app.models.document_attachment import DocumentAttachment

    await _load_doc_for_attachment(db, doc_id, user)

    # Validate suffix and MIME up front; both must be in the allow-list.
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

    # Per-document attachment cap
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


@router.delete("/{doc_id}/attachments/{att_id}", status_code=204)
async def delete_attachment(
    doc_id: UUID,
    att_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("documents.edit")),
):
    from app.models.document_attachment import DocumentAttachment

    await _load_doc_for_attachment(db, doc_id, user)
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
    # Free disk after the row is marked deleted — we don't want a half-deleted
    # attachment re-appearing if the commit fails. The soft-delete keeps the
    # history in the DB; the file is unlinked best-effort.
    if storage_path:
        try:
            storage.delete(storage_path)
        except Exception:
            pass


@router.patch("/{doc_id}/attachments/reorder")
async def reorder_attachments(
    doc_id: UUID,
    body: list[UUID],
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("documents.edit")),
):
    """Reorder attachments. Body is ordered list of attachment IDs."""
    from app.models.document_attachment import DocumentAttachment
    from sqlalchemy import update as sa_update

    await _load_doc_for_attachment(db, doc_id, user)

    # Single round-trip per id; bound by attachment cap so this stays cheap.
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


@router.get("/{doc_id}/bundle")
async def download_document_bundle(
    doc_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Download the complete merged PDF bundle for a document.

    Generates the document PDF and merges it with all user-uploaded attachments
    at their specified page positions.
    """
    from fastapi.responses import Response
    from sqlalchemy.orm import selectinload
    from app.models.document_attachment import DocumentAttachment
    from app.api.v1.reports import (
        _build_context,
        _fill_template,
        _convert_to_pdf,
        _stamp_vector_signatures,
    )
    from app.models.doc_template import DocTemplate

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
        raise HTTPException(status_code=404, detail="Not found")
    await assert_user_in_project(user, doc.project_id)

    # Get template
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

    # Generate PDF
    context = _build_context(doc)
    docx_bytes = _fill_template(template.file, context, doc)
    main_pdf_bytes = await _convert_to_pdf(docx_bytes)

    # Load signature config
    import json as _json
    from app.models.app_setting import AppSetting

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
    main_pdf_bytes = _stamp_vector_signatures(main_pdf_bytes, doc, _sig_cfg)

    # Get all user attachments for this document
    attachments_result = await db.execute(
        select(DocumentAttachment)
        .where(
            DocumentAttachment.document_id == doc_id,
            DocumentAttachment.kind == "user",
            DocumentAttachment.is_deleted == False,  # noqa: E712
        )
        .order_by(DocumentAttachment.sort_order)
    )
    attachments = attachments_result.scalars().all()

    # If no attachments, just return the main PDF
    if not attachments:
        fname = await _build_download_filename(db, doc)
        return Response(
            content=main_pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{fname}"'},
        )

    # Merge all attachments (PDFs appended, images converted to PDF pages)
    from app.api.v1.reports import _merge_attachments_with_status

    try:
        merged_pdf, _ = _merge_attachments_with_status(main_pdf_bytes, attachments)
    except ValueError as e:
        raise HTTPException(status_code=413, detail=str(e))

    fname = await _build_download_filename(db, doc)
    return Response(
        content=merged_pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )
