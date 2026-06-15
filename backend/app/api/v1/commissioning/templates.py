"""Requirement template CRUD endpoints."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import (
    assert_user_in_project,
    get_current_user,
    require_permission,
)
from app.models.commissioning import RequirementTemplate
from app.models.user import User
from app.schemas.commissioning import (
    RequirementTemplateCreate,
    RequirementTemplateOut,
    RequirementTemplateUpdate,
)

router = APIRouter()


@router.get("/requirement-templates", response_model=list[RequirementTemplateOut])
async def list_requirement_templates(
    project_id: uuid.UUID | None = None,
    level_code: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if project_id:
        await assert_user_in_project(user, project_id, db=db)
    query = select(RequirementTemplate).where(RequirementTemplate.is_deleted == False)  # noqa: E712
    if project_id:
        query = query.where(
            (RequirementTemplate.project_id == project_id)
            | (RequirementTemplate.project_id == None)  # noqa: E711
        )
    elif not user.is_superuser:
        my_project_ids = [p.id for p in user.projects]
        if my_project_ids:
            query = query.where(
                (RequirementTemplate.project_id == None)  # noqa: E711
                | (RequirementTemplate.project_id.in_(my_project_ids))
            )
        else:
            query = query.where(RequirementTemplate.project_id == None)  # noqa: E711
    if level_code:
        query = query.where(RequirementTemplate.level_code == level_code)
    query = query.order_by(RequirementTemplate.sort_order, RequirementTemplate.id)
    result = await db.execute(query)
    return result.scalars().all()


@router.post(
    "/requirement-templates",
    response_model=RequirementTemplateOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_requirement_template(
    data: RequirementTemplateCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("commissioning.manage")),
):
    payload = data.model_dump()
    if payload.get("project_id"):
        await assert_user_in_project(user, payload["project_id"], db=db)
    elif not user.is_superuser:
        raise HTTPException(
            status_code=403, detail="Only super_admin can create global templates"
        )
    template = RequirementTemplate(**payload)
    db.add(template)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Conflict — please retry")
    await db.refresh(template)
    return template


@router.patch(
    "/requirement-templates/{template_id}", response_model=RequirementTemplateOut
)
async def update_requirement_template(
    template_id: uuid.UUID,
    data: RequirementTemplateUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("commissioning.manage")),
):
    result = await db.execute(
        select(RequirementTemplate).where(RequirementTemplate.id == template_id)
    )
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    if template.project_id:
        await assert_user_in_project(user, template.project_id, db=db)
    elif not user.is_superuser:
        raise HTTPException(
            status_code=403, detail="Only super_admin can modify global templates"
        )
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(template, k, v)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Conflict — please retry")
    await db.refresh(template)
    return template


@router.delete("/requirement-templates/{template_id}", status_code=204)
async def delete_requirement_template(
    template_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("commissioning.manage")),
):
    result = await db.execute(
        select(RequirementTemplate).where(RequirementTemplate.id == template_id)
    )
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    if template.project_id:
        await assert_user_in_project(user, template.project_id, db=db)
    elif not user.is_superuser:
        raise HTTPException(
            status_code=403, detail="Only super_admin can delete global templates"
        )
    template.is_deleted = True
    await db.commit()
