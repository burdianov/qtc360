"""Generic CRUD endpoints for master tables."""
from typing import Any, Type
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel as PydanticModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.base import BaseModel


def create_crud_router(
    *,
    prefix: str,
    tag: str,
    model: Type[BaseModel],
    create_schema: Type[PydanticModel],
    response_schema: Type[PydanticModel],
) -> APIRouter:
    router = APIRouter(prefix=prefix, tags=[tag])

    @router.get("", response_model=list[response_schema])
    async def list_all(
        db: AsyncSession = Depends(get_db),
        _: Any = Depends(get_current_user),
    ):
        result = await db.execute(select(model).where(model.is_deleted == False))  # noqa: E712
        return result.scalars().all()

    @router.get("/{item_id}", response_model=response_schema)
    async def get_one(
        item_id: UUID,
        db: AsyncSession = Depends(get_db),
        _: Any = Depends(get_current_user),
    ):
        result = await db.execute(select(model).where(model.id == item_id, model.is_deleted == False))  # noqa: E712
        item = result.scalar_one_or_none()
        if not item:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
        return item

    @router.post("", response_model=response_schema, status_code=status.HTTP_201_CREATED)
    async def create(
        body: create_schema,
        db: AsyncSession = Depends(get_db),
        _: Any = Depends(get_current_user),
    ):
        item = model(**body.model_dump())
        db.add(item)
        await db.commit()
        await db.refresh(item)
        return item

    @router.patch("/{item_id}", response_model=response_schema)
    async def update(
        item_id: UUID,
        body: create_schema,
        db: AsyncSession = Depends(get_db),
        _: Any = Depends(get_current_user),
    ):
        result = await db.execute(select(model).where(model.id == item_id, model.is_deleted == False))  # noqa: E712
        item = result.scalar_one_or_none()
        if not item:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
        for key, value in body.model_dump(exclude_unset=True).items():
            setattr(item, key, value)
        await db.commit()
        await db.refresh(item)
        return item

    @router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
    async def delete(
        item_id: UUID,
        db: AsyncSession = Depends(get_db),
        _: Any = Depends(get_current_user),
    ):
        result = await db.execute(select(model).where(model.id == item_id, model.is_deleted == False))  # noqa: E712
        item = result.scalar_one_or_none()
        if not item:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
        item.is_deleted = True
        await db.commit()

    return router
