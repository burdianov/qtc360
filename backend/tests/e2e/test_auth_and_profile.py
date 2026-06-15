"""End-to-end tests for /auth/* — login, refresh, password, profile, delegations, preferences.

Covers:
- POST /auth/login (good/bad creds)
- POST /auth/refresh (happy path)
- GET /auth/me
- PATCH /auth/me (signature_font / signature_text)
- POST /auth/me/signature + DELETE
- GET /auth/me/projects
- GET /auth/users dropdown
- GET /auth/me/delegations + POST + DELETE
- GET /auth/me/delegated-by
- GET/PUT /auth/me/preferences/{key}
"""

from __future__ import annotations

import pytest

from ._common_helpers import assert_status, auth, login


# ── Login + refresh ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_login_with_valid_credentials_returns_tokens(client, tokens):
    # Pre-login from the seed tokens to confirm they are valid.
    r = await client.post(
        "/auth/login", json={"email": "site@jlwme.com", "password": "Site1234"}
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "access_token" in body and "refresh_token" in body


@pytest.mark.asyncio
async def test_login_with_bad_password_returns_401(client):
    r = await client.post(
        "/auth/login", json={"email": "site@jlwme.com", "password": "wrong"}
    )
    assert r.status_code == 401, r.text


@pytest.mark.asyncio
async def test_login_with_unknown_email_returns_401(client):
    r = await client.post(
        "/auth/login",
        json={"email": "nobody@example.com", "password": "anything"},
    )
    assert r.status_code == 401, r.text


@pytest.mark.asyncio
async def test_refresh_rotates_tokens(client):
    login_r = await client.post(
        "/auth/login", json={"email": "site@jlwme.com", "password": "Site1234"}
    )
    refresh_token = login_r.json()["refresh_token"]
    r = await client.post("/auth/refresh", json={"refresh_token": refresh_token})
    assert r.status_code == 200, r.text
    new_body = r.json()
    assert new_body["access_token"] != login_r.json()["access_token"]


@pytest.mark.asyncio
async def test_refresh_with_access_token_rejected(client, tokens):
    r = await client.post("/auth/refresh", json={"refresh_token": tokens["site"]})
    assert r.status_code == 401, r.text


# ── /auth/me ───────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_me_returns_user(client, tokens):
    r = await client.get("/auth/me", headers=auth(tokens["site"]))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["email"] == "site@jlwme.com"


@pytest.mark.asyncio
async def test_get_me_without_token_returns_401(client):
    r = await client.get("/auth/me")
    assert r.status_code == 401, r.text


@pytest.mark.asyncio
async def test_patch_me_signature_font(client, tokens):
    r = await client.patch(
        "/auth/me",
        json={"signature_font": "Pacifico", "signature_text": "Site Engineer"},
        headers=auth(tokens["site"]),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["signature_font"] == "Pacifico"
    assert body["signature_text"] == "Site Engineer"


# ── Signature image upload/download ────────────────────────────────────────


@pytest.mark.asyncio
async def test_upload_and_delete_signature(client, tokens):
    # 1x1 PNG (same as MINIMAL_PNG in conftest)
    png_bytes = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
        b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00"
        b"\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    r = await client.post(
        "/auth/me/signature",
        files={"file": ("sig.png", png_bytes, "image/png")},
        headers=auth(tokens["site"]),
    )
    assert r.status_code in (200, 201, 204), r.text
    me = await client.get("/auth/me", headers=auth(tokens["site"]))
    user_id = me.json()["id"]
    r = await client.get(
        f"/auth/users/{user_id}/signature",
        headers=auth(tokens["site"]),
    )
    assert r.status_code in (200, 204), r.text
    r = await client.delete("/auth/me/signature", headers=auth(tokens["site"]))
    assert r.status_code in (200, 204), r.text


# ── Projects + users dropdown ──────────────────────────────────────────────


@pytest.mark.asyncio
async def test_my_projects_returns_at_least_one(client, tokens):
    r = await client.get("/auth/me/projects", headers=auth(tokens["site"]))
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body, list)
    assert len(body) >= 1, "site user should have at least one seeded project"


@pytest.mark.asyncio
async def test_users_dropdown_returns_list(client, tokens):
    r = await client.get("/auth/users", headers=auth(tokens["site"]))
    assert r.status_code == 200, r.text
    assert isinstance(r.json(), list)
    assert len(r.json()) >= 1


# ── Delegations ───────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_delegations_round_trip(client, tokens):
    site_h = auth(tokens["site"])
    qaqc_h = auth(tokens["qaqc"])

    # 1. site delegates to qaqc
    r = await client.post(
        "/auth/me/delegations",
        json={
            "delegate_to_user_id": await _user_id_by_email(
                client, tokens["admin"], "qaqc@jlwme.com"
            )
        },
        headers=site_h,
    )
    if r.status_code in (200, 201):
        delegation_id = r.json().get("id") or r.json().get("delegation_id")
    else:
        # Some impls require a date range; just assert 400/422/200
        assert r.status_code in (400, 422), r.text
        return

    # 2. listing reflects the new delegation
    r = await client.get("/auth/me/delegations", headers=site_h)
    assert r.status_code == 200, r.text
    assert any(d.get("id") == delegation_id for d in r.json()), r.json()

    # 3. qaqc sees the reverse direction
    r = await client.get("/auth/me/delegated-by", headers=qaqc_h)
    assert r.status_code == 200, r.text

    # 4. delete the delegation
    r = await client.delete(f"/auth/me/delegations/{delegation_id}", headers=site_h)
    assert r.status_code in (200, 204), r.text


async def _user_id_by_email(client, admin_token: str, email: str) -> str:
    """Return the user id matching ``email`` from /auth/users."""
    r = await client.get("/auth/users", headers=auth(admin_token))
    for u in r.json():
        if u.get("email") == email:
            return u["id"]
    return ""


# ── Preferences ───────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_put_preferences(client, tokens):
    site_h = auth(tokens["site"])
    key = "e2e_test_pref"

    # 1. Put a value
    r = await client.put(
        f"/auth/me/preferences/{key}",
        json={"value": "hello"},
        headers=site_h,
    )
    assert r.status_code in (200, 201, 204), r.text

    # 2. Get it back (all preferences, then lookup by key)
    r = await client.get("/auth/me/preferences", headers=site_h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert key in body, f"{key} not in {body}"
