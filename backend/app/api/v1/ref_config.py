"""Reference number configuration endpoints."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel as PydanticModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import (
    assert_user_in_project,
    require_permission,
    require_project_access,
)
from app.core.types import DEFAULT_SERIAL_START
from app.models.reference_number_config import ReferenceNumberConfig
from app.models.user import User
from app.services.audit import record_audit

router = APIRouter(prefix="/ref-config", tags=["ref-config"])


_ALLOWED_PLACEHOLDERS = {
    "project_code",
    "contractor_code",
    "discipline_code",
    "doc_type",
    "serial",
}


def _validate_pattern(pattern: str) -> None:
    """Reject anything outside the known placeholder set to block format-string traversal
    (e.g. ``{0.__class__}``).  We require simple ``{name}``/``{name:fmt}`` placeholders."""
    import string

    fmt = string.Formatter()
    try:
        parsed = list(fmt.parse(pattern))
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid pattern syntax")
    for _literal, field, _spec, _conv in parsed:
        if field is None:
            continue
        # Reject attribute access or indexing in the field name.
        if any(c in field for c in ".[]"):
            raise HTTPException(
                status_code=400, detail=f"Invalid pattern field: {field!r}"
            )
        if field not in _ALLOWED_PLACEHOLDERS:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown placeholder {{{field}}}. Allowed: {sorted(_ALLOWED_PLACEHOLDERS)}",
            )


class RefConfigCreate(PydanticModel):
    project_id: UUID
    doc_type: str
    pattern: str = (
        "{project_code}-{contractor_code}-{discipline_code}-{doc_type}-{serial:04d}"
    )
    project_code: str
    contractor_code: str = ""
    serial_start: int = DEFAULT_SERIAL_START


class RefConfigResponse(PydanticModel):
    id: UUID
    project_id: UUID
    doc_type: str
    pattern: str
    project_code: str
    contractor_code: str
    serial_start: int

    model_config = {"from_attributes": True}


@router.get("", response_model=list[RefConfigResponse])
async def list_ref_configs(
    project_id: UUID = Query(...),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_project_access()),
):
    result = await db.execute(
        select(ReferenceNumberConfig).where(
            ReferenceNumberConfig.project_id == project_id,
            ReferenceNumberConfig.is_deleted == False,  # noqa: E712
        )
    )
    return result.scalars().all()


@router.post("", response_model=RefConfigResponse, status_code=201)
async def create_or_update_ref_config(
    body: RefConfigCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("admin.settings")),
):
    """Create or update reference number config (upsert by project+doc_type)."""
    await assert_user_in_project(user, body.project_id, db=db)
    _validate_pattern(body.pattern)
    result = await db.execute(
        select(ReferenceNumberConfig).where(
            ReferenceNumberConfig.project_id == body.project_id,
            ReferenceNumberConfig.doc_type == body.doc_type.upper(),
            ReferenceNumberConfig.is_deleted == False,  # noqa: E712
        )
    )
    existing = result.scalar_one_or_none()

    if existing:
        existing.pattern = body.pattern
        existing.project_code = body.project_code
        existing.contractor_code = body.contractor_code
        existing.serial_start = body.serial_start
    else:
        existing = ReferenceNumberConfig(
            project_id=body.project_id,
            doc_type=body.doc_type.upper(),
            pattern=body.pattern,
            project_code=body.project_code,
            contractor_code=body.contractor_code,
            serial_start=body.serial_start,
        )
        db.add(existing)

    await record_audit(
        db,
        user_id=user.id,
        action="update",
        entity_type="ref_config",
        entity_id=existing.id if existing.id else None,
        summary=f"Updated reference pattern for {body.doc_type.upper()}",
    )
    await db.commit()
    await db.refresh(existing)
    return existing


@router.delete("/{config_id}", status_code=204)
async def delete_ref_config(
    config_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("admin.settings")),
):
    result = await db.execute(
        select(ReferenceNumberConfig).where(ReferenceNumberConfig.id == config_id)
    )
    config = result.scalar_one_or_none()
    if not config:
        raise HTTPException(status_code=404, detail="Not found")
    await assert_user_in_project(user, config.project_id, db=db)
    config.is_deleted = True
    await record_audit(
        db,
        user_id=user.id,
        action="delete",
        entity_type="ref_config",
        entity_id=config.id,
        summary=f"Deleted reference pattern for {config.doc_type}",
    )
    await db.commit()
