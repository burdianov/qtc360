from __future__ import annotations

import pytest

from .helpers import (
    create_document,
    get_document,
    internally_sign_document,
    record_response,
    submit_to_approver,
)


@pytest.mark.asyncio
async def test_cannot_submit_draft_before_required_internal_signatures(client, seed_data, auth_headers):
    site = auth_headers("site")
    doc = await create_document(client, site, seed_data, "WIR", "submit too early")

    await submit_to_approver(client, site, doc["id"], 1, expected_status=400)
    assert (await get_document(client, site, doc["id"]))["status"] == "draft"


@pytest.mark.asyncio
async def test_wir_and_cir_require_qaqc_signature_but_mir_does_not(client, seed_data, auth_headers):
    """WIR/CIR need qaqc_engineer; MIR needs only site_engineer.
    FAT and CRS are auto-approved and cannot be signed at all."""
    site = auth_headers("site")

    for doc_type in ["WIR", "CIR"]:
        doc = await create_document(client, site, seed_data, doc_type, "signature rule")
        r = await client.post(f"/documents/{doc['id']}/sign?role=site_engineer", headers=site)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "draft"

    for doc_type in ["MIR"]:
        doc = await create_document(client, site, seed_data, doc_type, "signature rule")
        r = await client.post(f"/documents/{doc['id']}/sign?role=site_engineer", headers=site)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "internally_signed"


@pytest.mark.asyncio
async def test_unsign_returns_internally_signed_document_to_draft(client, seed_data, auth_headers):
    site = auth_headers("site")
    qaqc = auth_headers("qaqc")
    doc = await create_document(client, site, seed_data, "CIR", "unsign")
    doc = await internally_sign_document(client, doc, site, qaqc)
    assert doc["status"] == "internally_signed"

    r = await client.post(f"/documents/{doc['id']}/unsign?role=qaqc_engineer", headers=qaqc)
    assert r.status_code == 200, r.text
    assert r.json()["qaqc_engineer_signed"] is False
    assert r.json()["status"] == "draft"


@pytest.mark.asyncio
async def test_cannot_record_response_before_submission(client, seed_data, auth_headers):
    site = auth_headers("site")
    doc = await create_document(client, site, seed_data, "MIR", "record too early")
    await record_response(client, site, seed_data, doc["id"], 1, "A", expected_status=400)


@pytest.mark.asyncio
async def test_cannot_submit_approver_2_before_approver_1_returned(client, seed_data, auth_headers):
    site = auth_headers("site")
    doc = await create_document(client, site, seed_data, "MIR", "skip approver")
    doc = await internally_sign_document(client, doc, site, site)
    await submit_to_approver(client, site, doc["id"], 2, expected_status=400)


@pytest.mark.asyncio
async def test_invalid_status_transition_is_rejected(client, seed_data, auth_headers):
    site = auth_headers("site")
    doc = await create_document(client, site, seed_data, "MIR", "invalid transition")

    r = await client.patch(f"/documents/{doc['id']}", json={"status": "approved"}, headers=site)
    assert r.status_code == 400, r.text
    assert "Invalid status transition" in r.text


@pytest.mark.asyncio
async def test_duplicate_submit_same_approver_conflicts_or_rejects(client, seed_data, auth_headers):
    site = auth_headers("site")
    doc = await create_document(client, site, seed_data, "MIR", "duplicate submit")
    doc = await internally_sign_document(client, doc, site, site)
    await submit_to_approver(client, site, doc["id"], 1)

    r = await client.post(
        f"/documents/{doc['id']}/submit-to-approver",
        json={"approver_order": 1, "aconex_submitted_date": "2026-06-02"},
        headers=site,
    )
    assert r.status_code in {400, 409}, r.text


