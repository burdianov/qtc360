from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


# --- Document ---

class DocumentCreate(BaseModel):
    project_id: UUID
    doc_type: str  # MIR, WIR, CIR
    number: str
    title: str
    description: str | None = None
    discipline_id: UUID | None = None
    # MIR
    delivery_note: str | None = None
    is_milestone_delivery: bool | None = None
    # WIR
    activity_id: UUID | None = None
    sub_activity_id: UUID | None = None
    is_milestone_activity: bool | None = None
    # CIR
    test_id: UUID | None = None
    is_milestone_test: bool | None = None
    # Assets
    asset_ids: list[UUID] = []


class DocumentUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    discipline_id: UUID | None = None
    delivery_note: str | None = None
    is_milestone_delivery: bool | None = None
    activity_id: UUID | None = None
    sub_activity_id: UUID | None = None
    is_milestone_activity: bool | None = None
    test_id: UUID | None = None
    is_milestone_test: bool | None = None
    asset_ids: list[UUID] | None = None


class DocumentResponse(BaseModel):
    id: UUID
    project_id: UUID
    doc_type: str
    number: str
    revision: int
    title: str
    description: str | None
    discipline_id: UUID | None
    status: str
    site_engineer_id: UUID | None
    qaqc_engineer_id: UUID | None
    signed_at: datetime | None
    current_approver_order: int | None
    submitted_at: datetime | None
    closed_at: datetime | None
    delivery_note: str | None
    is_milestone_delivery: bool | None
    activity_id: UUID | None
    sub_activity_id: UUID | None
    is_milestone_activity: bool | None
    test_id: UUID | None
    is_milestone_test: bool | None
    created_at: datetime

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


# --- FAT ---

class FATCreate(BaseModel):
    project_id: UUID
    reference: str
    title: str
    description: str | None = None
    asset_type_id: UUID
    asset_ids: list[UUID] = []


class FATUpdate(BaseModel):
    reference: str | None = None
    title: str | None = None
    description: str | None = None
    asset_type_id: UUID | None = None
    status: str | None = None
    asset_ids: list[UUID] | None = None


class FATResponse(BaseModel):
    id: UUID
    project_id: UUID
    reference: str
    title: str
    description: str | None
    asset_type_id: UUID
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}
