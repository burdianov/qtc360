"""Approval round management tests: stage files, replace round file, list rounds.

Covers:
- Stage file downloads (S1, R1, S2, R2) — verify 200 and content-type
- Missing stage file returns 404
- Replace round file (PUT) — overwrite returned PDF and metadata
- Replace round file validation (non-PDF rejected)
- List approval rounds — verify order, statuses
- Verify round metadata: signatory_name, response_date, response_time, comments
"""

from __future__ import annotations

import pytest

from .helpers import (
    MULTI_APPROVAL_TYPES,
    create_document,
    download_stage_file,
    get_document,
    internally_sign_document,
    list_approval_rounds,
    pdf_file,
    record_response,
    replace_round_file,
    submit_to_approver,
)


# ── Stage file downloads ───────────────────────────────────────────────────────


@pytest.mark.asyncio
@pytest.mark.parametrize("doc_type", MULTI_APPROVAL_TYPES)
async def test_download_submitted_stage_files(client, seed_data, auth_headers, doc_type: str):
    """After submitting to approver 1 and 2, S1.pdf and S2.pdf should be downloadable."""
    site = auth_headers("site")
    qaqc = auth_headers("qaqc")

    doc = await create_document(client, site, seed_data, doc_type, "stage downloads")
    doc = await internally_sign_document(client, doc, site, qaqc)
    await submit_to_approver(client, site, doc["id"], 1)
    await record_response(client, site, seed_data, doc["id"], 1, "A")
    await submit_to_approver(client, site, doc["id"], 2)

    # Download S1 (submitted to approver 1)
    resp = await download_stage_file(client, site, doc["id"], "S1")
    assert resp.headers["content-type"].startswith("application/pdf")
    assert len(resp.content) > 0
    assert "attachment" in resp.headers.get("content-disposition", "").lower()

    # Download S2 (submitted to approver 2)
    resp = await download_stage_file(client, site, doc["id"], "S2")
    assert resp.headers["content-type"].startswith("application/pdf")
    assert len(resp.content) > 0


@pytest.mark.asyncio
@pytest.mark.parametrize("doc_type", MULTI_APPROVAL_TYPES)
async def test_download_returned_stage_files(client, seed_data, auth_headers, doc_type: str):
    """After recording responses, R1.pdf and R2.pdf should be downloadable."""
    site = auth_headers("site")
    qaqc = auth_headers("qaqc")

    doc = await create_document(client, site, seed_data, doc_type, "returned downloads")
    doc = await internally_sign_document(client, doc, site, qaqc)
    await submit_to_approver(client, site, doc["id"], 1)
    await record_response(client, site, seed_data, doc["id"], 1, "A")
    await submit_to_approver(client, site, doc["id"], 2)
    await record_response(client, site, seed_data, doc["id"], 2, "A")

    # Download R1 (response from approver 1)
    resp = await download_stage_file(client, site, doc["id"], "R1")
    assert resp.headers["content-type"].startswith("application/pdf")
    assert len(resp.content) > 0

    # Download R2 (response from approver 2)
    resp = await download_stage_file(client, site, doc["id"], "R2")
    assert resp.headers["content-type"].startswith("application/pdf")
    assert len(resp.content) > 0


@pytest.mark.asyncio
async def test_missing_stage_file_returns_404(client, seed_data, auth_headers):
    """Stage files that haven't been created yet should return 404."""
    site = auth_headers("site")
    doc = await create_document(client, site, seed_data, "MIR", "missing stage")

    # S1 doesn't exist yet (not submitted)
    await download_stage_file(client, site, doc["id"], "S1", expected_status=404)
    # R1 doesn't exist yet (no response)
    await download_stage_file(client, site, doc["id"], "R1", expected_status=404)


@pytest.mark.asyncio
async def test_invalid_stage_name_rejected(client, seed_data, auth_headers):
    """Stage names must match S1-S9 or R1-R9 pattern."""
    site = auth_headers("site")
    doc = await create_document(client, site, seed_data, "MIR", "invalid stage")

    # Use a stage name that won't match the regex pattern
    await download_stage_file(client, site, doc["id"], "X1", expected_status=422)


# ── List approval rounds ───────────────────────────────────────────────────────


