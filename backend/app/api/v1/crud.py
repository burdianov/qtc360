"""Generic CRUD endpoints for master tables."""
from typing import Any, Type
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel as PydanticModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload, InstrumentedAttribute

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.base import BaseModel


def create_crud_router(
    *,
    prefix: str,
    tag: str,
    model: Type[BaseModel],
    create_schema: Type[PydanticModel],
    update_schema: Type[PydanticModel] | None = None,
    response_schema: Type[PydanticModel],
    eager: list[InstrumentedAttribute] | None = None,
) -> APIRouter:
    router = APIRouter(prefix=prefix, tags=[tag])
    _update_schema = update_schema or create_schema

    def _base_query():
        stmt = select(model).where(model.is_deleted == False)  # noqa: E712
        if eager:
            for rel in eager:
                stmt = stmt.options(selectinload(rel))
        return stmt

    @router.get("", response_model=list[response_schema])
    async def list_all(
        skip: int = Query(0, ge=0),
        limit: int = Query(100, ge=1, le=500),
        paginated: bool = Query(False),
        db: AsyncSession = Depends(get_db),
        _: Any = Depends(get_current_user),
    ):
        base = _base_query()
        if paginated:
            from sqlalchemy import func
            count_result = await db.execute(select(func.count()).select_from(base.subquery()))
            total = count_result.scalar() or 0
            result = await db.execute(base.offset(skip).limit(limit))
            return {"items": result.scalars().all(), "total": total}
        result = await db.execute(base.offset(skip).limit(limit))
        return result.scalars().all()

    @router.get("/{item_id}", response_model=response_schema)
    async def get_one(
        item_id: UUID,
        db: AsyncSession = Depends(get_db),
        _: Any = Depends(get_current_user),
    ):
        result = await db.execute(_base_query().where(model.id == item_id))
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
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Record already exists or invalid reference")
        result = await db.execute(_base_query().where(model.id == item.id))
        item = result.scalar_one()
        return item

    @router.patch("/{item_id}", response_model=response_schema)
    async def update(
        item_id: UUID,
        body: _update_schema,
        db: AsyncSession = Depends(get_db),
        _: Any = Depends(get_current_user),
    ):
        result = await db.execute(_base_query().where(model.id == item_id))
        item = result.scalar_one_or_none()
        if not item:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
        for key, value in body.model_dump(exclude_unset=True).items():
            setattr(item, key, value)
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Record already exists or invalid reference")
        result = await db.execute(_base_query().where(model.id == item_id))
        item = result.scalar_one()
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
