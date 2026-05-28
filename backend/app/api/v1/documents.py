import uuid as uuid_mod
from datetime import datetime, timezone
from typing import Any
from uuid import UUID
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
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
    DocumentCreate, DocumentUpdate, DocumentResponse,
    DocumentApprovalRoundResponse,
    SubmitToApproverRequest, RecordApprovalResponseRequest,
    OCRExtractRequest, OCRExtractResponse,
)
from app.services.commissioning import recalculate_requirements_for_document
from app.services.audit import record_audit

router = APIRouter(prefix="/documents", tags=["documents"])


# ─── helpers ─────────────────────────────────────────────────────────────────

ALLOWED_ATTACHMENT_SUFFIXES = {".pdf", ".png", ".jpg", ".jpeg"}
ALLOWED_ATTACHMENT_MIMES = {
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/jpg",
}
MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024
MAX_ATTACHMENTS_PER_DOC = 200


async def _allocate_serial(
    db: AsyncSession,
    *,
    project_id: UUID,
    doc_type: str,
) -> tuple[ReferenceNumberConfig | None, int]:
    """Atomically allocate the next serial for (project, doc_type).

    Bumps ``next_serial`` under SELECT FOR UPDATE so two concurrent callers
    cannot get the same value. Falls back to a per-(project, doc_type, discipline)
    counter when no config row exists (legacy path)."""
    result = await db.execute(
        select(ReferenceNumberConfig)
        .where(
            ReferenceNumberConfig.project_id == project_id,
            ReferenceNumberConfig.doc_type == doc_type,
        )
        .with_for_update()
    )
    config = result.scalar_one_or_none()
    if config is None:
        return None, 0
    if config.next_serial is None or config.next_serial < (config.serial_start or 1):
        config.next_serial = config.serial_start or 1
    serial = int(config.next_serial)
    config.next_serial = serial + 1
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


@router.get("/generate-ref-number")
async def generate_ref_number(
    project_id: UUID = Query(...),
    doc_type: str = Query(...),
    discipline_code: str = Query(""),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_project_access()),
):
    """Preview the next reference number WITHOUT consuming a serial.

    Note: this is best-effort — the value may differ from what ``POST /documents``
    actually allocates if another request slips in between calls."""
    config_result = await db.execute(
        select(ReferenceNumberConfig).where(
            ReferenceNumberConfig.project_id == project_id,
            ReferenceNumberConfig.doc_type == doc_type.upper(),
        )
    )
    config = config_result.scalar_one_or_none()

    if discipline_code:
        from app.models.discipline import Discipline
        disc_result = await db.execute(
            select(Discipline.id).where(
                Discipline.project_id == project_id,
                Discipline.code == discipline_code,
            )
        )
        if not disc_result.scalar_one_or_none():
            raise HTTPException(status_code=400, detail=f"Discipline '{discipline_code}' not found in project")

    if config:
        next_serial = max(int(config.next_serial or 0), int(config.serial_start or 1))
        ref = _format_reference(
            config,
            doc_type=doc_type.upper(),
            discipline_code=discipline_code,
            serial=next_serial,
        )
    else:
        ref = f"{doc_type.upper()}-0001"
    return {"reference_number": ref}


@router.get("", response_model=list[DocumentResponse])
async def list_documents(
    project_id: UUID = Query(...),
    document_type: str | None = Query(None),
    status_filter: str | None = Query(None, alias="status"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    paginated: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_project_access()),
):
    stmt = select(Document).where(Document.is_deleted == False, Document.project_id == project_id)  # noqa: E712
    if document_type:
        stmt = stmt.where(Document.document_type == document_type)
    if status_filter:
        stmt = stmt.where(Document.status == status_filter)
    # Tie-break by id so paging is stable across rows with equal created_at.
    stmt = stmt.order_by(Document.created_at.desc(), Document.id.desc())
    if paginated:
        from sqlalchemy import func as sa_func
        count_result = await db.execute(select(sa_func.count()).select_from(stmt.subquery()))
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
        select(Document).where(Document.id == doc_id, Document.is_deleted == False)  # noqa: E712
        .options(selectinload(Document.assets))
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    await assert_user_in_project(user, doc.project_id)
    resp = DocumentResponse.model_validate(doc)
    resp.asset_ids = [a.id for a in doc.assets] if doc.assets else []
    return resp


