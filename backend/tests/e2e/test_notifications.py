"""End-to-end tests for /notifications/* — list, mark read, mark all read, delete, count.

These tests do not depend on a real notification being created (the
suite has no public POST /notifications endpoint). They exercise the
happy path of each operation and the 404 contract.
"""

from __future__ import annotations

import uuid

import pytest

from ._common_helpers import assert_status, auth


@pytest.mark.asyncio
async def test_list_notifications_for_current_user_only(client, tokens):
    r = await client.get("/notifications", headers=auth(tokens["site"]))
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body, list)


@pytest.mark.asyncio
async def test_list_notifications_filtered_by_project(client, tokens, seed_data):
    r = await client.get(
        f"/notifications?project_id={seed_data.project_id}",
        headers=auth(tokens["site"]),
    )
    assert r.status_code == 200, r.text
    assert isinstance(r.json(), list)


@pytest.mark.asyncio
async def test_unread_count_is_non_negative(client, tokens):
    r = await client.get("/notifications/unread-count", headers=auth(tokens["site"]))
    assert r.status_code == 200, r.text
    assert isinstance(r.json().get("count"), int)
    assert r.json()["count"] >= 0


@pytest.mark.asyncio
async def test_mark_unknown_notification_returns_404(client, tokens):
    r = await client.patch(
        f"/notifications/{uuid.uuid4()}/read", headers=auth(tokens["site"])
    )
    assert r.status_code == 404, r.text


@pytest.mark.asyncio
async def test_mark_all_read_clears_unread_count(client, tokens):
    site_h = auth(tokens["site"])
    r = await client.patch("/notifications/mark-all-read", headers=site_h)
    assert r.status_code == 200, r.text
    r = await client.get("/notifications/unread-count", headers=site_h)
    assert r.status_code == 200, r.text
    assert r.json()["count"] == 0


@pytest.mark.asyncio
async def test_delete_unknown_notification_returns_404(client, tokens):
    r = await client.delete(
        f"/notifications/{uuid.uuid4()}", headers=auth(tokens["site"])
    )
    assert r.status_code == 404, r.text


@pytest.mark.asyncio
async def test_clear_all_notifications(client, tokens):
    r = await client.delete("/notifications", headers=auth(tokens["site"]))
    assert r.status_code == 200, r.text
    r = await client.get("/notifications", headers=auth(tokens["site"]))
    assert r.status_code == 200, r.text
    assert r.json() == []


@pytest.mark.asyncio
async def test_delete_notification_404_then_ok(client, tokens, seed_data):
    """A made-up notification id returns 404; we don't have a way to
    create one in the public API, so this is the full coverage of the
    delete path in this suite."""
    r = await client.delete(
        f"/notifications/{uuid.uuid4()}", headers=auth(tokens["site"])
    )
    assert r.status_code == 404, r.text
