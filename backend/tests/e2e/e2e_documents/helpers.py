from __future__ import annotations

from typing import Any

import httpx

from .conftest import MINIMAL_PDF, MINIMAL_PNG, DocumentSeedData


def pdf_file(name: str = "file.pdf") -> dict[str, tuple[str, bytes, str]]:
    return {"file": (name, MINIMAL_PDF, "application/pdf")}


def png_file(name: str = "image.png") -> dict[str, tuple[str, bytes, str]]:
    return {"file": (name, MINIMAL_PNG, "image/png")}


def first_asset_id(seed: DocumentSeedData, preferred: str = "GEN-01") -> str:
    return seed.asset_ids.get(preferred) or next(iter(seed.asset_ids.values()))


def document_payload(seed: DocumentSeedData, doc_type: str, title_suffix: str = "") -> dict[str, Any]:
    asset_id = first_asset_id(seed)
    base: dict[str, Any] = {
        "project_id": seed.project_id,
        "document_type": doc_type,
        "title": f"E2E {doc_type} {title_suffix}".strip(),
        "description": f"E2E generated {doc_type} document",
        "discipline_id": seed.discipline_id,
        "asset_ids": [asset_id],
    }
    if doc_type in {"WIR", "CIR"}:
        base.update(
            {
                "location": "E2E Area A",
                "floor_level": "L01",
                "rams_ref": "RAMS-E2E-001",
                "drawing_ref": "DWG-E2E-001",
                "inspection_date": "2026-06-01T09:00:00Z",
                "remarks_1": "initial inspector remarks",
                "inspector_date_1": "2026-06-01",
                "inspector_time_1": "09:00",
            }
        )
    if doc_type == "MIR":
        base.update(
            {
                "delivery_note": "DN-E2E-001",
                "material_submittals": "MS-E2E-001",
                "qty": "1 lot",
            }
        )
    if doc_type == "FAT":
        base.update({"description": "FAT certificate package"})
    if doc_type == "CRS":
        base.update(
            {
                "crs_data": {
                    "subject": "E2E comment response sheet",
                    "comments": [
                        {
                            "no": 1,
                            "originator_comment": "Clarify installation sequence",
                            "contractor_response": "Sequence clarified and attached.",
                            "status": "open",
                        }
                    ],
                }
            }
        )
    return base


MULTI_APPROVAL_TYPES = {"WIR", "MIR", "CIR"}
"""Document types that go through the external approval workflow (excludes FAT and CRS which are auto-approved)."""


# ── CRUD ────────────────────────────────────────────────────────────────────────


async def create_document(
    client: httpx.AsyncClient,
    headers: dict[str, str],
    seed: DocumentSeedData,
    doc_type: str,
    title_suffix: str = "",
    extra: dict[str, Any] | None = None,
    expected_status: int = 201,
) -> dict[str, Any]:
    payload = document_payload(seed, doc_type, title_suffix)
    if extra:
        payload.update(extra)
    r = await client.post("/documents", json=payload, headers=headers)
    assert r.status_code == expected_status, f"create {doc_type} failed: {r.status_code} {r.text}"
    return r.json() if r.content else {"status_code": r.status_code}


async def get_document(
    client: httpx.AsyncClient,
    headers: dict[str, str],
    doc_id: str,
    expected_status: int = 200,
) -> dict[str, Any]:
    r = await client.get(f"/documents/{doc_id}", headers=headers)
    assert r.status_code == expected_status, f"get doc failed: {r.status_code} {r.text}"
    return r.json() if r.content else {}


async def get_document_list(
    client: httpx.AsyncClient,
    headers: dict[str, str],
    project_id: str,
    document_type: str | None = None,
    status: str | None = None,
    expected_status: int = 200,
) -> list[dict[str, Any]]:
    params: dict[str, str] = {"project_id": project_id}
    if document_type:
        params["document_type"] = document_type
    if status:
        params["status"] = status
    r = await client.get("/documents", params=params, headers=headers)
    assert r.status_code == expected_status, f"list docs failed: {r.status_code} {r.text}"
    return r.json() if r.content else []


async def update_document(
    client: httpx.AsyncClient,
    headers: dict[str, str],
    doc_id: str,
    payload: dict[str, Any],
    expected_status: int = 200,
) -> dict[str, Any]:
    r = await client.patch(f"/documents/{doc_id}", json=payload, headers=headers)
    assert r.status_code == expected_status, f"update doc failed: {r.status_code} {r.text}"
    return r.json() if r.content else {}


