"""Commissioning progress, gate overrides, recalculation, and inspection tracker."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.types import TAG_LEVEL_MAP
from app.core.deps import (
    assert_user_in_project,
    get_current_user,
    require_admin,
    require_permission,
    require_project_access,
)
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
    AssetCommissioningProgress,
    AssetRequirementDetail,
    GateOverrideCreate,
    GateOverrideOut,
)
from app.services.audit import record_audit
from app.services.commissioning import recalculate_requirement_status
from app.api.v1.commissioning.helpers import (
    project_id_for_asset as _project_id_for_asset,
    project_id_for_document as _project_id_for_document,
)

router = APIRouter()


# ── Commissioning progress ───────────────────────────────────────────────────


@router.get("/progress", response_model=list[AssetCommissioningProgress])
async def get_commissioning_progress(
    project_id: uuid.UUID = Query(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_project_access()),
):
    """Return commissioning progress for assets in a project."""
    from app.models.asset import Asset

    assets_result = await db.execute(
        select(Asset).where(Asset.is_deleted == False, Asset.project_id == project_id)  # noqa: E712
    )
    assets = assets_result.scalars().all()
    asset_ids = [a.id for a in assets]
    if not asset_ids:
        return []

    reqs_result = await db.execute(
        select(AssetRequirement)
        .where(
            AssetRequirement.is_deleted == False,  # noqa: E712
            AssetRequirement.asset_id.in_(asset_ids),
        )
        .options(selectinload(AssetRequirement.work_items))
    )
    all_reqs = reqs_result.scalars().all()

    tmpl_result = await db.execute(
        select(RequirementTemplate).where(
            RequirementTemplate.is_deleted == False,  # noqa: E712
            (RequirementTemplate.project_id == project_id)
            | (RequirementTemplate.project_id == None),  # noqa: E711
        )
    )
    templates = {t.id: t for t in tmpl_result.scalars().all()}

    tags_result = await db.execute(
        select(AssetTagTarget).where(
            AssetTagTarget.is_deleted == False,  # noqa: E712
            AssetTagTarget.asset_id.in_(asset_ids),
        )
    )
    all_tags = tags_result.scalars().all()

    reqs_by_asset: dict[uuid.UUID, list] = {}
    for req in all_reqs:
        reqs_by_asset.setdefault(req.asset_id, []).append(req)

    tags_by_asset: dict[uuid.UUID, list] = {}
    for tag in all_tags:
        tags_by_asset.setdefault(tag.asset_id, []).append(tag)

    progress_list = []
    for asset in assets:
        asset_reqs = reqs_by_asset.get(asset.id, [])
        if not asset_reqs:
            continue

        req_details = []
        for req in asset_reqs:
            tmpl = templates.get(req.requirement_template_id)
            work_items = [wi for wi in req.work_items if not wi.is_deleted]
            req_details.append(
                AssetRequirementDetail(
                    id=req.id,
                    asset_id=req.asset_id,
                    requirement_template_id=req.requirement_template_id,
                    status=req.status,
                    progress_percent=req.progress_percent,
                    required_for_tag=req.required_for_tag,
                    target_date=req.target_date,
                    actual_completion_date=req.actual_completion_date,
                    approved_date=req.approved_date,
                    notes=req.notes,
                    created_at=req.created_at,
                    template_name=tmpl.name if tmpl else None,
                    template_code=tmpl.code if tmpl else None,
                    level_code=tmpl.level_code if tmpl else None,
                    work_items=work_items,
                )
            )

        current_tags = []
        for tag_code, levels in TAG_LEVEL_MAP.items():
            tag_reqs = [
                r
                for r in asset_reqs
                if templates.get(r.requirement_template_id)
                and templates[r.requirement_template_id].level_code in levels
                and not templates[r.requirement_template_id].is_optional
            ]
            if tag_reqs and all(r.status == "achieved" for r in tag_reqs):
                current_tags.append(tag_code)

        progress_list.append(
            AssetCommissioningProgress(
                asset_id=asset.id,
                asset_name=asset.name,
                tag_number=asset.tag_number,
                current_tags=current_tags,
                requirements=req_details,
                tag_targets=tags_by_asset.get(asset.id, []),
            )
        )

    return progress_list


# ── Gate override CRUD ───────────────────────────────────────────────────────


@router.post(
    "/gate-overrides",
    response_model=GateOverrideOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_gate_override(
    data: GateOverrideCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("commissioning.manage")),
):
    pid = await _project_id_for_asset(db, data.asset_id)
    if pid is None:
        raise HTTPException(status_code=404, detail="Asset not found")
    await assert_user_in_project(user, pid, db=db)
    if data.document_id:
        pid_doc = await _project_id_for_document(db, data.document_id)
        if pid_doc != pid:
            raise HTTPException(
                status_code=400, detail="Asset and document are in different projects"
            )
    override = GateOverrideAcknowledgement(
        user_id=user.id,
        asset_id=data.asset_id,
        document_id=data.document_id,
        level_code=data.level_code,
        incomplete_requirements=data.incomplete_requirements,
        notes=data.notes,
    )
    db.add(override)
    await record_audit(
        db,
        user_id=user.id,
        action="gate_override",
        entity_type="asset",
        entity_id=data.asset_id,
        summary=f"Gate override on level {data.level_code}",
    )
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
    pid = await _project_id_for_asset(db, asset_id)
    await assert_user_in_project(user, pid, db=db)

    result = await db.execute(
        select(AssetRequirement).where(
            AssetRequirement.asset_id == asset_id,
            AssetRequirement.is_deleted == False,  # noqa: E712
        )
    )
    reqs = result.scalars().all()

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
        if (
            tmpl
            and tmpl.level_code == level_code
            and not tmpl.is_optional
            and req.status != "achieved"
        ):
            incomplete.append(
                {
                    "requirement_id": str(req.id),
                    "template_name": tmpl.name,
                    "template_code": tmpl.code,
                    "status": req.status,
                    "progress_percent": req.progress_percent,
                }
            )

    return {"complete": len(incomplete) == 0, "incomplete": incomplete}


@router.get("/gate-overrides", response_model=list[GateOverrideOut])
async def list_gate_overrides(
    asset_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if asset_id:
        await assert_user_in_project(user, await _project_id_for_asset(db, asset_id), db=db)
    query = select(GateOverrideAcknowledgement).where(
        GateOverrideAcknowledgement.is_deleted == False  # noqa: E712
    )
    if asset_id:
        query = query.where(GateOverrideAcknowledgement.asset_id == asset_id)
    elif not user.is_superuser:
        from app.models.asset import Asset

        my_project_ids = [p.id for p in user.projects]
        if not my_project_ids:
            return []
        query = query.join(
            Asset, GateOverrideAcknowledgement.asset_id == Asset.id
        ).where(Asset.project_id.in_(my_project_ids))
    result = await db.execute(query)
    return result.scalars().all()


# ── Admin recalculate ────────────────────────────────────────────────────────


@router.post("/recalculate-all", status_code=status.HTTP_200_OK)
async def recalculate_all_requirements(
    project_id: uuid.UUID = Query(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    """Admin-only: recalculate all requirement statuses and tag achievements for a project."""
    from app.models.asset import Asset
    from app.services.commissioning import recalculate_tag_status

    result = await db.execute(
        select(
            AssetRequirement.id, AssetRequirement.asset_id, AssetRequirement.status
        ).where(
            AssetRequirement.is_deleted == False,  # noqa: E712
            AssetRequirement.asset_id.in_(
                select(Asset.id).where(
                    Asset.project_id == project_id,
                    Asset.is_deleted == False,  # noqa: E712
                )
            ),
        )
    )
    rows = result.all()
    changed = 0
    for ar_id, _, old_status in rows:
        new_status = await recalculate_requirement_status(db, ar_id)
        if new_status != old_status:
            changed += 1

    asset_ids = list({r[1] for r in rows})
    for aid in asset_ids:
        await recalculate_tag_status(db, aid)

    await db.commit()
    return {"recalculated": len(rows), "changed": changed}


# ── Inspection tracker ───────────────────────────────────────────────────────


@router.get("/inspection-tracker")
async def get_inspection_tracker(
    project_id: uuid.UUID = Query(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_project_access()),
):
    """Return the full requirements achievement tracker for a project."""
    from app.models.asset import Asset
    from app.models.asset_type import AssetType
    from app.models.service import Service

    tmpl_result = await db.execute(
        select(RequirementTemplate)
        .where(
            RequirementTemplate.is_deleted == False,  # noqa: E712
            RequirementTemplate.is_active == True,  # noqa: E712
            (RequirementTemplate.project_id == project_id)
            | (RequirementTemplate.project_id == None),  # noqa: E711
        )
        .order_by(RequirementTemplate.sort_order, RequirementTemplate.level_code)
    )
    templates = tmpl_result.scalars().all()
    tmpl_by_id = {t.id: t for t in templates}

    assets_result = await db.execute(
        select(Asset)
        .where(Asset.is_deleted == False, Asset.project_id == project_id)  # noqa: E712
        .options(
            selectinload(Asset.asset_type)
            .selectinload(AssetType.service)
            .selectinload(Service.discipline)
        )
    )
    assets = assets_result.scalars().all()
    if not assets:
        return {"columns": [], "rows": []}

    asset_ids = [a.id for a in assets]

    reqs_result = await db.execute(
        select(AssetRequirement).where(
            AssetRequirement.is_deleted == False,  # noqa: E712
            AssetRequirement.asset_id.in_(asset_ids),
        )
    )
    all_reqs = reqs_result.scalars().all()

    links_result = await db.execute(
        select(DocumentRequirementLink)
        .where(
            DocumentRequirementLink.is_deleted == False,  # noqa: E712
            DocumentRequirementLink.asset_requirement_id.in_([r.id for r in all_reqs]),
        )
        .options(selectinload(DocumentRequirementLink.document))
    )
    all_links = links_result.scalars().all()

    links_by_ar: dict[uuid.UUID, list] = {}
    for link in all_links:
        links_by_ar.setdefault(link.asset_requirement_id, []).append(link)

    wi_result = await db.execute(
        select(RequirementWorkItem)
        .where(
            RequirementWorkItem.is_deleted == False,  # noqa: E712
            RequirementWorkItem.asset_requirement_id.in_([r.id for r in all_reqs]),
        )
        .order_by(RequirementWorkItem.sequence_no)
    )
    all_work_items = wi_result.scalars().all()

    wi_by_ar: dict[uuid.UUID, list] = {}
    for wi in all_work_items:
        wi_by_ar.setdefault(wi.asset_requirement_id, []).append(wi)

    reqs_by_asset: dict[uuid.UUID, dict[uuid.UUID, AssetRequirement]] = {}
    for req in all_reqs:
        reqs_by_asset.setdefault(req.asset_id, {})[req.requirement_template_id] = req

    level_order = ["L1", "L2A", "L2B", "L3", "L4", "L5"]
    columns = []
    for tmpl in sorted(
        templates,
        key=lambda t: (
            level_order.index(t.level_code) if t.level_code in level_order else 99,
            t.sort_order,
        ),
    ):
        columns.append(
            {
                "id": str(tmpl.id),
                "name": tmpl.name,
                "code": tmpl.code,
                "level_code": tmpl.level_code,
                "doc_type": tmpl.evidence_document_type,
                "sort_order": tmpl.sort_order,
            }
        )

    rows = []
    for asset in assets:
        asset_reqs = reqs_by_asset.get(asset.id, {})

        total = len(asset_reqs)
        achieved = sum(1 for r in asset_reqs.values() if r.status == "achieved")
        progress = achieved / total if total > 0 else 0

        blocker = None
        for tmpl in sorted(
            templates,
            key=lambda t: (
                level_order.index(t.level_code) if t.level_code in level_order else 99,
                t.sort_order,
            ),
        ):
            if tmpl.is_optional:
                continue
            req = asset_reqs.get(tmpl.id)
            if req and req.status not in ("achieved", "not_applicable"):
                blocker = {
                    "template_name": tmpl.name,
                    "level_code": tmpl.level_code,
                    "status": req.status,
                }
                break

        cells = {}
        for tmpl_id, req in asset_reqs.items():
            links = links_by_ar.get(req.id, [])
            doc_refs = []
            seen_doc_ids: set[uuid.UUID] = set()
            for link in links:
                doc = link.document
                if doc and not doc.is_deleted and doc.id not in seen_doc_ids:
                    seen_doc_ids.add(doc.id)
                    doc_refs.append(
                        {
                            "id": str(doc.id),
                            "reference_no": doc.reference_no,
                            "revision_no": doc.revision_no or 0,
                            "status": doc.status,
                        }
                    )
            work_items = wi_by_ar.get(req.id, [])
            wi_data = (
                [{"name": wi.name, "status": wi.status} for wi in work_items]
                if work_items
                else []
            )
            cells[str(tmpl_id)] = {
                "status": req.status,
                "progress": req.progress_percent,
                "docs": doc_refs,
                "work_items": wi_data,
            }

        achieved_levels = []
        for level in level_order:
            level_reqs = [
                r
                for tid, r in asset_reqs.items()
                if tmpl_by_id.get(tid)
                and tmpl_by_id[tid].level_code == level
                and not tmpl_by_id[tid].is_optional
            ]
            if level_reqs and all(r.status == "achieved" for r in level_reqs):
                achieved_levels.append(level)

        rows.append(
            {
                "asset_id": str(asset.id),
                "asset_name": asset.name,
                "tag_number": asset.tag_number,
                "asset_type": asset.asset_type.name if asset.asset_type else None,
                "discipline": asset.asset_type.service.discipline.name
                if asset.asset_type
                and asset.asset_type.service
                and asset.asset_type.service.discipline
                else None,
                "service": asset.asset_type.service.name
                if asset.asset_type and asset.asset_type.service
                else None,
                "pod": (asset.custom_fields or {}).get("field_1", ""),
                "custom_fields": asset.custom_fields or {},
                "location": asset.location,
                "progress": progress,
                "achieved_count": achieved,
                "total_count": total,
                "blocker": blocker,
                "achieved_levels": achieved_levels,
                "cells": cells,
            }
        )

    return {"columns": columns, "rows": rows}
