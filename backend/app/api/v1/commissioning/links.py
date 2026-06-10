"""Document-requirement link endpoints."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import (
    assert_user_in_project,
    get_current_user,
    require_permission,
)
from app.models.commissioning import DocumentRequirementLink
from app.models.user import User
from app.schemas.commissioning import (
    DocumentRequirementLinkCreate,
    DocumentRequirementLinkOut,
)
from app.services.commissioning import recalculate_requirement_status
from app.api.v1.commissioning.helpers import (
    project_id_for_document as _project_id_for_document,
    project_id_for_asset_requirement as _project_id_for_asset_requirement,
)

router = APIRouter()


@router.post(
    "/document-links",
    response_model=DocumentRequirementLinkOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_document_requirement_link(
    data: DocumentRequirementLinkCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("documents.edit")),
):
    pid_doc = await _project_id_for_document(db, data.document_id)
    pid_req = await _project_id_for_asset_requirement(db, data.asset_requirement_id)
    if pid_doc is None or pid_req is None:
        raise HTTPException(status_code=404, detail="Document or requirement not found")
    if pid_doc != pid_req:
        raise HTTPException(
            status_code=400,
            detail="Document and requirement belong to different projects",
        )
    await assert_user_in_project(user, pid_doc)
    link = DocumentRequirementLink(**data.model_dump())
    db.add(link)
    await recalculate_requirement_status(db, data.asset_requirement_id)
    await db.commit()
    await db.refresh(link)
    return link


@router.delete("/document-links", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document_requirement_links(
    document_id: uuid.UUID = Query(...),
    asset_requirement_id: uuid.UUID = Query(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("documents.edit")),
):
    """Remove all links between a document and a specific asset requirement."""
    pid_doc = await _project_id_for_document(db, document_id)
    pid_req = await _project_id_for_asset_requirement(db, asset_requirement_id)
    if pid_doc is None or pid_req is None:
        raise HTTPException(status_code=404, detail="Document or requirement not found")
    await assert_user_in_project(user, pid_doc)

    result = await db.execute(
        select(DocumentRequirementLink).where(
            DocumentRequirementLink.document_id == document_id,
            DocumentRequirementLink.asset_requirement_id == asset_requirement_id,
            DocumentRequirementLink.is_deleted == False,  # noqa: E712
        )
    )
    links = result.scalars().all()
    for link in links:
        link.is_deleted = True
    await db.flush()
    await recalculate_requirement_status(db, asset_requirement_id)
    await db.commit()


@router.get("/document-links", response_model=list[DocumentRequirementLinkOut])
async def list_document_links(
    document_id: uuid.UUID | None = None,
    asset_requirement_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if document_id:
        await assert_user_in_project(
            user, await _project_id_for_document(db, document_id)
        )
    if asset_requirement_id:
        await assert_user_in_project(
            user, await _project_id_for_asset_requirement(db, asset_requirement_id)
        )
    query = select(DocumentRequirementLink).where(
        DocumentRequirementLink.is_deleted == False  # noqa: E712
    )
    if document_id:
        query = query.where(DocumentRequirementLink.document_id == document_id)
    if asset_requirement_id:
        query = query.where(
            DocumentRequirementLink.asset_requirement_id == asset_requirement_id
        )
    result = await db.execute(query)
    return result.scalars().all()