async def delete_document(
    client: httpx.AsyncClient,
    headers: dict[str, str],
    doc_id: str,
    expected_status: int = 204,
) -> None:
    r = await client.delete(f"/documents/{doc_id}", headers=headers)
    assert r.status_code == expected_status, f"delete doc failed: {r.status_code} {r.text}"


async def list_rejected_for_revision(
    client: httpx.AsyncClient,
    headers: dict[str, str],
    project_id: str,
    document_type: str | None = None,
    expected_status: int = 200,
) -> list[dict[str, Any]]:
    """List rejected documents available for revision.

    The API returns docs grouped by discipline name; the helper flattens
    that into a single list for easier test assertions.
    """
    params: dict[str, str] = {"project_id": project_id}
    if document_type:
        params["document_type"] = document_type
    r = await client.get("/documents/rejected-for-revision", params=params, headers=headers)
    assert r.status_code == expected_status, f"rejected-for-revision failed: {r.status_code} {r.text}"
    grouped = r.json() if r.content else {}
    flat: list[dict[str, Any]] = []
    for docs in grouped.values():
        flat.extend(docs)
    return flat


# ── Signing ─────────────────────────────────────────────────────────────────────


async def sign_document(
    client: httpx.AsyncClient,
    doc_id: str,
    role: str,
    headers: dict[str, str],
    expected_status: str | None = None,
    on_behalf_of: str | None = None,
) -> dict[str, Any]:
    url = f"/documents/{doc_id}/sign?role={role}"
    if on_behalf_of:
        url += f"&on_behalf_of={on_behalf_of}"
    r = await client.post(url, headers=headers)
    assert r.status_code == 200, f"sign {role} failed: {r.status_code} {r.text}"
    doc = r.json()
    if expected_status is not None:
        assert doc["status"] == expected_status
    return doc


async def unsign_document(
    client: httpx.AsyncClient,
    doc_id: str,
    role: str,
    headers: dict[str, str],
    expected_status: int = 200,
) -> dict[str, Any]:
    r = await client.post(f"/documents/{doc_id}/unsign?role={role}", headers=headers)
    assert r.status_code == expected_status, f"unsign {role} failed: {r.status_code} {r.text}"
    return r.json() if r.content else {}


async def notify_signatories(
    client: httpx.AsyncClient,
    doc_id: str,
    headers: dict[str, str],
    expected_status: int = 200,
) -> dict[str, Any]:
    r = await client.post(f"/documents/{doc_id}/notify-signatories", headers=headers)
    assert r.status_code == expected_status, f"notify failed: {r.status_code} {r.text}"
    return r.json() if r.content else {}


async def internally_sign_document(
    client: httpx.AsyncClient,
    doc: dict[str, Any],
    site_headers: dict[str, str],
    qaqc_headers: dict[str, str],
) -> dict[str, Any]:
    """Sign a document through to internally_signed status.

    MIR needs only site_engineer. WIR and CIR need both site_engineer
    and qaqc_engineer. FAT and CRS cannot be signed (auto-approved on create).
    """
    doc_type = doc["document_type"]
    doc_id = doc["id"]
    if doc_type in ("FAT", "CRS"):
        # FAT and CRS are already approved — signing is not applicable
        return doc
    if doc_type == "MIR":
        return await sign_document(client, doc_id, "site_engineer", site_headers, "internally_signed")
    await sign_document(client, doc_id, "site_engineer", site_headers, "draft")
    return await sign_document(client, doc_id, "qaqc_engineer", qaqc_headers, "internally_signed")


# ── Approval workflow ───────────────────────────────────────────────────────────


async def submit_to_approver(
    client: httpx.AsyncClient,
    headers: dict[str, str],
    doc_id: str,
    order: int,
    date: str = "2026-06-02",
    expected_status: int = 201,
) -> dict[str, Any] | None:
    r = await client.post(
        f"/documents/{doc_id}/submit-to-approver",
        json={"approver_order": order, "aconex_submitted_date": date},
        headers=headers,
    )
    assert r.status_code == expected_status, f"submit order {order} got {r.status_code}: {r.text}"
    return r.json() if r.content else None


