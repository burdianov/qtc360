from typing import Callable
from uuid import UUID as _UUID

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.security import decode_token
from app.models.user import User
from app.models.rbac import Role

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    payload = decode_token(token)
    if not payload or payload.get("type") != "access":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token"
        )
    sub = payload.get("sub")
    if not sub:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token"
        )
    try:
        user_id = _UUID(sub)
    except (ValueError, TypeError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token"
        )
    result = await db.execute(
        select(User)
        .where(User.id == user_id, User.is_deleted == False)  # noqa: E712
        .options(
            selectinload(User.roles).selectinload(Role.permissions),
            selectinload(User.projects),
            selectinload(User.designation),
        )
    )
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
        )
    # Token revocation: bump User.token_version on password change to invalidate.
    token_ver = payload.get("ver", 0) or 0
    if int(token_ver) != int(user.token_version or 0):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Token revoked"
        )
    return user


async def require_superuser(user: User = Depends(get_current_user)) -> User:
    if not user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Superuser required"
        )
    return user


async def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.is_superuser:
        return user
    user_role_names = {r.name for r in user.roles}
    if "admin" not in user_role_names and "super_admin" not in user_role_names:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required"
        )
    return user


def require_permission(permission_code: str) -> Callable:
    async def checker(user: User = Depends(get_current_user)) -> User:
        if user.is_superuser:
            return user
        user_role_names = {r.name for r in user.roles}
        # Viewers are blocked from all write operations
        if user_role_names == {"viewer"}:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Viewers have read-only access",
            )
        user_permissions = {p.code for role in user.roles for p in role.permissions}
        if permission_code not in user_permissions:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permission '{permission_code}' required",
            )
        return user

    return checker


def require_project_access(
    project_id_param: str = "project_id", *, required: bool = True
) -> Callable:
    """Validate that the user has access to the requested project_id.

    By default the project_id is REQUIRED — endpoints that don't provide one fail closed.
    Pass ``required=False`` for endpoints that legitimately span projects (the caller is
    responsible for filtering results to ``user.projects`` in that case).
    """

    async def checker(request: Request, user: User = Depends(get_current_user)) -> User:
        if user.is_superuser:
            return user
        pid = request.query_params.get(project_id_param)
        if not pid:
            pid = request.path_params.get(project_id_param)
        if not pid:
            # Fall back to JSON body (one read; FastAPI caches the body)
            try:
                body = await request.json()
                if isinstance(body, dict):
                    raw = body.get(project_id_param)
                    if raw is not None:
                        pid = str(raw)
            except Exception:
                pass
        if not pid:
            if required:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"'{project_id_param}' is required",
                )
            return user
        try:
            project_uuid = _UUID(pid)
        except (ValueError, TypeError):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid '{project_id_param}'",
            )
        user_project_ids = {p.id for p in user.projects}
        if project_uuid not in user_project_ids:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have access to this project",
            )
        return user

    return checker


async def assert_user_in_project(
    user: User, project_id, *, require_super_for_missing: bool = True
) -> None:
    """Helper: raise 403 if a non-superuser tries to act on a project they don't belong to.

    Use after fetching a parent object whose project_id was not on the request itself
    (e.g. a Document fetched by id in the path)."""
    if user.is_superuser:
        return
    if project_id is None:
        if require_super_for_missing:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="Project context required"
            )
        return
    if project_id not in {p.id for p in user.projects}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have access to this project",
        )
