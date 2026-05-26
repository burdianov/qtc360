from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.document import Document
from app.models.document_approval import DocumentApproval, document_assets
from app.models.asset import Asset
from app.models.approval_status import ApprovalStatus
from app.schemas.document import (
    DocumentCreate, DocumentUpdate, DocumentResponse,
    DocumentApprovalCreate, DocumentApprovalResponse, ApprovalActionRequest,
)

router = APIRouter(prefix="/documents", tags=["documents"])


@router.get("", response_model=list[DocumentResponse])
async def list_documents(
    project_id: UUID = Query(...),
    doc_type: str | None = Query(None),
    status_filter: str | None = Query(None, alias="status"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    _: Any = Depends(get_current_user),
):
    stmt = select(Document).where(Document.is_deleted == False, Document.project_id == project_id)  # noqa: E712
    if doc_type:
        stmt = stmt.where(Document.doc_type == doc_type)
    if status_filter:
        stmt = stmt.where(Document.status == status_filter)
    stmt = stmt.order_by(Document.created_at.desc()).offset(skip).limit(limit)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/{doc_id}", response_model=DocumentResponse)
async def get_document(
    doc_id: UUID,
    db: AsyncSession = Depends(get_db),
    _: Any = Depends(get_current_user),
):
    result = await db.execute(
        select(Document).where(Document.id == doc_id, Document.is_deleted == False)  # noqa: E712
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    return doc


@router.post("", response_model=DocumentResponse, status_code=status.HTTP_201_CREATED)
async def create_document(
    body: DocumentCreate,
    db: AsyncSession = Depends(get_db),
    _: Any = Depends(get_current_user),
):
    data = body.model_dump(exclude={"asset_ids"})
    doc = Document(**data)
    db.add(doc)
    await db.flush()

    if body.asset_ids:
        for aid in body.asset_ids:
            await db.execute(document_assets.insert().values(document_id=doc.id, asset_id=aid))

    await db.commit()
    await db.refresh(doc)
    return doc


@router.patch("/{doc_id}", response_model=DocumentResponse)
async def update_document(
    doc_id: UUID,
    body: DocumentUpdate,
    db: AsyncSession = Depends(get_db),
    _: Any = Depends(get_current_user),
):
    result = await db.execute(
        select(Document).where(Document.id == doc_id, Document.is_deleted == False)  # noqa: E712
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")

    updates = body.model_dump(exclude_unset=True, exclude={"asset_ids"})
    for k, v in updates.items():
        setattr(doc, k, v)

    if body.asset_ids is not None:
        await db.execute(document_assets.delete().where(document_assets.c.document_id == doc_id))
        for aid in body.asset_ids:
            await db.execute(document_assets.insert().values(document_id=doc.id, asset_id=aid))

    await db.commit()
    await db.refresh(doc)
    return doc


@router.delete("/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(
    doc_id: UUID,
    db: AsyncSession = Depends(get_db),
    _: Any = Depends(get_current_user),
):
    result = await db.execute(
        select(Document).where(Document.id == doc_id, Document.is_deleted == False)  # noqa: E712
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    doc.is_deleted = True
    await db.commit()


# --- Sign & Submit ---

@router.post("/{doc_id}/sign", response_model=DocumentResponse)
async def sign_document(
    doc_id: UUID,
    role: str = Query(..., pattern="^(site_engineer|qaqc_engineer)$"),
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    result = await db.execute(
        select(Document).where(Document.id == doc_id, Document.is_deleted == False)  # noqa: E712
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    if doc.status != "draft":
        raise HTTPException(status_code=400, detail="Document is not in draft status")

    if role == "site_engineer":
        doc.site_engineer_id = user.id
    else:
        doc.qaqc_engineer_id = user.id

    # Auto-submit when both signed
    from datetime import datetime, timezone
    if doc.site_engineer_id and doc.qaqc_engineer_id:
        doc.status = "pending_review"
        doc.current_approver_order = 1
        doc.signed_at = datetime.now(timezone.utc)
        doc.submitted_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(doc)
    return doc


# --- Approvals ---

@router.get("/{doc_id}/approvals", response_model=list[DocumentApprovalResponse])
async def list_approvals(
    doc_id: UUID,
    db: AsyncSession = Depends(get_db),
    _: Any = Depends(get_current_user),
):
    result = await db.execute(
        select(DocumentApproval)
        .where(DocumentApproval.document_id == doc_id, DocumentApproval.is_deleted == False)  # noqa: E712
        .order_by(DocumentApproval.approver_order)
    )
    return result.scalars().all()


@router.post("/{doc_id}/approvals", response_model=DocumentApprovalResponse, status_code=201)
async def add_approver(
    doc_id: UUID,
    body: DocumentApprovalCreate,
    db: AsyncSession = Depends(get_db),
    _: Any = Depends(get_current_user),
):
    approval = DocumentApproval(document_id=doc_id, **body.model_dump())
    db.add(approval)
    await db.commit()
    await db.refresh(approval)
    return approval


@router.post("/{doc_id}/approvals/{approval_id}/respond", response_model=DocumentApprovalResponse)
async def respond_approval(
    doc_id: UUID,
    approval_id: UUID,
    body: ApprovalActionRequest,
    db: AsyncSession = Depends(get_db),
    _: Any = Depends(get_current_user),
):
    result = await db.execute(
        select(DocumentApproval).where(DocumentApproval.id == approval_id)
    )
    approval = result.scalar_one_or_none()
    if not approval:
        raise HTTPException(status_code=404, detail="Approval not found")

    approval.status_id = body.status_id
    approval.comments = body.comments

    # Check approval status action
    status_result = await db.execute(select(ApprovalStatus).where(ApprovalStatus.id == body.status_id))
    approval_status = status_result.scalar_one_or_none()
    if not approval_status:
        raise HTTPException(status_code=400, detail="Invalid approval status")

    # Update document status
    doc_result = await db.execute(select(Document).where(Document.id == doc_id))
    doc = doc_result.scalar_one()

    from datetime import datetime, timezone
    if approval_status.action == "rejected":
        doc.status = "rejected"
        doc.closed_at = datetime.now(timezone.utc)
    else:
        # Check if there's a next approver
        next_result = await db.execute(
            select(DocumentApproval).where(
                DocumentApproval.document_id == doc_id,
                DocumentApproval.approver_order == approval.approver_order + 1,
                DocumentApproval.is_deleted == False,  # noqa: E712
            )
        )
        if next_result.scalar_one_or_none():
            doc.current_approver_order = approval.approver_order + 1
        else:
            doc.status = "approved"
            doc.closed_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(approval)
    return approval
