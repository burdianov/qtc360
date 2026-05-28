"""Pydantic schemas for commissioning engine."""
import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

LEVEL_CODES = Literal["L1", "L2A", "L2B", "L3", "L4", "L5"]
REQUIREMENT_CATEGORIES = Literal["fat", "delivery", "activity", "test", "integration_test", "final_level_test"]
EVIDENCE_DOCUMENT_TYPES = Literal["FAT", "MIR", "WIR", "CIR"]
TAG_CODES = Literal["red", "yellow", "green", "blue"]


# --- RequirementTemplate ---

class RequirementTemplateCreate(BaseModel):
    project_id: uuid.UUID | None = None
    name: str
    code: str
    description: str | None = None
    level_code: LEVEL_CODES
    requirement_category: REQUIREMENT_CATEGORIES
    evidence_document_type: EVIDENCE_DOCUMENT_TYPES
    requires_work_breakdown: bool = False
    is_gate_requirement: bool = False
    is_optional: bool = False
    sort_order: int = 0


class RequirementTemplateUpdate(BaseModel):
    name: str | None = None
    code: str | None = None
    description: str | None = None
    level_code: LEVEL_CODES | None = None
    requirement_category: REQUIREMENT_CATEGORIES | None = None
    evidence_document_type: EVIDENCE_DOCUMENT_TYPES | None = None
    requires_work_breakdown: bool | None = None
    is_gate_requirement: bool | None = None
    is_optional: bool | None = None
    sort_order: int | None = None
    is_active: bool | None = None


class RequirementTemplateOut(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID | None
    name: str
    code: str
    description: str | None
    level_code: str
    requirement_category: str
    evidence_document_type: str
    requires_work_breakdown: bool
    is_gate_requirement: bool
    is_optional: bool
    sort_order: int
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


# --- AssetRequirement ---

class AssetRequirementCreate(BaseModel):
    asset_id: uuid.UUID
    requirement_template_id: uuid.UUID
    required_for_tag: TAG_CODES
    target_date: date | None = None
    notes: str | None = None


class AssetRequirementBulkCreate(BaseModel):
    """Assign a requirement template to multiple assets at once."""
    asset_ids: list[uuid.UUID]
    requirement_template_id: uuid.UUID
    required_for_tag: TAG_CODES
    target_date: date | None = None


class AssetRequirementBulkByTypeCreate(BaseModel):
    """Assign a requirement to all assets of a given type."""
    asset_type_id: uuid.UUID
    requirement_template_id: uuid.UUID
    required_for_tag: TAG_CODES


class AssetRequirementOut(BaseModel):
    id: uuid.UUID
    asset_id: uuid.UUID
    requirement_template_id: uuid.UUID
    status: str
    progress_percent: float
    required_for_tag: str
    target_date: date | None
    actual_completion_date: date | None
    notes: str | None
    created_at: datetime

    class Config:
        from_attributes = True


class AssetRequirementDetail(AssetRequirementOut):
    """Extended with template info and work items."""
    template_name: str | None = None
    template_code: str | None = None
    level_code: str | None = None
    work_items: list["RequirementWorkItemOut"] = []


# --- RequirementWorkItem ---

class RequirementWorkItemCreate(BaseModel):
    asset_requirement_id: uuid.UUID
    name: str
    description: str | None = None
    sequence_no: int = 0
    created_dynamically: bool = False


class RequirementWorkItemUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    sequence_no: int | None = None


class RequirementWorkItemOut(BaseModel):
    id: uuid.UUID
    asset_requirement_id: uuid.UUID
    name: str
    description: str | None
    status: str
    linked_document_id: uuid.UUID | None
    approved_date: date | None
    sequence_no: int
    created_dynamically: bool
    created_at: datetime

    class Config:
        from_attributes = True


# --- DocumentRequirementLink ---

class DocumentRequirementLinkCreate(BaseModel):
    document_id: uuid.UUID
    asset_requirement_id: uuid.UUID
    requirement_work_item_id: uuid.UUID | None = None


class DocumentRequirementLinkOut(BaseModel):
    id: uuid.UUID
    document_id: uuid.UUID
    asset_requirement_id: uuid.UUID
    requirement_work_item_id: uuid.UUID | None

    class Config:
        from_attributes = True


# --- AssetTagTarget ---

class AssetTagTargetCreate(BaseModel):
    asset_id: uuid.UUID
    tag_code: TAG_CODES
    target_date: date


class AssetTagTargetUpdate(BaseModel):
    target_date: date | None = None


class AssetTagTargetOut(BaseModel):
    id: uuid.UUID
    asset_id: uuid.UUID
    tag_code: str
    target_date: date
    actual_achieved_date: date | None
    status: str
    created_at: datetime

    class Config:
        from_attributes = True


# --- Gate Override ---

class GateOverrideCreate(BaseModel):
    asset_id: uuid.UUID
    document_id: uuid.UUID
    level_code: LEVEL_CODES
    incomplete_requirements: list[dict]
    notes: str | None = None


class GateOverrideOut(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    asset_id: uuid.UUID
    document_id: uuid.UUID
    level_code: str
    incomplete_requirements: list[dict]
    acknowledged_at: datetime
    notes: str | None

    class Config:
        from_attributes = True


# --- Asset Commissioning Progress (read-only view) ---

class AssetCommissioningProgress(BaseModel):
    asset_id: uuid.UUID
    asset_name: str | None = None
    tag_number: str | None = None
    current_tags: list[str] = []
    requirements: list[AssetRequirementDetail] = []
    tag_targets: list[AssetTagTargetOut] = []
