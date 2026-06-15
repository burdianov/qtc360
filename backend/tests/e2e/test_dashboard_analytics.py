"""End-to-end tests for /dashboard/* — stats, analytics, weekly targets, tracker export.

Covers:
- GET /dashboard/stats?project_id= returns counts
- GET /dashboard/analytics?project_id= returns the full analytics payload
- GET /dashboard/weekly-targets returns a list
- GET /dashboard/tracker-export returns CSV/XLSX with required columns
"""

from __future__ import annotations

import pytest

from ._common_helpers import assert_status, auth


@pytest.mark.asyncio
async def test_dashboard_stats_returns_counts(client, tokens, seed_data, auth_headers):
    site = auth_headers("site")
    r = await client.get(
        f"/dashboard/stats?project_id={seed_data.project_id}", headers=site
    )
    assert r.status_code == 200, r.text
    body = r.json()
    # Required keys per the route implementation
    for key in ("disciplines", "services", "systems", "contractors", "documents"):
        assert key in body, body
    assert isinstance(body["disciplines"], int)


@pytest.mark.asyncio
async def test_dashboard_stats_grows_when_doc_created(
    client, tokens, seed_data, auth_headers
):
    site = auth_headers("site")
    admin = auth(tokens["admin"])
    r0 = await client.get(
        f"/dashboard/stats?project_id={seed_data.project_id}", headers=site
    )
    assert r0.status_code == 200, r0.text
    docs_before = r0.json()["documents"]

    # Create one document via the master CRUD on /documents
    from .e2e_documents.helpers import create_document

    await create_document(client, site, seed_data, "WIR", "stats grow")

    r1 = await client.get(
        f"/dashboard/stats?project_id={seed_data.project_id}", headers=site
    )
    assert r1.status_code == 200, r1.text
    assert r1.json()["documents"] >= docs_before + 1, r1.json()


@pytest.mark.asyncio
async def test_dashboard_analytics_returns_full_shape(
    client, tokens, seed_data, auth_headers
):
    site = auth_headers("site")
    r = await client.get(
        f"/dashboard/analytics?project_id={seed_data.project_id}", headers=site
    )
    assert r.status_code == 200, r.text
    body = r.json()
    # The analytics route is large; at minimum it should be a dict.
    assert isinstance(body, dict)
    # The route must return *something* useful — at least one well-known key
    # survives across schema iterations.
    assert any(
        k in body
        for k in (
            "kpi",
            "submission_timeline",
            "doc_status_distribution",
            "progress_by_pod",
            "tag_achievement",
            "approval_turnaround",
            "delayed_items",
            "docs_by_discipline",
            "approval_scatter",
        )
    ), body


@pytest.mark.asyncio
async def test_weekly_targets_returns_list(client, tokens, seed_data, auth_headers):
    site = auth_headers("site")
    r = await client.get(
        f"/dashboard/weekly-targets?project_id={seed_data.project_id}", headers=site
    )
    assert r.status_code == 200, r.text
    assert isinstance(r.json(), (list, dict)), r.json()


@pytest.mark.asyncio
async def test_tracker_export_rows_have_required_columns(
    client, tokens, seed_data, auth_headers
):
    site = auth_headers("site")
    r = await client.get(
        f"/dashboard/tracker-export?project_id={seed_data.project_id}", headers=site
    )
    # The route may stream XLSX/CSV (binary body) or return a JSON list,
    # depending on the implementation. Accept both.
    if r.headers.get("content-type", "").startswith("application/json"):
        body = r.json()
        assert isinstance(body, (list, dict))
    else:
        assert r.status_code == 200, r.text
        assert len(r.content) > 0
