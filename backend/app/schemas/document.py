from datetime import date, datetime
from typing import Literal
from uuid import UUID
from pydantic import computed_field

from pydantic import BaseModel, Field

from app.core.types import MAX_APPROVERS

DOCUMENT_TYPES = Literal["FAT", "MIR", "WIR", "CIR", "CRS"]
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
REQUIREMENT_STATUSES = Literal[
    "not_started", "submitted", "partial", "achieved", "rejected", "not_applicable"
]
TAG_TARGET_STATUSES = Literal[
    "not_started", "in_progress", "achieved", "delayed", "at_risk"
]
TAG_CODES = Literal["red", "yellow", "green", "blue"]

# State machine for the external approval workflow.
# Document `status` reflects current chain position; the per-round decision
# letter (A/B/C/D) is stored on DocumentApprovalRound, not here.
VALID_STATUS_TRANSITIONS: dict[str, set[str]] = {
    "draft": {"internally_signed", "cancelled"},
    "internally_signed": {"with_approver_1", "draft", "cancelled"},
    "with_approver_1": {"approver_1_returned", "rejected", "approved", "cancelled"},
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
    # Strict: reject any field not listed below. This is how we enforce
    # that the client cannot smuggle a reference_no into a POST.
    model_config = {"extra": "forbid"}

    project_id: UUID
    document_type: DOCUMENT_TYPES
    # reference_no is intentionally NOT here. It is allocated server-side at
    # the moment of save so the per-(project, doc_type, discipline) counter
    # can be locked atomically. The client never sends or previews a ref.
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
    material_submittals: str | None = None
    qty: str | None = None
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
    # Revision: if set, creates a new revision of the rejected document
    revision_of_id: UUID | None = None
    # CRS data
    crs_data: dict | None = None


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
    material_submittals: str | None = None
    qty: str | None = None
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
    crs_data: dict | None = None


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
    material_submittals: str | None
    qty: str | None
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
    crs_data: dict | None = None

    @computed_field
    def full_reference_no(self) -> str:
        ref = self.reference_no or "document"
        rev = int(self.revision_no or 0)
        return f"{ref}_{rev:02d}"

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
    # PR2: per-stage file metadata
    submitted_file_path: str | None = None
    submitted_file_size: int | None = None
    returned_file_path: str | None = None
    returned_file_name: str | None = None
    returned_file_locked: bool = False
    remarks_file_path: str | None = None
    remarks_file_name: str | None = None
    aconex_submitted_date: date | None = None
    aconex_received_date: date | None = None
    aconex_reference_number: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class SubmitToApproverRequest(BaseModel):
    approver_order: int = Field(..., ge=1, le=MAX_APPROVERS)
    aconex_submitted_date: str | None = None  # ISO date yyyy-MM-dd
    password: str | None = Field(
        None,
        max_length=255,
        description="Required only for round >= 2 when the previous R is password-protected",
    )


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
