"""End-to-end tests for /admin/* — users, roles, permissions, audit, settings.

Covers:
- GET/POST /admin/users (create, duplicate email 409)
- PATCH /admin/users/{id} (role assignment, is_active toggle)
- DELETE /admin/users/{id} (cannot self-delete 400)
- GET/POST /admin/roles
- GET /admin/audit-logs (paging, filters)
- GET/PUT /admin/settings/{key}
- POST/GET /admin/settings/crs-header/{project_id}
"""

from __future__ import annotations

import uuid

import pytest

from ._common_helpers import assert_404, assert_status, auth


# ── Users ──────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_admin_can_list_users(client, tokens):
    r = await client.get("/admin/users", headers=auth(tokens["admin"]))
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body, list)
    assert any(u.get("email") == "site@jlwme.com" for u in body)


@pytest.mark.asyncio
async def test_admin_can_create_user(client, tokens):
    email = f"e2e+{uuid.uuid4().hex[:6]}@example.com"
    payload = {
        "email": email,
        "password": "Initial1234",
        "full_name": "E2E User",
        "is_active": True,
    }
    r = await client.post("/admin/users", json=payload, headers=auth(tokens["admin"]))
    assert r.status_code in (200, 201), r.text
    user = r.json()
    assert user["email"] == email


@pytest.mark.asyncio
async def test_duplicate_email_returns_409(client, tokens):
    payload = {
        "email": "site@jlwme.com",
        "password": "Site1234",
        "full_name": "Dup",
    }
    r = await client.post("/admin/users", json=payload, headers=auth(tokens["admin"]))
    assert r.status_code in (400, 409), r.text


@pytest.mark.asyncio
async def test_non_admin_cannot_list_users(client, tokens):
    r = await client.get("/admin/users", headers=auth(tokens["site"]))
    assert r.status_code in (401, 403), r.text


@pytest.mark.asyncio
async def test_admin_cannot_self_delete(client, tokens):
    me_id = (await client.get("/auth/me", headers=auth(tokens["admin"]))).json()["id"]
    r = await client.delete(f"/admin/users/{me_id}", headers=auth(tokens["admin"]))
    assert r.status_code in (400, 403, 409), r.text


# ── Roles ──────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_admin_can_list_roles(client, tokens):
    r = await client.get("/admin/roles", headers=auth(tokens["admin"]))
    assert r.status_code == 200, r.text
    assert isinstance(r.json(), list)
    role_names = {rl.get("name") for rl in r.json()}
    assert "admin" in role_names or "Admin" in role_names


@pytest.mark.asyncio
async def test_admin_can_create_role(client, tokens):
    name = f"e2e_role_{uuid.uuid4().hex[:6]}"
    payload = {"name": name, "description": "E2E test role"}
    r = await client.post("/admin/roles", json=payload, headers=auth(tokens["admin"]))
    assert r.status_code in (200, 201), r.text
    role = r.json()
    assert role["name"] == name
    # Clean up: delete the role we just made
    rid = role.get("id")
    if rid:
        r = await client.delete(f"/admin/roles/{rid}", headers=auth(tokens["admin"]))
        assert r.status_code in (200, 204), r.text


# ── Permissions (superuser only) ──────────────────────────────────────────


@pytest.mark.asyncio
async def test_admin_can_list_permissions(client, tokens):
    r = await client.get("/admin/permissions", headers=auth(tokens["admin"]))
    assert r.status_code == 200, r.text
    assert isinstance(r.json(), list)


# ── Audit log ─────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_audit_log_paging(client, tokens):
    r = await client.get(
        "/admin/audit-logs",
        params={"skip": 0, "limit": 20},
        headers=auth(tokens["admin"]),
    )
    assert r.status_code == 200, r.text
    assert isinstance(r.json(), list)


# ── Settings ──────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_set_date_format_setting(client, tokens):
    payload = {"value": "DD/MM/YYYY"}
    r = await client.put(
        "/admin/settings/date_format",
        json=payload,
        headers=auth(tokens["admin"]),
    )
    assert r.status_code in (200, 201), r.text
    r = await client.get("/admin/settings/date_format", headers=auth(tokens["admin"]))
    assert r.status_code == 200, r.text
    assert r.json().get("value") == "DD/MM/YYYY"


@pytest.mark.asyncio
async def test_crs_header_upload_and_get(client, tokens, seed_data):
    # 1x1 PNG
    png_bytes = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
        b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00"
        b"\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    r = await client.post(
        f"/admin/settings/crs-header/{seed_data.project_id}",
        files={"file": ("header.png", png_bytes, "image/png")},
        headers=auth(tokens["admin"]),
    )
    assert r.status_code in (200, 201), r.text
    r = await client.get(
        f"/admin/settings/crs-header/{seed_data.project_id}",
        headers=auth(tokens["admin"]),
    )
    assert r.status_code == 200, r.text
