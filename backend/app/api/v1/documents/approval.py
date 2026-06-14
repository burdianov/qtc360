"""External approval workflow — submit to approver, record response, OCR extraction,
round remarks, round attachments, and bundle download."""

import uuid
from datetime import date as date_cls
from pathlib import Path as FilePath
from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
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
)
from app.core.types import MAX_ATTACHMENT_BYTES, MAX_APPROVERS, AttachmentKind, _mb
from app.models.document import Document
from app.models.document_approval_round import DocumentApprovalRound
from app.models.document_attachment import DocumentAttachment
from app.models.user import User
from app.schemas.document import (
    DocumentApprovalRoundResponse,
    OCRExtractRequest,
    OCRExtractResponse,
    SubmitToApproverRequest,
)
from app.services.audit import record_audit
from app.services.commissioning import recalculate_requirements_for_document
from app.services.storage import storage
from app.api.v1.documents.helpers import build_download_filename

router = APIRouter()


# ── List approval rounds ─────────────────────────────────────────────────────

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


# ── OCR preview (stateless, before round exists) ─────────────────────────────

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
    """Stateless region extraction against an in-memory PDF."""
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


# ── Submit to approver ───────────────────────────────────────────────────────

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
    """Mirror an Aconex submission for the document to Approver N."""
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

    if aconex_submitted_date:
        try:
            round_.aconex_submitted_date = date_cls.fromisoformat(aconex_submitted_date)
        except ValueError:
            raise HTTPException(
                status_code=400, detail="aconex_submitted_date must be ISO yyyy-MM-dd"
            )

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
    # Flush (not commit) so the unique constraint on (document_id, approver_order,
    # round_no) is checked in this transaction. Two concurrent submissions against
    # the same document will both pass the pre-check (both see existing=None), but
    # the second flush() trips the unique constraint, which we translate to 409.
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail="A submission for this approver is already in progress — retry",
        )
    # Commit so the doc.status flip and the new round row are visible to the
    # next request inside the same test. record_response runs in its own
    # session and reads doc.status; without a commit the second request sees
    # the stale "internally_signed" status and 400s.
    await db.commit()
    await db.refresh(round_)
    return round_


