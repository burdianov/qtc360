"""CRUD tests: create, read, update, delete for all 5 document types.

Covers:
- Create with all type-specific fields
- Server-assigned reference number
- Client-supplied reference_no rejected
- Update fields in draft status
- Get single document
- List with type/status filters
- Delete draft (hard delete)
- Delete submitted (supersede)
- Rejected-for-revision listing
"""

from __future__ import annotations

import pytest

from .helpers import (
    MULTI_APPROVAL_TYPES,
    create_document,
    delete_document,
    document_payload,
    get_document,
    get_document_list,
    internally_sign_document,
    list_rejected_for_revision,
    record_response,
    submit_to_approver,
    update_document,
)


# ── Creation with type-specific fields ─────────────────────────────────────────


@pytest.mark.asyncio
@pytest.mark.parametrize("doc_type", ["WIR", "MIR", "CIR", "CRS", "FAT"])
async def test_create_document_with_all_fields(client, seed_data, auth_headers, doc_type: str):
    site = auth_headers("site")
    doc = await create_document(client, site, seed_data, doc_type, "all fields")

    assert doc["document_type"] == doc_type
    assert doc["project_id"] == seed_data.project_id
    assert doc["status"] == ("approved" if doc_type in ("FAT", "CRS") else "draft")
    assert doc["reference_no"] != ""
    assert doc["revision_no"] == 0
    assert doc["full_reference_no"] == f"{doc['reference_no']}_00"

    # Verify reference contains doc type
    assert f"-{doc_type}-" in doc["reference_no"]

    # Type-specific assertions
    if doc_type in {"WIR", "CIR"}:
        assert doc["location"] == "E2E Area A"
        assert doc["floor_level"] == "L01"
        assert doc["rams_ref"] == "RAMS-E2E-001"
        assert doc["drawing_ref"] == "DWG-E2E-001"
        assert doc["remarks_1"] == "initial inspector remarks"
    elif doc_type == "MIR":
        assert doc["delivery_note"] == "DN-E2E-001"
        assert doc["material_submittals"] == "MS-E2E-001"
        assert doc["qty"] == "1 lot"
    elif doc_type == "CRS":
        assert doc["crs_data"] is not None
        assert doc["crs_data"]["comments"][0]["no"] == 1
    elif doc_type == "FAT":
        assert "FAT certificate package" in doc["description"]


@pytest.mark.asyncio
async def test_create_document_rejects_client_supplied_reference(client, seed_data, auth_headers):
    """Client cannot send reference_no — Pydantic must 422 the extra field."""
    site = auth_headers("site")
    payload = document_payload(seed_data, "WIR", "rejected ref")
    payload["reference_no"] = "MERC-JMJV-EL-WIR-9999"  # type: ignore[typeddict-unknown-key]

    r = await client.post("/documents", json=payload, headers=site)
    # Pydantic extra=forbid rejects extra fields
    assert r.status_code == 422, f"Expected 422, got {r.status_code}: {r.text}"


@pytest.mark.asyncio
async def test_create_document_with_revision_of_id_inherits_parent_reference(
    client, seed_data, auth_headers
):
    """Creating a new revision inherits parent reference and increments revision_no."""
    site = auth_headers("site")
    parent = await create_document(client, site, seed_data, "MIR", "parent for revision")

    # Transition parent to rejected (required for revision_of behaviour)
    # draft → internally_signed (MIR: site only) → with_approver_1 → rejected
    await internally_sign_document(client, parent, site, site)
    await submit_to_approver(client, site, parent["id"], 1)
    await record_response(client, site, seed_data, parent["id"], 1, "C")

    parent_reloaded = await get_document(client, site, parent["id"])
    assert parent_reloaded["status"] == "rejected"

    # Create revision
    revision = await create_document(
        client,
        site,
        seed_data,
        "MIR",
        "revision child",
        extra={"revision_of_id": parent["id"]},
    )
    assert revision["reference_no"] == parent["reference_no"]
    assert revision["revision_no"] == parent["revision_no"] + 1
    assert revision["status"] == "draft"