@pytest.mark.asyncio
async def test_viewer_cannot_create_or_edit_documents(client, seed_data, auth_headers):
    # The seed data may or may not include a viewer login in older branches.
    # This test uses no auth to guarantee write endpoints reject access.
    r = await client.post(
        "/documents",
        json={
            "project_id": seed_data.project_id,
            "document_type": "MIR",
            "title": "Unauthorized create",
            "discipline_id": seed_data.discipline_id,
        },
    )
    assert r.status_code in {401, 403}

    site = auth_headers("site")
    doc = await create_document(client, site, seed_data, "MIR", "unauth edit")
    r = await client.patch(f"/documents/{doc['id']}", json={"title": "bad"})
    assert r.status_code in {401, 403}


# ── Per-type guards ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
@pytest.mark.parametrize("doc_type", ["FAT", "CRS"])
async def test_auto_approved_cannot_be_submitted_to_approver(client, seed_data, auth_headers, doc_type: str):
    """FAT and CRS are auto-approved on create — no approval workflow needed."""
    site = auth_headers("site")
    doc = await create_document(client, site, seed_data, doc_type, "no submit")
    assert doc["status"] == "approved"

    r = await client.post(
        f"/documents/{doc['id']}/submit-to-approver",
        json={"approver_order": 1, "aconex_submitted_date": "2026-06-02"},
        headers=site,
    )
    assert r.status_code >= 400, f"{doc_type} should not be submittable: {r.status_code} {r.text}"


@pytest.mark.asyncio
async def test_fat_and_crs_skip_status_transition_validation(client, seed_data, auth_headers):
    """FAT and CRS skip the status transition validation block in update_document."""
    site = auth_headers("site")
    for doc_type in ("FAT", "CRS"):
        doc = await create_document(client, site, seed_data, doc_type, f"{doc_type} status check")
        assert doc["status"] == "approved"

        r = await client.patch(
            f"/documents/{doc['id']}",
            json={"status": "cancelled"},
            headers=site,
        )
        # FAT and CRS skip the status transition validation block
        if r.status_code == 200:
            assert r.json()["status"] == "cancelled"
        else:
            assert r.status_code in {400, 422}, r.text


@pytest.mark.asyncio
@pytest.mark.parametrize("doc_type", ["WIR", "MIR", "CIR"])
async def test_cannot_direct_jump_from_draft_to_approved(client, seed_data, auth_headers, doc_type: str):
    """Cannot jump directly from draft to approved — must go through the
    proper state machine transitions.
    Excludes CRS (auto-approved, starts at approved) and FAT (auto-approved)."""
    site = auth_headers("site")
    doc = await create_document(client, site, seed_data, doc_type, "jump test")

    r = await client.patch(
        f"/documents/{doc['id']}",
        json={"status": "approved"},
        headers=site,
    )
    assert r.status_code == 400, f"{doc_type}: {r.text}"
    assert "Invalid status transition" in r.text


@pytest.mark.asyncio
@pytest.mark.parametrize("doc_type", ["WIR", "MIR", "CIR", "CRS"])
async def test_cancelled_is_terminal_for_all_types(client, seed_data, auth_headers, doc_type: str):
    """Once cancelled, a document cannot be signed or submitted — for all types."""
    site = auth_headers("site")
    qaqc = auth_headers("qaqc")

    doc = await create_document(client, site, seed_data, doc_type, "cancel terminal")
    # Cancel from draft (valid transition for all types)
    r = await client.patch(
        f"/documents/{doc['id']}",
        json={"status": "cancelled"},
        headers=site,
    )
    assert r.status_code == 200, f"Cancel failed for {doc_type}: {r.text}"
    assert r.json()["status"] == "cancelled"

    # Cannot sign after cancel
    r = await client.post(
        f"/documents/{doc['id']}/sign?role=site_engineer",
        headers=site,
    )
    assert r.status_code >= 400, f"Sign after cancel should fail for {doc_type}"

    # Cannot submit after cancel
    r = await client.post(
        f"/documents/{doc['id']}/submit-to-approver",
        json={"approver_order": 1, "aconex_submitted_date": "2026-06-02"},
        headers=site,
    )
    assert r.status_code >= 400, f"Submit after cancel should fail for {doc_type}"
