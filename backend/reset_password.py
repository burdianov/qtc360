"""Reset a user's password to a known value by writing a fresh bcrypt hash
directly into the DB. Bypasses the API and the seed's skip-if-exists check."""

import asyncio
import sys

import bcrypt
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import settings


async def reset(email: str, new_password: str) -> None:
    engine = create_async_engine(settings.database_url, poolclass=NullPool)
    new_hash = bcrypt.hashpw(new_password.encode(), bcrypt.gensalt()).decode()
    async with engine.begin() as conn:
        result = await conn.execute(
            text(
                "UPDATE users SET hashed_password = :h, "
                "must_change_password = false, password_reset_at = NULL "
                "WHERE email = :e AND is_deleted = false"
            ),
            {"h": new_hash, "e": email},
        )
        if result.rowcount == 0:
            print(f"  no active user with email={email!r}")
        else:
            print(f"  reset {email} -> {new_password!r} (bcrypt cost=12)")
    await engine.dispose()


if __name__ == "__main__":
    email, password = sys.argv[1], sys.argv[2]
    asyncio.run(reset(email, password))
