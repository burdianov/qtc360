"""Reports API — template management, report generation, bundle composer, and
PDF helpers."""

import asyncio
import logging

from fastapi import APIRouter

from app.api.v1.reports.templates import router as templates_router
from app.api.v1.reports.generation import router as generation_router
from app.api.v1.reports.bundle import router as bundle_router

# Re-export helpers that other modules (documents, approval_files, admin) depend on.
from app.api.v1.reports.helpers import (  # noqa: F401
    _build_context,
    _fill_template,
    _stamp_vector_signatures,
    _merge_attachments_with_status,
    _convert_to_pdf,
    _format_date,
    _safe_filename_for_disposition,
    reset_date_format_cache,
    _load_date_format,
)

router = APIRouter(prefix="/reports", tags=["reports"])

router.include_router(templates_router)
router.include_router(generation_router)
router.include_router(bundle_router)

logger = logging.getLogger(__name__)
