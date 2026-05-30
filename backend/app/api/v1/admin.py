"""Admin endpoints for Users, Roles, Permissions, Audit Logs."""
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.deps import get_current_user, require_admin, require_superuser
from app.core.security import hash_password, validate_password
from app.models.user import User
from app.models.rbac import Role, Permission, user_roles, role_permissions
from app.models.audit_log import AuditLog
from app.services.audit import record_audit
from app.schemas.admin import (
    UserAdminCreate, UserAdminUpdate, UserAdminResponse,
    RoleCreate, RoleUpdate, RoleAdminResponse,
    PermissionCreate, PermissionUpdate, PermissionResponse,
    AuditLogResponse,
)


router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


def _is_super(user: User) -> bool:
    return user.is_superuser or any(r.name == "super_admin" for r in user.roles)


# --- Users ---
@router.get("/users", response_model=list[UserAdminResponse])
async def list_users(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.is_deleted == False).options(selectinload(User.roles), selectinload(User.designation)))  # noqa: E712
    return result.scalars().all()

@router.post("/users", response_model=UserAdminResponse, status_code=status.HTTP_201_CREATED)
async def create_user(body: UserAdminCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    validate_password(body.password)
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Email already registered")
    if body.role_ids:
        roles = (await db.execute(select(Role).where(Role.id.in_(body.role_ids), Role.is_deleted == False))).scalars().all()  # noqa: E712
        if any(r.name == "super_admin" for r in roles) and not _is_super(current_user):
            raise HTTPException(status_code=403, detail="Only super_admin can assign the super_admin role")
    else:
        roles = []
    user = User(email=body.email, hashed_password=hash_password(body.password), full_name=body.full_name, designation_id=body.designation_id, is_active=body.is_active, is_superuser=False, must_change_password=True, password_reset_at=datetime.now(timezone.utc))
    user.roles = list(roles)
    db.add(user)
    await db.flush()
    await record_audit(db, user_id=current_user.id, action="create", entity_type="user", entity_id=user.id, summary=f"Created user '{user.full_name}' ({user.email})")
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Email already registered")
    await db.refresh(user)
    return user

@router.patch("/users/{user_id}", response_model=UserAdminResponse)
async def update_user(user_id: UUID, body: UserAdminUpdate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    user = (await db.execute(select(User).where(User.id == user_id, User.is_deleted == False).options(selectinload(User.roles), selectinload(User.designation)))).scalar_one_or_none()  # noqa: E712
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    # Block non-super_admin from modifying a super_admin / superuser.
    target_is_super = user.is_superuser or any(r.name == "super_admin" for r in user.roles)
    if target_is_super and not _is_super(current_user):
        raise HTTPException(status_code=403, detail="Only super_admin can modify a super_admin user")
    if body.email is not None:
        user.email = body.email
    if body.full_name is not None:
        user.full_name = body.full_name
    if body.designation_id is not None:
        user.designation_id = body.designation_id
    if body.is_active is not None:
        user.is_active = body.is_active
    if body.password is not None:
        validate_password(body.password)
        user.hashed_password = hash_password(body.password)
        user.must_change_password = True
        user.password_reset_at = datetime.now(timezone.utc)
        user.token_version = (user.token_version or 0) + 1  # invalidate outstanding tokens
    if body.role_ids is not None:
        roles = (await db.execute(select(Role).where(Role.id.in_(body.role_ids), Role.is_deleted == False))).scalars().all()  # noqa: E712
        if any(r.name == "super_admin" for r in roles) and not _is_super(current_user):
            raise HTTPException(status_code=403, detail="Only super_admin can assign the super_admin role")
        user.roles = list(roles)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Email already in use")
    result = await db.execute(select(User).where(User.id == user_id).options(selectinload(User.roles), selectinload(User.designation)))
    return result.scalar_one()

@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(user_id: UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    user = (await db.execute(select(User).where(User.id == user_id, User.is_deleted == False).options(selectinload(User.roles)))).scalar_one_or_none()  # noqa: E712
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    target_is_super = user.is_superuser or any(r.name == "super_admin" for r in user.roles)
    if target_is_super and not _is_super(current_user):
        raise HTTPException(status_code=403, detail="Only super_admin can delete a super_admin user")
    user.is_deleted = True
    user.is_active = False
    user.token_version = (user.token_version or 0) + 1  # kill any sessions
    # Cascade-clear association table rows so revocation isn't dependent on cache TTL.
    from app.models.user import user_projects
    await db.execute(user_roles.delete().where(user_roles.c.user_id == user_id))
    await db.execute(user_projects.delete().where(user_projects.c.user_id == user_id))
    await record_audit(db, user_id=current_user.id, action="delete", entity_type="user", entity_id=user.id, summary=f"Deleted user '{user.full_name}' ({user.email})")
    await db.commit()


# --- Roles ---
@router.get("/roles", response_model=list[RoleAdminResponse])
async def list_roles(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Role).where(Role.is_deleted == False).options(selectinload(Role.permissions)))  # noqa: E712
    return result.scalars().all()

@router.post("/roles", response_model=RoleAdminResponse, status_code=status.HTTP_201_CREATED)
async def create_role(body: RoleCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    role = Role(name=body.name, description=body.description)
    if body.permission_ids:
        perms = (await db.execute(select(Permission).where(Permission.id.in_(body.permission_ids), Permission.is_deleted == False))).scalars().all()  # noqa: E712
        role.permissions = list(perms)
    db.add(role)
    await db.flush()
    await record_audit(db, user_id=current_user.id, action="create", entity_type="role", entity_id=role.id, summary=f"Created role '{role.name}'")
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Role already exists")
    await db.refresh(role)
    return role

@router.patch("/roles/{role_id}", response_model=RoleAdminResponse)
async def update_role(role_id: UUID, body: RoleUpdate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    role = (await db.execute(select(Role).where(Role.id == role_id, Role.is_deleted == False))).scalar_one_or_none()  # noqa: E712
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    if role.name == "super_admin" and not _is_super(current_user):
        raise HTTPException(status_code=403, detail="Only super_admin can modify the super_admin role")
    if body.name is not None:
        role.name = body.name
    if body.description is not None:
        role.description = body.description
    if body.permission_ids is not None:
        perms = (await db.execute(select(Permission).where(Permission.id.in_(body.permission_ids), Permission.is_deleted == False))).scalars().all()  # noqa: E712
        role.permissions = list(perms)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Role name already in use")
    await db.refresh(role)
    return role

@router.delete("/roles/{role_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_role(role_id: UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    role = (await db.execute(select(Role).where(Role.id == role_id, Role.is_deleted == False))).scalar_one_or_none()  # noqa: E712
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    if role.name in {"super_admin", "admin"}:
        raise HTTPException(status_code=400, detail=f"Cannot delete the built-in '{role.name}' role")
    role.is_deleted = True
    # Cascade-clear association rows so revoked roles drop out of the user's permission set.
    await db.execute(user_roles.delete().where(user_roles.c.role_id == role_id))
    await db.execute(role_permissions.delete().where(role_permissions.c.role_id == role_id))
    await record_audit(db, user_id=current_user.id, action="delete", entity_type="role", entity_id=role.id, summary=f"Deleted role '{role.name}'")
    await db.commit()


# --- Permissions ---
@router.get("/permissions", response_model=list[PermissionResponse])
async def list_permissions(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Permission).where(Permission.is_deleted == False))  # noqa: E712
    return result.scalars().all()

@router.post("/permissions", response_model=PermissionResponse, status_code=status.HTTP_201_CREATED)
async def create_permission(body: PermissionCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_superuser)):
    perm = Permission(code=body.code, description=body.description)
    db.add(perm)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Permission already exists")
    await db.refresh(perm)
    return perm

@router.patch("/permissions/{perm_id}", response_model=PermissionResponse)
async def update_permission(perm_id: UUID, body: PermissionUpdate, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_superuser)):
    perm = (await db.execute(select(Permission).where(Permission.id == perm_id, Permission.is_deleted == False))).scalar_one_or_none()  # noqa: E712
    if not perm:
        raise HTTPException(status_code=404, detail="Permission not found")
    if body.code is not None:
        perm.code = body.code
    if body.description is not None:
        perm.description = body.description
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Permission code already in use")
    await db.refresh(perm)
    return perm

@router.delete("/permissions/{perm_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_permission(perm_id: UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_superuser)):
    perm = (await db.execute(select(Permission).where(Permission.id == perm_id, Permission.is_deleted == False))).scalar_one_or_none()  # noqa: E712
    if not perm:
        raise HTTPException(status_code=404, detail="Permission not found")
    perm.is_deleted = True
    await db.execute(role_permissions.delete().where(role_permissions.c.permission_id == perm_id))
    await db.commit()



# --- Audit Logs ---
@router.get("/audit-logs", response_model=list[AuditLogResponse])
async def list_audit_logs(
    action: str | None = None,
    entity_type: str | None = None,
    limit: int = Query(default=100, le=500),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    # Tie-break by id so paging is deterministic when timestamps tie.
    q = select(AuditLog).options(selectinload(AuditLog.user)).order_by(AuditLog.timestamp.desc(), AuditLog.id.desc())
    if action:
        q = q.where(AuditLog.action == action)
    if entity_type:
        q = q.where(AuditLog.entity_type == entity_type)
    q = q.offset(offset).limit(limit)
    result = await db.execute(q)
    return result.scalars().all()


# --- App Settings ---
from app.models.app_setting import AppSetting


@router.get("/settings/{key}")
async def get_setting(
    key: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(select(AppSetting).where(AppSetting.key == key, AppSetting.is_deleted == False))  # noqa: E712
    item = result.scalar_one_or_none()
    if not item:
        # Return defaults
        defaults = {"date_format": "DD.MM.YYYY", "asset_custom_fields": '[{"id":"field_1","label":"POD"}]'}
        return {"key": key, "value": defaults.get(key, "")}
    return {"key": item.key, "value": item.value}


@router.put("/settings/{key}")
async def set_setting(
    key: str,
    body: dict,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    value = body.get("value", "")
    result = await db.execute(select(AppSetting).where(AppSetting.key == key))
    item = result.scalar_one_or_none()
    if item:
        item.value = value
        item.is_deleted = False
    else:
        db.add(AppSetting(key=key, value=value))
    await db.commit()
    return {"key": key, "value": value}