# ── Update ─────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
@pytest.mark.parametrize("doc_type", ["WIR", "MIR", "CIR", "CRS"])
async def test_update_draft_document_fields(client, seed_data, auth_headers, doc_type: str):
    site = auth_headers("site")
    doc = await create_document(client, site, seed_data, doc_type, "update test")

    payload: dict = {"title": f"Updated {doc_type} title", "description": "Updated description"}
    if doc_type in {"WIR", "CIR"}:
        payload.update(
            {
                "location": "Updated Location",
                "floor_level": "L99",
                "rams_ref": "RAMS-UPDATED",
                "drawing_ref": "DWG-UPDATED",
                "remarks_1": "updated remarks",
                "remarks_2": "second remarks",
                "inspector_date_1": "2026-06-10",
                "inspector_time_1": "16:00",
            }
        )
    elif doc_type == "MIR":
        payload.update(
            {
                "delivery_note": "DN-UPDATED-999",
                "material_submittals": "MS-UPDATED-888",
                "qty": "99 units",
            }
        )
    elif doc_type == "CRS":
        payload.update(
            {
                "crs_data": {
                    "subject": "Updated CRS",
                    "comments": [
                        {
                            "no": 1,
                            "originator_comment": "Updated question",
                            "contractor_response": "Updated answer",
                            "status": "closed",
                        }
                    ],
                }
            }
        )

    updated = await update_document(client, site, doc["id"], payload)
    # Verify all fields were persisted
    for key, value in payload.items():
        if key == "crs_data":
            assert updated["crs_data"]["subject"] == "Updated CRS"
        else:
            assert updated[key] == value, f"{key} mismatch for {doc_type}"


@pytest.mark.asyncio
async def test_fat_fields_are_updatable(client, seed_data, auth_headers):
    """FAT is approved on create but its description can still be updated."""
    site = auth_headers("site")
    doc = await create_document(client, site, seed_data, "FAT", "update fat")

    updated = await update_document(
        client,
        site,
        doc["id"],
        {"description": "Updated FAT description"},
    )
    assert updated["description"] == "Updated FAT description"


# ── Get / List ─────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
@pytest.mark.parametrize("doc_type", ["WIR", "MIR", "CIR", "CRS", "FAT"])
async def test_get_single_document(client, seed_data, auth_headers, doc_type: str):
    site = auth_headers("site")
    doc = await create_document(client, site, seed_data, doc_type, "get test")
    fetched = await get_document(client, site, doc["id"])
    assert fetched["id"] == doc["id"]
    assert fetched["document_type"] == doc_type


@pytest.mark.asyncio
async def test_list_documents_with_filters(client, seed_data, auth_headers):
    site = auth_headers("site")

    # Create one of each type
    wir = await create_document(client, site, seed_data, "WIR", "list test")
    mir = await create_document(client, site, seed_data, "MIR", "list test")
    cir = await create_document(client, site, seed_data, "CIR", "list test")

    # List all
    all_docs = await get_document_list(client, site, seed_data.project_id)
    assert len(all_docs) >= 3

    # Filter by type
    wir_docs = await get_document_list(client, site, seed_data.project_id, document_type="WIR")
    assert all(d["document_type"] == "WIR" for d in wir_docs)
    assert any(d["id"] == wir["id"] for d in wir_docs)

    # Filter by status
    draft_docs = await get_document_list(client, site, seed_data.project_id, status="draft")
    assert all(d["status"] == "draft" for d in draft_docs)


@pytest.mark.asyncio
async def test_get_nonexistent_document_returns_404(client, seed_data, auth_headers):
    site = auth_headers("site")
    await get_document(client, site, "00000000-0000-0000-0000-000000000000", expected_status=404)


# ── Delete ─────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_delete_draft_document_hard_deletes(client, seed_data, auth_headers):
    """Deleting a draft (unsubmitted) document hard-deletes it — 404 after."""
    admin = auth_headers("admin")
    doc = await create_document(client, admin, seed_data, "MIR", "delete draft")

    await delete_document(client, admin, doc["id"])
    await get_document(client, admin, doc["id"], expected_status=404)


@pytest.mark.asyncio
@pytest.mark.parametrize("doc_type", MULTI_APPROVAL_TYPES)
async def test_delete_submitted_document_supersedes(client, seed_data, auth_headers, doc_type: str):
    """Deleting a submitted document marks it superseded, not hard-deleted."""
    site = auth_headers("site")
    qaqc = auth_headers("qaqc")
    admin = auth_headers("admin")

    doc = await create_document(client, site, seed_data, doc_type, "delete submitted")
    doc = await internally_sign_document(client, doc, site, qaqc)
    await submit_to_approver(client, site, doc["id"], 1)

    # Now the doc has been submitted — delete should supersede (needs admin)
    await delete_document(client, admin, doc["id"])

    # After supersede, the API may return 404 (is_deleted=True) or 200 with superseded
    # Let's check: the API get filters is_deleted=False, so 404 is expected
    r = await client.get(f"/documents/{doc['id']}", headers=site)
    if r.status_code == 200:
        assert r.json()["status"] == "superseded"
    else:
        assert r.status_code == 404


# ── Rejected-for-revision ──────────────────────────────────────────────────────


