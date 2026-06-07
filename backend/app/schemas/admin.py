from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, EmailStr


class UserAdminCreate(BaseModel):
    email: EmailStr
    password: str
    full_name: str
    designation_id: UUID | None = None
    is_active: bool = True
    role_ids: list[UUID] = []


class UserAdminUpdate(BaseModel):
    email: EmailStr | None = None
    full_name: str | None = None
    designation_id: UUID | None = None
    is_active: bool | None = None
    password: str | None = None
    role_ids: list[UUID] | None = None


class RoleResponse(BaseModel):
    id: UUID
    name: str
    description: str | None
    model_config = {"from_attributes": True}


class DesignationRef(BaseModel):
    id: UUID
    name: str
    model_config = {"from_attributes": True}


class UserAdminResponse(BaseModel):
    id: UUID
    email: str
    full_name: str
    designation_id: UUID | None = None
    designation: DesignationRef | None = None
    signature_text: str | None = None
    signature_font: str | None = None
    is_active: bool
    is_superuser: bool
    roles: list[RoleResponse] = []
    model_config = {"from_attributes": True}


class PermissionResponse(BaseModel):
    id: UUID
    code: str
    description: str | None
    model_config = {"from_attributes": True}


class RoleAdminResponse(BaseModel):
    id: UUID
    name: str
    description: str | None
    permissions: list[PermissionResponse] = []
    model_config = {"from_attributes": True}


class RoleCreate(BaseModel):
    name: str
    description: str | None = None
    permission_ids: list[UUID] = []


class RoleUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    permission_ids: list[UUID] | None = None


class PermissionCreate(BaseModel):
    code: str
    description: str | None = None


class PermissionUpdate(BaseModel):
    code: str | None = None
    description: str | None = None


class AuditUserRef(BaseModel):
    id: UUID
    full_name: str
    email: str
    model_config = {"from_attributes": True}


class AuditLogResponse(BaseModel):
    id: UUID
    timestamp: datetime
    user_id: UUID | None = None
    user: AuditUserRef | None = None
    action: str
    entity_type: str
    entity_id: UUID | None = None
    summary: str
    details: dict | None = None
    model_config = {"from_attributes": True}
