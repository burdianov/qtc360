"""Bundle composer endpoints — page thumbnails, compose bundle (S2 preparation)."""

import base64
import io
from uuid import UUID

import fitz
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response
from pydantic import BaseModel as PydanticModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import (
    assert_user_in_project,
    get_current_user,
    require_permission,
)
from app.models.document import Document
from app.models.document_approval_round import DocumentApprovalRound
from app.models.document_attachment import DocumentAttachment
from app.models.user import User
from app.services.storage import storage

router = APIRouter()


# ── Bundle pages (thumbnails) ────────────────────────────────────────────────

@router.get("/bundle-pages/{document_id}")
async def get_bundle_pages(
    document_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Return page thumbnails from Approver 1's returned PDF for the bundle composer."""
    doc = await db.get(Document, document_id)
    if not doc or doc.is_deleted:
        raise HTTPException(status_code=404, detail="Document not found")
    await assert_user_in_project(user, doc.project_id)

    round_result = await db.execute(
        select(DocumentApprovalRound)
        .where(
            DocumentApprovalRound.document_id == document_id,
            DocumentApprovalRound.approver_order == 1,
        )
        .order_by(DocumentApprovalRound.round_no.desc())
    )
    round1 = round_result.scalar_one_or_none()
    if not round1 or not round1.returned_file_path:
        raise HTTPException(status_code=404, detail="Approver 1 response not found")

    pdf_bytes = storage.read(round1.returned_file_path)
    if not pdf_bytes:
        raise HTTPException(status_code=404, detail="PDF file not found on disk")

    pdf_doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    thumbnails = []
    for page in pdf_doc:
        mat = fitz.Matrix(0.3, 0.3)
        pix = page.get_pixmap(matrix=mat, alpha=False)
        thumbnails.append(base64.b64encode(pix.tobytes("png")).decode())
    pdf_doc.close()

    return {"page_count": len(thumbnails), "thumbnails": thumbnails}


# ── Compose bundle ───────────────────────────────────────────────────────────

@router.post("/bundle-compose/{document_id}")
async def compose_bundle(
    document_id: UUID,
    body: dict,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("documents.edit")),
):
    """Compose the S2 bundle with attachments at specific positions."""
    doc = await db.get(Document, document_id)
    if not doc or doc.is_deleted:
        raise HTTPException(status_code=404, detail="Document not found")
    await assert_user_in_project(user, doc.project_id)

    round_result = await db.execute(
        select(DocumentApprovalRound)
        .where(
            DocumentApprovalRound.document_id == document_id,
            DocumentApprovalRound.approver_order == 1,
        )
        .order_by(DocumentApprovalRound.round_no.desc())
    )
    round1 = round_result.scalar_one_or_none()
    if not round1 or not round1.returned_file_path:
        raise HTTPException(status_code=404, detail="Approver 1 response not found")

    pdf_bytes = storage.read(round1.returned_file_path)
    if not pdf_bytes:
        raise HTTPException(status_code=404, detail="PDF file not found")

    insertions = body.get("insertions", [])
    if not insertions:
        return Response(content=pdf_bytes, media_type="application/pdf")

    att_data: list[tuple[bytes, int]] = []
    for ins in insertions:
        att_id = ins.get("attachment_id")
        after_page = ins.get("insert_after_page", 0)
        att = await db.get(DocumentAttachment, att_id)
        if not att or att.is_deleted:
            continue
        file_bytes = storage.read(att.storage_path)
        if file_bytes:
            att_data.append((file_bytes, after_page))
            att.insert_after_page = after_page

    await db.commit()

    from app.services.pdf_merge import merge_pdf_bundle

    try:
        merged = merge_pdf_bundle(pdf_bytes, att_data)
    except ValueError as e:
        raise HTTPException(status_code=413, detail=str(e))

    bundle_key = f"responses/{document_id}/S2_composed.pdf"
    storage.save(bundle_key, merged)

    return Response(content=merged, media_type="application/pdf")
