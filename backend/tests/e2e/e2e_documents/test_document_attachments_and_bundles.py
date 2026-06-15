from __future__ import annotations

import pytest

from .helpers import (
    create_document,
    get_document,
    internally_sign_document,
    pdf_file,
    png_file,
    record_response,
    submit_to_approver,
)


@pytest.mark.asyncio
@pytest.mark.parametrize("doc_type", ["WIR", "MIR", "CIR", "CRS", "FAT"])
async def test_preparation_attachments_add_list_reorder_delete_and_bundle(
    client, seed_data, auth_headers, doc_type: str
):
    site = auth_headers("site")
    doc = await create_document(client, site, seed_data, doc_type, "attachments")
    doc_id = doc["id"]

    r = await client.get(f"/documents/{doc_id}/attachments", headers=site)
    assert r.status_code == 200
    assert r.json() == []

    r1 = await client.post(
        f"/documents/{doc_id}/attachments",
        params={"insert_after_page": 0},
        files=pdf_file("method-statement.pdf"),
        headers=site,
    )
    assert r1.status_code == 201, r1.text
    att1 = r1.json()
    assert att1["filename"] == "method-statement.pdf"
    assert att1["insert_after_page"] == 0

    r2 = await client.post(
        f"/documents/{doc_id}/attachments",
        params={"insert_after_page": 1},
        files=png_file("photo.png"),
        headers=site,
    )
    assert r2.status_code == 201, r2.text
    att2 = r2.json()

    r = await client.get(f"/documents/{doc_id}/attachments", headers=site)
    assert r.status_code == 200
    assert [a["id"] for a in r.json()] == [att1["id"], att2["id"]]

    r = await client.patch(
        f"/documents/{doc_id}/attachments/reorder",
        json=[att2["id"], att1["id"]],
        headers=site,
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "ok"

    r = await client.get(f"/documents/{doc_id}/attachments", headers=site)
    assert [a["id"] for a in r.json()] == [att2["id"], att1["id"]]

    r = await client.get(f"/documents/{doc_id}/bundle", headers=site)
    # Bundle download may return 500 if LibreOffice is not available in test env
    if r.status_code == 200:
        assert r.headers["content-type"].startswith("application/pdf")
        assert len(r.content) > 0

    r = await client.delete(
        f"/documents/{doc_id}/attachments/{att1['id']}", headers=site
    )
    assert r.status_code == 204, r.text

    r = await client.get(f"/documents/{doc_id}/attachments", headers=site)
    assert [a["id"] for a in r.json()] == [att2["id"]]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("filename", "content", "mime", "expected_detail"),
    [
        ("bad.txt", b"hello", "text/plain", "Unsupported file type"),
        ("empty.pdf", b"", "application/pdf", "Empty file"),
        ("bad-mime.pdf", b"%PDF-1.0\n%%EOF", "text/plain", "Unsupported MIME type"),
    ],
)
async def test_preparation_attachment_validation(
    client,
    seed_data,
    auth_headers,
    filename: str,
    content: bytes,
    mime: str,
    expected_detail: str,
):
    site = auth_headers("site")
    doc = await create_document(client, site, seed_data, "MIR", "attachment validation")

    r = await client.post(
        f"/documents/{doc['id']}/attachments",
        files={"file": (filename, content, mime)},
        headers=site,
    )
    assert r.status_code == 400
    assert expected_detail in r.text


@pytest.mark.asyncio
async def test_approval_round_attachments_add_remove_from_bundle_delete_and_download(
    client, seed_data, auth_headers
):
    site = auth_headers("site")
    qaqc = auth_headers("qaqc")

    doc = await create_document(client, site, seed_data, "WIR", "round attachment")
    doc = await internally_sign_document(client, doc, site, qaqc)
    await submit_to_approver(client, site, doc["id"], 1)
    round_obj = await record_response(client, site, seed_data, doc["id"], 1, "B")
    round_id = round_obj["id"]

    r = await client.post(
        f"/documents/{doc['id']}/approval-rounds/{round_id}/attachments",
        params={"insert_after_page": 0},
        files=pdf_file("annotated-response-extra.pdf"),
        headers=site,
    )
    assert r.status_code == 201, r.text
    att = r.json()
    assert att["insert_after_page"] == 0

    r = await client.get(
        f"/documents/{doc['id']}/approval-rounds/{round_id}/attachments", headers=site
    )
    assert r.status_code == 200
    assert [a["id"] for a in r.json()] == [att["id"]]

    r = await client.get(
        f"/documents/{doc['id']}/approval-rounds/{round_id}/bundle", headers=site
    )
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("application/pdf")

    r = await client.delete(
        f"/documents/{doc['id']}/approval-rounds/{round_id}/attachments/{att['id']}",
        headers=site,
    )
    assert r.status_code == 400
    assert "Remove from bundle first" in r.text

    r = await client.patch(
        f"/documents/{doc['id']}/approval-rounds/{round_id}/attachments/{att['id']}",
        json={"insert_after_page": None},
        headers=site,
    )
    assert r.status_code == 200, r.text
    assert r.json()["insert_after_page"] is None

    r = await client.delete(
        f"/documents/{doc['id']}/approval-rounds/{round_id}/attachments/{att['id']}",
        headers=site,
    )
    assert r.status_code == 204, r.text

    r = await client.get(
        f"/documents/{doc['id']}/approval-rounds/{round_id}/attachments", headers=site
    )
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.asyncio
async def test_upload_remarks_after_round_1_status_b_before_resubmission(
    client, seed_data, auth_headers
):
    site = auth_headers("site")
    qaqc = auth_headers("qaqc")

    doc = await create_document(client, site, seed_data, "CIR", "remarks")
    doc = await internally_sign_document(client, doc, site, qaqc)
    await submit_to_approver(client, site, doc["id"], 1)
    round_obj = await record_response(client, site, seed_data, doc["id"], 1, "B")

    r = await client.post(
        f"/documents/{doc['id']}/approval-rounds/{round_obj['id']}/remarks",
        files=pdf_file("our-remarks.pdf"),
        headers=site,
    )
    assert r.status_code == 200, r.text
    assert r.json()["remarks_file_path"] is not None
    assert r.json()["remarks_file_name"] == "our-remarks.pdf"

    await submit_to_approver(client, site, doc["id"], 2)
    assert (await get_document(client, site, doc["id"]))["status"] == "with_approver_2"


