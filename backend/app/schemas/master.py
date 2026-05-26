import uuid
from datetime import date, datetime

from pydantic import BaseModel


# --- Client ---
class ClientCreate(BaseModel):
    name: str
    code: str

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
    description: str | None = None
    status: str = "active"
    start_date: date | None = None
    end_date: date | None = None
    client_id: uuid.UUID | None = None

class ProjectResponse(BaseModel):
    id: uuid.UUID
    name: str
    code: str
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

class AssetResponse(BaseModel):
    id: uuid.UUID
    name: str
    tag_number: str
    asset_type_id: uuid.UUID
    location: str | None
    status: str
    created_at: datetime
    model_config = {"from_attributes": True}
