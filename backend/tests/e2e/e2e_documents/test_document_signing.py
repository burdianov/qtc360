"""Signing tests: per-type signature rules, delegation, unsign, notify.

Covers:
- WIR/CIR need both site + qaqc signatures
- MIR/CRS need only site signature
- FAT cannot be signed (auto-approved on create)
- on_behalf_of (delegation)
- Unsign returns internally_signed -> draft
- Notify signatories creates notifications
- Cannot sign after submission
- Duplicate sign rejected
"""

from __future__ import annotations

import pytest

from .helpers import (
    create_document,
    get_document,
    internally_sign_document,
    notify_signatories,
    sign_document,
    submit_to_approver,
    unsign_document,
)


# ── Signature rules per document type ──────────────────────────────────────────


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("doc_type", "needs_qaqc"),
    [
        ("WIR", True),
        ("CIR", True),
        ("MIR", False),
    ],
)
async def test_signature_rules_per_document_type(
    client, seed_data, auth_headers, doc_type: str, needs_qaqc: bool
):
    site = auth_headers("site")
    qaqc = auth_headers("qaqc")

    doc = await create_document(client, site, seed_data, doc_type, "sign rules")
    assert doc["status"] == "draft"

    # Site engineer signs
    doc = await sign_document(client, doc["id"], "site_engineer", site)
    assert doc["site_engineer_signed"] is True

    if needs_qaqc:
        # After site sign, still draft (WIR/CIR)
        assert doc["status"] == "draft"
        # QA/QC signs → transitions to internally_signed
        doc = await sign_document(client, doc["id"], "qaqc_engineer", qaqc)
        assert doc["qaqc_engineer_signed"] is True
        assert doc["status"] == "internally_signed"
    else:
        # After site sign, immediately internally_signed (MIR/CRS)
        assert doc["status"] == "internally_signed"


@pytest.mark.asyncio
@pytest.mark.parametrize("doc_type", ["FAT", "CRS"])
async def test_auto_approved_docs_cannot_be_signed(client, seed_data, auth_headers, doc_type: str):
    """FAT and CRS are auto-approved on create — signing is not applicable."""
    site = auth_headers("site")
    doc = await create_document(client, site, seed_data, doc_type, "no sign")
    assert doc["status"] == "approved"

    r = await client.post(f"/documents/{doc['id']}/sign?role=site_engineer", headers=site)
    assert r.status_code == 400, f"{doc_type} should not be signable: {r.status_code} {r.text}"
    assert "draft" in r.text.lower()


# ── Duplicate sign guard ───────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_duplicate_sign_rejected(client, seed_data, auth_headers):
    site = auth_headers("site")
    doc = await create_document(client, site, seed_data, "WIR", "dup sign")
    # WIR: site sign keeps it in draft, needed so QAQC can sign second
    await sign_document(client, doc["id"], "site_engineer", site, "draft")

    # Duplicate site sign should be rejected
    r = await client.post(f"/documents/{doc['id']}/sign?role=site_engineer", headers=site)
    assert r.status_code == 400, r.text
    assert "already signed" in r.text.lower()


# ── Unsign ─────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
@pytest.mark.parametrize("doc_type", ["WIR", "MIR", "CIR"])
async def test_unsign_returns_internally_signed_to_draft(
    client, seed_data, auth_headers, doc_type: str
):
    site = auth_headers("site")
    qaqc = auth_headers("qaqc")

    doc = await create_document(client, site, seed_data, doc_type, "unsign")
    doc = await internally_sign_document(client, doc, site, qaqc)
    assert doc["status"] == "internally_signed"

    # Unsign site engineer
    doc = await unsign_document(client, doc["id"], "site_engineer", site)
    assert doc["site_engineer_signed"] is False
    assert doc["status"] == "draft"


@pytest.mark.asyncio
async def test_cannot_unsign_after_submission(client, seed_data, auth_headers):
    site = auth_headers("site")
    doc = await create_document(client, site, seed_data, "MIR", "unsign after submit")
    doc = await internally_sign_document(client, doc, site, site)
    await submit_to_approver(client, site, doc["id"], 1)

    r = await client.post(f"/documents/{doc['id']}/unsign?role=site_engineer", headers=site)
    assert r.status_code == 400, r.text
    assert "Cannot remove signature" in r.text


# ── Notify signatories ─────────────────────────────────────────────────────────


@pytest.mark.asyncio
@pytest.mark.parametrize("doc_type", ["WIR", "MIR", "CIR", "CRS"])
async def test_notify_signatories_succeeds(client, seed_data, auth_headers, doc_type: str):
    site = auth_headers("site")
    doc = await create_document(client, site, seed_data, doc_type, "notify")
    # Must be the creator to notify
    result = await notify_signatories(client, doc["id"], site)
    assert "notified" in result


# ── Cannot sign after submission ───────────────────────────────────────────────


@pytest.mark.asyncio
@pytest.mark.parametrize("doc_type", ["WIR", "MIR", "CIR"])
async def test_cannot_sign_after_submission(client, seed_data, auth_headers, doc_type: str):
    site = auth_headers("site")
    qaqc = auth_headers("qaqc")

    doc = await create_document(client, site, seed_data, doc_type, "sign after submit")
    doc = await internally_sign_document(client, doc, site, qaqc)
    await submit_to_approver(client, site, doc["id"], 1)

    # Now in with_approver_1 — signing should be blocked
    r = await client.post(f"/documents/{doc['id']}/sign?role=site_engineer", headers=site)
    assert r.status_code == 400, r.text
    assert "draft" in r.text.lower()


# ── Signature with on_behalf_of (delegation) ───────────────────────────────────


@pytest.mark.asyncio
async def test_sign_on_behalf_of_without_delegation_rejected(client, seed_data, auth_headers):
    """Signing on behalf of another user requires a delegation record.
    The qaqc user tries to sign on behalf of the site engineer without a
    delegation — should fail."""
    site = auth_headers("site")
    qaqc = auth_headers("qaqc")

    doc = await create_document(client, site, seed_data, "WIR", "on behalf invalid")
    # Get the site engineer's ID (doc creator)
    site_user_id = doc["created_by"]

    # qaqc tries to sign as site_engineer on behalf of the site engineer
    r = await client.post(
        f"/documents/{doc['id']}/sign?role=site_engineer&on_behalf_of={site_user_id}",
        headers=qaqc,
    )
    # Should fail — qaqc hasn't been delegated by the site engineer
    assert r.status_code in {400, 403}, f"Expected 400 or 403, got {r.status_code}: {r.text}"
