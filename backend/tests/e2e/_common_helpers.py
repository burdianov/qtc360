"""Shared helpers for top-level (non-document) e2e tests.

These functions are intentionally lightweight — they wrap httpx calls
with the same conventions used by ``e2e_documents.helpers`` so the
new e2e suites read consistently.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

import httpx


async def login(client: httpx.AsyncClient, email: str, password: str) -> str:
    """Return an access token for the given credentials."""
    r = await client.post("/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"login({email}) failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


def auth(token: str) -> dict[str, str]:
    """Wrap a token into a Bearer header dict."""
    return {"Authorization": f"Bearer {token}"}


async def get_me(client: httpx.AsyncClient, token: str) -> dict[str, Any]:
    r = await client.get("/auth/me", headers=auth(token))
    assert r.status_code == 200, f"GET /auth/me failed: {r.status_code} {r.text}"
    return r.json()


def assert_status(r: httpx.Response, expected: int, label: str = "") -> None:
    """Single-line assert with the canonical error format used across tests."""
    assert r.status_code == expected, (
        f"{label} expected {expected} got {r.status_code}: {r.text}"
    )


def assert_404(r: httpx.Response, label: str = "") -> None:
    assert_status(r, 404, label)


def assert_403(r: httpx.Response, label: str = "") -> None:
    assert_status(r, 403, label)


def u(value: Any) -> str:
    """Stringify a UUID-like value (str | UUID)."""
    if isinstance(value, UUID):
        return str(value)
    return str(value)
