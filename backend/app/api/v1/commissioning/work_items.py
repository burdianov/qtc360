"""Requirement work-item CRUD endpoints."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import (
    assert_user_in_project,
    get_current_user,
    require_permission,
)
from app.models.commissioning import RequirementWorkItem
from app.models.user import User
from app.schemas.commissioning import (
    RequirementWorkItemCreate,
    RequirementWorkItemOut,
    RequirementWorkItemUpdate,
)
from app.services.commissioning import recalculate_requirement_status
from app.api.v1.commissioning.helpers import (
    project_id_for_asset_requirement as _project_id_for_asset_requirement,
)

router = APIRouter()


@router.get("/work-items", response_model=list[RequirementWorkItemOut])
async def list_work_items(
    asset_requirement_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    pid = await _project_id_for_asset_requirement(db, asset_requirement_id)
    await assert_user_in_project(user, pid, db=db)
    result = await db.execute(
        select(RequirementWorkItem)
        .where(
            RequirementWorkItem.asset_requirement_id == asset_requirement_id,
            RequirementWorkItem.is_deleted == False,
        )  # noqa: E712
        .order_by(RequirementWorkItem.sequence_no, RequirementWorkItem.id)
    )
    return result.scalars().all()


@router.post(
    "/work-items",
    response_model=RequirementWorkItemOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_work_item(
    data: RequirementWorkItemCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("documents.submit")),
):
    pid = await _project_id_for_asset_requirement(db, data.asset_requirement_id)
    if pid is None:
        raise HTTPException(status_code=404, detail="Asset requirement not found")
    await assert_user_in_project(user, pid, db=db)
    item = RequirementWorkItem(**data.model_dump())
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


@router.patch("/work-items/{item_id}", response_model=RequirementWorkItemOut)
async def update_work_item(
    item_id: uuid.UUID,
    data: RequirementWorkItemUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("documents.submit")),
):
    result = await db.execute(
        select(RequirementWorkItem).where(RequirementWorkItem.id == item_id)
    )
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Work item not found")
    pid = await _project_id_for_asset_requirement(db, item.asset_requirement_id)
    await assert_user_in_project(user, pid, db=db)
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(item, k, v)
    await db.commit()
    await db.refresh(item)
    return item


@router.delete("/work-items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_work_item(
    item_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("documents.submit")),
):
    result = await db.execute(
        select(RequirementWorkItem).where(RequirementWorkItem.id == item_id)
    )
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Work item not found")
    pid = await _project_id_for_asset_requirement(db, item.asset_requirement_id)
    await assert_user_in_project(user, pid, db=db)
    if item.status == "approved":
        raise HTTPException(status_code=400, detail="Cannot delete approved work item")
    item.is_deleted = True
    await recalculate_requirement_status(db, item.asset_requirement_id)
    await db.commit()
