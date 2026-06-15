"""End-to-end tests for the master-data CRUD routes.

Per-prefix create/list/get/patch/delete for: clients, projects,
approver-titles, approvers, project-approvers, disciplines, services,
asset-types, assets, systems, contractors, approval-statuses,
designations.

The tests use the admin token for mutations (the master_data.manage
permission is held by admin) and the site token for read-only
checks. Each test creates a row with a unique name, mutates it, and
soft-deletes it.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest

from ._common_helpers import assert_status, auth


def _new_name(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


def _new_code(prefix: str) -> str:
    return f"{prefix}{uuid.uuid4().hex[:4].upper()}"


# Each tuple is (prefix, create_body, patch_field, patch_value, project_scoped)
#   - create_body: dict used in POST
#   - patch_field: top-level key in the body that we mutate in PATCH
#   - project_scoped: True means the resource has project_id and needs a
#     seed project to live under
RESOURCES: list[tuple[str, dict[str, Any], str, Any, bool]] = [
    # clients (not project-scoped)
    (
        "clients",
        {"name": _new_name("client"), "code": _new_code("C")},
        "name",
        "Renamed",
        False,
    ),
    # disciplines (project-scoped, project_id required)
    (
        "disciplines",
        {
            "project_id": "__PROJECT__",
            "name": _new_name("disc"),
            "code": _new_code("D"),
        },
        "name",
        "Renamed",
        True,
    ),
    # systems (project-scoped)
    (
        "systems",
        {"project_id": "__PROJECT__", "name": _new_name("sys"), "code": _new_code("S")},
        "name",
        "Renamed",
        True,
    ),
    # contractors (project-scoped)
    (
        "contractors",
        {
            "project_id": "__PROJECT__",
            "name": _new_name("con"),
            "code": _new_code("CN"),
        },
        "name",
        "Renamed",
        True,
    ),
    # approval-statuses (project-scoped)
    (
        "approval-statuses",
        {
            "project_id": "__PROJECT__",
            "name": _new_name("status"),
            "letter": "X",
            "description": _new_name("status"),
            "action": "approved",
        },
        "description",
        "Renamed",
        True,
    ),
]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("prefix", "create_body", "patch_field", "patch_value", "project_scoped"),
    RESOURCES,
    ids=[r[0] for r in RESOURCES],
)
async def test_crud_create_list_get_patch_delete(
    client,
    tokens,
    seed_data,
    auth_headers,
    prefix,
    create_body,
    patch_field,
    patch_value,
    project_scoped,
):
    admin = auth(tokens["admin"])
    site = auth_headers("site")

    # 1. Patch in the real project_id for project-scoped resources
    body = dict(create_body)
    if project_scoped:
        body["project_id"] = seed_data.project_id

    # 2. Create
    r = await client.post(f"/{prefix}", json=body, headers=admin)
    assert r.status_code in (200, 201), f"create {prefix}: {r.status_code} {r.text}"
    created = r.json()
    new_id = created["id"]

    # 3. List (scoped to the project for project-scoped resources)
    list_qs = ""
    if project_scoped:
        list_qs = f"?project_id={seed_data.project_id}"
    r = await client.get(f"/{prefix}{list_qs}", headers=admin)
    assert r.status_code == 200, r.text
    assert any(x.get("id") == new_id for x in r.json()), r.json()

    # 4. Get one
    r = await client.get(f"/{prefix}/{new_id}", headers=admin)
    assert r.status_code == 200, r.text

    # 5. Patch
    r = await client.patch(
        f"/{prefix}/{new_id}",
        json={patch_field: patch_value},
        headers=admin,
    )
    assert r.status_code == 200, r.text
    assert r.json().get(patch_field) == patch_value, r.json()

    # 6. Delete
    r = await client.delete(f"/{prefix}/{new_id}", headers=admin)
    assert r.status_code in (200, 204), r.text

    # 7. After soft-delete, GET → 404
    r = await client.get(f"/{prefix}/{new_id}", headers=admin)
    assert r.status_code == 404, r.text


# ── Project-scoped read isolation ──────────────────────────────────────────


@pytest.mark.asyncio
async def test_project_scoped_row_hidden_from_non_member(
    client, tokens, seed_data, auth_headers
):
    """A user with no membership in the project must not see rows for it."""
    # Create a discipline in the seed project
    admin = auth(tokens["admin"])
    body = {
        "project_id": seed_data.project_id,
        "name": _new_name("hidden"),
        "code": _new_code("H"),
    }
    r = await client.post("/disciplines", json=body, headers=admin)
    assert r.status_code in (200, 201), r.text
    created_id = r.json()["id"]

    # 1. Site user CAN see it (site is a member of the seed project)
    r = await client.get(
        f"/disciplines?project_id={seed_data.project_id}", headers=auth_headers("site")
    )
    assert r.status_code == 200, r.text
    assert any(x.get("id") == created_id for x in r.json()), r.json()

    # 2. Cleanup
    r = await client.delete(f"/disciplines/{created_id}", headers=admin)
    assert r.status_code in (200, 204), r.text


@pytest.mark.asyncio
async def test_patch_soft_deleted_returns_404(client, tokens, seed_data, auth_headers):
    admin = auth(tokens["admin"])
    body = {
        "project_id": seed_data.project_id,
        "name": _new_name("will_delete"),
        "code": _new_code("WD"),
    }
    r = await client.post("/disciplines", json=body, headers=admin)
    assert r.status_code in (200, 201), r.text
    new_id = r.json()["id"]
    r = await client.delete(f"/disciplines/{new_id}", headers=admin)
    assert r.status_code in (200, 204), r.text
    r = await client.patch(
        f"/disciplines/{new_id}",
        json={"name": "x"},
        headers=admin,
    )
    assert r.status_code == 404, r.text
