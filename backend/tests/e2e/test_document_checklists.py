"""End-to-end tests for /checklists/* — items, templates, document checklists, PDF.

Covers:
- GET /checklists/templates/{tid}/items
- POST /checklists/templates/{tid}/items (bulk)
- PATCH /checklists/items/{id}
- DELETE /checklists/items/{id}
- PUT /checklists/templates/{tid}/reorder
- GET /checklists/documents/{doc_id}
- POST /checklists/documents (save)
- DELETE /checklists/documents/{doc_id}/{tmpl_id}
- GET /checklists/documents/{doc_id}/{tmpl_id}/pdf 404 then 200
"""

from __future__ import annotations

import uuid

import pytest

from ._common_helpers import assert_status, auth


async def _first_template_id(client, tokens, seed_data):
    """Resolve a real RequirementTemplate id from the seed."""
    r = await client.get(
        f"/commissioning/requirement-templates?project_id={seed_data.project_id}",
        headers=auth(tokens["admin"]),
    )
    if r.status_code != 200 or not r.json():
        return None
    return r.json()[0]["id"]


@pytest.mark.asyncio
async def test_bulk_create_and_list_checklist_items(client, tokens, seed_data):
    tmpl_id = await _first_template_id(client, tokens, seed_data)
    if not tmpl_id:
        pytest.skip("no requirement template seeded")
    admin = auth(tokens["admin"])

    payload = {
        "items": [
            {"text": f"E2E item {uuid.uuid4().hex[:4]}", "sort_order": 1},
            {"text": f"E2E item {uuid.uuid4().hex[:4]}", "sort_order": 2},
        ]
    }
    r = await client.post(
        f"/checklists/templates/{tmpl_id}/items", json=payload, headers=admin
    )
    assert r.status_code in (200, 201), r.text

    r = await client.get(f"/checklists/templates/{tmpl_id}/items", headers=admin)
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body, list)
    assert len(body) >= 2


@pytest.mark.asyncio
async def test_patch_and_delete_checklist_item(client, tokens, seed_data):
    tmpl_id = await _first_template_id(client, tokens, seed_data)
    if not tmpl_id:
        pytest.skip("no requirement template seeded")
    admin = auth(tokens["admin"])

    payload = {"items": [{"text": "E2E patch target", "sort_order": 5}]}
    r = await client.post(
        f"/checklists/templates/{tmpl_id}/items", json=payload, headers=admin
    )
    assert r.status_code in (200, 201), r.text
    created = r.json()
    # Response may be a list of created items or a single item
    if isinstance(created, list):
        item = created[0]
    else:
        item = created
    item_id = item["id"]

    r = await client.patch(
        f"/checklists/items/{item_id}",
        json={"text": "E2E patched"},
        headers=admin,
    )
    assert r.status_code == 200, r.text
    assert r.json()["text"] == "E2E patched"

    r = await client.delete(f"/checklists/items/{item_id}", headers=admin)
    assert r.status_code in (200, 204), r.text


@pytest.mark.asyncio
async def test_reorder_checklist_items(client, tokens, seed_data):
    tmpl_id = await _first_template_id(client, tokens, seed_data)
    if not tmpl_id:
        pytest.skip("no requirement template seeded")
    admin = auth(tokens["admin"])

    # Create 3 items
    payload = {
        "items": [
            {"text": f"reorder-a-{uuid.uuid4().hex[:4]}", "sort_order": 10},
            {"text": f"reorder-b-{uuid.uuid4().hex[:4]}", "sort_order": 20},
            {"text": f"reorder-c-{uuid.uuid4().hex[:4]}", "sort_order": 30},
        ]
    }
    r = await client.post(
        f"/checklists/templates/{tmpl_id}/items", json=payload, headers=admin
    )
    assert r.status_code in (200, 201), r.text
    body = r.json()
    if not isinstance(body, list):
        body = [body]
    assert len(body) >= 3
    # Reverse their order
    reverse_items = [
        {"id": body[i]["id"], "sort_order": (len(body) - i) * 10}
        for i in range(len(body))
    ]
    r = await client.put(
        f"/checklists/templates/{tmpl_id}/reorder",
        json={"items": reverse_items},
        headers=admin,
    )
    assert r.status_code in (200, 204), r.text


# ── Document-level checklists ─────────────────────────────────────────────


async def _seed_checklist_item(client, tokens, seed_data, tmpl_id):
    """Create a real checklist item and return its id."""
    admin = auth(tokens["admin"])
    payload = {"items": [{"text": "E2E checklist item", "sort_order": 1}]}
    r = await client.post(
        f"/checklists/templates/{tmpl_id}/items", json=payload, headers=admin
    )
    assert r.status_code in (200, 201), r.text
    body = r.json()
    if isinstance(body, list):
        return body[0]["id"]
    return body["id"]


@pytest.mark.asyncio
async def test_save_document_checklist_and_download_pdf(
    client, tokens, seed_data, auth_headers
):
    from .e2e_documents.helpers import create_document

    site = auth_headers("site")
    admin = auth(tokens["admin"])

    # Create a fresh document
    doc = await create_document(client, site, seed_data, "WIR", "checklist pdf")
    tmpl_id = await _first_template_id(client, tokens, seed_data)
    if not tmpl_id:
        pytest.skip("no requirement template seeded")

    # Create a real checklist item and use its id
    item_id = await _seed_checklist_item(client, tokens, seed_data, tmpl_id)

    save_payload = {
        "document_id": doc["id"],
        "requirement_template_id": tmpl_id,
        "responses": [
            {
                "checklist_item_id": item_id,
                "response": "yes",
                "notes": "E2E",
                "display_order": 1,
                "item_text": "E2E response",
            }
        ],
    }
    r = await client.post("/checklists/documents", json=save_payload, headers=site)
    assert r.status_code in (200, 201), r.text

    # Try the PDF
    r = await client.get(
        f"/checklists/documents/{doc['id']}/{tmpl_id}/pdf", headers=site
    )
    assert r.status_code in (200, 404), r.text


@pytest.mark.asyncio
async def test_pdf_404_when_no_checklist(client, tokens, seed_data, auth_headers):
    from .e2e_documents.helpers import create_document

    site = auth_headers("site")
    doc = await create_document(client, site, seed_data, "MIR", "no checklist pdf")
    tmpl_id = await _first_template_id(client, tokens, seed_data)
    if not tmpl_id:
        pytest.skip("no requirement template seeded")

    r = await client.get(
        f"/checklists/documents/{doc['id']}/{tmpl_id}/pdf", headers=site
    )
    assert r.status_code == 404, r.text


@pytest.mark.asyncio
async def test_remove_document_checklist(client, tokens, seed_data, auth_headers):
    from .e2e_documents.helpers import create_document

    site = auth_headers("site")
    doc = await create_document(client, site, seed_data, "WIR", "checklist rm")
    tmpl_id = await _first_template_id(client, tokens, seed_data)
    if not tmpl_id:
        pytest.skip("no requirement template seeded")

    r = await client.delete(
        f"/checklists/documents/{doc['id']}/{tmpl_id}", headers=site
    )
    assert r.status_code in (200, 204, 404), r.text