async def record_response(
    client: httpx.AsyncClient,
    headers: dict[str, str],
    seed: DocumentSeedData,
    doc_id: str,
    order: int,
    status_letter: str,
    date: str = "2026-06-03",
    comments: str | None = None,
    signatory_name: str | None = None,
    expected_status: int = 201,
) -> dict[str, Any] | None:
    r = await client.post(
        f"/documents/{doc_id}/approval-rounds",
        params={
            "approver_order": order,
            "decision_status_id": seed.approval_status_ids[status_letter],
            "signatory_name": signatory_name or f"Approver {order} {status_letter}",
            "response_date": date,
            "response_time": "10:15",
            "comments": comments or f"Decision {status_letter}",
            "aconex_received_date": date,
        },
        files=pdf_file(f"R{order}_{status_letter}.pdf"),
        headers=headers,
    )
    assert r.status_code == expected_status, f"record response got {r.status_code}: {r.text}"
    return r.json() if r.content else None


async def list_approval_rounds(
    client: httpx.AsyncClient,
    headers: dict[str, str],
    doc_id: str,
    expected_status: int = 200,
) -> list[dict[str, Any]]:
    r = await client.get(f"/documents/{doc_id}/approval-rounds", headers=headers)
    assert r.status_code == expected_status, f"list rounds failed: {r.status_code} {r.text}"
    return r.json() if r.content else []


# ── Stage files ─────────────────────────────────────────────────────────────────


async def download_stage_file(
    client: httpx.AsyncClient,
    headers: dict[str, str],
    doc_id: str,
    stage: str,
    expected_status: int = 200,
) -> httpx.Response:
    r = await client.get(f"/documents/{doc_id}/files/{stage}", headers=headers)
    assert r.status_code == expected_status, f"download {stage} got {r.status_code}: {r.text}"
    return r


async def replace_round_file(
    client: httpx.AsyncClient,
    headers: dict[str, str],
    doc_id: str,
    round_id: str,
    file_data: dict | None = None,
    signatory_name: str | None = None,
    response_date: str | None = None,
    response_time: str | None = None,
    comments: str | None = None,
    expected_status: int = 200,
) -> dict[str, Any]:
    data: dict[str, Any] = {}
    files: dict[str, tuple[str, bytes, str]] = {}
    if file_data is None:
        file_data = pdf_file("replaced.pdf")
    files.update(file_data)
    if signatory_name:
        data["signatory_name"] = signatory_name
    if response_date:
        data["response_date"] = response_date
    if response_time:
        data["response_time"] = response_time
    if comments:
        data["comments"] = comments
    r = await client.put(
        f"/documents/{doc_id}/approval-rounds/{round_id}/file",
        data=data,
        files=files,
        headers=headers,
    )
    assert r.status_code == expected_status, f"replace round file got {r.status_code}: {r.text}"
    return r.json() if r.content else {}


async def upload_round_remarks(
    client: httpx.AsyncClient,
    headers: dict[str, str],
    doc_id: str,
    round_id: str,
    file_data: dict | None = None,
    expected_status: int = 200,
) -> dict[str, Any]:
    if file_data is None:
        file_data = pdf_file("remarks.pdf")
    r = await client.post(
        f"/documents/{doc_id}/approval-rounds/{round_id}/remarks",
        files=file_data,
        headers=headers,
    )
    assert r.status_code == expected_status, f"upload remarks got {r.status_code}: {r.text}"
    return r.json() if r.content else {}


# ── Commissioning ───────────────────────────────────────────────────────────────


async def link_requirement(
    client: httpx.AsyncClient,
    headers: dict[str, str],
    seed: DocumentSeedData,
    doc: dict[str, Any],
) -> None:
    doc_type = doc["document_type"]
    if doc_type == "CRS" or doc_type not in seed.asset_requirement_ids:
        return
    r = await client.post(
        "/commissioning/document-links",
        json={
            "document_id": doc["id"],
            "asset_requirement_id": seed.asset_requirement_ids[doc_type],
        },
        headers=headers,
    )
    assert r.status_code in {200, 201}, f"link requirement failed: {r.status_code} {r.text}"


async def get_asset_requirements(
    client: httpx.AsyncClient,
    headers: dict[str, str],
    asset_id: str,
    expected_status: int = 200,
) -> list[dict[str, Any]]:
    r = await client.get(
        f"/commissioning/asset-requirements?asset_id={asset_id}",
        headers=headers,
    )
    assert r.status_code == expected_status, f"get asset requirements failed: {r.status_code} {r.text}"
    return r.json() if r.content else []
