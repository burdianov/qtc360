"""Admin endpoints for Users, Roles, Permissions."""
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.deps import require_superuser
from app.core.security import hash_password
from app.models.user import User
from app.models.rbac import Role, Permission
from app.schemas.admin import (
    UserAdminCreate, UserAdminUpdate, UserAdminResponse,
    RoleCreate, RoleUpdate, RoleAdminResponse,
    PermissionCreate, PermissionUpdate, PermissionResponse,
)


router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_superuser)])


# --- Users ---
@router.get("/users", response_model=list[UserAdminResponse])
async def list_users(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.is_deleted == False).options(selectinload(User.roles)))  # noqa: E712
    return result.scalars().all()

@router.post("/users", response_model=UserAdminResponse, status_code=status.HTTP_201_CREATED)
async def create_user(body: UserAdminCreate, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Email already registered")
    user = User(email=body.email, hashed_password=hash_password(body.password), full_name=body.full_name, position=body.position, is_active=body.is_active, is_superuser=body.is_superuser, must_change_password=True, password_reset_at=datetime.now(timezone.utc))
    if body.role_ids:
        roles = (await db.execute(select(Role).where(Role.id.in_(body.role_ids)))).scalars().all()
        user.roles = list(roles)
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user

@router.patch("/users/{user_id}", response_model=UserAdminResponse)
async def update_user(user_id: UUID, body: UserAdminUpdate, db: AsyncSession = Depends(get_db)):
    user = (await db.execute(select(User).where(User.id == user_id, User.is_deleted == False).options(selectinload(User.roles)))).scalar_one_or_none()  # noqa: E712
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if body.email is not None:
        user.email = body.email
    if body.full_name is not None:
        user.full_name = body.full_name
    if body.position is not None:
        user.position = body.position
    if body.is_active is not None:
        user.is_active = body.is_active
    if body.is_superuser is not None:
        user.is_superuser = body.is_superuser
    if body.password is not None:
        user.hashed_password = hash_password(body.password)
        user.must_change_password = True
        user.password_reset_at = datetime.now(timezone.utc)
    if body.role_ids is not None:
        roles = (await db.execute(select(Role).where(Role.id.in_(body.role_ids)))).scalars().all()
        user.roles = list(roles)
    await db.commit()
    result = await db.execute(select(User).where(User.id == user_id).options(selectinload(User.roles)))
    return result.scalar_one()

@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(user_id: UUID, db: AsyncSession = Depends(get_db)):
    user = (await db.execute(select(User).where(User.id == user_id, User.is_deleted == False))).scalar_one_or_none()  # noqa: E712
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.is_deleted = True
    await db.commit()


# --- Roles ---
@router.get("/roles", response_model=list[RoleAdminResponse])
async def list_roles(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Role).where(Role.is_deleted == False).options(selectinload(Role.permissions)))  # noqa: E712
    return result.scalars().all()

@router.post("/roles", response_model=RoleAdminResponse, status_code=status.HTTP_201_CREATED)
async def create_role(body: RoleCreate, db: AsyncSession = Depends(get_db)):
    role = Role(name=body.name, description=body.description)
    if body.permission_ids:
        perms = (await db.execute(select(Permission).where(Permission.id.in_(body.permission_ids)))).scalars().all()
        role.permissions = list(perms)
    db.add(role)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Role already exists")
    await db.refresh(role)
    return role

@router.patch("/roles/{role_id}", response_model=RoleAdminResponse)
async def update_role(role_id: UUID, body: RoleUpdate, db: AsyncSession = Depends(get_db)):
    role = (await db.execute(select(Role).where(Role.id == role_id, Role.is_deleted == False))).scalar_one_or_none()  # noqa: E712
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    if body.name is not None:
        role.name = body.name
    if body.description is not None:
        role.description = body.description
    if body.permission_ids is not None:
        perms = (await db.execute(select(Permission).where(Permission.id.in_(body.permission_ids)))).scalars().all()
        role.permissions = list(perms)
    await db.commit()
    await db.refresh(role)
    return role

@router.delete("/roles/{role_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_role(role_id: UUID, db: AsyncSession = Depends(get_db)):
    role = (await db.execute(select(Role).where(Role.id == role_id, Role.is_deleted == False))).scalar_one_or_none()  # noqa: E712
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    role.is_deleted = True
    await db.commit()


# --- Permissions ---
@router.get("/permissions", response_model=list[PermissionResponse])
async def list_permissions(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Permission).where(Permission.is_deleted == False))  # noqa: E712
    return result.scalars().all()

@router.post("/permissions", response_model=PermissionResponse, status_code=status.HTTP_201_CREATED)
async def create_permission(body: PermissionCreate, db: AsyncSession = Depends(get_db)):
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
async def update_permission(perm_id: UUID, body: PermissionUpdate, db: AsyncSession = Depends(get_db)):
    perm = (await db.execute(select(Permission).where(Permission.id == perm_id, Permission.is_deleted == False))).scalar_one_or_none()  # noqa: E712
    if not perm:
        raise HTTPException(status_code=404, detail="Permission not found")
    if body.code is not None:
        perm.code = body.code
    if body.description is not None:
        perm.description = body.description
    await db.commit()
    await db.refresh(perm)
    return perm

@router.delete("/permissions/{perm_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_permission(perm_id: UUID, db: AsyncSession = Depends(get_db)):
    perm = (await db.execute(select(Permission).where(Permission.id == perm_id, Permission.is_deleted == False))).scalar_one_or_none()  # noqa: E712
    if not perm:
        raise HTTPException(status_code=404, detail="Permission not found")
    perm.is_deleted = True
    await db.commit()
