"""Asset tag-target CRUD endpoints."""

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
from app.models.commissioning import AssetTagTarget
from app.models.user import User
from app.schemas.commissioning import (
    AssetTagTargetCreate,
    AssetTagTargetOut,
    AssetTagTargetUpdate,
)
from app.api.v1.commissioning.helpers import (
    project_id_for_asset as _project_id_for_asset,
)

router = APIRouter()


@router.get("/tag-targets", response_model=list[AssetTagTargetOut])
async def list_tag_targets(
    asset_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if asset_id:
        await assert_user_in_project(user, await _project_id_for_asset(db, asset_id), db=db)
    query = select(AssetTagTarget).where(AssetTagTarget.is_deleted == False)  # noqa: E712
    if asset_id:
        query = query.where(AssetTagTarget.asset_id == asset_id)
    elif not user.is_superuser:
        from app.models.asset import Asset

        my_project_ids = [p.id for p in user.projects]
        if not my_project_ids:
            return []
        query = query.join(Asset, AssetTagTarget.asset_id == Asset.id).where(
            Asset.project_id.in_(my_project_ids)
        )
    result = await db.execute(query)
    return result.scalars().all()


@router.post(
    "/tag-targets",
    response_model=AssetTagTargetOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_tag_target(
    data: AssetTagTargetCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("commissioning.manage")),
):
    pid = await _project_id_for_asset(db, data.asset_id)
    if pid is None:
        raise HTTPException(status_code=404, detail="Asset not found")
    await assert_user_in_project(user, pid, db=db)
    target = AssetTagTarget(**data.model_dump())
    db.add(target)
    await db.commit()
    await db.refresh(target)
    return target


@router.patch("/tag-targets/{target_id}", response_model=AssetTagTargetOut)
async def update_tag_target(
    target_id: uuid.UUID,
    data: AssetTagTargetUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("commissioning.manage")),
):
    result = await db.execute(
        select(AssetTagTarget).where(AssetTagTarget.id == target_id)
    )
    target = result.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="Tag target not found")
    pid = await _project_id_for_asset(db, target.asset_id)
    await assert_user_in_project(user, pid, db=db)
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(target, k, v)
    await db.commit()
    await db.refresh(target)
    return target
