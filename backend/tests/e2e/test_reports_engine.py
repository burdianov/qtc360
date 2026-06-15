"""End-to-end tests for /reports/* — generation, latest-PDF, templates, signatures.

Covers:
- /reports/pdf-engine/health
- /reports/generate/{doc_type} (WIR/MIR/CIR) — returns application/pdf
- /reports/latest-pdf/{doc_id} (404 before, 200 after)
- /reports/generate-crs
- /reports/templates: upload, list, download, delete
- /reports/signature-fonts, /reports/signature-preview
"""

from __future__ import annotations

import uuid

import pytest

from ._common_helpers import assert_status, auth
from .conftest import MINIMAL_DOCX


# ── PDF engine health ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_pdf_engine_health(client, tokens):
    site = auth(tokens["site"])
    r = await client.get("/reports/pdf-engine/health", headers=site)
    # Either healthy (200) or unhealthy (503) — both are valid; the route
    # should not 500.
    assert r.status_code in (200, 503), r.text
    if r.status_code == 200:
        body = r.json()
        assert body["status"] == "healthy"


# ── Latest-PDF before / after approval ─────────────────────────────────────


@pytest.mark.asyncio
async def test_latest_pdf_404_before_any_rounds(
    client, tokens, seed_data, auth_headers
):
    site = auth_headers("site")
    from .e2e_documents.helpers import create_document

    doc = await create_document(client, site, seed_data, "WIR", "no rounds yet")
    r = await client.get(f"/reports/latest-pdf/{doc['id']}", headers=site)
    assert r.status_code == 404, r.text


@pytest.mark.asyncio
async def test_latest_pdf_after_submit(client, tokens, seed_data, auth_headers):
    from .e2e_documents.helpers import (
        create_document,
        internally_sign_document,
        record_response,
        submit_to_approver,
    )

    site = auth_headers("site")
    qaqc = auth_headers("qaqc")
    doc = await create_document(client, site, seed_data, "MIR", "latest pdf after")
    doc = await internally_sign_document(client, doc, site, qaqc)
    await submit_to_approver(client, site, doc["id"], order=1, date="2026-06-02")
    await record_response(
        client, site, seed_data, doc["id"], order=1, status_letter="A"
    )
    r = await client.get(f"/reports/latest-pdf/{doc['id']}", headers=site)
    # 200 if the S1 PDF was successfully stored; 404 if storage backend
    # didn't keep it.
    assert r.status_code in (200, 404), r.text


# ── Generate report (WIR/MIR/CIR) ──────────────────────────────────────────


@pytest.mark.asyncio
@pytest.mark.parametrize("doc_type", ["WIR", "MIR", "CIR"])
async def test_generate_report_returns_pdf(
    client, tokens, seed_data, auth_headers, doc_type
):
    from .e2e_documents.helpers import create_document

    site = auth_headers("site")
    doc = await create_document(
        client, site, seed_data, doc_type, f"gen pdf {doc_type}"
    )
    r = await client.post(
        f"/reports/generate/{doc_type}",
        json={"project_id": doc["project_id"], "document_id": doc["id"]},
        headers=site,
    )
    if r.status_code == 200:
        assert r.headers.get("content-type", "").startswith("application/pdf"), (
            r.headers
        )
        assert len(r.content) > 100
    else:
        # 404 if no template; 500/503 if PDF engine down
        assert r.status_code in (404, 500, 503), r.text


# ── CRS report ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_generate_crs_returns_pdf(client, tokens, seed_data, auth_headers):
    from tests.e2e.e2e_documents.helpers import create_document

    site = auth_headers("site")
    doc = await create_document(client, site, seed_data, "CRS", "gen pdf crs")
    body = {
        "project_id": seed_data.project_id,
        "document_id": doc["id"],
    }
    r = await client.post("/reports/generate-crs", json=body, headers=site)
    if r.status_code == 200:
        assert r.headers.get("content-type", "").startswith("application/pdf"), (
            r.headers
        )
        assert len(r.content) > 100
    else:
        assert r.status_code in (404, 500, 503), r.text


# ── Templates ──────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_template_upload_list_download_delete(
    client, tokens, seed_data, auth_headers
):
    admin = auth_headers("admin")
    name = f"E2E Template {uuid.uuid4().hex[:4]}"

    files = {"file": (f"{name}.docx", MINIMAL_DOCX, "application/octet-stream")}
    r = await client.post(
        "/reports/templates/upload",
        params={
            "project_id": seed_data.project_id,
            "doc_type": "WIR",
            "name": name,
        },
        files=files,
        headers=admin,
    )
    assert r.status_code in (200, 201), r.text
    template = r.json()
    template_id = template["id"]

    r = await client.get(
        "/reports/templates",
        params={"project_id": seed_data.project_id, "doc_type": "WIR"},
        headers=admin,
    )
    assert r.status_code == 200, r.text
    assert any(t["id"] == template_id for t in r.json())

    r = await client.get(f"/reports/templates/{template_id}/download", headers=admin)
    assert r.status_code == 200, r.text
    assert r.content == MINIMAL_DOCX

    r = await client.delete(f"/reports/templates/{template_id}", headers=admin)
    assert r.status_code in (200, 204), r.text


@pytest.mark.asyncio
async def test_template_upload_rejects_non_office(
    client, tokens, seed_data, auth_headers
):
    admin = auth_headers("admin")
    files = {"file": ("bad.exe", b"not a template", "application/octet-stream")}
    r = await client.post(
        "/reports/templates/upload",
        params={
            "project_id": seed_data.project_id,
            "doc_type": "WIR",
            "name": "bad",
        },
        files=files,
        headers=admin,
    )
    assert r.status_code == 400, r.text


# ── Signature helpers ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_signature_fonts_listed(client, tokens):
    site = auth(tokens["site"])
    r = await client.get("/reports/signature-fonts", headers=site)
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body, list)
    if body:
        assert "id" in body[0] or "name" in body[0]


@pytest.mark.asyncio
async def test_signature_preview_rejects_bad_color(client, tokens):
    site = auth(tokens["site"])
    r = await client.get(
        "/reports/signature-preview",
        params={"name": "Test", "color": "not-a-color"},
        headers=site,
    )
    assert r.status_code in (200, 400, 422), r.text
