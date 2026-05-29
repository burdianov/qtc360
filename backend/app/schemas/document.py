from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel

DOCUMENT_TYPES = Literal["FAT", "MIR", "WIR", "CIR"]
DOCUMENT_STATUSES = Literal[
    "draft",
    "internally_signed",
    "with_approver_1",
    "approver_1_returned",
    "with_approver_2",
    "approved",
    "approved_with_comments",
    "rejected",
    "cancelled",
    "superseded",
]
APPROVAL_ACTIONS = Literal["approved", "approved_with_comments", "rejected"]
REQUIREMENT_STATUSES = Literal["not_started", "submitted", "partial", "achieved", "rejected", "not_applicable"]
TAG_TARGET_STATUSES = Literal["not_started", "in_progress", "achieved", "delayed", "at_risk"]
TAG_CODES = Literal["red", "yellow", "green", "blue"]

# State machine for the external approval workflow.
# Document `status` reflects current chain position; the per-round decision
# letter (A/B/C/D) is stored on DocumentApprovalRound, not here.
VALID_STATUS_TRANSITIONS: dict[str, set[str]] = {
    "draft": {"internally_signed", "cancelled"},
    "internally_signed": {"with_approver_1", "draft", "cancelled"},
    "with_approver_1": {"approver_1_returned", "cancelled"},
    "approver_1_returned": {
        "with_approver_2",
        "approved",
        "approved_with_comments",
        "rejected",
        "cancelled",
    },
    "with_approver_2": {"approved", "approved_with_comments", "rejected", "cancelled"},
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
    remarks_1: str | None = None
    remarks_2: str | None = None
    inspector_date_1: str | None = None
    inspector_time_1: str | None = None
    inspector_date_2: str | None = None
    inspector_time_2: str | None = None
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
    remarks_1: str | None = None
    remarks_2: str | None = None
    inspector_date_1: str | None = None
    inspector_time_1: str | None = None
    inspector_date_2: str | None = None
    inspector_time_2: str | None = None
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
    remarks_1: str | None
    remarks_2: str | None
    inspector_date_1: str | None
    inspector_time_1: str | None
    inspector_date_2: str | None
    inspector_time_2: str | None
    created_by: UUID | None
    updated_by: UUID | None
    created_at: datetime
    updated_at: datetime | None
    asset_ids: list[UUID] = []

    model_config = {"from_attributes": True}


# --- Document Approval Round ---

class DocumentApprovalRoundResponse(BaseModel):
    id: UUID
    document_id: UUID
    approver_order: int
    round_no: int
    project_approver_id: UUID
    decision_status_id: UUID | None
    signatory_name: str | None
    comments: str | None
    submitted_at: datetime | None
    returned_at: datetime | None
    response_date: datetime | None
    response_time: str | None
    returned_file_name: str | None
    remarks_file_name: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class SubmitToApproverRequest(BaseModel):
    approver_order: int
    submitted_at: datetime | None = None  # defaults to now() server-side
    notes: str | None = None


class RecordApprovalResponseRequest(BaseModel):
    approver_order: int
    decision_status_id: UUID
    signatory_name: str
    response_date: datetime
    comments: str | None = None


class OCRExtractRequest(BaseModel):
    page: int  # 1-indexed
    bbox: list[float]  # [x, y, width, height] in PDF user-space coords
    target_field: Literal["signatory_name", "response_date", "comments"]
    force_ocr: bool = False  # skip native text, go straight to Tesseract


class OCRExtractResponse(BaseModel):
    text: str
    via: Literal["native", "ocr"]
