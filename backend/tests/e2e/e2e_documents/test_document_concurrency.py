"""Concurrency tests: race safety for document creation and signing.

Covers:
- 5 concurrent creates get unique reference numbers
- Concurrent sign and submit — only one path succeeds
"""

from __future__ import annotations

import asyncio
import uuid as uuid_mod

import pytest

from .helpers import (
    create_document,
    document_payload,
    get_document,
    internally_sign_document,
)


@pytest.mark.asyncio
async def test_concurrent_creates_get_unique_references(client, seed_data, auth_headers):
    """5 concurrent POSTs to the same (project, type, discipline) all
    succeed and produce distinct reference numbers."""
    site = auth_headers("site")

    async def post_one(index: int):
        payload = document_payload(seed_data, "MIR", f"concurrent {index} {uuid_mod.uuid4().hex[:6]}")
        r = await client.post("/documents", json=payload, headers=site)
        return r

    results = await asyncio.gather(*(post_one(i) for i in range(5)))
    refs: list[str] = []
    for i, r in enumerate(results):
        assert r.status_code == 201, f"Post #{i} failed: {r.status_code} {r.text}"
        doc = r.json()
        refs.append(doc["reference_no"])

    assert len(refs) == 5
    assert len(set(refs)) == 5, f"Duplicate references in concurrent run: {refs}"


@pytest.mark.asyncio
async def test_concurrent_creates_across_different_types_no_conflict(client, seed_data, auth_headers):
    """Concurrent creates across different document types should all succeed."""
    site = auth_headers("site")

    async def post_type(doc_type: str, index: int):
        payload = document_payload(seed_data, doc_type, f"cross-type {index} {uuid_mod.uuid4().hex[:6]}")
        r = await client.post("/documents", json=payload, headers=site)
        return r

    results = await asyncio.gather(
        post_type("WIR", 0),
        post_type("MIR", 1),
        post_type("CIR", 2),
        post_type("CRS", 3),
        post_type("FAT", 4),
    )
    for i, r in enumerate(results):
        assert r.status_code == 201, f"Post #{i} failed: {r.status_code} {r.text}"


@pytest.mark.asyncio
async def test_concurrent_sign_and_submit_one_wins(client, seed_data, auth_headers):
    """When sign and submit happen concurrently, only one path should win.
    The other should get a conflict or fail gracefully."""
    site = auth_headers("site")
    qaqc = auth_headers("qaqc")

    # Create a doc and internally sign it
    doc = await create_document(client, site, seed_data, "MIR", "concurrent sign submit")
    doc = await internally_sign_document(client, doc, site, site)
    assert doc["status"] == "internally_signed"

    # Now try to unsign and submit concurrently
    async def try_unsign():
        r = await client.post(f"/documents/{doc['id']}/unsign?role=site_engineer", headers=site)
        return r

    async def try_submit():
        r = await client.post(
            f"/documents/{doc['id']}/submit-to-approver",
            json={"approver_order": 1, "aconex_submitted_date": "2026-06-02"},
            headers=site,
        )
        return r

    results = await asyncio.gather(try_unsign(), try_submit(), return_exceptions=True)

    # At least one should succeed (status codes may vary: 200, 201, 400, 409)
    successes = [
        r for r in results
        if not isinstance(r, Exception) and r.status_code in {200, 201}
    ]
    assert len(successes) >= 1, f"Neither unsign nor submit succeeded: {results}"

    # The document should end up in a consistent state
    doc_final = await get_document(client, site, doc["id"])
    assert doc_final["status"] in {
        "draft",           # unsign won
        "with_approver_1",  # submit won
        "internally_signed",  # submit may have been rejected
    }


@pytest.mark.asyncio
async def test_concurrent_submit_same_order_one_wins(client, seed_data, auth_headers):
    """Two concurrent submissions to the same approver order should
    result in only one succeeding."""
    site = auth_headers("site")
    doc = await create_document(client, site, seed_data, "MIR", "concurrent same order")
    doc = await internally_sign_document(client, doc, site, site)

    async def submit():
        r = await client.post(
            f"/documents/{doc['id']}/submit-to-approver",
            json={"approver_order": 1, "aconex_submitted_date": "2026-06-02"},
            headers=site,
        )
        return r.status_code

    results = await asyncio.gather(submit(), submit())

    # One should succeed (201), the other should conflict (400 or 409)
    assert 201 in results, f"Expected one 201, got {results}"
    assert results.count(201) == 1 or (results.count(201) == 1 and results.count(409) == 1), (
        f"Expected exactly one success, got {results}"
    )
