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
from app.core.deps import get_current_user, require_permission, assert_user_in_project
from app.models.base import BaseModel
from app.models.user import User


def _has_project_id(model: Type[BaseModel]) -> bool:
    return "project_id" in {c.name for c in model.__table__.columns}


def create_crud_router(
    *,
    prefix: str,
    tag: str,
    model: Type[BaseModel],
    create_schema: Type[PydanticModel],
    update_schema: Type[PydanticModel] | None = None,
    response_schema: Type[PydanticModel],
    eager: list[InstrumentedAttribute] | None = None,
    write_permission: str = "master_data.manage",
) -> APIRouter:
    router = APIRouter(prefix=prefix, tags=[tag])
    _update_schema = update_schema or create_schema
    has_project = _has_project_id(model)

    def _base_query():
        stmt = select(model).where(model.is_deleted == False)  # noqa: E712
        if eager:
            for rel in eager:
                stmt = stmt.options(selectinload(rel))
        return stmt

    def _scope_to_user(stmt, user: User):
        """If model has project_id, restrict to projects the user belongs to."""
        if has_project and not user.is_superuser:
            user_project_ids = [p.id for p in user.projects]
            if not user_project_ids:
                # User belongs to no projects: return nothing.
                return stmt.where(model.project_id.is_(None) & False)  # always-false
            return stmt.where(model.project_id.in_(user_project_ids))
        return stmt

    @router.get("", response_model=list[response_schema])
    async def list_all(
        skip: int = Query(0, ge=0),
        limit: int = Query(100, ge=1, le=500),
        paginated: bool = Query(False),
        project_id: UUID | None = Query(None),
        db: AsyncSession = Depends(get_db),
        user: User = Depends(get_current_user),
    ):
        base = _base_query()
        if has_project and project_id:
            await assert_user_in_project(user, project_id)
            base = base.where(model.project_id == project_id)
        else:
            base = _scope_to_user(base, user)
        # Tie-break by id for deterministic pagination.
        base = base.order_by(model.id)
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
        user: User = Depends(get_current_user),
    ):
        result = await db.execute(_base_query().where(model.id == item_id))
        item = result.scalar_one_or_none()
        if not item:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
        if has_project:
            await assert_user_in_project(user, getattr(item, "project_id", None))
        return item

    @router.post("", response_model=response_schema, status_code=status.HTTP_201_CREATED)
    async def create(
        body: create_schema,
        db: AsyncSession = Depends(get_db),
        user: User = Depends(require_permission(write_permission)),
    ):
        payload = body.model_dump()
        if has_project:
            project_id = payload.get("project_id")
            await assert_user_in_project(user, project_id, require_super_for_missing=False)
        item = model(**payload)
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
        user: User = Depends(require_permission(write_permission)),
    ):
        result = await db.execute(_base_query().where(model.id == item_id))
        item = result.scalar_one_or_none()
        if not item:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
        if has_project:
            await assert_user_in_project(user, getattr(item, "project_id", None))
        updates = body.model_dump(exclude_unset=True)
        # Don't let an update silently move a row across projects unless the caller has access to BOTH.
        if has_project and "project_id" in updates and updates["project_id"] != getattr(item, "project_id", None):
            await assert_user_in_project(user, updates["project_id"])
        for key, value in updates.items():
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
        user: User = Depends(require_permission(write_permission)),
    ):
        result = await db.execute(select(model).where(model.id == item_id, model.is_deleted == False))  # noqa: E712
        item = result.scalar_one_or_none()
        if not item:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
        if has_project:
            await assert_user_in_project(user, getattr(item, "project_id", None))
        item.is_deleted = True
        await db.commit()

    return router
