"""Reference number configuration endpoints."""
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel as PydanticModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.reference_number_config import ReferenceNumberConfig

router = APIRouter(prefix="/ref-config", tags=["ref-config"])


class RefConfigCreate(PydanticModel):
    project_id: UUID
    doc_type: str
    pattern: str = "{project_code}-{contractor_code}-{discipline_code}-{doc_type}-{serial:04d}"
    project_code: str
    contractor_code: str = ""
    serial_start: int = 1


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
    _: Any = Depends(get_current_user),
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
    _: Any = Depends(get_current_user),
):
    """Create or update reference number config (upsert by project+doc_type)."""
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

    await db.commit()
    await db.refresh(existing)
    return existing


@router.delete("/{config_id}", status_code=204)
async def delete_ref_config(
    config_id: UUID,
    db: AsyncSession = Depends(get_db),
    _: Any = Depends(get_current_user),
):
    result = await db.execute(
        select(ReferenceNumberConfig).where(ReferenceNumberConfig.id == config_id)
    )
    config = result.scalar_one_or_none()
    if not config:
        raise HTTPException(status_code=404, detail="Not found")
    config.is_deleted = True
    await db.commit()
