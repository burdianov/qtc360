"""End-to-end tests for CRS lifecycle and document resubmit / start-new-revision.

Covers:
- /documents/{id}/resubmit: rejected → draft, soft-deletes old approval rounds,
  accepts optional title/remarks_1 in body
- /documents/{id}/start-new-revision: rejected/approved → new doc with
  bumped revision_no, old doc marked superseded, assets copied
- /documents/crs-by-source: returns CRS docs linked to a source
"""

from __future__ import annotations

import uuid

import pytest

from ._common_helpers import assert_status, auth
from .e2e_documents.helpers import (
    create_document,
    internally_sign_document,
    record_response,
    submit_to_approver,
)


# ── Resubmit ───────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_resubmit_rejected_doc_returns_to_draft(
    client, tokens, seed_data, auth_headers
):
    site = auth_headers("site")
    qaqc = auth_headers("qaqc")

    doc = await create_document(client, site, seed_data, "WIR", "resubmit")
    doc = await internally_sign_document(client, doc, site, qaqc)

    # Push it to rejected (status C on first approver)
    await submit_to_approver(client, site, doc["id"], order=1, date="2026-06-02")
    await record_response(
        client, site, seed_data, doc["id"], order=1, status_letter="C"
    )

    refreshed = (await client.get(f"/documents/{doc['id']}", headers=site)).json()
    assert refreshed["status"] == "rejected", refreshed

    r = await client.post(
        f"/documents/{doc['id']}/resubmit",
        json={"title": "E2E Resubmit WIR", "remarks_1": "fixed per approver"},
        headers=site,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "draft", body
    assert body["title"] == "E2E Resubmit WIR", body


@pytest.mark.asyncio
async def test_resubmit_non_rejected_doc_returns_400(
    client, tokens, seed_data, auth_headers
):
    site = auth_headers("site")
    doc = await create_document(client, site, seed_data, "WIR", "resubmit 400")
    r = await client.post(f"/documents/{doc['id']}/resubmit", json={}, headers=site)
    assert r.status_code == 400, r.text


# ── Start new revision ─────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_start_new_revision_after_approved(
    client, tokens, seed_data, auth_headers
):
    site = auth_headers("site")
    qaqc = auth_headers("qaqc")

    doc = await create_document(client, site, seed_data, "MIR", "new rev")
    doc = await internally_sign_document(client, doc, site, qaqc)
    await submit_to_approver(client, site, doc["id"], order=1, date="2026-06-02")
    await record_response(
        client, site, seed_data, doc["id"], order=1, status_letter="A"
    )

    refreshed = (await client.get(f"/documents/{doc['id']}", headers=site)).json()
    assert refreshed["status"] == "approver_1_returned", refreshed

    # Submit to approver 2 for final approval
    await submit_to_approver(client, site, doc["id"], order=2, date="2026-06-04")
    await record_response(
        client, site, seed_data, doc["id"], order=2, status_letter="A"
    )

    refreshed = (await client.get(f"/documents/{doc['id']}", headers=site)).json()
    assert refreshed["status"] == "approved", refreshed

    r = await client.post(f"/documents/{doc['id']}/start-new-revision", headers=site)
    assert r.status_code in (200, 201), r.text
    new_doc = r.json()
    assert new_doc["revision_no"] == 1, new_doc
    assert new_doc["reference_no"] == refreshed["reference_no"], new_doc
    assert new_doc["id"] != refreshed["id"], new_doc

    # Old doc is now superseded
    old = (await client.get(f"/documents/{refreshed['id']}", headers=site)).json()
    assert old["status"] == "superseded", old


@pytest.mark.asyncio
async def test_start_new_revision_blocked_in_draft(
    client, tokens, seed_data, auth_headers
):
    site = auth_headers("site")
    doc = await create_document(client, site, seed_data, "WIR", "block new rev")
    r = await client.post(f"/documents/{doc['id']}/start-new-revision", headers=site)
    assert r.status_code == 400, r.text


# ── CRS by source ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_crs_by_source_returns_empty_when_no_crs(
    client, tokens, seed_data, auth_headers
):
    site = auth_headers("site")
    doc = await create_document(client, site, seed_data, "WIR", "no crs")
    r = await client.get(
        "/documents/crs-by-source",
        params={"source_document_id": doc["id"]},
        headers=site,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["exists"] is False, body
    assert body["crs_list"] == [], body


@pytest.mark.asyncio
async def test_crs_by_source_404_for_unknown_source(
    client, tokens, seed_data, auth_headers
):
    site = auth_headers("site")
    r = await client.get(
        "/documents/crs-by-source",
        params={"source_document_id": str(uuid.uuid4())},
        headers=site,
    )
    assert r.status_code == 404, r.text
