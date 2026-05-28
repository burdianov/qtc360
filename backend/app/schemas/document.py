from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel

DOCUMENT_TYPES = Literal["FAT", "MIR", "WIR", "CIR"]
DOCUMENT_STATUSES = Literal["draft", "submitted", "approved", "approved_with_comments", "rejected", "cancelled", "superseded"]

# Valid status transitions
VALID_STATUS_TRANSITIONS: dict[str, set[str]] = {
    "draft": {"submitted", "cancelled"},
    "submitted": {"approved", "approved_with_comments", "rejected", "cancelled"},
    "approved": {"superseded"},
    "approved_with_comments": {"superseded"},
    "rejected": {"superseded"},
    "cancelled": set(),
    "superseded": set(),
}


# --- Document ---

class DocumentCreate(BaseModel):
    project_id: UUID
    document_type: DOCUMENT_TYPES
    reference_no: str = ""
    title: str
    description: str | None = None
    discipline_id: UUID | None = None
    # Context fields
    location: str | None = None
    floor_level: str | None = None
    rams_ref: str | None = None
    drawing_ref: str | None = None
    inspection_date: datetime | None = None
    delivery_note: str | None = None
    asset_type_id: UUID | None = None
    # Signatories
    site_engineer_id: UUID | None = None
    qaqc_engineer_id: UUID | None = None
    # Assets
    asset_ids: list[UUID] = []


class DocumentUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    discipline_id: UUID | None = None
    location: str | None = None
    floor_level: str | None = None
    rams_ref: str | None = None
    drawing_ref: str | None = None
    inspection_date: datetime | None = None
    delivery_note: str | None = None
    asset_type_id: UUID | None = None
    site_engineer_id: UUID | None = None
    qaqc_engineer_id: UUID | None = None
    status: DOCUMENT_STATUSES | None = None
    asset_ids: list[UUID] | None = None


class DocumentResponse(BaseModel):
    id: UUID
    project_id: UUID
    document_type: str
    reference_no: str
    revision_no: int
    title: str
    description: str | None
    discipline_id: UUID | None
    status: str
    site_engineer_id: UUID | None
    qaqc_engineer_id: UUID | None
    site_engineer_signed: bool
    qaqc_engineer_signed: bool
    current_approver_order: int | None
    submitted_date: datetime | None
    approved_date: datetime | None
    location: str | None
    floor_level: str | None
    rams_ref: str | None
    drawing_ref: str | None
    inspection_date: datetime | None
    delivery_note: str | None
    asset_type_id: UUID | None
    created_by: UUID | None
    updated_by: UUID | None
    created_at: datetime
    updated_at: datetime | None
    asset_ids: list[UUID] = []

    model_config = {"from_attributes": True}


# --- Document Approval ---

class DocumentApprovalCreate(BaseModel):
    project_approver_id: UUID
    approver_order: int


class DocumentApprovalResponse(BaseModel):
    id: UUID
    document_id: UUID
    approver_order: int
    project_approver_id: UUID
    status_id: UUID | None
    comments: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class ApprovalActionRequest(BaseModel):
    status_id: UUID
    comments: str | None = None
