"""Commissioning engine API endpoints."""
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.commissioning import (
    AssetRequirement,
    AssetTagTarget,
    DocumentRequirementLink,
    RequirementTemplate,
    RequirementWorkItem,
)
from app.models.gate_override import GateOverrideAcknowledgement
from app.models.user import User
from app.schemas.commissioning import (
    AssetRequirementBulkCreate,
    AssetRequirementCreate,
    AssetRequirementOut,
    AssetTagTargetCreate,
    AssetTagTargetOut,
    AssetTagTargetUpdate,
    DocumentRequirementLinkCreate,
    DocumentRequirementLinkOut,
    GateOverrideCreate,
    GateOverrideOut,
    RequirementTemplateCreate,
    RequirementTemplateOut,
    RequirementTemplateUpdate,
    RequirementWorkItemCreate,
    RequirementWorkItemOut,
    RequirementWorkItemUpdate,
)
from app.services.commissioning import recalculate_requirement_status

router = APIRouter(prefix="/commissioning", tags=["commissioning"])


# --- Requirement Templates ---

@router.get("/requirement-templates", response_model=list[RequirementTemplateOut])
async def list_requirement_templates(
    project_id: uuid.UUID | None = None,
    level_code: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    query = select(RequirementTemplate).where(RequirementTemplate.is_deleted == False)  # noqa: E712
    if project_id:
        query = query.where((RequirementTemplate.project_id == project_id) | (RequirementTemplate.project_id == None))  # noqa: E711
    if level_code:
        query = query.where(RequirementTemplate.level_code == level_code)
    query = query.order_by(RequirementTemplate.sort_order)
    result = await db.execute(query)
    return result.scalars().all()


@router.post("/requirement-templates", response_model=RequirementTemplateOut, status_code=status.HTTP_201_CREATED)
async def create_requirement_template(
    data: RequirementTemplateCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    template = RequirementTemplate(**data.model_dump())
    db.add(template)
    await db.commit()
    await db.refresh(template)
    return template


@router.patch("/requirement-templates/{template_id}", response_model=RequirementTemplateOut)
async def update_requirement_template(
    template_id: uuid.UUID,
    data: RequirementTemplateUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(select(RequirementTemplate).where(RequirementTemplate.id == template_id))
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(template, k, v)
    await db.commit()
    await db.refresh(template)
    return template


# --- Asset Requirements ---

@router.get("/asset-requirements", response_model=list[AssetRequirementOut])
async def list_asset_requirements(
    asset_id: uuid.UUID | None = None,
    required_for_tag: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    query = select(AssetRequirement).where(AssetRequirement.is_deleted == False)  # noqa: E712
    if asset_id:
        query = query.where(AssetRequirement.asset_id == asset_id)
    if required_for_tag:
        query = query.where(AssetRequirement.required_for_tag == required_for_tag)
    result = await db.execute(query)
    return result.scalars().all()


@router.post("/asset-requirements", response_model=AssetRequirementOut, status_code=status.HTTP_201_CREATED)
async def create_asset_requirement(
    data: AssetRequirementCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    req = AssetRequirement(**data.model_dump())
    db.add(req)
    await db.commit()
    await db.refresh(req)
    return req


@router.post("/asset-requirements/bulk", response_model=list[AssetRequirementOut], status_code=status.HTTP_201_CREATED)
async def bulk_create_asset_requirements(
    data: AssetRequirementBulkCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
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
    await db.commit()
    for r in reqs:
        await db.refresh(r)
    return reqs


@router.post("/asset-requirements/bulk-by-type", status_code=status.HTTP_201_CREATED)
async def bulk_assign_by_asset_type(
    asset_type_id: uuid.UUID = Query(...),
    requirement_template_id: uuid.UUID = Query(...),
    required_for_tag: str = Query(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Assign a requirement to all assets of a given type (including subtypes)."""
    from app.models.asset import Asset
    from app.models.asset_type import AssetType

    # Get all asset type IDs (parent + subtypes)
    type_ids = [asset_type_id]
    subtypes = await db.execute(select(AssetType.id).where(AssetType.parent_type_id == asset_type_id))
    type_ids.extend([row[0] for row in subtypes.all()])

    # Get all assets of those types
    assets_result = await db.execute(
        select(Asset).where(Asset.asset_type_id.in_(type_ids), Asset.is_deleted == False)  # noqa: E712
    )
    assets = assets_result.scalars().all()

    count = 0
    for asset in assets:
        existing = await db.execute(
            select(AssetRequirement).where(
                AssetRequirement.asset_id == asset.id,
                AssetRequirement.requirement_template_id == requirement_template_id,
            )
        )
        if not existing.scalar_one_or_none():
            db.add(AssetRequirement(
                asset_id=asset.id,
                requirement_template_id=requirement_template_id,
                required_for_tag=required_for_tag,
            ))
            count += 1

    await db.commit()
    return {"assigned": count, "total_assets": len(assets)}


# --- Work Items ---

@router.get("/work-items", response_model=list[RequirementWorkItemOut])
async def list_work_items(
    asset_requirement_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(RequirementWorkItem)
        .where(RequirementWorkItem.asset_requirement_id == asset_requirement_id, RequirementWorkItem.is_deleted == False)  # noqa: E712
        .order_by(RequirementWorkItem.sequence_no)
    )
    return result.scalars().all()


@router.post("/work-items", response_model=RequirementWorkItemOut, status_code=status.HTTP_201_CREATED)
async def create_work_item(
    data: RequirementWorkItemCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
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
    user: User = Depends(get_current_user),
):
    result = await db.execute(select(RequirementWorkItem).where(RequirementWorkItem.id == item_id))
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Work item not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(item, k, v)
    await db.commit()
    await db.refresh(item)
    return item


@router.delete("/work-items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_work_item(
    item_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(select(RequirementWorkItem).where(RequirementWorkItem.id == item_id))
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Work item not found")
    if item.status == "approved":
        raise HTTPException(status_code=400, detail="Cannot delete approved work item")
    item.is_deleted = True
    await db.commit()
    # Recalculate parent requirement status
    await recalculate_requirement_status(db, item.asset_requirement_id)
    await db.commit()


# --- Document Requirement Links ---

@router.post("/document-links", response_model=DocumentRequirementLinkOut, status_code=status.HTTP_201_CREATED)
async def create_document_requirement_link(
    data: DocumentRequirementLinkCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    link = DocumentRequirementLink(**data.model_dump())
    db.add(link)
    await db.commit()
    await db.refresh(link)
    # Trigger recalculation
    await recalculate_requirement_status(db, data.asset_requirement_id)
    await db.commit()
    return link


@router.get("/document-links", response_model=list[DocumentRequirementLinkOut])
async def list_document_links(
    document_id: uuid.UUID | None = None,
    asset_requirement_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    query = select(DocumentRequirementLink).where(DocumentRequirementLink.is_deleted == False)  # noqa: E712
    if document_id:
        query = query.where(DocumentRequirementLink.document_id == document_id)
    if asset_requirement_id:
        query = query.where(DocumentRequirementLink.asset_requirement_id == asset_requirement_id)
    result = await db.execute(query)
    return result.scalars().all()


# --- Tag Targets ---

@router.get("/tag-targets", response_model=list[AssetTagTargetOut])
async def list_tag_targets(
    asset_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    query = select(AssetTagTarget).where(AssetTagTarget.is_deleted == False)  # noqa: E712
    if asset_id:
        query = query.where(AssetTagTarget.asset_id == asset_id)
    result = await db.execute(query)
    return result.scalars().all()


@router.post("/tag-targets", response_model=AssetTagTargetOut, status_code=status.HTTP_201_CREATED)
async def create_tag_target(
    data: AssetTagTargetCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
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
    user: User = Depends(get_current_user),
):
    result = await db.execute(select(AssetTagTarget).where(AssetTagTarget.id == target_id))
    target = result.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="Tag target not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(target, k, v)
    await db.commit()
    await db.refresh(target)
    return target


# --- Gate Override Acknowledgements ---

@router.post("/gate-overrides", response_model=GateOverrideOut, status_code=status.HTTP_201_CREATED)
async def create_gate_override(
    data: GateOverrideCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    override = GateOverrideAcknowledgement(
        user_id=user.id,
        asset_id=data.asset_id,
        document_id=data.document_id,
        level_code=data.level_code,
        incomplete_requirements=data.incomplete_requirements,
        notes=data.notes,
    )
    db.add(override)
    await db.commit()
    await db.refresh(override)
    return override


@router.get("/gate-check")
async def check_gate_requirements(
    asset_id: uuid.UUID = Query(...),
    level_code: str = Query(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Check if all requirements for a level are complete. Returns incomplete ones."""
    from app.models.commissioning import RequirementTemplate

    result = await db.execute(
        select(AssetRequirement)
        .where(AssetRequirement.asset_id == asset_id, AssetRequirement.is_deleted == False)  # noqa: E712
    )
    reqs = result.scalars().all()

    # Get templates to filter by level
    tmpl_ids = [r.requirement_template_id for r in reqs]
    if not tmpl_ids:
        return {"complete": True, "incomplete": []}

    tmpl_result = await db.execute(
        select(RequirementTemplate).where(RequirementTemplate.id.in_(tmpl_ids))
    )
    templates = {t.id: t for t in tmpl_result.scalars().all()}

    incomplete = []
    for req in reqs:
        tmpl = templates.get(req.requirement_template_id)
        if tmpl and tmpl.level_code == level_code and not tmpl.is_optional and req.status != "achieved":
            incomplete.append({
                "requirement_id": str(req.id),
                "template_name": tmpl.name,
                "template_code": tmpl.code,
                "status": req.status,
                "progress_percent": req.progress_percent,
            })

    return {"complete": len(incomplete) == 0, "incomplete": incomplete}


@router.get("/gate-overrides", response_model=list[GateOverrideOut])
async def list_gate_overrides(
    asset_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    query = select(GateOverrideAcknowledgement).where(GateOverrideAcknowledgement.is_deleted == False)  # noqa: E712
    if asset_id:
        query = query.where(GateOverrideAcknowledgement.asset_id == asset_id)
    result = await db.execute(query)
    return result.scalars().all()
