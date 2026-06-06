"""
End-to-end test of approval workflows for WIR, MIR, CIR, and FAT.
Tests the full lifecycle via HTTP API calls against the running backend.

Each test creates exactly one document. To keep the dev DB clean across
re-runs, every test hard-deletes its document (and any work items it
created) in a finally block, bypassing the API's soft-delete behaviour.
"""
import io
import httpx
import asyncio
import pytest
from uuid import uuid4

from tests.e2e._config import BASE
from tests.helpers.cleanup import hard_delete_documents


# --- Test Data ---
PROJECT_ID = "61de59c0-eb71-42ad-90f4-81f561c80ac1"
DISCIPLINE_ID = "54927b47-fc63-4382-ad5b-02d92388fd3c"
ASSET_GEN1 = "36cbe2c9-1c0e-4ff9-91a0-24d34d4d12c3"
ASSET_GEN2 = "1858d0ee-2378-43a0-ae4c-434373a6bd2d"

# Asset requirements
AR_WIR_WB = "bd38f69e-5810-48dc-98ad-e9aad837a754"  # Power Cable Installation (work breakdown)
AR_WIR_NO_WB = "ac5ec2da-6cb2-44fb-902f-2d7b1d82b94b"  # Equipment Placement & Anchoring
AR_MIR = "746de3bf-424e-443e-9cd2-0be704d56d26"  # Equipment Delivery
AR_CIR = "4a64ebd9-4867-4d0f-adeb-9467d1a4df34"  # Insulation Resistance Test
AR_FAT = "22f1cd50-446d-4d65-9686-7e902f94d0b7"  # Factory Acceptance Test (Gen 2)

# Approval statuses
STATUS_A = "f456470a-9665-44a8-bef9-57b1b477dee9"
STATUS_B = "1f33df66-9530-4978-ab9c-41d5356a5eec"

# Minimal valid PDF (1 page)
MINIMAL_PDF = (
    b"%PDF-1.0\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
    b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
    b"3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R>>endobj\n"
    b"xref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n"
    b"0000000058 00000 n \n0000000115 00000 n \n"
    b"trailer<</Size 4/Root 1 0 R>>\nstartxref\n190\n%%EOF"
)


