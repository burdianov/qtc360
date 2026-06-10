"""Commissioning API — requirement templates, asset requirements, work items,
document links, tag targets, progress tracking, and gate overrides."""

from fastapi import APIRouter

from app.api.v1.commissioning.templates import router as templates_router
from app.api.v1.commissioning.requirements import router as requirements_router
from app.api.v1.commissioning.work_items import router as work_items_router
from app.api.v1.commissioning.links import router as links_router
from app.api.v1.commissioning.tag_targets import router as tag_targets_router
from app.api.v1.commissioning.progress import router as progress_router

router = APIRouter(prefix="/commissioning", tags=["commissioning"])

router.include_router(templates_router)
router.include_router(requirements_router)
router.include_router(work_items_router)
router.include_router(links_router)
router.include_router(tag_targets_router)
router.include_router(progress_router)

# Re-export shared helpers (moved to helpers.py to break circular imports)
from app.api.v1.commissioning.helpers import (  # noqa: E402, F401
    project_id_for_asset as _project_id_for_asset,
    project_id_for_asset_requirement as _project_id_for_asset_requirement,
    project_id_for_document as _project_id_for_document,
)