@pytest.mark.asyncio
@pytest.mark.parametrize("doc_type", MULTI_APPROVAL_TYPES)
async def test_list_approval_rounds_returns_in_order(client, seed_data, auth_headers, doc_type: str):
    site = auth_headers("site")
    qaqc = auth_headers("qaqc")

    doc = await create_document(client, site, seed_data, doc_type, "rounds list")
    doc = await internally_sign_document(client, doc, site, qaqc)
    await submit_to_approver(client, site, doc["id"], 1)
    await record_response(client, site, seed_data, doc["id"], 1, "A",
                          signatory_name="First Approver",
                          comments="First round done")

    # List rounds
    rounds = await list_approval_rounds(client, site, doc["id"])
    assert len(rounds) == 1
    assert rounds[0]["approver_order"] == 1
    assert rounds[0]["signatory_name"] == "First Approver"
    assert rounds[0]["comments"] == "First round done"
    assert rounds[0]["submitted_file_path"] is not None
    assert rounds[0]["submitted_file_size"] > 0
    assert rounds[0]["returned_file_path"] is not None

    # Submit and record round 2
    await submit_to_approver(client, site, doc["id"], 2)
    await record_response(client, site, seed_data, doc["id"], 2, "B",
                          signatory_name="Second Approver",
                          comments="Second round with comments")

    rounds = await list_approval_rounds(client, site, doc["id"])
    assert len(rounds) == 2
    assert rounds[0]["approver_order"] == 1
    assert rounds[1]["approver_order"] == 2
    assert rounds[1]["signatory_name"] == "Second Approver"

    # Verify final document status
    doc_final = await get_document(client, site, doc["id"])
    assert doc_final["status"] in {"approved", "approved_with_comments"}


# ── Replace round file ─────────────────────────────────────────────────────────


@pytest.mark.asyncio
@pytest.mark.parametrize("doc_type", MULTI_APPROVAL_TYPES)
async def test_replace_round_file_succeeds(client, seed_data, auth_headers, doc_type: str):
    site = auth_headers("site")
    qaqc = auth_headers("qaqc")

    doc = await create_document(client, site, seed_data, doc_type, "replace round file")
    doc = await internally_sign_document(client, doc, site, qaqc)
    await submit_to_approver(client, site, doc["id"], 1)
    round_obj = await record_response(client, site, seed_data, doc["id"], 1, "A")

    # Replace the returned file
    result = await replace_round_file(
        client,
        site,
        doc["id"],
        round_obj["id"],
        signatory_name="Replaced Approver",
        response_date="2026-06-15",
        response_time="12:00",
        comments="Updated response after review",
    )
    assert result["status"] == "replaced"
    assert result["filename"] is not None

    # Verify the round was updated
    rounds = await list_approval_rounds(client, site, doc["id"])
    assert rounds[0]["signatory_name"] == "Replaced Approver"
    assert rounds[0]["comments"] == "Updated response after review"


@pytest.mark.asyncio
async def test_replace_round_file_rejects_non_pdf(client, seed_data, auth_headers):
    site = auth_headers("site")
    qaqc = auth_headers("qaqc")

    doc = await create_document(client, site, seed_data, "WIR", "replace non-pdf")
    doc = await internally_sign_document(client, doc, site, qaqc)
    await submit_to_approver(client, site, doc["id"], 1)
    round_obj = await record_response(client, site, seed_data, doc["id"], 1, "A")

    # Try to replace with a text file
    bad_file = {"file": ("bad.txt", b"not a pdf", "text/plain")}
    await replace_round_file(
        client, site, doc["id"], round_obj["id"], file_data=bad_file, expected_status=400
    )


@pytest.mark.asyncio
async def test_replace_round_file_rejects_empty_file(client, seed_data, auth_headers):
    site = auth_headers("site")
    qaqc = auth_headers("qaqc")

    doc = await create_document(client, site, seed_data, "MIR", "replace empty")
    doc = await internally_sign_document(client, doc, site, site)
    await submit_to_approver(client, site, doc["id"], 1)
    round_obj = await record_response(client, site, seed_data, doc["id"], 1, "A")

    empty_pdf = {"file": ("empty.pdf", b"", "application/pdf")}
    await replace_round_file(
        client, site, doc["id"], round_obj["id"], file_data=empty_pdf, expected_status=400
    )


# ── Round metadata ─────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_round_metadata_persisted_correctly(client, seed_data, auth_headers):
    """Verify all round metadata fields are stored correctly."""
    site = auth_headers("site")
    qaqc = auth_headers("qaqc")

    doc = await create_document(client, site, seed_data, "WIR", "round metadata")
    doc = await internally_sign_document(client, doc, site, qaqc)
    await submit_to_approver(client, site, doc["id"], 1, "2026-06-01")
    await record_response(
        client, site, seed_data, doc["id"], 1, "B",
        signatory_name="Metadata Tester",
        date="2026-06-05",
        comments="Detailed round 1 comments",
    )

    rounds = await list_approval_rounds(client, site, doc["id"])
    round1 = rounds[0]
    assert round1["approver_order"] == 1
    assert round1["signatory_name"] == "Metadata Tester"
    assert round1["comments"] == "Detailed round 1 comments"
    assert round1["submitted_file_size"] > 0
    assert "S1" in round1["submitted_file_path"]
    assert "R1" in round1["returned_file_path"]
    assert round1["aconex_submitted_date"] is not None
    assert round1["response_date"] is not None
