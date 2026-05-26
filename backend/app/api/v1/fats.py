from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.fat import FAT, fat_assets
from app.schemas.document import FATCreate, FATUpdate, FATResponse

router = APIRouter(prefix="/fats", tags=["fats"])


@router.get("", response_model=list[FATResponse])
async def list_fats(
    project_id: UUID = Query(...),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    _: Any = Depends(get_current_user),
):
    stmt = (
        select(FAT)
        .where(FAT.is_deleted == False, FAT.project_id == project_id)  # noqa: E712
        .order_by(FAT.created_at.desc())
        .offset(skip).limit(limit)
    )
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/{fat_id}", response_model=FATResponse)
async def get_fat(
    fat_id: UUID,
    db: AsyncSession = Depends(get_db),
    _: Any = Depends(get_current_user),
):
    result = await db.execute(select(FAT).where(FAT.id == fat_id, FAT.is_deleted == False))  # noqa: E712
    fat = result.scalar_one_or_none()
    if not fat:
        raise HTTPException(status_code=404, detail="Not found")
    return fat


@router.post("", response_model=FATResponse, status_code=status.HTTP_201_CREATED)
async def create_fat(
    body: FATCreate,
    db: AsyncSession = Depends(get_db),
    _: Any = Depends(get_current_user),
):
    data = body.model_dump(exclude={"asset_ids"})
    fat = FAT(**data)
    db.add(fat)
    await db.flush()

    if body.asset_ids:
        for aid in body.asset_ids:
            await db.execute(fat_assets.insert().values(fat_id=fat.id, asset_id=aid))

    await db.commit()
    await db.refresh(fat)
    return fat


@router.patch("/{fat_id}", response_model=FATResponse)
async def update_fat(
    fat_id: UUID,
    body: FATUpdate,
    db: AsyncSession = Depends(get_db),
    _: Any = Depends(get_current_user),
):
    result = await db.execute(select(FAT).where(FAT.id == fat_id, FAT.is_deleted == False))  # noqa: E712
    fat = result.scalar_one_or_none()
    if not fat:
        raise HTTPException(status_code=404, detail="Not found")

    updates = body.model_dump(exclude_unset=True, exclude={"asset_ids"})
    for k, v in updates.items():
        setattr(fat, k, v)

    if body.asset_ids is not None:
        await db.execute(fat_assets.delete().where(fat_assets.c.fat_id == fat_id))
        for aid in body.asset_ids:
            await db.execute(fat_assets.insert().values(fat_id=fat.id, asset_id=aid))

    await db.commit()
    await db.refresh(fat)
    return fat


@router.delete("/{fat_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_fat(
    fat_id: UUID,
    db: AsyncSession = Depends(get_db),
    _: Any = Depends(get_current_user),
):
    result = await db.execute(select(FAT).where(FAT.id == fat_id, FAT.is_deleted == False))  # noqa: E712
    fat = result.scalar_one_or_none()
    if not fat:
        raise HTTPException(status_code=404, detail="Not found")
    fat.is_deleted = True
    await db.commit()