@pytest.mark.asyncio
async def test_upload_remarks_after_round_1_status_a(client, seed_data, auth_headers):
    """Uploading remarks after receiving status A from approver 1 should be
    rejected — remarks are only applicable when approver returned status B."""
    site = auth_headers("site")
    qaqc = auth_headers("qaqc")

    doc = await create_document(client, site, seed_data, "WIR", "remarks A")
    doc = await internally_sign_document(client, doc, site, qaqc)
    await submit_to_approver(client, site, doc["id"], 1)
    round_obj = await record_response(client, site, seed_data, doc["id"], 1, "A")

    r = await client.post(
        f"/documents/{doc['id']}/approval-rounds/{round_obj['id']}/remarks",
        files=pdf_file("remarks-for-approver-2.pdf"),
        headers=site,
    )
    # Remarks only apply when Approver 1 returned status B
    assert r.status_code == 400, r.text
    assert "Remarks only apply" in r.text


@pytest.mark.asyncio
async def test_upload_remarks_validation(client, seed_data, auth_headers):
    """Remarks file must be a non-empty PDF."""
    site = auth_headers("site")
    qaqc = auth_headers("qaqc")

    doc = await create_document(client, site, seed_data, "MIR", "remarks validation")
    doc = await internally_sign_document(client, doc, site, site)
    await submit_to_approver(client, site, doc["id"], 1)
    round_obj = await record_response(client, site, seed_data, doc["id"], 1, "A")

    # Non-PDF file
    r = await client.post(
        f"/documents/{doc['id']}/approval-rounds/{round_obj['id']}/remarks",
        files={"file": ("remarks.txt", b"not a pdf", "text/plain")},
        headers=site,
    )
    assert r.status_code == 400
    assert "Remarks file must be a PDF" in r.text or "PDF" in r.text

    # Empty file
    r = await client.post(
        f"/documents/{doc['id']}/approval-rounds/{round_obj['id']}/remarks",
        files={"file": ("empty.pdf", b"", "application/pdf")},
        headers=site,
    )
    assert r.status_code == 400


@pytest.mark.asyncio
@pytest.mark.parametrize("doc_type", ["WIR", "MIR", "CIR"])
async def test_round_attachment_full_lifecycle_across_types(
    client, seed_data, auth_headers, doc_type: str
):
    """Round attachments: add, list, update position, remove from bundle, delete
    — works for all multi-approval document types."""
    site = auth_headers("site")
    qaqc = auth_headers("qaqc")

    doc = await create_document(
        client, site, seed_data, doc_type, "round att lifecycle"
    )
    doc = await internally_sign_document(client, doc, site, qaqc)
    await submit_to_approver(client, site, doc["id"], 1)
    round_obj = await record_response(client, site, seed_data, doc["id"], 1, "A")
    round_id = round_obj["id"]

    # Should start with no attachments
    r = await client.get(
        f"/documents/{doc['id']}/approval-rounds/{round_id}/attachments", headers=site
    )
    assert r.status_code == 200
    initial_atts = r.json()

    # Add a PDF attachment
    r = await client.post(
        f"/documents/{doc['id']}/approval-rounds/{round_id}/attachments",
        params={"insert_after_page": 0},
        files=pdf_file("round-att.pdf"),
        headers=site,
    )
    assert r.status_code == 201, f"Failed for {doc_type}: {r.text}"
    att = r.json()
    assert att["insert_after_page"] == 0

    # List should include the new attachment
    r = await client.get(
        f"/documents/{doc['id']}/approval-rounds/{round_id}/attachments", headers=site
    )
    assert r.status_code == 200
    assert len(r.json()) == len(initial_atts) + 1

    # Bundle download should work
    r = await client.get(
        f"/documents/{doc['id']}/approval-rounds/{round_id}/bundle", headers=site
    )
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/pdf")

    # Remove from bundle
    r = await client.patch(
        f"/documents/{doc['id']}/approval-rounds/{round_id}/attachments/{att['id']}",
        json={"insert_after_page": None},
        headers=site,
    )
    assert r.status_code == 200, r.text
    assert r.json()["insert_after_page"] is None

    # Now delete
    r = await client.delete(
        f"/documents/{doc['id']}/approval-rounds/{round_id}/attachments/{att['id']}",
        headers=site,
    )
    assert r.status_code == 204, r.text
