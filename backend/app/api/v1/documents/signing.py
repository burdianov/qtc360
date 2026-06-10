"""Signing endpoints — sign, unsign, notify-signatories, and per-stage file download."""

from datetime import datetime, timezone
from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Path,
    Query,
    status,
)
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import (
    assert_user_in_project,
    get_current_user,
    require_permission,
)
from app.models.document import Document
from app.models.user import User
from app.schemas.document import DocumentResponse
from app.services.audit import record_audit

router = APIRouter()

_STAGE_PATTERN = r"^S[1-9]\d*$|^R[1-9]\d*$"


# ── Per-stage file download ──────────────────────────────────────────────────

@router.get("/{doc_id}/files/{stage}")
async def download_stage_file(
    doc_id: UUID,
    stage: str = Path(..., pattern=_STAGE_PATTERN, description="S1, R1, S2, R2, ..."),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Download a per-stage file for this document's approval cycle."""
    from fastapi.responses import Response
    from app.services.approval_files import submitted_path, returned_path
    from app.services.storage import storage

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


# ── Notify Signatories ───────────────────────────────────────────────────────

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


# ── Sign ─────────────────────────────────────────────────────────────────────

@router.post("/{doc_id}/sign", response_model=DocumentResponse)
async def sign_document(
    doc_id: UUID,
    role: str = Query(..., pattern="^(site_engineer|qaqc_engineer)$"),
    on_behalf_of: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("documents.sign")),
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
    if doc.status != "draft":
        raise HTTPException(status_code=400, detail="Document is not in draft status")

    from app.models.signature_delegation import SignatureDelegation

    signatory_id = user.id
    if on_behalf_of:
        from uuid import UUID as _UUID

        try:
            behalf_uuid = _UUID(on_behalf_of)
        except (ValueError, TypeError):
            raise HTTPException(status_code=400, detail="Invalid on_behalf_of")
        if behalf_uuid != user.id:
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


# ── Unsign ───────────────────────────────────────────────────────────────────

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
        .with_for_update()
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
