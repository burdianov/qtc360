"""Asset requirement CRUD and bulk-assignment endpoints."""

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
from app.models.commissioning import (
    AssetRequirement,
    DocumentRequirementLink,
    RequirementTemplate,
)
from app.models.user import User
from app.schemas.commissioning import (
    AssetRequirementBulkCreate,
    AssetRequirementBulkByTypeCreate,
    AssetRequirementCreate,
    AssetRequirementOut,
    AssetRequirementUpdate,
)
from app.api.v1.commissioning.helpers import (
    project_id_for_asset,
    project_id_for_asset_requirement,
)

router = APIRouter()


@router.get("/asset-requirements", response_model=list[AssetRequirementOut])
async def list_asset_requirements(
    asset_id: uuid.UUID | None = None,
    project_id: uuid.UUID | None = None,
    required_for_tag: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from app.models.asset import Asset

    query = select(AssetRequirement).where(AssetRequirement.is_deleted == False)  # noqa: E712
    if asset_id:
        ap = await project_id_for_asset(db, asset_id)
        await assert_user_in_project(user, ap)
        query = query.where(AssetRequirement.asset_id == asset_id)
    if project_id:
        await assert_user_in_project(user, project_id)
        query = query.join(Asset, AssetRequirement.asset_id == Asset.id).where(
            Asset.is_deleted == False,  # noqa: E712
            Asset.project_id == project_id,
        )
    elif not asset_id and not user.is_superuser:
        my_project_ids = [p.id for p in user.projects]
        if not my_project_ids:
            return []
        query = query.join(Asset, AssetRequirement.asset_id == Asset.id).where(
            Asset.is_deleted == False,  # noqa: E712
            Asset.project_id.in_(my_project_ids),
        )
    if required_for_tag:
        query = query.where(AssetRequirement.required_for_tag == required_for_tag)
    query = query.join(
        RequirementTemplate,
        AssetRequirement.requirement_template_id == RequirementTemplate.id,
        isouter=True,
    ).order_by(RequirementTemplate.level_code, RequirementTemplate.sort_order)
    result = await db.execute(query)
    return result.scalars().all()


@router.post(
    "/asset-requirements",
    response_model=AssetRequirementOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_asset_requirement(
    data: AssetRequirementCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("commissioning.manage")),
):
    ap = await project_id_for_asset(db, data.asset_id)
    if ap is None:
        raise HTTPException(status_code=404, detail="Asset not found")
    await assert_user_in_project(user, ap)
    req = AssetRequirement(**data.model_dump())
    db.add(req)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=409, detail="Requirement already assigned to this asset"
        )
    await db.refresh(req)
    return req


@router.patch(
    "/asset-requirements/{asset_requirement_id}", response_model=AssetRequirementOut
)
async def update_asset_requirement(
    asset_requirement_id: uuid.UUID,
    data: AssetRequirementUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("commissioning.manage")),
):
    result = await db.execute(
        select(AssetRequirement).where(
            AssetRequirement.id == asset_requirement_id,
            AssetRequirement.is_deleted == False,  # noqa: E712
        )
    )
    req = result.scalar_one_or_none()
    if not req:
        raise HTTPException(status_code=404, detail="Asset requirement not found")

    project_id = await project_id_for_asset_requirement(db, asset_requirement_id)
    await assert_user_in_project(user, project_id)

    updates = data.model_dump(exclude_unset=True)
    for key, value in updates.items():
        setattr(req, key, value)

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=409, detail="Requirement already assigned to this asset"
        )

    await db.refresh(req)
    return req


@router.delete(
    "/asset-requirements/{asset_requirement_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def delete_asset_requirement(
    asset_requirement_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("commissioning.manage")),
):
    result = await db.execute(
        select(AssetRequirement).where(
            AssetRequirement.id == asset_requirement_id,
            AssetRequirement.is_deleted == False,  # noqa: E712
        )
    )
    req = result.scalar_one_or_none()
    if not req:
        raise HTTPException(status_code=404, detail="Asset requirement not found")

    project_id = await project_id_for_asset_requirement(db, asset_requirement_id)
    await assert_user_in_project(user, project_id)

    linked_doc = await db.execute(
        select(DocumentRequirementLink.id).where(
            DocumentRequirementLink.asset_requirement_id == asset_requirement_id,
            DocumentRequirementLink.is_deleted == False,  # noqa: E712
        )
    )
    if linked_doc.scalar_one_or_none():
        raise HTTPException(
            status_code=400,
            detail="Cannot delete this asset requirement because it is already linked to a document",
        )

    req.is_deleted = True
    await db.commit()


@router.post(
    "/asset-requirements/bulk",
    response_model=list[AssetRequirementOut],
    status_code=status.HTTP_201_CREATED,
)
async def bulk_create_asset_requirements(
    data: AssetRequirementBulkCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("commissioning.manage")),
):
    from app.models.asset import Asset

    if data.asset_ids:
        rows = (
            await db.execute(
                select(Asset.id, Asset.project_id).where(Asset.id.in_(data.asset_ids))
            )
        ).all()
        project_ids = {pid for _, pid in rows if pid is not None}
        if len(project_ids) > 1:
            raise HTTPException(
                status_code=400, detail="Bulk create cannot span multiple projects"
            )
        if not project_ids:
            raise HTTPException(status_code=404, detail="No valid assets found")
        for pid in project_ids:
            await assert_user_in_project(user, pid)
    reqs = []
    for asset_id in data.asset_ids:
        req = AssetRequirement(
            asset_id=asset_id,
            requirement_template_id=data.requirement_template_id,
            required_for_tag=data.required_for_tag,
            target_date=data.target_date,
        )
        db.add(req)
        reqs.append(req)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=409, detail="One or more requirements already assigned"
        )
    for r in reqs:
        await db.refresh(r)
    return reqs


@router.post("/asset-requirements/bulk-by-type", status_code=status.HTTP_201_CREATED)
async def bulk_assign_by_asset_type(
    data: AssetRequirementBulkByTypeCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("commissioning.manage")),
):
    """Assign a requirement to all assets of a given type (including subtypes)."""
    from app.models.asset import Asset
    from app.models.asset_type import AssetType

    type_ids = [data.asset_type_id]
    subtypes = await db.execute(
        select(AssetType.id).where(AssetType.parent_type_id == data.asset_type_id)
    )
    type_ids.extend([row[0] for row in subtypes.all()])

    asset_q = select(Asset).where(
        Asset.asset_type_id.in_(type_ids), Asset.is_deleted == False  # noqa: E712
    )
    if not user.is_superuser:
        my_project_ids = [p.id for p in user.projects]
        if not my_project_ids:
            return {"assigned": 0, "total_assets": 0}
        asset_q = asset_q.where(Asset.project_id.in_(my_project_ids))
    assets = (await db.execute(asset_q)).scalars().all()

    count = 0
    for asset in assets:
        existing = await db.execute(
            select(AssetRequirement).where(
                AssetRequirement.asset_id == asset.id,
                AssetRequirement.requirement_template_id
                == data.requirement_template_id,
            )
        )
        if not existing.scalar_one_or_none():
            db.add(
                AssetRequirement(
                    asset_id=asset.id,
                    requirement_template_id=data.requirement_template_id,
                    required_for_tag=data.required_for_tag,
                )
            )
            count += 1

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Conflict — please retry")
    return {"assigned": count, "total_assets": len(assets)}