async def login(client: httpx.AsyncClient, email: str, password: str) -> str:
    r = await client.post(f"{BASE}/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"Login failed for {email}: {r.text}"
    return r.json()["access_token"]


@pytest.mark.asyncio
async def test_wir_e2e(client: httpx.AsyncClient):
    """WIR: create -> sign (both) -> submit approver 1 -> record A -> submit approver 2 -> record A -> verify achievement"""
    print("\n=== WIR END-TO-END TEST ===")

    # Login as site engineer (creator + signatory 1)
    site_token = await login(client, "site@jlwme.com", "Site1234")
    site_headers = {"Authorization": f"Bearer {site_token}"}

    # Login as qaqc engineer (signatory 2)
    qaqc_token = await login(client, "qaqc@jlwme.com", "Qaqc1234")
    qaqc_headers = {"Authorization": f"Bearer {qaqc_token}"}

    # Track resources for teardown (populated inside the try, used in finally)
    doc_id: str | None = None
    wi_ids: list[str] = []

    try:
        # 1. Create WIR
        print("  1. Creating WIR...")
        r = await client.post(f"{BASE}/documents", json={
            "project_id": PROJECT_ID,
            "document_type": "WIR",
            "title": "Power Cable Installation - Generator 1 to MDB-1",
            "discipline_id": DISCIPLINE_ID,
            "location": "POD 3, Level 1",
            "asset_ids": [ASSET_GEN1],
        }, headers=site_headers)
        assert r.status_code == 201, f"Create WIR failed: {r.text}"
        doc = r.json()
        doc_id = doc["id"]
        print(f"     Created: {doc['reference_no']} (status={doc['status']})")
        assert doc["status"] == "draft"

        # 2. Create work items for the work-breakdown requirement
        print("  2. Creating work items...")
        for i, name in enumerate(["Gen1 to MDB-1A", "Gen1 to MDB-1B"], 1):
            r = await client.post(f"{BASE}/commissioning/work-items", json={
                "asset_requirement_id": AR_WIR_WB,
                "name": name,
                "sequence_no": i,
                "created_dynamically": True,
            }, headers=site_headers)
            assert r.status_code == 201, f"Create work item failed: {r.text}"
            wi_ids.append(r.json()["id"])
        print(f"     Created {len(wi_ids)} work items")

        # 3. Create document-requirement links (with work items)
        print("  3. Linking document to requirements...")
        for wi_id in wi_ids:
            r = await client.post(f"{BASE}/commissioning/document-links", json={
                "document_id": doc_id,
                "asset_requirement_id": AR_WIR_WB,
                "requirement_work_item_id": wi_id,
            }, headers=site_headers)
            assert r.status_code == 201, f"Create link failed: {r.text}"
        print(f"     Linked to {len(wi_ids)} work items")

        # 4. Sign as site engineer
        print("  4. Signing as site_engineer...")
        r = await client.post(f"{BASE}/documents/{doc_id}/sign?role=site_engineer", headers=site_headers)
        assert r.status_code == 200, f"Sign failed: {r.text}"
        assert r.json()["site_engineer_signed"] is True
        assert r.json()["status"] == "draft"  # Still draft, needs qaqc sig
        print(f"     Signed (status={r.json()['status']})")

        # 5. Sign as qaqc engineer
        print("  5. Signing as qaqc_engineer...")
        r = await client.post(f"{BASE}/documents/{doc_id}/sign?role=qaqc_engineer", headers=qaqc_headers)
        assert r.status_code == 200, f"Sign failed: {r.text}"
        assert r.json()["qaqc_engineer_signed"] is True
        assert r.json()["status"] == "internally_signed"
        print(f"     Signed (status={r.json()['status']})")

        # 6. Submit to Approver 1
        print("  6. Submitting to Approver 1 (RED Engineering)...")
        r = await client.post(f"{BASE}/documents/{doc_id}/submit-to-approver", json={
            "approver_order": 1,
            "aconex_submitted_date": "2026-05-28",
        }, headers=site_headers)
        assert r.status_code == 201, f"Submit to approver 1 failed: {r.text}"
        rnd = r.json()
        round1_id = rnd["id"]
        assert rnd["submitted_file_path"] == f"responses/{doc_id}/S1.pdf"
        assert rnd["submitted_file_size"] > 0
        print(f"     Submitted (round_id={round1_id}, size={rnd['submitted_file_size']})")

        # Verify doc status
        r = await client.get(f"{BASE}/documents/{doc_id}", headers=site_headers)
        assert r.json()["status"] == "with_approver_1"
        print(f"     Doc status: {r.json()['status']}")

        # 7. Record Approver 1 Response (Status A - Approved)
        print("  7. Recording Approver 1 response (A - Approved)...")
        r = await client.post(
            f"{BASE}/documents/{doc_id}/approval-rounds",
            params={
                "approver_order": 1,
                "decision_status_id": STATUS_A,
                "signatory_name": "Ahmed Al-Rashid",
                "response_date": "2026-05-29",
                "comments": "Approved. Good work.",
                "aconex_received_date": "2026-05-29",
            },
            files={"file": ("returned.pdf", MINIMAL_PDF, "application/pdf")},
            headers=site_headers,
        )
        assert r.status_code == 201, f"Record response failed: {r.text}"
        rnd = r.json()
        assert rnd["returned_file_path"] == f"responses/{doc_id}/R1.pdf"
        assert rnd["returned_file_locked"] is False
        print(f"     Recorded (status now: approver_1_returned)")

        # Verify doc status
        r = await client.get(f"{BASE}/documents/{doc_id}", headers=site_headers)
        assert r.json()["status"] == "approver_1_returned"

        # 8. Submit to Approver 2
        print("  8. Submitting to Approver 2 (Sudlows)...")
        r = await client.post(f"{BASE}/documents/{doc_id}/submit-to-approver", json={
            "approver_order": 2,
            "aconex_submitted_date": "2026-05-29",
        }, headers=site_headers)
        assert r.status_code == 201, f"Submit to approver 2 failed: {r.text}"
        rnd = r.json()
        assert rnd["submitted_file_path"] == f"responses/{doc_id}/S2.pdf"
        assert rnd["submitted_file_size"] > 0
        print(f"     Submitted (size={rnd['submitted_file_size']})")

        # Verify doc status
        r = await client.get(f"{BASE}/documents/{doc_id}", headers=site_headers)
        assert r.json()["status"] == "with_approver_2"
        print(f"     Doc status: {r.json()['status']}")

        # 9. Record Approver 2 Response (Status A - Approved)
        print("  9. Recording Approver 2 response (A - Approved)...")
        r = await client.post(
            f"{BASE}/documents/{doc_id}/approval-rounds",
            params={
                "approver_order": 2,
                "decision_status_id": STATUS_A,
                "signatory_name": "James Wilson",
                "response_date": "2026-05-30",
                "comments": "Final approval granted.",
                "aconex_received_date": "2026-05-30",
            },
            files={"file": ("returned.pdf", MINIMAL_PDF, "application/pdf")},
            headers=site_headers,
        )
        assert r.status_code == 201, f"Record response failed: {r.text}"

        # Verify doc status = approved
        r = await client.get(f"{BASE}/documents/{doc_id}", headers=site_headers)
        assert r.json()["status"] == "approved", f"Expected approved, got {r.json()['status']}"
        print(f"     Doc status: {r.json()['status']}")

        # 10. Verify commissioning achievement
        print("  10. Verifying commissioning status...")
        r = await client.get(f"{BASE}/commissioning/asset-requirements?asset_id={ASSET_GEN1}", headers=site_headers)
        assert r.status_code == 200
        reqs = r.json()
        wir_wb_req = next((req for req in reqs if req["id"] == AR_WIR_WB), None)
        assert wir_wb_req is not None
        print(f"     Power Cable Installation: status={wir_wb_req['status']}, progress={wir_wb_req['progress_percent']}%")
        assert wir_wb_req["status"] == "achieved"
        assert wir_wb_req["progress_percent"] == 100.0

        print("  [PASS] WIR end-to-end test passed!")
        return doc_id
    finally:
        # Teardown: hard-delete the doc and remove the work items the test
        # created. Work items are unlinked by the document DELETE (their
        # linked_document_id is cleared); we delete them outright so they
        # don't accumulate on re-runs.
        if doc_id:
            try:
                deleted = await hard_delete_documents([doc_id])
                print(f"  cleanup: hard-deleted {deleted}/1 doc ({doc_id})")
            except Exception as e:  # noqa: BLE001
                print(f"  WARN: teardown hard_delete_documents({doc_id}) raised {e!r}")
        for wi_id in wi_ids:
            try:
                await client.delete(
                    f"{BASE}/commissioning/work-items/{wi_id}",
                    headers=site_headers,
                )
            except Exception as e:  # noqa: BLE001
                print(f"  WARN: teardown DELETE work-item {wi_id} raised {e!r}")

@pytest.mark.asyncio
async def test_mir_e2e(client: httpx.AsyncClient):
    """MIR: create -> sign (single) -> submit approver 1 -> record A -> submit approver 2 -> record A -> approved"""
    print("\n=== MIR END-TO-END TEST ===")

    site_token = await login(client, "site@jlwme.com", "Site1234")
    site_headers = {"Authorization": f"Bearer {site_token}"}

    doc_id: str | None = None

    try:
        # 1. Create MIR
        print("  1. Creating MIR...")
        r = await client.post(f"{BASE}/documents", json={
            "project_id": PROJECT_ID,
            "document_type": "MIR",
            "title": "Generator 1 - Equipment Delivery Inspection",
            "discipline_id": DISCIPLINE_ID,
            "delivery_note": "DN-2026-0451",
            "material_submittals": "MS-EL-0089",
            "qty": "1 unit",
            "asset_ids": [ASSET_GEN1],
        }, headers=site_headers)
        assert r.status_code == 201, f"Create MIR failed: {r.text}"
        doc = r.json()
        doc_id = doc["id"]
        print(f"     Created: {doc['reference_no']} (status={doc['status']})")

        # 2. Link to MIR requirement
        print("  2. Linking to Equipment Delivery requirement...")
        r = await client.post(f"{BASE}/commissioning/document-links", json={
            "document_id": doc_id,
            "asset_requirement_id": AR_MIR,
        }, headers=site_headers)
        assert r.status_code == 201, f"Create link failed: {r.text}"

        # 3. Sign as site engineer (MIR = single signatory)
        print("  3. Signing as site_engineer (single signatory for MIR)...")
        r = await client.post(f"{BASE}/documents/{doc_id}/sign?role=site_engineer", headers=site_headers)
        assert r.status_code == 200, f"Sign failed: {r.text}"
        assert r.json()["status"] == "internally_signed"  # MIR transitions after 1 sig
        print(f"     Signed (status={r.json()['status']})")

        # 4. Submit to Approver 1
        print("  4. Submitting to Approver 1 (RED Engineering)...")
        r = await client.post(f"{BASE}/documents/{doc_id}/submit-to-approver", json={
            "approver_order": 1,
            "aconex_submitted_date": "2026-05-28",
        }, headers=site_headers)
        assert r.status_code == 201, f"Submit failed: {r.text}"
        print(f"     Doc status: with_approver_1")

        # 5. Record Approver 1 Response (A)
        print("  5. Recording Approver 1 response (A)...")
        r = await client.post(
            f"{BASE}/documents/{doc_id}/approval-rounds",
            params={
                "approver_order": 1,
                "decision_status_id": STATUS_A,
                "signatory_name": "Khalid Mansour",
                "response_date": "2026-05-29",
                "aconex_received_date": "2026-05-29",
            },
            files={"file": ("returned.pdf", MINIMAL_PDF, "application/pdf")},
            headers=site_headers,
        )
        assert r.status_code == 201, f"Record response failed: {r.text}"

        # 6. Submit to Approver 2
        print("  6. Submitting to Approver 2 (Sudlows)...")
        r = await client.post(f"{BASE}/documents/{doc_id}/submit-to-approver", json={
            "approver_order": 2,
            "aconex_submitted_date": "2026-05-29",
        }, headers=site_headers)
        assert r.status_code == 201, f"Submit failed: {r.text}"

        # 7. Record Approver 2 Response (A)
        print("  7. Recording Approver 2 response (A)...")
        r = await client.post(
            f"{BASE}/documents/{doc_id}/approval-rounds",
            params={
                "approver_order": 2,
                "decision_status_id": STATUS_A,
                "signatory_name": "David Chen",
                "response_date": "2026-05-30",
                "aconex_received_date": "2026-05-30",
            },
            files={"file": ("returned.pdf", MINIMAL_PDF, "application/pdf")},
            headers=site_headers,
        )
        assert r.status_code == 201, f"Record response failed: {r.text}"

        # Verify final status
        r = await client.get(f"{BASE}/documents/{doc_id}", headers=site_headers)
        assert r.json()["status"] == "approved", f"Expected approved, got {r.json()['status']}"
        print(f"     Doc status: {r.json()['status']}")

        # Verify requirement achievement
        print("  8. Verifying commissioning status...")
        r = await client.get(f"{BASE}/commissioning/asset-requirements?asset_id={ASSET_GEN1}", headers=site_headers)
        reqs = r.json()
        mir_req = next((req for req in reqs if req["id"] == AR_MIR), None)
        assert mir_req["status"] == "achieved"
        print(f"     Equipment Delivery: status={mir_req['status']}")

        print("  [PASS] MIR end-to-end test passed!")
        return doc_id
    finally:
        if doc_id:
            try:
                deleted = await hard_delete_documents([doc_id])
                print(f"  cleanup: hard-deleted {deleted}/1 doc ({doc_id})")
            except Exception as e:  # noqa: BLE001
                print(f"  WARN: teardown hard_delete_documents({doc_id}) raised {e!r}")

@pytest.mark.asyncio
async def test_cir_e2e(client: httpx.AsyncClient):
    """CIR: create -> sign (both) -> submit approver 1 -> record A -> submit approver 2 -> record B -> approved_with_comments"""
    print("\n=== CIR END-TO-END TEST ===")

    site_token = await login(client, "site@jlwme.com", "Site1234")
    site_headers = {"Authorization": f"Bearer {site_token}"}
    qaqc_token = await login(client, "qaqc@jlwme.com", "Qaqc1234")
    qaqc_headers = {"Authorization": f"Bearer {qaqc_token}"}

    doc_id: str | None = None

    try:
        # 1. Create CIR
        print("  1. Creating CIR...")
        r = await client.post(f"{BASE}/documents", json={
            "project_id": PROJECT_ID,
            "document_type": "CIR",
            "title": "Insulation Resistance Test - Generator 1",
            "discipline_id": DISCIPLINE_ID,
            "location": "POD 3, Electrical Room",
            "asset_ids": [ASSET_GEN1],
        }, headers=site_headers)
        assert r.status_code == 201, f"Create CIR failed: {r.text}"
        doc = r.json()
        doc_id = doc["id"]
        print(f"     Created: {doc['reference_no']} (status={doc['status']})")

        # 2. Link to CIR requirement
        print("  2. Linking to Insulation Resistance Test requirement...")
        r = await client.post(f"{BASE}/commissioning/document-links", json={
            "document_id": doc_id,
            "asset_requirement_id": AR_CIR,
        }, headers=site_headers)
        assert r.status_code == 201, f"Create link failed: {r.text}"

        # 3. Sign as site engineer
        print("  3. Signing as site_engineer...")
        r = await client.post(f"{BASE}/documents/{doc_id}/sign?role=site_engineer", headers=site_headers)
        assert r.status_code == 200, f"Sign failed: {r.text}"
        assert r.json()["status"] == "draft"  # CIR needs both sigs
        print(f"     Signed (status={r.json()['status']})")

        # 4. Sign as qaqc engineer
        print("  4. Signing as qaqc_engineer...")
        r = await client.post(f"{BASE}/documents/{doc_id}/sign?role=qaqc_engineer", headers=qaqc_headers)
        assert r.status_code == 200, f"Sign failed: {r.text}"
        assert r.json()["status"] == "internally_signed"
        print(f"     Signed (status={r.json()['status']})")

        # 5. Submit to Approver 1 (AESG for CIR)
        print("  5. Submitting to Approver 1 (AESG)...")
        r = await client.post(f"{BASE}/documents/{doc_id}/submit-to-approver", json={
            "approver_order": 1,
            "aconex_submitted_date": "2026-05-28",
        }, headers=site_headers)
        assert r.status_code == 201, f"Submit failed: {r.text}"

        # 6. Record Approver 1 Response (A)
        print("  6. Recording Approver 1 response (A)...")
        r = await client.post(
            f"{BASE}/documents/{doc_id}/approval-rounds",
            params={
                "approver_order": 1,
                "decision_status_id": STATUS_A,
                "signatory_name": "Omar Farouk",
                "response_date": "2026-05-29",
                "aconex_received_date": "2026-05-29",
            },
            files={"file": ("returned.pdf", MINIMAL_PDF, "application/pdf")},
            headers=site_headers,
        )
        assert r.status_code == 201, f"Record response failed: {r.text}"

        # 7. Submit to Approver 2 (Core Emirates for CIR)
        print("  7. Submitting to Approver 2 (Core Emirates)...")
        r = await client.post(f"{BASE}/documents/{doc_id}/submit-to-approver", json={
            "approver_order": 2,
            "aconex_submitted_date": "2026-05-29",
        }, headers=site_headers)
        assert r.status_code == 201, f"Submit failed: {r.text}"

        # 8. Record Approver 2 Response (B - Approved with Comments)
        print("  8. Recording Approver 2 response (B - Approved with Comments)...")
        r = await client.post(
            f"{BASE}/documents/{doc_id}/approval-rounds",
            params={
                "approver_order": 2,
                "decision_status_id": STATUS_B,
                "signatory_name": "Rashid Al-Maktoum",
                "response_date": "2026-05-30",
                "comments": "Approved. Please incorporate minor comments on cable routing.",
                "aconex_received_date": "2026-05-30",
            },
            files={"file": ("returned.pdf", MINIMAL_PDF, "application/pdf")},
            headers=site_headers,
        )
        assert r.status_code == 201, f"Record response failed: {r.text}"

        # Verify final status
        r = await client.get(f"{BASE}/documents/{doc_id}", headers=site_headers)
        assert r.json()["status"] == "approved_with_comments", f"Expected approved_with_comments, got {r.json()['status']}"
        print(f"     Doc status: {r.json()['status']}")

        # Verify requirement achievement
        print("  9. Verifying commissioning status...")
        r = await client.get(f"{BASE}/commissioning/asset-requirements?asset_id={ASSET_GEN1}", headers=site_headers)
        reqs = r.json()
        cir_req = next((req for req in reqs if req["id"] == AR_CIR), None)
        assert cir_req["status"] == "achieved"
        print(f"     Insulation Resistance Test: status={cir_req['status']}")

        print("  [PASS] CIR end-to-end test passed!")
        return doc_id
    finally:
        if doc_id:
            try:
                deleted = await hard_delete_documents([doc_id])
                print(f"  cleanup: hard-deleted {deleted}/1 doc ({doc_id})")
            except Exception as e:  # noqa: BLE001
                print(f"  WARN: teardown hard_delete_documents({doc_id}) raised {e!r}")

@pytest.mark.asyncio
async def test_fat_e2e(client: httpx.AsyncClient):
    """FAT: create -> auto-approved -> verify requirement achievement"""
    print("\n=== FAT END-TO-END TEST ===")

    site_token = await login(client, "site@jlwme.com", "Site1234")
    site_headers = {"Authorization": f"Bearer {site_token}"}

    doc_id: str | None = None

    try:
        # 1. Create FAT (auto-approved on create)
        print("  1. Creating FAT...")
        r = await client.post(f"{BASE}/documents", json={
            "project_id": PROJECT_ID,
            "document_type": "FAT",
            "title": "Factory Acceptance Test - Generator 2",
            "description": "FAT certificate for 2500kVA Generator unit 2",
            "discipline_id": DISCIPLINE_ID,
            "asset_ids": [ASSET_GEN2],
        }, headers=site_headers)
        assert r.status_code == 201, f"Create FAT failed: {r.text}"
        doc = r.json()
        doc_id = doc["id"]
        print(f"     Created: {doc['reference_no']} (status={doc['status']})")
        assert doc["status"] == "approved"  # FAT is always approved on create

        # 2. Link to FAT requirement
        print("  2. Linking to Factory Acceptance Test requirement...")
        r = await client.post(f"{BASE}/commissioning/document-links", json={
            "document_id": doc_id,
            "asset_requirement_id": AR_FAT,
        }, headers=site_headers)
        assert r.status_code == 201, f"Create link failed: {r.text}"

        # 3. Verify requirement achievement (FAT is already approved)
        print("  3. Verifying commissioning status...")
        r = await client.get(f"{BASE}/commissioning/asset-requirements?asset_id={ASSET_GEN2}", headers=site_headers)
        reqs = r.json()
        fat_req = next((req for req in reqs if req["id"] == AR_FAT), None)
        assert fat_req is not None, "FAT requirement not found"
        assert fat_req["status"] == "achieved", f"Expected achieved, got {fat_req['status']}"
        print(f"     Factory Acceptance Test: status={fat_req['status']}")

        print("  [PASS] FAT end-to-end test passed!")
        return doc_id
    finally:
        if doc_id:
            try:
                deleted = await hard_delete_documents([doc_id])
                print(f"  cleanup: hard-deleted {deleted}/1 doc ({doc_id})")
            except Exception as e:  # noqa: BLE001
                print(f"  WARN: teardown hard_delete_documents({doc_id}) raised {e!r}")


async def verify_commissioning_summary(client: httpx.AsyncClient):
    """Verify overall commissioning status after all tests"""
    print("\n=== COMMISSIONING STATUS SUMMARY ===")

    site_token = await login(client, "site@jlwme.com", "Site1234")
    headers = {"Authorization": f"Bearer {site_token}"}

    # Check Generator 1 requirements
    r = await client.get(f"{BASE}/commissioning/asset-requirements?asset_id={ASSET_GEN1}", headers=headers)
    reqs = r.json()
    print(f"\n  Generator 1 (MERC:P3:GEN:0001) - {len(reqs)} requirements:")
    for req in reqs:
        print(f"    {req['id'][:8]}... | status={req['status']:12s} | progress={req['progress_percent']}%")

    achieved = sum(1 for r in reqs if r["status"] == "achieved")
    print(f"  Achieved: {achieved}/{len(reqs)}")

    # Check Generator 2 requirements
    r = await client.get(f"{BASE}/commissioning/asset-requirements?asset_id={ASSET_GEN2}", headers=headers)
    reqs2 = r.json()
    print(f"\n  Generator 2 (MERC:P3:GEN:0002) - {len(reqs2)} requirements:")
    for req in reqs2:
        print(f"    {req['id'][:8]}... | status={req['status']:12s} | progress={req['progress_percent']}%")

    achieved2 = sum(1 for r in reqs2 if r["status"] == "achieved")
    print(f"  Achieved: {achieved2}/{len(reqs2)}")


async def main():
    async with httpx.AsyncClient(timeout=30.0) as client:
        # Verify server is running
        try:
            r = await client.get(f"{BASE}/auth/me", headers={"Authorization": "Bearer invalid"})
        except httpx.ConnectError:
            print("ERROR: Backend not running at http://localhost:8000")
            print("Start it with: cd backend && uv run uvicorn app.main:app --reload")
            return

        print("=" * 60)
        print("  QTC360 - End-to-End Approval Workflow Tests")
        print("=" * 60)

        try:
            await test_wir_e2e(client)
            await test_mir_e2e(client)
            await test_cir_e2e(client)
            await test_fat_e2e(client)
            await verify_commissioning_summary(client)
        except AssertionError as e:
            print(f"\n  [FAIL] {e}")
            raise
        except Exception as e:
            print(f"\n  [ERROR] {type(e).__name__}: {e}")
            raise

        print("\n" + "=" * 60)
        print("  ALL TESTS PASSED")
        print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