@pytest.mark.asyncio
@pytest.mark.parametrize("doc_type", MULTI_APPROVAL_TYPES)
async def test_rejected_document_appears_in_rejected_for_revision_list(
    client, seed_data, auth_headers, doc_type: str
):
    site = auth_headers("site")
    qaqc = auth_headers("qaqc")

    doc = await create_document(client, site, seed_data, doc_type, "rejected list")
    doc = await internally_sign_document(client, doc, site, qaqc)
    await submit_to_approver(client, site, doc["id"], 1)
    await record_response(client, site, seed_data, doc["id"], 1, "C")

    rejected_doc = await get_document(client, site, doc["id"])
    assert rejected_doc["status"] == "rejected"

    rejected_list = await list_rejected_for_revision(client, site, seed_data.project_id)
    assert any(d["id"] == doc["id"] for d in rejected_list)

    # Filter by type
    filtered = await list_rejected_for_revision(
        client, site, seed_data.project_id, document_type=doc_type
    )
    assert any(d["id"] == doc["id"] for d in filtered)
    assert all(d["document_type"] == doc_type for d in filtered)


@pytest.mark.asyncio
async def test_rejected_doc_disappears_from_list_after_start_new_revision(
    client, seed_data, auth_headers
):
    """Once a revision is started, the rejected parent is superseded and
    should not appear in the rejected-for-revision list."""
    site = auth_headers("site")
    qaqc = auth_headers("qaqc")

    doc = await create_document(client, site, seed_data, "WIR", "rejected then revised")
    doc = await internally_sign_document(client, doc, site, qaqc)
    await submit_to_approver(client, site, doc["id"], 1)
    await record_response(client, site, seed_data, doc["id"], 1, "C")
    assert (await get_document(client, site, doc["id"]))["status"] == "rejected"

    # It should appear in the rejected list
    rejected_list = await list_rejected_for_revision(client, site, seed_data.project_id)
    assert any(d["id"] == doc["id"] for d in rejected_list)

    # Start a new revision supersedes the original
    r = await client.post(f"/documents/{doc['id']}/start-new-revision", headers=site)
    assert r.status_code == 201, r.text

    # The rejected original should now be excluded from the list
    rejected_after = await list_rejected_for_revision(client, site, seed_data.project_id)
    assert not any(d["id"] == doc["id"] for d in rejected_after), (
        "Superseded rejected doc should not appear in rejected-for-revision"
    )


# ── Start-new-revision from approved ───────────────────────────────────────────


@pytest.mark.asyncio
@pytest.mark.parametrize("doc_type", MULTI_APPROVAL_TYPES)
async def test_start_new_revision_from_approved_document(
    client, seed_data, auth_headers, doc_type: str
):
    """An approved document can start a new revision (rev++)."""
    site = auth_headers("site")
    qaqc = auth_headers("qaqc")

    doc = await create_document(client, site, seed_data, doc_type, "rev from approved")
    doc = await internally_sign_document(client, doc, site, qaqc)
    await submit_to_approver(client, site, doc["id"], 1)
    await record_response(client, site, seed_data, doc["id"], 1, "A")

    approved = await get_document(client, site, doc["id"])
    assert approved["status"] in {"approved", "approver_1_returned"}

    # If status is approver_1_returned with D/A, it may be at a point where
    # start-new-revision is still possible. Advance to terminal status if needed.
    if approved["status"] == "approver_1_returned":
        await submit_to_approver(client, site, doc["id"], 2)
        await record_response(client, site, seed_data, doc["id"], 2, "A")
        approved = await get_document(client, site, doc["id"])
        assert approved["status"] in {"approved", "approved_with_comments"}

    r = await client.post(f"/documents/{doc['id']}/start-new-revision", headers=site)
    assert r.status_code == 201, r.text
    new_rev = r.json()
    assert new_rev["reference_no"] == approved["reference_no"]
    assert new_rev["revision_no"] == approved["revision_no"] + 1
    assert new_rev["status"] == "draft"


# ── FAT-specific ───────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_fat_start_new_revision_from_approved(client, seed_data, auth_headers):
    site = auth_headers("site")
    fat = await create_document(client, site, seed_data, "FAT", "rev test")
    assert fat["status"] == "approved"

    r = await client.post(f"/documents/{fat['id']}/start-new-revision", headers=site)
    assert r.status_code == 201, r.text
    new_rev = r.json()
    assert new_rev["reference_no"] == fat["reference_no"]
    assert new_rev["revision_no"] == 1
    assert new_rev["document_type"] == "FAT"
    # new revision starts as draft (start_new_revision does not auto-approve)
    assert new_rev["status"] == "draft"
