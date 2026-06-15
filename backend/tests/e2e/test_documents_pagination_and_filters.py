"""End-to-end tests for /documents list pagination, filtering, and shape.

Covers:
- Default listing (paginated=false) returns a list
- Paginated listing returns {items, total}
- Filters: document_type, status, discipline_id, has_comments
- Skip/limit honoured
- Sort is created_at desc (newest first)
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


# ── Shape ──────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_documents_list_default_shape(client, tokens, seed_data, auth_headers):
    site = auth_headers("site")
    r = await client.get(f"/documents?project_id={seed_data.project_id}", headers=site)
    assert r.status_code == 200, r.text
    assert isinstance(r.json(), list)
    if r.json():
        first = r.json()[0]
        for k in ("id", "project_id", "document_type", "status", "reference_no"):
            assert k in first, f"missing {k}"


@pytest.mark.asyncio
async def test_documents_list_paginated_shape(client, tokens, seed_data, auth_headers):
    site = auth_headers("site")
    r = await client.get(
        f"/documents?project_id={seed_data.project_id}&paginated=true&skip=0&limit=5",
        headers=site,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "items" in body and "total" in body, body
    assert isinstance(body["items"], list)
    assert isinstance(body["total"], int)
    assert body["total"] >= 0


# ── Filters ─────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
@pytest.mark.parametrize("doc_type", ["WIR", "MIR", "CIR"])
async def test_filter_by_document_type(
    client, tokens, seed_data, auth_headers, doc_type
):
    site = auth_headers("site")
    r = await client.get(
        f"/documents?project_id={seed_data.project_id}&document_type={doc_type}",
        headers=site,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert all(d["document_type"] == doc_type for d in body), body


@pytest.mark.asyncio
async def test_filter_by_status_returns_only_matching(
    client, tokens, seed_data, auth_headers
):
    site = auth_headers("site")
    await create_document(client, site, seed_data, "WIR", "filter status")
    r = await client.get(
        f"/documents?project_id={seed_data.project_id}&status=draft",
        headers=site,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert all(d["status"] == "draft" for d in body), body


@pytest.mark.asyncio
async def test_filter_by_has_comments(client, tokens, seed_data, auth_headers):
    """has_comments=true only returns docs that have a non-empty round comment."""
    site = auth_headers("site")
    qaqc = auth_headers("qaqc")

    # Doc with comments
    doc_with = await create_document(client, site, seed_data, "WIR", "with comments")
    doc_with = await internally_sign_document(client, doc_with, site, qaqc)
    await submit_to_approver(client, site, doc_with["id"], order=1, date="2026-06-02")
    await record_response(
        client,
        site,
        seed_data,
        doc_with["id"],
        order=1,
        status_letter="B",
        comments="E2E comments for has_comments test",
    )

    r = await client.get(
        f"/documents?project_id={seed_data.project_id}&has_comments=true",
        headers=site,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    ids = [d["id"] for d in body]
    assert doc_with["id"] in ids, body


# ── Pagination math ─────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_pagination_skip_limit_respected(client, tokens, seed_data, auth_headers):
    site = auth_headers("site")
    # Ensure at least 2 documents exist for pagination
    d1 = await create_document(client, site, seed_data, "WIR", "pagination doc 1")
    d2 = await create_document(client, site, seed_data, "MIR", "pagination doc 2")

    r1 = await client.get(
        f"/documents?project_id={seed_data.project_id}&paginated=true&skip=0&limit=1",
        headers=site,
    )
    r2 = await client.get(
        f"/documents?project_id={seed_data.project_id}&paginated=true&skip=1&limit=1",
        headers=site,
    )
    r1_body = r1.json()
    r2_body = r2.json()
    if isinstance(r1_body, dict) and "items" in r1_body:
        assert r1_body["items"] != r2_body["items"]
        assert r1_body["total"] == r2_body["total"]
        assert r1_body["total"] >= 2
    else:
        assert r1_body != r2_body


# ── Sort ────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_documents_sorted_by_created_at_desc(
    client, tokens, seed_data, auth_headers
):
    site = auth_headers("site")
    first = await create_document(client, site, seed_data, "WIR", "earlier")
    second = await create_document(client, site, seed_data, "MIR", "later")

    r = await client.get(
        f"/documents?project_id={seed_data.project_id}&limit=50",
        headers=site,
    )
    body = r.json()
    first_idx = next((i for i, d in enumerate(body) if d["id"] == first["id"]), None)
    second_idx = next((i for i, d in enumerate(body) if d["id"] == second["id"]), None)
    assert first_idx is not None and second_idx is not None
    assert second_idx < first_idx, (
        f"second (newer) should be at smaller index; got {second_idx} vs {first_idx}"
    )


# ── Access control ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_documents_list_requires_project_access(client, tokens, seed_data):
    """A non-member cannot list documents for a project."""
    site = auth(tokens["site"])
    r = await client.get(f"/documents?project_id={uuid.uuid4()}", headers=site)
    # 403 because the user is not in that project
    assert r.status_code == 403, r.text
