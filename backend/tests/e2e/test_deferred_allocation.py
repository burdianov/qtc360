"""
Tests for server-authoritative deferred reference-number allocation.

These tests assume the backend is running on http://localhost:8000 (same as
the other e2e tests). They verify:

1. POST /documents with no reference_no allocates one server-side
2. POST /documents with a client-supplied reference_no is rejected (422)
3. Two concurrent POSTs to the same (project, doc_type, discipline) get
   distinct reference numbers (no race)
4. POST /documents with revision_of_id inherits the parent's reference
   and increments revision_no
5. GET /documents/generate-ref-number is no longer exposed (404/405)

Test isolation: every document created by a test is hard-deleted in
teardown by a super_admin user. Re-runs do not pollute the dev DB.

Run: cd backend && .venv/Scripts/python.exe -m pytest tests/test_deferred_allocation.py -v
"""

import asyncio
import uuid as uuid_mod
from contextlib import asynccontextmanager

import httpx
import pytest

from tests.e2e._config import BASE
from tests.helpers.cleanup import hard_delete_documents


# Test IDs from the running dev environment (matches test_e2e_approval.py)
PROJECT_ID = "61de59c0-eb71-42ad-90f4-81f561c80ac1"
DISCIPLINE_ID = "54927b47-fc63-4382-ad5b-02d92388fd3c"
ASSET_ID = "36cbe2c9-1c0e-4ff9-91a0-24d34d4d12c3"


async def _login(client: httpx.AsyncClient, email: str, password: str) -> str:
    r = await client.post(
        f"{BASE}/auth/login", json={"email": email, "password": password}
    )
    assert r.status_code == 200, f"Login failed for {email}: {r.text}"
    return r.json()["access_token"]


class _TestContext:
    """Holds the HTTP client, auth headers, and a list of doc IDs to clean
    up. Use ``await ctx.create(...)`` to create a doc (auto-tracked) and
    ``ctx.track(doc_id)`` to track an existing id. On exit all tracked
    docs are hard-deleted directly from the DB (bypasses the API's
    soft-delete behaviour)."""

    def __init__(self, client: httpx.AsyncClient):
        self.client = client
        self.site_token: str | None = None
        self._created_ids: list[str] = []

    @property
    def headers(self) -> dict[str, str]:
        assert self.site_token, "site token not loaded — call load_tokens() first"
        return {"Authorization": f"Bearer {self.site_token}"}

    async def load_tokens(self) -> None:
        self.site_token = await _login(self.client, "site@jlwme.com", "Site1234")

    async def create(self, doc_type: str, title: str, **extra) -> dict:
        """Create a document and track its id for teardown."""
        body = {
            "project_id": PROJECT_ID,
            "document_type": doc_type,
            "title": title,
            "discipline_id": DISCIPLINE_ID,
            **extra,
        }
        r = await self.client.post(f"{BASE}/documents", json=body, headers=self.headers)
        assert r.status_code == 201, f"Create {doc_type} failed: {r.text}"
        doc = r.json()
        self._created_ids.append(doc["id"])
        return doc

    def track(self, doc_id: str) -> None:
        """Track an id for hard-deletion on context exit."""
        self._created_ids.append(doc_id)

    async def patch(self, doc_id: str, json_body: dict) -> httpx.Response:
        return await self.client.patch(
            f"{BASE}/documents/{doc_id}", json=json_body, headers=self.headers
        )

    async def cleanup(self) -> None:
        """Hard-delete all tracked documents via direct DB DELETE.

        Failures are logged but do not raise — partial cleanup is better
        than none, and we don't want teardown to mask a test failure.
        """
        if not self._created_ids:
            return
        try:
            deleted = await hard_delete_documents(self._created_ids)
            print(
                f"  cleanup: hard-deleted {deleted}/{len(self._created_ids)} tracked docs"
            )
        except Exception as e:  # noqa: BLE001
            print(f"  WARN: hard_delete_documents raised {e!r}")


@asynccontextmanager
async def make_ctx():
    """Async context manager: yields a loaded TestContext, then auto-cleans."""
    async with httpx.AsyncClient(base_url=BASE, timeout=60.0) as client:
        ctx = _TestContext(client)
        await ctx.load_tokens()
        try:
            yield ctx
        finally:
            await ctx.cleanup()


