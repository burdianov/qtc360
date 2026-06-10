from __future__ import annotations

import pytest

from .helpers import (
    create_document,
    get_document,
    internally_sign_document,
    link_requirement,
    record_response,
    submit_to_approver,
)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("doc_type", "round1", "round2", "final_status"),
    [
        ("WIR", "A", "A", "approved"),
        ("WIR", "A", "B", "approved_with_comments"),
        ("WIR", "B", "A", "approved"),
        ("WIR", "C", None, "rejected"),
        ("WIR", "D", None, "approved"),
        ("MIR", "A", "A", "approved"),
        ("MIR", "A", "B", "approved_with_comments"),
        ("MIR", "B", "A", "approved"),
        ("MIR", "C", None, "rejected"),
        ("MIR", "D", None, "approved"),
        ("CIR", "A", "A", "approved"),
        ("CIR", "A", "B", "approved_with_comments"),
        ("CIR", "B", "A", "approved"),
        ("CIR", "C", None, "rejected"),
        ("CIR", "D", None, "approved"),
    ],
)
async def test_document_type_approval_lifecycle_matrix(
    client,
    seed_data,
    auth_headers,
    doc_type: str,
    round1: str,
    round2: str | None,
    final_status: str,
):
    site = auth_headers("site")
    qaqc = auth_headers("qaqc")

    doc = await create_document(
        client,
        site,
        seed_data,
        doc_type,
        f"{round1}{round2 or ''} lifecycle",
    )
    assert doc["status"] == "draft"
    await link_requirement(client, site, seed_data, doc)

    doc = await internally_sign_document(client, doc, site, qaqc)
    assert doc["status"] == "internally_signed"

    round_obj = await submit_to_approver(client, site, doc["id"], 1, "2026-06-02")
    assert round_obj["approver_order"] == 1
    assert round_obj["submitted_file_path"].endswith("S1.pdf")
    assert round_obj["submitted_file_size"] > 0
    assert (await get_document(client, site, doc["id"]))["status"] == "with_approver_1"

    await record_response(
        client,
        site,
        seed_data,
        doc["id"],
        1,
        round1,
        "2026-06-03",
        f"Round 1 decision {round1}",
    )
    status_after_round1 = (await get_document(client, site, doc["id"]))["status"]

    if round2 is None:
        assert status_after_round1 == final_status
        return

    assert status_after_round1 == "approver_1_returned"
    round_obj = await submit_to_approver(client, site, doc["id"], 2, "2026-06-04")
    assert round_obj["approver_order"] == 2
    assert round_obj["submitted_file_path"].endswith("S2.pdf")
    assert round_obj["submitted_file_size"] > 0
    assert (await get_document(client, site, doc["id"]))["status"] == "with_approver_2"

    await record_response(
        client,
        site,
        seed_data,
        doc["id"],
        2,
        round2,
        "2026-06-05",
        f"Round 2 decision {round2}",
    )
    assert (await get_document(client, site, doc["id"]))["status"] == final_status


@pytest.mark.asyncio
@pytest.mark.asyncio
@pytest.mark.parametrize("doc_type", ["FAT", "CRS"])
async def test_auto_approved_docs_on_create_and_crs_data(client, seed_data, auth_headers, doc_type: str):
    """FAT and CRS are auto-approved on create and can be linked to requirements."""
    site = auth_headers("site")
    doc = await create_document(client, site, seed_data, doc_type, "auto-approved")
    assert doc["status"] == "approved"

    if doc_type == "CRS":
        assert doc["crs_data"] is not None
    elif doc_type == "FAT":
        # FAT links to a commissioned requirement
        await link_requirement(client, site, seed_data, doc)
        r = await client.get(
            f"/commissioning/asset-requirements?project_id={seed_data.project_id}",
            headers=site,
        )
        assert r.status_code == 200, r.text
        matching = [
            req for req in r.json() if req["id"] == seed_data.asset_requirement_ids["FAT"]
        ]
        assert matching, f"FAT requirement not found in: {r.json()}"
        linked_req = matching[0]
        assert linked_req["status"] == "achieved"


@pytest.mark.asyncio
async def test_rejected_document_can_start_new_revision_and_original_is_superseded(
    client, seed_data, auth_headers
):
    site = auth_headers("site")
    qaqc = auth_headers("qaqc")

    doc = await create_document(client, site, seed_data, "WIR", "revision after C")
    doc = await internally_sign_document(client, doc, site, qaqc)
    await submit_to_approver(client, site, doc["id"], 1)
    await record_response(client, site, seed_data, doc["id"], 1, "C")
    rejected = await get_document(client, site, doc["id"])
    assert rejected["status"] == "rejected"

    r = await client.post(f"/documents/{doc['id']}/start-new-revision", headers=site)
    assert r.status_code == 201, r.text
    new_doc = r.json()
    assert new_doc["reference_no"] == rejected["reference_no"]
    assert new_doc["revision_no"] == rejected["revision_no"] + 1
    assert new_doc["status"] == "draft"

    old_doc = await get_document(client, site, doc["id"])
    assert old_doc["status"] == "superseded"


@pytest.mark.asyncio
async def test_cancelled_document_is_terminal(client, seed_data, auth_headers):
    site = auth_headers("site")
    doc = await create_document(client, site, seed_data, "MIR", "cancel terminal")

    r = await client.patch(f"/documents/{doc['id']}", json={"status": "cancelled"}, headers=site)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "cancelled"

    r = await client.post(f"/documents/{doc['id']}/sign?role=site_engineer", headers=site)
    assert r.status_code >= 400

    r = await client.post(
        f"/documents/{doc['id']}/submit-to-approver",
        json={"approver_order": 1, "aconex_submitted_date": "2026-06-02"},
        headers=site,
    )
    assert r.status_code >= 400
