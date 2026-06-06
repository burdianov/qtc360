# Tests

End-to-end test suite for the QTC360 API.

## Layout

```
tests/
├── e2e/                # Full HTTP roundtrip against a live backend
│   ├── conftest.py     # `client` fixture (httpx.AsyncClient)
│   ├── test_approval_workflow.py
│   └── test_deferred_allocation.py
└── helpers/
    └── cleanup.py      # `hard_delete_documents()` for teardown
```

Tests are organised by *how they run*, not by *what they cover*:

| Folder    | What goes here                                                | Speed    | Needs DB? |
|-----------|---------------------------------------------------------------|----------|-----------|
| `unit/`   | Pure logic, no I/O. (placeholder — no tests yet)              | <10ms    | No        |
| `integration/` | Talks to a real DB via asyncpg fixtures.                 | 10-500ms | Yes       |
| `e2e/`    | Drives the running app over HTTP.                             | seconds  | Yes + app |

## Running

From the `backend/` directory:

```bash
# Everything that pytest can find
uv run pytest

# Just e2e
uv run pytest tests/e2e

# A single test by name
uv run pytest -k wir

# Verbose with full traceback
uv run pytest -v --tb=long
```

The e2e tests assume the backend is running on `http://localhost:8000`
(see `tests/e2e/conftest.py`). They also expect specific test users
(creator, qaqc, approver) to exist in the dev DB.

## Teardown

E2E tests create real documents and must clean up after themselves.
`tests/helpers/cleanup.py` exposes `hard_delete_documents(ids)` which
bypasses the API's soft-delete and issues a direct `DELETE` against
the DB in FK-respecting order, then rolls back the per-discipline
reference-number counters so re-runs are idempotent.

Use it in a `try / finally` block:

```python
from tests.helpers.cleanup import hard_delete_documents

async def test_something(client):
    doc_id = None
    try:
        r = await client.post(...)
        doc_id = r.json()["id"]
        # ... assertions ...
    finally:
        if doc_id:
            await hard_delete_documents([doc_id])
```

## CI

`.github/workflows/ci.yml` spins up Postgres 16, runs migrations, then
`uv run pytest -v --tb=short`. Collection errors fail the build (see
`strict = true` in `pyproject.toml`).