# ─── Tests ───────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_document_assigns_reference_server_side():
    """POST /documents with no reference_no allocates one server-side."""
    async with make_ctx() as ctx:
        unique = uuid_mod.uuid4().hex[:8]
        doc = await ctx.create(
            "WIR",
            f"Deferred allocation test {unique}",
            asset_ids=[ASSET_ID],
        )
        assert doc["reference_no"], "Server should have assigned a reference"
        assert "-WIR-" in doc["reference_no"]
        assert doc["full_reference_no"] == f"{doc['reference_no']}_00"
        assert doc["revision_no"] == 0
        assert doc["status"] == "draft"


@pytest.mark.asyncio
async def test_create_document_rejects_client_supplied_reference():
    """Client cannot send a reference_no. Pydantic must 422 the extra field."""
    async with make_ctx() as ctx:
        r = await ctx.client.post(
            f"{BASE}/documents",
            json={
                "project_id": PROJECT_ID,
                "document_type": "WIR",
                "reference_no": "MERC-JMJV-EL-WIR-9999",
                "title": "Tampered ref",
                "discipline_id": DISCIPLINE_ID,
            },
            headers=ctx.headers,
        )
        assert r.status_code == 422, f"Expected 422, got {r.status_code}: {r.text}"


@pytest.mark.asyncio
async def test_concurrent_creates_get_unique_references():
    """5 concurrent POSTs to the same (project, doc_type, discipline) all
    succeed and produce distinct references. This is the core race-safety
    guarantee of deferred allocation."""
    async with make_ctx() as ctx:

        async def post(i: int):
            r = await ctx.client.post(
                f"{BASE}/documents",
                json={
                    "project_id": PROJECT_ID,
                    "document_type": "MIR",
                    "title": f"Concurrent MIR #{i} {uuid_mod.uuid4().hex[:6]}",
                    "discipline_id": DISCIPLINE_ID,
                    "delivery_note": f"DN-CONC-{i}",
                    "asset_ids": [ASSET_ID],
                },
                headers=ctx.headers,
            )
            return r

        results = await asyncio.gather(*(post(i) for i in range(5)))
        refs = []
        for i, r in enumerate(results):
            assert r.status_code == 201, f"Post #{i} failed: {r.status_code} {r.text}"
            doc = r.json()
            ctx._created_ids.append(doc["id"])
            refs.append(doc["reference_no"])

        assert len(refs) == 5
        assert len(set(refs)) == 5, f"Duplicate references in concurrent run: {refs}"


@pytest.mark.asyncio
async def test_revision_inherits_parent_reference():
    """Creating a revision of a rejected doc copies its reference and
    increments revision_no, regardless of the discipline counter."""
    async with make_ctx() as ctx:
        # 1. Create a WIR
        parent = await ctx.create(
            "WIR", "Original (will be rejected) for revision test"
        )
        doc_id = parent["id"]
        parent_ref = parent["reference_no"]

        # Manually mark it rejected via PATCH. The state machine requires:
        # draft → internally_signed → with_approver_1 → rejected
        for target_status in (
            "internally_signed",
            "with_approver_1",
            "rejected",
        ):
            r = await ctx.patch(doc_id, {"status": target_status})
            assert r.status_code == 200, (
                f"Transition to {target_status!r} failed: {r.text}"
            )
        assert r.json()["status"] == "rejected"

        # 2. Submit a revision (ctx.create will track it for cleanup)
        revision = await ctx.create(
            "WIR",
            "Revision of rejected doc",
            revision_of_id=doc_id,
        )
        assert revision["reference_no"] == parent_ref, (
            f"Revision should inherit parent ref, got {revision['reference_no']!r} "
            f"vs {parent_ref!r}"
        )
        assert revision["revision_no"] == 1
        assert revision["full_reference_no"] == f"{parent_ref}_01"


@pytest.mark.asyncio
async def test_generate_ref_number_endpoint_is_gone():
    """The preview endpoint must be removed under deferred allocation."""
    async with make_ctx() as ctx:
        r = await ctx.client.get(
            f"{BASE}/documents/generate-ref-number",
            params={
                "project_id": PROJECT_ID,
                "doc_type": "WIR",
                "discipline_code": "EL",
            },
            headers=ctx.headers,
        )
        # 404/405 mean the route is gone. FastAPI can also return 422 if a
        # wildcard handler rejects the params — we treat that as "gone" too.
        assert r.status_code in (404, 405, 422), (
            f"Expected preview endpoint to be removed, got {r.status_code}: {r.text}"
        )
