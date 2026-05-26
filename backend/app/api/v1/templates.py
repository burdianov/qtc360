from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel as PydanticModel, Field
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.document_template import DocumentTemplate
from app.models.reference_number_config import ReferenceNumberConfig
from app.models.document import Document

router = APIRouter(prefix="/templates", tags=["templates"])


# --- Schemas ---

class TemplateCreate(PydanticModel):
    project_id: UUID
    doc_type: str
    name: str
    template_schema: dict = {}

    model_config = {"populate_by_name": True}


class TemplateUpdate(PydanticModel):
    name: str | None = None
    template_schema: dict | None = None


class TemplateResponse(PydanticModel):
    id: UUID
    project_id: UUID
    doc_type: str
    name: str
    template_schema: dict = Field(validation_alias="schema")

    model_config = {"from_attributes": True}


class RefNumConfigCreate(PydanticModel):
    project_id: UUID
    doc_type: str
    pattern: str
    project_code: str
    contractor_code: str = ""
    serial_start: int = 1


class RefNumConfigResponse(PydanticModel):
    id: UUID
    project_id: UUID
    doc_type: str
    pattern: str
    project_code: str
    contractor_code: str
    serial_start: int
    model_config = {"from_attributes": True}


class GeneratedRefNum(PydanticModel):
    reference_number: str
    serial: int


# --- Template CRUD ---

@router.get("", response_model=list[TemplateResponse])
async def list_templates(
    project_id: UUID = Query(...),
    db: AsyncSession = Depends(get_db),
    _: Any = Depends(get_current_user),
):
    result = await db.execute(
        select(DocumentTemplate).where(
            DocumentTemplate.is_deleted == False, DocumentTemplate.project_id == project_id  # noqa: E712
        )
    )
    return result.scalars().all()


@router.get("/{template_id}", response_model=TemplateResponse)
async def get_template(
    template_id: UUID,
    db: AsyncSession = Depends(get_db),
    _: Any = Depends(get_current_user),
):
    result = await db.execute(
        select(DocumentTemplate).where(DocumentTemplate.id == template_id, DocumentTemplate.is_deleted == False)  # noqa: E712
    )
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Not found")
    return item


@router.post("", response_model=TemplateResponse, status_code=201)
async def create_template(
    body: TemplateCreate,
    db: AsyncSession = Depends(get_db),
    _: Any = Depends(get_current_user),
):
    data = body.model_dump()
    data["schema"] = data.pop("template_schema")
    item = DocumentTemplate(**data)
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


@router.patch("/{template_id}", response_model=TemplateResponse)
async def update_template(
    template_id: UUID,
    body: TemplateUpdate,
    db: AsyncSession = Depends(get_db),
    _: Any = Depends(get_current_user),
):
    result = await db.execute(
        select(DocumentTemplate).where(DocumentTemplate.id == template_id, DocumentTemplate.is_deleted == False)  # noqa: E712
    )
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Not found")
    updates = body.model_dump(exclude_unset=True)
    if "template_schema" in updates:
        updates["schema"] = updates.pop("template_schema")
    for k, v in updates.items():
        setattr(item, k, v)
    await db.commit()
    await db.refresh(item)
    return item


@router.delete("/{template_id}", status_code=204)
async def delete_template(
    template_id: UUID,
    db: AsyncSession = Depends(get_db),
    _: Any = Depends(get_current_user),
):
    result = await db.execute(
        select(DocumentTemplate).where(DocumentTemplate.id == template_id, DocumentTemplate.is_deleted == False)  # noqa: E712
    )
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Not found")
    item.is_deleted = True
    await db.commit()


# --- Reference Number Config ---

@router.get("/ref-config", response_model=list[RefNumConfigResponse])
async def list_ref_configs(
    project_id: UUID = Query(...),
    db: AsyncSession = Depends(get_db),
    _: Any = Depends(get_current_user),
):
    result = await db.execute(
        select(ReferenceNumberConfig).where(
            ReferenceNumberConfig.is_deleted == False, ReferenceNumberConfig.project_id == project_id  # noqa: E712
        )
    )
    return result.scalars().all()


@router.post("/ref-config", response_model=RefNumConfigResponse, status_code=201)
async def create_ref_config(
    body: RefNumConfigCreate,
    db: AsyncSession = Depends(get_db),
    _: Any = Depends(get_current_user),
):
    item = ReferenceNumberConfig(**body.model_dump())
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


@router.get("/ref-config/generate", response_model=GeneratedRefNum)
async def generate_reference_number(
    project_id: UUID = Query(...),
    doc_type: str = Query(...),
    discipline_code: str = Query(...),
    db: AsyncSession = Depends(get_db),
    _: Any = Depends(get_current_user),
):
    """Generate the next reference number for a given project + doc_type + discipline."""
    result = await db.execute(
        select(ReferenceNumberConfig).where(
            ReferenceNumberConfig.project_id == project_id,
            ReferenceNumberConfig.doc_type == doc_type,
            ReferenceNumberConfig.is_deleted == False,  # noqa: E712
        )
    )
    config = result.scalar_one_or_none()
    if not config:
        raise HTTPException(status_code=404, detail="Reference number config not found for this project/doc_type")

    # Count existing documents for this project + doc_type + discipline to determine serial
    count_result = await db.execute(
        select(func.count()).select_from(Document).where(
            Document.project_id == project_id,
            Document.doc_type == doc_type,
            Document.number.like(f"%-{discipline_code}-{doc_type}-%"),
            Document.is_deleted == False,  # noqa: E712
        )
    )
    current_count = count_result.scalar() or 0
    serial = config.serial_start + current_count

    # Build reference number from pattern
    ref = config.pattern.format(
        project_code=config.project_code,
        contractor_code=config.contractor_code,
        discipline_code=discipline_code,
        doc_type=doc_type,
        serial=serial,
    )

    return GeneratedRefNum(reference_number=ref, serial=serial)
