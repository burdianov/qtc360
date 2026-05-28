"""External approval workflow service.

Encapsulates the state machine described in the domain spec:

  draft → internally_signed → with_approver_1 → approver_1_returned →
    (with_approver_2 | rejected) → (approved | approved_with_comments | rejected)

Each "Submit to Approver N" creates a DocumentApprovalRound (status pending);
each "Record Approver N Response" stamps it with decision/signatory/comments
and either advances the document or terminates the chain.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.approval_status import ApprovalStatus
from app.models.doc_template import DocTemplate
from app.models.document import Document
from app.models.document_approval_round import DocumentApprovalRound
from app.models.project_approver import ProjectApprover
from app.schemas.document import VALID_STATUS_TRANSITIONS


def _assert_transition(current: str, target: str) -> None:
    if target not in VALID_STATUS_TRANSITIONS.get(current, set()):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid status transition: {current} → {target}",
        )


async def _resolve_project_approver(
    db: AsyncSession, project_id: uuid.UUID, document_type: str, approver_order: int
) -> ProjectApprover:
    result = await db.execute(
        select(ProjectApprover).where(
            ProjectApprover.project_id == project_id,
            ProjectApprover.document_type == document_type,
            ProjectApprover.approver_order == approver_order,
            ProjectApprover.is_deleted == False,  # noqa: E712
        )
    )
    pa = result.scalar_one_or_none()
    if not pa:
        raise HTTPException(
            status_code=400,
            detail=(
                f"No approver configured for {document_type} order {approver_order}. "
                "Set up the approver chain in Admin → Settings → Project Approvers."
            ),
        )
    return pa


def _expected_submit_status(approver_order: int) -> str:
    return {1: "with_approver_1", 2: "with_approver_2"}.get(
        approver_order, f"with_approver_{approver_order}"
    )


def _expected_pre_submit_status(approver_order: int) -> str:
    return {1: "internally_signed", 2: "approver_1_returned"}.get(
        approver_order, f"approver_{approver_order - 1}_returned"
    )


async def _lock_template(db: AsyncSession, doc: Document) -> None:
    """Snapshot the active template's id + cover_page_count onto the document.

    Called at "Submit to Approver 1". Idempotent: if the document already has
    these set (re-submit edge case during revision lifecycle), leaves them
    alone — they are immutable for this revision.
    """
    if doc.template_id is not None and doc.cover_page_count is not None:
        return
    template_q = await db.execute(
        select(DocTemplate)
        .where(
            DocTemplate.project_id == doc.project_id,
            DocTemplate.doc_type == doc.document_type,
            DocTemplate.is_active == True,  # noqa: E712
            DocTemplate.is_deleted == False,  # noqa: E712
        )
    )
    template = template_q.scalar_one_or_none()
    if template is None:
        raise HTTPException(
            status_code=400,
            detail=(
                f"No active {doc.document_type} template configured for this project. "
                "Upload one in Documents → Templates before submitting."
            ),
        )
    doc.template_id = template.id
    doc.cover_page_count = max(1, template.cover_page_count or 1)


async def submit_to_approver(
    db: AsyncSession,
    doc: Document,
    approver_order: int,
    submitted_at: datetime | None = None,
) -> DocumentApprovalRound:
    """Mirror an Aconex submission: create a pending round and advance status.

    On Approver-1 submission, snapshots the active template (id +
    cover_page_count) onto the document so the split boundary can't drift
    if admin uploads a newer template version mid-flight.
    """
    expected_pre = _expected_pre_submit_status(approver_order)
    if doc.status != expected_pre:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot submit to approver {approver_order} from status {doc.status!r}",
        )

    pa = await _resolve_project_approver(db, doc.project_id, doc.document_type, approver_order)

    if approver_order == 1:
        await _lock_template(db, doc)

    existing = await db.execute(
        select(DocumentApprovalRound).where(
            DocumentApprovalRound.document_id == doc.id,
            DocumentApprovalRound.approver_order == approver_order,
            DocumentApprovalRound.is_deleted == False,  # noqa: E712
        )
    )
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=400,
            detail=f"A round already exists for approver {approver_order} on this revision",
        )

    round_ = DocumentApprovalRound(
        document_id=doc.id,
        approver_order=approver_order,
        round_no=1,
        project_approver_id=pa.id,
        submitted_at=submitted_at or datetime.now(timezone.utc),
    )
    db.add(round_)

    target = _expected_submit_status(approver_order)
    _assert_transition(doc.status, target)
    doc.status = target
    if approver_order == 1:
        doc.submitted_date = round_.submitted_at

    return round_


async def record_response(
    db: AsyncSession,
    doc: Document,
    approver_order: int,
    decision_status_id: uuid.UUID,
    signatory_name: str,
    response_date: date,
    comments: str | None,
) -> DocumentApprovalRound:
    """Stamp the open round with the approver's decision and advance the document.

    Decision letter A or D → "approved" leg of the chain.
    Decision letter B → "approved with comments" leg.
    Decision letter C → "rejected" (terminates revision).
    """
    expected_pre = _expected_submit_status(approver_order)
    if doc.status != expected_pre:
        raise HTTPException(
            status_code=400,
            detail=f"Document is not awaiting approver {approver_order} response (status: {doc.status})",
        )

    round_q = await db.execute(
        select(DocumentApprovalRound).where(
            DocumentApprovalRound.document_id == doc.id,
            DocumentApprovalRound.approver_order == approver_order,
            DocumentApprovalRound.is_deleted == False,  # noqa: E712
        )
    )
    round_ = round_q.scalar_one_or_none()
    if not round_:
        raise HTTPException(
            status_code=400,
            detail=f"No open round for approver {approver_order}",
        )
    if round_.decision_status_id is not None:
        raise HTTPException(status_code=400, detail="Round already has a decision recorded")

    decision_q = await db.execute(
        select(ApprovalStatus).where(
            ApprovalStatus.id == decision_status_id,
            ApprovalStatus.project_id == doc.project_id,
        )
    )
    decision = decision_q.scalar_one_or_none()
    if not decision:
        raise HTTPException(status_code=400, detail="Invalid decision status for this project")

    round_.decision_status_id = decision_status_id
    round_.signatory_name = signatory_name
    round_.response_date = response_date
    round_.comments = comments
    round_.returned_at = datetime.now(timezone.utc)

    # Advance document state based on decision letter.
    letter = (decision.letter or "").upper()
    if letter == "C":
        _assert_transition(doc.status, "rejected")
        doc.status = "rejected"
        doc.approved_date = round_.returned_at
    elif approver_order == 1:
        _assert_transition(doc.status, "approver_1_returned")
        doc.status = "approver_1_returned"
    else:
        # Final approver. B → approved_with_comments, A/D → approved.
        target = "approved_with_comments" if letter == "B" else "approved"
        _assert_transition(doc.status, target)
        doc.status = target
        doc.approved_date = round_.returned_at

    return round_


async def attach_remarks(
    db: AsyncSession,
    doc: Document,
    round_: DocumentApprovalRound,
    file_path: str,
    file_name: str,
) -> None:
    """Store the optional 'Our Remarks for Approver 2' file on the Approver-1 round.

    Only valid while the document is in approver_1_returned and Approver 1
    returned status B. Anything else is a misuse.
    """
    if doc.status != "approver_1_returned":
        raise HTTPException(
            status_code=400,
            detail="Remarks can only be attached after Approver 1 has returned",
        )
    if round_.approver_order != 1:
        raise HTTPException(
            status_code=400,
            detail="Remarks attach only to the Approver 1 round",
        )
    decision = None
    if round_.decision_status_id is not None:
        decision_q = await db.execute(
            select(ApprovalStatus).where(ApprovalStatus.id == round_.decision_status_id)
        )
        decision = decision_q.scalar_one_or_none()
    if not decision or (decision.letter or "").upper() != "B":
        raise HTTPException(
            status_code=400,
            detail="Remarks only apply when Approver 1 returned status B",
        )

    round_.remarks_file_path = file_path
    round_.remarks_file_name = file_name
