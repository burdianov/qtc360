from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

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


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def register(
    body: RegisterRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_superuser),
):
    validate_password(body.password)
    existing = await db.execute(select(User).where(User.email == body.email, User.is_deleted == False))  # noqa: E712
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")
    user = User(email=body.email, hashed_password=hash_password(body.password), full_name=body.full_name)
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@router.post("/login", response_model=LoginResponse)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == body.email, User.is_deleted == False))  # noqa: E712
    user = result.scalar_one_or_none()
    if not user or not verify_password(body.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account disabled")
    if user.must_change_password and user.password_reset_at:
        if datetime.now(timezone.utc) - user.password_reset_at > timedelta(hours=1):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Temporary password expired. Please contact your administrator.")
    return LoginResponse(
        access_token=create_access_token(str(user.id)),
        refresh_token=create_refresh_token(str(user.id)),
        must_change_password=user.must_change_password,
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh(body: RefreshRequest, db: AsyncSession = Depends(get_db)):
    payload = decode_token(body.refresh_token)
    if not payload or payload.get("type") != "refresh":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")
    result = await db.execute(select(User).where(User.id == payload["sub"], User.is_deleted == False))  # noqa: E712
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return TokenResponse(
        access_token=create_access_token(str(user.id)),
        refresh_token=create_refresh_token(str(user.id)),
    )


@router.post("/change-password")
async def change_password(
    body: ChangePasswordRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not verify_password(body.current_password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")
    validate_password(body.new_password)
    user.hashed_password = hash_password(body.new_password)
    user.must_change_password = False
    user.password_reset_at = None
    await db.commit()
    return {"detail": "Password changed successfully"}


@router.get("/me", response_model=UserResponse)
async def me(user: User = Depends(get_current_user)):
    return user


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


@router.get("/me/projects", response_model=list[ProjectSummaryResponse])
async def my_projects(user: User = Depends(get_current_user)):
    return [{"id": p.id, "name": p.name, "code": p.code} for p in user.projects]



# --- User Preferences (column orders, etc.) ---

@router.get("/me/preferences")
async def get_preferences(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from app.models.user_preference import UserPreference
    result = await db.execute(
        select(UserPreference).where(UserPreference.user_id == user.id, UserPreference.is_deleted == False)  # noqa: E712
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
    result = await db.execute(
        select(UserPreference).where(UserPreference.user_id == user.id, UserPreference.key == key)
    )
    pref = result.scalar_one_or_none()
    if pref:
        pref.value = body
    else:
        pref = UserPreference(user_id=user.id, key=key, value=body)
        db.add(pref)
    await db.commit()
    return {"status": "ok"}
