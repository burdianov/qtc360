from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.deps import get_current_user, require_superuser
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    validate_password,
    verify_password,
)
from app.core.types import MAX_SIGNATURE_IMAGE_BYTES
from app.models.user import User
from app.schemas.auth import (
    ChangePasswordRequest,
    LoginRequest,
    LoginResponse,
    ProjectSummaryResponse,
    RefreshRequest,
    RegisterRequest,
    TokenResponse,
    UserResponse,
)

router = APIRouter(prefix="/auth", tags=["auth"])


def _ver(user: User) -> int:
    return int(user.token_version or 0)


@router.post(
    "/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED
)
async def register(
    body: RegisterRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_superuser),
):
    validate_password(body.password)
    existing = await db.execute(
        select(User).where(User.email == body.email, User.is_deleted.is_(False))
    )  # noqa: E712
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Email already registered"
        )
    user = User(
        email=body.email,
        hashed_password=hash_password(body.password),
        full_name=body.full_name,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@router.post("/login", response_model=LoginResponse)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(User).where(User.email == body.email, User.is_deleted.is_(False))
    )  # noqa: E712
    user = result.scalar_one_or_none()
    if not user or not verify_password(body.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials"
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Account disabled"
        )
    if user.must_change_password and user.password_reset_at:
        if datetime.now(timezone.utc) - user.password_reset_at > timedelta(hours=1):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Temporary password expired. Please contact your administrator.",
            )
    return LoginResponse(
        access_token=create_access_token(str(user.id), token_version=_ver(user)),
        refresh_token=create_refresh_token(str(user.id), token_version=_ver(user)),
        must_change_password=user.must_change_password,
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh(body: RefreshRequest, db: AsyncSession = Depends(get_db)):
    payload = decode_token(body.refresh_token)
    if not payload or payload.get("type") != "refresh":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token"
        )
    result = await db.execute(
        select(User).where(User.id == payload["sub"], User.is_deleted.is_(False))
    )  # noqa: E712
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found"
        )
    if int(payload.get("ver", 0) or 0) != _ver(user):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Token revoked"
        )
    return TokenResponse(
        access_token=create_access_token(str(user.id), token_version=_ver(user)),
        refresh_token=create_refresh_token(str(user.id), token_version=_ver(user)),
    )


@router.post("/change-password")
async def change_password(
    body: ChangePasswordRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not verify_password(body.current_password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect",
        )
    validate_password(body.new_password)
    user.hashed_password = hash_password(body.new_password)
    user.must_change_password = False
    user.password_reset_at = None
    user.token_version = (user.token_version or 0) + 1  # invalidate outstanding tokens
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not change password",
        )
    new_access = create_access_token(str(user.id), token_version=_ver(user))
    new_refresh = create_refresh_token(str(user.id), token_version=_ver(user))
    return {
        "detail": "Password changed successfully",
        "access_token": new_access,
        "refresh_token": new_refresh,
    }


@router.get("/me", response_model=UserResponse)
async def me(user: User = Depends(get_current_user)):
    perms = set()
    for role in user.roles:
        for perm in role.permissions:
            perms.add(perm.code)
    return {
        **{c.name: getattr(user, c.name) for c in user.__table__.columns},
        "designation": user.designation,
        "roles": user.roles,
        "permissions": sorted(perms),
    }


@router.get("/users")
async def list_users_basic(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """List active users for dropdowns/selectors. Limited to users sharing at least one
    project with the caller, unless the caller is an admin/super_admin/superuser."""
    from app.models.user import user_projects

    role_names = {r.name for r in user.roles}
    is_privileged = (
        user.is_superuser or "admin" in role_names or "super_admin" in role_names
    )

    base = (
        select(User)
        .where(User.is_deleted.is_(False), User.is_active)
        .options(  # noqa: E712
            selectinload(User.designation), selectinload(User.projects)
        )
    )
    if not is_privileged:
        my_project_ids = {p.id for p in user.projects}
        if not my_project_ids:
            return []
        # Filter at the SQL level: only users who share at least one project.
        base = base.where(
            User.id.in_(
                select(user_projects.c.user_id).where(
                    user_projects.c.project_id.in_(my_project_ids)
                )
            )
        )
    result = await db.execute(base)
    users = result.scalars().all()
    return [
        {
            "id": str(u.id),
            "full_name": u.full_name,
            "email": u.email,
            "designation": {"id": str(u.designation.id), "name": u.designation.name}
            if u.designation
            else None,
            "signature_font": u.signature_font,
            "signature_text": u.signature_text,
            "has_signature": bool(u.signature_path),
        }
        for u in users
    ]


@router.patch("/me")
async def update_me(
    body: dict,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Update current user preferences (e.g. signature_font, signature_text)."""
    allowed = {"signature_font", "signature_text"}
    for k, v in body.items():
        if k in allowed:
            setattr(user, k, v)
    await db.commit()
    return {"status": "ok"}


@router.post("/me/signature")
async def upload_signature(
    file: UploadFile,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Upload a PNG signature image for the current user."""
    if not file.content_type or not file.content_type.startswith("image/png"):
        raise HTTPException(status_code=400, detail="Only PNG files are accepted")
    data = await file.read()
    if len(data) > MAX_SIGNATURE_IMAGE_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"File too large (max {MAX_SIGNATURE_IMAGE_BYTES // (1024 * 1024)}MB)",
        )
    from app.services.storage import storage

    key = f"signatures/{user.id}.png"
    storage.save(key, data)
    user.signature_path = key
    await db.commit()
    return {"signature_path": key}


@router.delete("/me/signature")
async def delete_signature(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Delete the current user's uploaded signature."""
    if user.signature_path:
        from app.services.storage import storage

        storage.delete(user.signature_path)
        user.signature_path = None
        await db.commit()
    return {"status": "ok"}


@router.get("/users/{user_id}/signature")
async def get_user_signature(
    user_id: str,
    _: User = Depends(get_current_user),
):
    """Serve a user's signature PNG."""
    from app.services.storage import storage
    from app.core.config import settings

    key = f"signatures/{user_id}.png"
    if not storage.exists(key):
        raise HTTPException(status_code=404, detail="No signature uploaded")
    path = settings.upload_dir_abs / key
    return FileResponse(path, media_type="image/png")


@router.get("/me/projects", response_model=list[ProjectSummaryResponse])
async def my_projects(user: User = Depends(get_current_user)):
    return [{"id": p.id, "name": p.name, "code": p.code} for p in user.projects]


# --- Signature Delegations ---


@router.get("/me/delegations")
async def list_delegations(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """List users I have granted signing rights to."""
    from app.models.signature_delegation import SignatureDelegation

    result = await db.execute(
        select(SignatureDelegation)
        .where(
            SignatureDelegation.grantor_id == user.id,
            not SignatureDelegation.is_deleted,
        )  # noqa: E712
        .options(selectinload(SignatureDelegation.delegate))
    )
    return [
        {
            "id": str(d.id),
            "delegate_id": str(d.delegate_id),
            "delegate_name": d.delegate.full_name,
        }
        for d in result.scalars().all()
    ]


@router.post("/me/delegations")
async def grant_delegation(
    body: dict,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Grant signing rights to another user."""
    from app.models.signature_delegation import SignatureDelegation
    from uuid import UUID as _UUID

    delegate_id = body.get("delegate_id")
    if not delegate_id:
        raise HTTPException(status_code=400, detail="delegate_id required")
    if str(delegate_id) == str(user.id):
        raise HTTPException(status_code=400, detail="Cannot delegate to yourself")
    try:
        delegate_uuid = _UUID(str(delegate_id))
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Invalid delegate_id")
    # Check if already exists
    existing = await db.execute(
        select(SignatureDelegation).where(
            SignatureDelegation.grantor_id == user.id,
            SignatureDelegation.delegate_id == delegate_uuid,
            SignatureDelegation.is_deleted == False,  # noqa: E712
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Delegation already exists")
    delegation = SignatureDelegation(grantor_id=user.id, delegate_id=delegate_uuid)
    db.add(delegation)
    await db.commit()
    return {"status": "ok", "id": str(delegation.id)}


@router.delete("/me/delegations/{delegation_id}")
async def revoke_delegation(
    delegation_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Revoke a signing delegation."""
    from app.models.signature_delegation import SignatureDelegation

    result = await db.execute(
        select(SignatureDelegation).where(
            SignatureDelegation.id == delegation_id,
            SignatureDelegation.grantor_id == user.id,
            SignatureDelegation.is_deleted == False,  # noqa: E712
        )
    )
    delegation = result.scalar_one_or_none()
    if not delegation:
        raise HTTPException(status_code=404, detail="Delegation not found")
    delegation.is_deleted = True
    await db.commit()
    return {"status": "ok"}


@router.get("/me/delegated-by")
async def list_delegated_by(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """List users who have granted me signing rights."""
    from app.models.signature_delegation import SignatureDelegation

    result = await db.execute(
        select(SignatureDelegation)
        .where(
            SignatureDelegation.delegate_id == user.id,
            not SignatureDelegation.is_deleted,
        )  # noqa: E712
        .options(selectinload(SignatureDelegation.grantor))
    )
    return [
        {
            "grantor_id": str(d.grantor_id),
            "grantor_name": d.grantor.full_name,
            "has_signature": bool(d.grantor.signature_path),
        }
        for d in result.scalars().all()
    ]


# --- User Preferences (column orders, etc.) ---


@router.get("/me/preferences")
async def get_preferences(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from app.models.user_preference import UserPreference

    result = await db.execute(
        select(UserPreference).where(
            UserPreference.user_id == user.id, not UserPreference.is_deleted
        )  # noqa: E712
    )
    return {p.key: p.value for p in result.scalars().all()}


@router.put("/me/preferences/{key}")
async def set_preference(
    key: str,
    body: dict,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from app.models.user_preference import UserPreference
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    stmt = (
        pg_insert(UserPreference.__table__)
        .values(user_id=user.id, key=key, value=body.get("value", body))
        .on_conflict_do_update(
            constraint="uq_user_preference_key",
            set_={"value": body.get("value", body), "is_deleted": False},
        )
    )
    try:
        await db.execute(stmt)
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not save preference",
        )
    return {"status": "ok"}