# ── Record response ──────────────────────────────────────────────────────────

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
    aconex_reference_number: str | None = Query(None, max_length=255),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("documents.edit")),
):
    """Record a response from approver N: upload returned PDF."""
    from app.services.approval import record_response

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

    if aconex_received_date:
        try:
            round_.aconex_received_date = date_cls.fromisoformat(aconex_received_date)
        except ValueError:
            raise HTTPException(
                status_code=400, detail="aconex_received_date must be ISO yyyy-MM-dd"
            )

    if aconex_reference_number:
        round_.aconex_reference_number = aconex_reference_number

    db.add(
        DocumentAttachment(
            document_id=doc.id,
            document_approval_round_id=round_.id,
            kind=AttachmentKind.RETURNED,
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


# ── Replace round file ───────────────────────────────────────────────────────

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
    aconex_reference_number: str | None = Form(None, max_length=255),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("documents.edit")),
):
    """Replace the returned PDF for an approval round. Always overwrites all metadata."""
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

    round_.signatory_name = signatory_name or None
    round_.comments = comments or None
    round_.response_time = response_time or None
    if aconex_reference_number:
        round_.aconex_reference_number = aconex_reference_number
    if response_date:
        try:
            round_.response_date = date_cls.fromisoformat(response_date)
        except ValueError:
            round_.response_date = None
    else:
        round_.response_date = None

    att = (
        await db.execute(
            select(DocumentAttachment).where(
                DocumentAttachment.document_approval_round_id == round_id,
                DocumentAttachment.kind == AttachmentKind.RETURNED,
                DocumentAttachment.is_deleted == False,  # noqa: E712
            )
        )
    ).scalar_one_or_none()
    if att:
        att.storage_path = storage_key
        att.size = len(data)
        att.filename = f"Approver {round_.approver_order} — Returned.pdf"

    user_atts = (
        (
            await db.execute(
                select(DocumentAttachment).where(
                    DocumentAttachment.document_approval_round_id == round_id,
                    DocumentAttachment.kind == AttachmentKind.ROUND_USER,
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


# ── OCR from a saved round ───────────────────────────────────────────────────

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
    """Region-based text extraction from a returned PDF."""
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


# ── Round remarks ────────────────────────────────────────────────────────────

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
    """Attach an optional 'Our Remarks for Approver 2' file."""
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


# ── Round attachments CRUD ───────────────────────────────────────────────────

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
        description="Page number after which to insert (0-indexed).",
    ),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("documents.edit")),
):
    """Upload an additional attachment to an approval round."""
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

    count_result = await db.execute(
        select(func.count())
        .select_from(DocumentAttachment)
        .where(
            DocumentAttachment.document_approval_round_id == round_id,
            DocumentAttachment.kind == AttachmentKind.ROUND_USER,
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
        kind=AttachmentKind.ROUND_USER,
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
    result = await db.execute(
        select(DocumentAttachment)
        .where(
            DocumentAttachment.document_approval_round_id == round_id,
            DocumentAttachment.kind == AttachmentKind.ROUND_USER,
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
    att = (
        await db.execute(
            select(DocumentAttachment).where(
                DocumentAttachment.id == att_id,
                DocumentAttachment.document_approval_round_id == round_id,
                DocumentAttachment.kind == AttachmentKind.ROUND_USER,
                DocumentAttachment.is_deleted == False,  # noqa: E712
            )
        )
    ).scalar_one_or_none()
    if not att:
        raise HTTPException(status_code=404, detail="Attachment not found")

    if "insert_after_page" in body:
        att.insert_after_page = body["insert_after_page"]
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
    att = (
        await db.execute(
            select(DocumentAttachment).where(
                DocumentAttachment.id == att_id,
                DocumentAttachment.document_approval_round_id == round_id,
                DocumentAttachment.kind == AttachmentKind.ROUND_USER,
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

    try:
        storage.delete(att.storage_path)
    except Exception:
        pass
    await db.delete(att)
    await db.commit()


# ── Download single round attachment ─────────────────────────────────────────

@router.get("/{doc_id}/approval-rounds/{round_id}/attachments/{att_id}")
async def download_round_attachment(
    doc_id: UUID,
    round_id: UUID,
    att_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Download a single round attachment file for preview."""
    from fastapi.responses import Response

    doc = (
        await db.execute(
            select(Document).where(Document.id == doc_id, Document.is_deleted == False)  # noqa: E712
        )
    ).scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    await assert_user_in_project(user, doc.project_id)

    att = (
        await db.execute(
            select(DocumentAttachment).where(
                DocumentAttachment.id == att_id,
                DocumentAttachment.document_approval_round_id == round_id,
                DocumentAttachment.kind == AttachmentKind.ROUND_USER,
                DocumentAttachment.is_deleted == False,  # noqa: E712
            )
        )
    ).scalar_one_or_none()
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


# ── Round bundle download ────────────────────────────────────────────────────

@router.get("/{doc_id}/approval-rounds/{round_id}/bundle")
async def download_round_bundle(
    doc_id: UUID,
    round_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Download the complete merged PDF bundle for an approval round."""
    from fastapi.responses import Response
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

    attachments_result = await db.execute(
        select(DocumentAttachment)
        .where(
            DocumentAttachment.document_approval_round_id == round_id,
            DocumentAttachment.kind == AttachmentKind.ROUND_USER,
            DocumentAttachment.insert_after_page.isnot(None),
            DocumentAttachment.is_deleted == False,  # noqa: E712
        )
        .order_by(DocumentAttachment.insert_after_page, DocumentAttachment.sort_order)
    )
    attachments = attachments_result.scalars().all()

    if not attachments:
        fname = await build_download_filename(db, doc)
        return Response(
            content=returned_pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{fname}"'},
        )

    attachment_data = []
    for att in attachments:
        if not storage.exists(att.storage_path):
            continue
        att_bytes = storage.read(att.storage_path)
        attachment_data.append((att_bytes, att.insert_after_page or 0))

    try:
        merged_pdf = merge_pdf_bundle(returned_pdf_bytes, attachment_data)
    except ValueError as e:
        raise HTTPException(status_code=413, detail=str(e))

    fname = await build_download_filename(db, doc)
    return Response(
        content=merged_pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )
