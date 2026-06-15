"""End-to-end tests for /ref-config/* — reference number patterns.

Covers:
- GET /ref-config?project_id= returns list
- POST /ref-config upserts by (project, doc_type)
- POST /ref-config rejects patterns with unknown placeholders
- POST /ref-config rejects attribute access in placeholders ({0.__class__})
- DELETE /ref-config/{id} soft-deletes
"""

from __future__ import annotations

import uuid

import pytest

from ._common_helpers import assert_status, auth
from .e2e_documents.helpers import create_document


@pytest.mark.asyncio
async def test_get_ref_config_for_project(client, tokens, seed_data):
    site = auth(tokens["site"])
    r = await client.get(f"/ref-config?project_id={seed_data.project_id}", headers=site)
    assert r.status_code == 200, r.text
    assert isinstance(r.json(), list)


@pytest.mark.asyncio
async def test_upsert_ref_config_drives_new_doc_reference(
    client, tokens, seed_data, auth_headers
):
    admin = auth(tokens["admin"])
    site = auth_headers("site")

    pattern = (
        "{project_code}-{contractor_code}-{discipline_code}-{doc_type}-{serial:03d}"
    )
    payload = {
        "project_id": seed_data.project_id,
        "doc_type": "WIR",
        "pattern": pattern,
        "project_code": "E2E",
        "contractor_code": "CN",
        "serial_start": 1000,
    }
    r = await client.post("/ref-config", json=payload, headers=admin)
    assert r.status_code in (200, 201), r.text
    config = r.json()
    assert config["pattern"] == pattern

    # Now create a WIR document; reference_no should follow the new pattern
    doc = await create_document(client, site, seed_data, "WIR", "ref config drives ref")
    assert doc["reference_no"].startswith("E2E-CN-"), doc["reference_no"]
    assert "-WIR-" in doc["reference_no"]


@pytest.mark.asyncio
async def test_ref_config_rejects_unknown_placeholder(client, tokens, seed_data):
    admin = auth(tokens["admin"])
    payload = {
        "project_id": seed_data.project_id,
        "doc_type": "MIR",
        "pattern": "{unknown_placeholder}-{serial:03d}",
        "project_code": "E2E",
    }
    r = await client.post("/ref-config", json=payload, headers=admin)
    assert r.status_code == 400, r.text
    assert "placeholder" in r.text.lower() or "unknown" in r.text.lower(), r.text


@pytest.mark.asyncio
async def test_ref_config_rejects_attribute_access_in_placeholder(
    client, tokens, seed_data
):
    """Defends against format-string traversal: {0.__class__} must be rejected."""
    admin = auth(tokens["admin"])
    payload = {
        "project_id": seed_data.project_id,
        "doc_type": "CIR",
        "pattern": "{0.__class__}-{serial:03d}",
        "project_code": "E2E",
    }
    r = await client.post("/ref-config", json=payload, headers=admin)
    assert r.status_code == 400, r.text


@pytest.mark.asyncio
async def test_ref_config_delete(client, tokens, seed_data, auth_headers):
    admin = auth_headers("admin")
    payload = {
        "project_id": seed_data.project_id,
        "doc_type": "FAT",
        "pattern": "{project_code}-{doc_type}-{serial:03d}",
        "project_code": "E2E",
    }
    r = await client.post("/ref-config", json=payload, headers=admin)
    assert r.status_code in (200, 201), r.text
    config_id = r.json()["id"]

    r = await client.delete(f"/ref-config/{config_id}", headers=admin)
    assert r.status_code in (200, 204), r.text

    r = await client.get(
        f"/ref-config?project_id={seed_data.project_id}", headers=admin
    )
    assert all(c["id"] != config_id for c in r.json()), r.json()
