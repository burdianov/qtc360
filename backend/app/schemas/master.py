import uuid
from datetime import date, datetime

from pydantic import BaseModel


# --- Client ---
class ClientCreate(BaseModel):
    name: str
    code: str

class ClientUpdate(BaseModel):
    name: str | None = None
    code: str | None = None

class ClientResponse(BaseModel):
    id: uuid.UUID
    name: str
    code: str
    created_at: datetime
    model_config = {"from_attributes": True}


# --- ApproverTitle ---
class ApproverTitleCreate(BaseModel):
    code: str
    title: str

class ApproverTitleUpdate(BaseModel):
    code: str | None = None
    title: str | None = None

class ApproverTitleResponse(BaseModel):
    id: uuid.UUID
    code: str
    title: str
    model_config = {"from_attributes": True}


# --- Approver ---
class ApproverCreate(BaseModel):
    name: str
    code: str
    title_id: uuid.UUID

class ApproverUpdate(BaseModel):
    name: str | None = None
    code: str | None = None
    title_id: uuid.UUID | None = None

class ApproverResponse(BaseModel):
    id: uuid.UUID
    name: str
    code: str
    title: ApproverTitleResponse | None = None
    created_at: datetime
    model_config = {"from_attributes": True}


# --- Project ---
class ProjectCreate(BaseModel):
    name: str
    code: str
    external_code: str | None = None
    description: str | None = None
    status: str = "active"
    start_date: date | None = None
    end_date: date | None = None
    client_id: uuid.UUID | None = None

class ProjectUpdate(BaseModel):
    name: str | None = None
    code: str | None = None
    external_code: str | None = None
    description: str | None = None
    status: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    client_id: uuid.UUID | None = None

class ProjectResponse(BaseModel):
    id: uuid.UUID
    name: str
    code: str
    external_code: str | None = None
    description: str | None
    status: str
    start_date: date | None
    end_date: date | None
    client: ClientResponse | None = None
    created_at: datetime
    model_config = {"from_attributes": True}


# --- ProjectApprover ---
class ProjectApproverCreate(BaseModel):
    project_id: uuid.UUID
    approver_id: uuid.UUID
    approver_title_id: uuid.UUID

class ProjectApproverUpdate(BaseModel):
    project_id: uuid.UUID | None = None
    approver_id: uuid.UUID | None = None
    approver_title_id: uuid.UUID | None = None

class ProjectApproverResponse(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    approver: ApproverResponse
    approver_title: ApproverTitleResponse
    model_config = {"from_attributes": True}


# --- Discipline ---
class DisciplineCreate(BaseModel):
    name: str
    code: str
    project_id: uuid.UUID

class DisciplineUpdate(BaseModel):
    name: str | None = None
    code: str | None = None

class DisciplineResponse(BaseModel):
    id: uuid.UUID
    name: str
    code: str
    project_id: uuid.UUID
    created_at: datetime
    model_config = {"from_attributes": True}


# --- Service ---
class ServiceCreate(BaseModel):
    name: str
    code: str
    discipline_id: uuid.UUID

class ServiceUpdate(BaseModel):
    name: str | None = None
    code: str | None = None
    discipline_id: uuid.UUID | None = None

class ServiceResponse(BaseModel):
    id: uuid.UUID
    name: str
    code: str
    discipline_id: uuid.UUID
    created_at: datetime
    model_config = {"from_attributes": True}


# --- AssetType ---
class AssetTypeCreate(BaseModel):
    name: str
    code: str
    service_id: uuid.UUID
    parent_type_id: uuid.UUID | None = None

class AssetTypeUpdate(BaseModel):
    name: str | None = None
    code: str | None = None
    service_id: uuid.UUID | None = None
    parent_type_id: uuid.UUID | None = None

class AssetTypeResponse(BaseModel):
    id: uuid.UUID
    name: str
    code: str
    service_id: uuid.UUID
    parent_type_id: uuid.UUID | None
    created_at: datetime
    model_config = {"from_attributes": True}


# --- Asset ---
class AssetCreate(BaseModel):
    name: str
    tag_number: str
    asset_type_id: uuid.UUID
    location: str | None = None
    status: str = "pending"

class AssetUpdate(BaseModel):
    name: str | None = None
    tag_number: str | None = None
    asset_type_id: uuid.UUID | None = None
    location: str | None = None
    status: str | None = None

class AssetResponse(BaseModel):
    id: uuid.UUID
    name: str
    tag_number: str
    asset_type_id: uuid.UUID
    location: str | None
    status: str
    created_at: datetime
    model_config = {"from_attributes": True}


# --- System ---
class SystemCreate(BaseModel):
    name: str
    code: str
    description: str | None = None
    project_id: uuid.UUID

class SystemUpdate(BaseModel):
    name: str | None = None
    code: str | None = None
    description: str | None = None

class SystemResponse(BaseModel):
    id: uuid.UUID
    name: str
    code: str
    description: str | None
    project_id: uuid.UUID
    created_at: datetime
    model_config = {"from_attributes": True}


# --- Contractor ---
class ContractorCreate(BaseModel):
    name: str
    code: str
    project_id: uuid.UUID

class ContractorUpdate(BaseModel):
    name: str | None = None
    code: str | None = None

class ContractorResponse(BaseModel):
    id: uuid.UUID
    name: str
    code: str
    project_id: uuid.UUID
    created_at: datetime
    model_config = {"from_attributes": True}


# --- ApprovalStatus ---
class ApprovalStatusCreate(BaseModel):
    project_id: uuid.UUID
    letter: str
    name: str
    description: str
    action: str

class ApprovalStatusUpdate(BaseModel):
    letter: str | None = None
    name: str | None = None
    description: str | None = None
    action: str | None = None

class ApprovalStatusResponse(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    letter: str
    name: str
    description: str
    action: str
    created_at: datetime
    model_config = {"from_attributes": True}
