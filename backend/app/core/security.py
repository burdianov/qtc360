import re
from datetime import datetime, timedelta, timezone

import bcrypt
from fastapi import HTTPException, status
from jose import jwt, JWTError

from app.core.config import settings

ALGORITHM = "HS256"


def validate_password(password: str) -> None:
    """Raise HTTPException if password doesn't meet policy: 8+ chars, 1 uppercase, 1 number."""
    if (
        len(password) < 8
        or not re.search(r"[A-Z]", password)
        or not re.search(r"\d", password)
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Password must be at least 8 characters with 1 uppercase letter and 1 number",
        )


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def _now_ts() -> int:
    # Millisecond precision ensures two tokens created in the same second
    # have distinct iat values, preventing identical JWT payloads.
    return int(datetime.now(timezone.utc).timestamp() * 1000)


def create_access_token(subject: str, token_version: int = 0) -> str:
    now = datetime.now(timezone.utc)
    expire = now + timedelta(minutes=settings.access_token_expire_minutes)
    return jwt.encode(
        {
            "sub": subject,
            "exp": expire,
            "iat": _now_ts(),
            "type": "access",
            "ver": token_version,
        },
        settings.secret_key.get_secret_value(),
        algorithm=ALGORITHM,
    )


def create_refresh_token(subject: str, token_version: int = 0) -> str:
    now = datetime.now(timezone.utc)
    expire = now + timedelta(days=settings.refresh_token_expire_days)
    return jwt.encode(
        {
            "sub": subject,
            "exp": expire,
            "iat": _now_ts(),
            "type": "refresh",
            "ver": token_version,
        },
        settings.secret_key.get_secret_value(),
        algorithm=ALGORITHM,
    )


def decode_token(token: str) -> dict | None:
    try:
        return jwt.decode(
            token, settings.secret_key.get_secret_value(), algorithms=[ALGORITHM]
        )
    except JWTError:
        return None
