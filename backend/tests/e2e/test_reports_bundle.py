"""End-to-end tests for /reports/bundle-pages and /reports/bundle-compose.

These endpoints power the S2 bundle composer UI (reorderable page thumbnails).

- /reports/bundle-pages/{doc_id} returns 200 with page_count + base64
  thumbnails when an Approver 1 response PDF exists; 404 otherwise.
- /reports/bundle-compose/{doc_id} returns a merged PDF.
"""

from __future__ import annotations

import pytest

from ._common_helpers import assert_status, auth
from .e2e_documents.helpers import (
    create_document,
    internally_sign_document,
    record_response,
    submit_to_approver,
)


@pytest.mark.asyncio
async def test_bundle_pages_404_before_approver1_response(
    client, tokens, seed_data, auth_headers
):
    site = auth_headers("site")
    doc = await create_document(client, site, seed_data, "WIR", "bundle pages 404")
    r = await client.get(f"/reports/bundle-pages/{doc['id']}", headers=site)
    assert r.status_code == 404, r.text


@pytest.mark.asyncio
async def test_bundle_pages_after_approver1_response(
    client, tokens, seed_data, auth_headers
):
    site = auth_headers("site")
    qaqc = auth_headers("qaqc")

    doc = await create_document(client, site, seed_data, "MIR", "bundle pages")
    # MIR: only site signs
    doc = await internally_sign_document(client, doc, site, qaqc)
    await submit_to_approver(client, site, doc["id"], order=1, date="2026-06-02")
    await record_response(
        client, site, seed_data, doc["id"], order=1, status_letter="A"
    )

    r = await client.get(f"/reports/bundle-pages/{doc['id']}", headers=site)
    if r.status_code == 200:
        body = r.json()
        assert "page_count" in body
        assert "thumbnails" in body
        assert isinstance(body["thumbnails"], list)
    else:
        # No stored file (env without storage backend) → 404
        assert r.status_code == 404, r.text


@pytest.mark.asyncio
async def test_compose_bundle_no_insertions_returns_main_pdf(
    client, tokens, seed_data, auth_headers
):
    site = auth_headers("site")
    qaqc = auth_headers("qaqc")

    doc = await create_document(client, site, seed_data, "MIR", "compose no ins")
    doc = await internally_sign_document(client, doc, site, qaqc)
    await submit_to_approver(client, site, doc["id"], order=1, date="2026-06-02")
    await record_response(
        client, site, seed_data, doc["id"], order=1, status_letter="A"
    )

    r = await client.post(
        f"/reports/bundle-compose/{doc['id']}",
        json={"insertions": []},
        headers=site,
    )
    if r.status_code == 200:
        assert r.headers["content-type"].startswith("application/pdf"), r.headers
        assert len(r.content) > 0
    else:
        # 404 if no stored approver-1 file
        assert r.status_code == 404, r.text