@router.post("", response_model=DocumentResponse, status_code=status.HTTP_201_CREATED)
async def create_document(
    body: DocumentCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("documents.submit")),
):
    await assert_user_in_project(user, body.project_id)

    data = body.model_dump(exclude={"asset_ids"})

    # Server-side ref number generation if not provided
    if not data.get("reference_no"):
        disc_code = ""
        if body.discipline_id:
            from app.models.discipline import Discipline
            disc_result = await db.execute(select(Discipline).where(Discipline.id == body.discipline_id))
            disc = disc_result.scalar_one_or_none()
            if disc:
                disc_code = disc.code
        config, serial = await _allocate_serial(
            db,
            project_id=body.project_id,
            doc_type=body.document_type,
        )
        if config is None:
            # Fallback: count existing docs of this type for the project. Not race-safe, but
            # only used when no ref-config row exists; the unique constraint will catch dupes.
            count_q = select(func.count()).select_from(Document).where(
                Document.project_id == body.project_id,
                Document.document_type == body.document_type,
            )
            fallback = (await db.execute(count_q)).scalar() or 0
            data["reference_no"] = _format_reference(
                None,
                doc_type=body.document_type,
                discipline_code=disc_code,
                serial=fallback + 1,
                fallback_serial=fallback + 1,
            )
        else:
            data["reference_no"] = _format_reference(
                config,
                doc_type=body.document_type,
                discipline_code=disc_code,
                serial=serial,
            )

    doc = Document(**data, created_by=user.id)
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
            await db.execute(document_assets.insert().values(document_id=doc.id, asset_id=aid))

    await record_audit(db, user_id=user.id, action="create", entity_type="document", entity_id=doc.id, summary=f"Created {doc.document_type} '{doc.reference_no}'")
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Reference number collision — please retry.")
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
        select(Document).where(Document.id == doc_id, Document.is_deleted == False).with_for_update()  # noqa: E712
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    await assert_user_in_project(user, doc.project_id)

    old_status = doc.status
    updates = body.model_dump(exclude_unset=True, exclude={"asset_ids"})

    # Validate status transition if status is being changed
    if "status" in updates and updates["status"] and updates["status"] != old_status:
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
        await db.execute(document_assets.delete().where(document_assets.c.document_id == doc_id))
        for aid in body.asset_ids:
            await db.execute(document_assets.insert().values(document_id=doc.id, asset_id=aid))

    if doc.status != old_status:
        await record_audit(db, user_id=user.id, action="update", entity_type="document", entity_id=doc.id, summary=f"Status changed {old_status} → {doc.status} on {doc.reference_no}")

    # If status changed, recalculate linked requirements (same transaction).
    if doc.status != old_status and doc.status in ("approved", "approved_with_comments", "rejected"):
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
        select(Document).where(Document.id == doc_id, Document.is_deleted == False).with_for_update()  # noqa: E712
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    await assert_user_in_project(user, doc.project_id)
    if doc.status != "rejected":
        raise HTTPException(status_code=400, detail="Only rejected documents can be resubmitted")

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
        await db.execute(document_assets.insert().values(document_id=new_doc.id, asset_id=row.asset_id))

    # Approval rounds are NOT copied — each new revision starts fresh and
    # progresses through the approver chain again. The chain itself is
    # configured per project + doc_type on ProjectApprover and resolved
    # at "Submit to Approver N" time (Phase 2).

    await record_audit(
        db, user_id=user.id, action="update", entity_type="document", entity_id=new_doc.id,
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
    result = await db.execute(
        select(Document).where(Document.id == doc_id, Document.is_deleted == False)  # noqa: E712
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    await assert_user_in_project(user, doc.project_id)
    doc.is_deleted = True
    # Recalculate before commit so the soft-delete and the requirement reset land atomically.
    await recalculate_requirements_for_document(db, doc_id)
    await record_audit(db, user_id=user.id, action="delete", entity_type="document", entity_id=doc.id, summary=f"Deleted {doc.document_type} '{doc.reference_no}'")
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

    result = await db.execute(
        select(Document).where(Document.id == doc_id, Document.is_deleted == False)  # noqa: E712
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    await assert_user_in_project(user, doc.project_id)

    link = f"/qaqc/{doc.document_type.lower()}/new?id={doc_id}"
    notified = []

    for user_id in [doc.site_engineer_id, doc.qaqc_engineer_id]:
        if user_id and user_id != user.id:
            notification = Notification(
                user_id=user_id,
                project_id=doc.project_id,
                title="Signature Required",
                message=f"You are requested to sign {doc.document_type}: {doc.title}",
                link=link,
            )
            db.add(notification)
            notified.append(str(user_id))

    await db.commit()
    return {"notified": notified}


# --- Sign ---

@router.post("/{doc_id}/sign", response_model=DocumentResponse)
async def sign_document(
    doc_id: UUID,
    role: str = Query(..., pattern="^(site_engineer|qaqc_engineer)$"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("documents.sign")),
):
    # Lock the row so two concurrent signers can't race past the "already signed" check.
    result = await db.execute(
        select(Document).where(Document.id == doc_id, Document.is_deleted == False).with_for_update()  # noqa: E712
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    await assert_user_in_project(user, doc.project_id)
    if doc.status != "draft":
        raise HTTPException(status_code=400, detail="Document is not in draft status")

    if role == "site_engineer":
        if doc.site_engineer_signed:
            raise HTTPException(status_code=400, detail="Already signed by inspector 1")
        # If a specific engineer was assigned, only that engineer can sign here.
        if doc.site_engineer_id and doc.site_engineer_id != user.id and not user.is_superuser:
            raise HTTPException(status_code=403, detail="This slot is assigned to another engineer")
        doc.site_engineer_id = user.id
        doc.site_engineer_signed = True
    else:
        if doc.qaqc_engineer_signed:
            raise HTTPException(status_code=400, detail="Already signed by inspector 2")
        if doc.qaqc_engineer_id and doc.qaqc_engineer_id != user.id and not user.is_superuser:
            raise HTTPException(status_code=403, detail="This slot is assigned to another engineer")
        doc.qaqc_engineer_id = user.id
        doc.qaqc_engineer_signed = True

    # Auto-transition to internally_signed when both internal sigs collected.
    # External-approval submission is a separate explicit user action (Phase 2).
    if doc.site_engineer_signed and doc.qaqc_engineer_signed:
        doc.status = "internally_signed"
        doc.submitted_date = datetime.now(timezone.utc)

    await record_audit(db, user_id=user.id, action="sign", entity_type="document", entity_id=doc.id, summary=f"Signed {doc.document_type} '{doc.reference_no}' as {role}")
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Conflict — please retry")
    await db.refresh(doc)
    return doc


# --- External Approval Workflow ---


@router.get("/{doc_id}/approval-rounds", response_model=list[DocumentApprovalRoundResponse])
async def list_approval_rounds(
    doc_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    doc = (await db.execute(
        select(Document).where(Document.id == doc_id, Document.is_deleted == False)  # noqa: E712
    )).scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    await assert_user_in_project(user, doc.project_id)
    rounds = (await db.execute(
        select(DocumentApprovalRound)
        .where(
            DocumentApprovalRound.document_id == doc_id,
            DocumentApprovalRound.is_deleted == False,  # noqa: E712
        )
        .order_by(DocumentApprovalRound.approver_order, DocumentApprovalRound.round_no)
    )).scalars().all()
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

    if target_field not in ("signatory_name", "response_date", "comments"):
        raise HTTPException(status_code=400, detail="Invalid target_field")

    doc = (await db.execute(
        select(Document).where(Document.id == doc_id, Document.is_deleted == False)  # noqa: E712
    )).scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    await assert_user_in_project(user, doc.project_id)

    suffix = Path(file.filename or "").suffix.lower()
    if suffix != ".pdf":
        raise HTTPException(status_code=400, detail="File must be a PDF")
    data = await file.read()
    if len(data) > MAX_ATTACHMENT_BYTES:
        raise HTTPException(status_code=400, detail="File too large (max 20MB)")
    if len(data) == 0:
        raise HTTPException(status_code=400, detail="Empty file")

    text, via = extract_region_text(
        data, page, (x, y, width, height),
        target_field=target_field, force_ocr=force_ocr,
    )
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
    body: SubmitToApproverRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("documents.edit")),
):
    """Mirror an Aconex submission for the document to Approver N."""
    from app.services.approval import submit_to_approver

    doc = (await db.execute(
        select(Document)
        .where(Document.id == doc_id, Document.is_deleted == False)  # noqa: E712
        .with_for_update()
    )).scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    await assert_user_in_project(user, doc.project_id)

    round_ = await submit_to_approver(db, doc, body.approver_order, body.submitted_at)

    await record_audit(
        db, user_id=user.id, action="submit", entity_type="document", entity_id=doc.id,
        summary=(
            f"Submitted {doc.document_type} '{doc.reference_no}' rev {doc.revision_no} "
            f"to approver {body.approver_order}"
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
    approver_order: int = Query(..., ge=1, le=10),
    decision_status_id: UUID = Query(...),
    signatory_name: str = Query(..., min_length=1, max_length=255),
    response_date: str = Query(..., description="ISO date yyyy-MM-dd"),
    comments: str | None = Query(None, max_length=4000),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("documents.edit")),
):
    """Record a response from approver N: upload returned PDF, capture decision,
    auto-split into cover + per-page attachments."""
    from datetime import date as date_cls

    from app.services.approval import record_response
    from app.services.pdf import split_returned_pdf
    from app.models.document_attachment import DocumentAttachment

    suffix = Path(file.filename or "").suffix.lower()
    if suffix != ".pdf":
        raise HTTPException(status_code=400, detail="Returned file must be a PDF")
    declared_mime = (file.content_type or "").lower().split(";", 1)[0].strip()
    if declared_mime and declared_mime != "application/pdf":
        raise HTTPException(status_code=400, detail=f"Unsupported MIME type {declared_mime!r}")

    data = await file.read()
    if len(data) > MAX_ATTACHMENT_BYTES:
        raise HTTPException(status_code=400, detail="File too large (max 20MB)")
    if len(data) == 0:
        raise HTTPException(status_code=400, detail="Empty file")

    try:
        parsed_date = date_cls.fromisoformat(response_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="response_date must be ISO yyyy-MM-dd")

    doc = (await db.execute(
        select(Document)
        .where(Document.id == doc_id, Document.is_deleted == False)  # noqa: E712
        .with_for_update()
    )).scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    await assert_user_in_project(user, doc.project_id)

    round_ = await record_response(
        db, doc, approver_order, decision_status_id,
        signatory_name, parsed_date, comments,
    )
    await db.flush()

    # Use the template snapshot locked at submission time, not whichever
    # template happens to be active right now. Admin can upload a newer
    # template version mid-flight without shifting the split boundary.
    cover_pages = doc.cover_page_count or 1
    if not cover_pages or cover_pages < 1:
        cover_pages = 1

    cover_pdf, attachment_pdfs = split_returned_pdf(data, cover_pages)

    upload_root = settings.upload_dir_abs
    upload_dir = (upload_root / "approval-rounds" / str(round_.id)).resolve()
    try:
        upload_dir.relative_to(upload_root)
    except ValueError:
        raise HTTPException(status_code=500, detail="Bad upload path")
    upload_dir.mkdir(parents=True, exist_ok=True)

    returned_path = (upload_dir / "returned.pdf").resolve()
    returned_path.write_bytes(data)
    round_.returned_file_path = str(returned_path.relative_to(upload_root)).replace("\\", "/")
    round_.returned_file_name = file.filename or "returned.pdf"

    cover_path = (upload_dir / "cover.pdf").resolve()
    cover_path.write_bytes(cover_pdf)
    db.add(DocumentAttachment(
        document_id=doc.id,
        document_approval_round_id=round_.id,
        kind="cover",
        filename=f"Approver {approver_order} — Cover.pdf",
        storage_path=str(cover_path.relative_to(upload_root)).replace("\\", "/"),
        content_type="application/pdf",
        size=len(cover_pdf),
        sort_order=0,
    ))
    for idx, att_bytes in enumerate(attachment_pdfs, start=1):
        att_path = (upload_dir / f"attachment-{idx}.pdf").resolve()
        att_path.write_bytes(att_bytes)
        db.add(DocumentAttachment(
            document_id=doc.id,
            document_approval_round_id=round_.id,
            kind="response_attachment",
            filename=f"Approver {approver_order} — Attachment-{idx}.pdf",
            storage_path=str(att_path.relative_to(upload_root)).replace("\\", "/"),
            content_type="application/pdf",
            size=len(att_bytes),
            sort_order=idx,
        ))

    await record_audit(
        db, user_id=user.id, action="approval_response", entity_type="document", entity_id=doc.id,
        summary=(
            f"Recorded approver {approver_order} response on "
            f"{doc.document_type} '{doc.reference_no}' rev {doc.revision_no}"
        ),
    )
    if doc.status in ("approved", "approved_with_comments", "rejected"):
        await recalculate_requirements_for_document(db, doc.id)

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Conflict — please retry")
    await db.refresh(round_)
    return round_


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

    doc = (await db.execute(
        select(Document).where(Document.id == doc_id, Document.is_deleted == False)  # noqa: E712
    )).scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    await assert_user_in_project(user, doc.project_id)

    round_ = (await db.execute(
        select(DocumentApprovalRound).where(
            DocumentApprovalRound.id == round_id,
            DocumentApprovalRound.document_id == doc_id,
        )
    )).scalar_one_or_none()
    if not round_ or not round_.returned_file_path:
        raise HTTPException(status_code=404, detail="Round or returned file not found")

    upload_root = settings.upload_dir_abs
    file_path = (upload_root / round_.returned_file_path).resolve()
    try:
        file_path.relative_to(upload_root)
    except ValueError:
        raise HTTPException(status_code=400, detail="Bad file path")
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Returned file is missing on disk")

    if len(body.bbox) != 4:
        raise HTTPException(status_code=400, detail="bbox must be [x, y, width, height]")

    text, via = extract_region_text(
        file_path.read_bytes(),
        body.page,
        tuple(body.bbox),
        target_field=body.target_field,
        force_ocr=body.force_ocr,
    )
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

    suffix = Path(file.filename or "").suffix.lower()
    if suffix != ".pdf":
        raise HTTPException(status_code=400, detail="Remarks file must be a PDF")
    data = await file.read()
    if len(data) > MAX_ATTACHMENT_BYTES:
        raise HTTPException(status_code=400, detail="File too large (max 20MB)")
    if len(data) == 0:
        raise HTTPException(status_code=400, detail="Empty file")

    doc = (await db.execute(
        select(Document)
        .where(Document.id == doc_id, Document.is_deleted == False)  # noqa: E712
        .with_for_update()
    )).scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    await assert_user_in_project(user, doc.project_id)

    round_ = (await db.execute(
        select(DocumentApprovalRound).where(
            DocumentApprovalRound.id == round_id,
            DocumentApprovalRound.document_id == doc_id,
        )
    )).scalar_one_or_none()
    if not round_:
        raise HTTPException(status_code=404, detail="Round not found")

    upload_root = settings.upload_dir_abs
    upload_dir = (upload_root / "approval-rounds" / str(round_.id)).resolve()
    try:
        upload_dir.relative_to(upload_root)
    except ValueError:
        raise HTTPException(status_code=500, detail="Bad upload path")
    upload_dir.mkdir(parents=True, exist_ok=True)
    remarks_path = (upload_dir / "remarks.pdf").resolve()
    remarks_path.write_bytes(data)

    rel_path = str(remarks_path.relative_to(upload_root)).replace("\\", "/")
    await attach_remarks(db, doc, round_, rel_path, file.filename or "remarks.pdf")

    await record_audit(
        db, user_id=user.id, action="update", entity_type="document", entity_id=doc.id,
        summary=f"Added remarks to approver 1 round on '{doc.reference_no}'",
    )
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Conflict — please retry")
    await db.refresh(round_)
    return round_


@router.post("/{doc_id}/start-new-revision", response_model=DocumentResponse, status_code=201)
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
    doc = (await db.execute(
        select(Document)
        .where(Document.id == doc_id, Document.is_deleted == False)  # noqa: E712
        .with_for_update()
    )).scalar_one_or_none()
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
        await db.execute(document_assets.insert().values(document_id=new_doc.id, asset_id=row.asset_id))

    doc.status = "superseded"

    await record_audit(
        db, user_id=user.id, action="update", entity_type="document", entity_id=new_doc.id,
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

async def _load_doc_for_attachment(db: AsyncSession, doc_id: UUID, user: User) -> Document:
    doc = (await db.execute(select(Document).where(Document.id == doc_id, Document.is_deleted == False))).scalar_one_or_none()  # noqa: E712
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
        .where(DocumentAttachment.document_id == doc_id, DocumentAttachment.is_deleted == False)  # noqa: E712
        .order_by(DocumentAttachment.sort_order, DocumentAttachment.id)
    )
    return [{"id": str(a.id), "filename": a.filename, "size": a.size, "sort_order": a.sort_order, "content_type": a.content_type} for a in result.scalars().all()]


@router.post("/{doc_id}/attachments", status_code=201)
async def upload_attachment(
    doc_id: UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("documents.edit")),
):
    from app.models.document_attachment import DocumentAttachment
    from app.core.config import settings

    await _load_doc_for_attachment(db, doc_id, user)

    # Validate suffix and MIME up front; both must be in the allow-list.
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_ATTACHMENT_SUFFIXES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type {suffix!r}. Allowed: {sorted(ALLOWED_ATTACHMENT_SUFFIXES)}",
        )
    declared_mime = (file.content_type or "").lower().split(";", 1)[0].strip()
    if declared_mime and declared_mime not in ALLOWED_ATTACHMENT_MIMES:
        raise HTTPException(status_code=400, detail=f"Unsupported MIME type {declared_mime!r}")

    data = await file.read()
    if len(data) > MAX_ATTACHMENT_BYTES:
        raise HTTPException(status_code=400, detail="File too large (max 20MB)")
    if len(data) == 0:
        raise HTTPException(status_code=400, detail="Empty file")

    # Per-document attachment cap
    count_result = await db.execute(
        select(func.count()).select_from(DocumentAttachment).where(
            DocumentAttachment.document_id == doc_id, DocumentAttachment.is_deleted == False  # noqa: E712
        )
    )
    existing_count = count_result.scalar() or 0
    if existing_count >= MAX_ATTACHMENTS_PER_DOC:
        raise HTTPException(status_code=400, detail=f"Maximum of {MAX_ATTACHMENTS_PER_DOC} attachments per document")

    # Resolve upload dir to absolute path; verify the final path stays within it.
    upload_root = settings.upload_dir_abs
    upload_dir = (upload_root / "attachments" / str(doc_id)).resolve()
    try:
        upload_dir.relative_to(upload_root)
    except ValueError:
        raise HTTPException(status_code=500, detail="Bad upload path")
    upload_dir.mkdir(parents=True, exist_ok=True)

    file_id = str(uuid_mod.uuid4())
    storage_filename = f"{file_id}{suffix}"
    file_path = (upload_dir / storage_filename).resolve()
    try:
        file_path.relative_to(upload_root)
    except ValueError:
        raise HTTPException(status_code=500, detail="Bad upload path")
    file_path.write_bytes(data)

    att = DocumentAttachment(
        document_id=doc_id,
        filename=file.filename or "unnamed",
        storage_path=str(file_path.relative_to(upload_root)).replace("\\", "/"),
        content_type=declared_mime or "application/octet-stream",
        size=len(data),
        sort_order=existing_count,
    )
    db.add(att)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Conflict — please retry")
    await db.refresh(att)
    return {"id": str(att.id), "filename": att.filename, "size": att.size}


@router.delete("/{doc_id}/attachments/{att_id}", status_code=204)
async def delete_attachment(
    doc_id: UUID,
    att_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("documents.edit")),
):
    from app.models.document_attachment import DocumentAttachment
    await _load_doc_for_attachment(db, doc_id, user)
    result = await db.execute(select(DocumentAttachment).where(DocumentAttachment.id == att_id, DocumentAttachment.document_id == doc_id))
    att = result.scalar_one_or_none()
    if not att:
        raise HTTPException(status_code=404, detail="Attachment not found")
    att.is_deleted = True
    await db.commit()


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
            .where(DocumentAttachment.id == att_id, DocumentAttachment.document_id == doc_id)
            .values(sort_order=i)
        )
    await db.commit()
    return {"status": "ok"}

