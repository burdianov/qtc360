# Tests

End-to-end test suite for the QTC360 API.

## Layout

```
tests/
├── e2e/                    # Full HTTP roundtrip against a live backend
│   ├── conftest.py         # `client` fixture (httpx.AsyncClient)
│   ├── e2e_documents/      # Isolated document tests (per-session DB)
│   │   ├── conftest.py     # Session-scoped test DB, uvicorn, seed data
│   │   ├── helpers.py      # Shared test helpers
│   │   ├── test_document_creation_and_crud.py
│   │   ├── test_document_signing.py
│   │   ├── test_document_attachments_and_bundles.py
│   │   ├── test_document_lifecycle_matrix.py
│   │   ├── test_document_state_machine_and_permissions.py
│   │   ├── test_document_resubmission_and_captured_information.py
│   │   ├── test_document_approval_rounds.py
│   │   └── test_document_concurrency.py
│   └── _config.py          # Shared base URL config
└── helpers/
    └── cleanup.py          # `hard_delete_documents()` for teardown
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

# Just e2e document tests (isolated per-session test DB)
uv run pytest tests/e2e/e2e_documents -v

# A single test by name
uv run pytest -k wir

# Verbose with full traceback
uv run pytest -v --tb=long
```

### Test Database

The `e2e_documents` tests use a fully isolated workflow:
- Each session creates a fresh test database (`qtc360_e2e_{pid}_{uuid}`)
- Migrations and seeds run automatically
- A uvicorn instance starts on a random free port
- The database is dropped at session end

To debug a failing test, keep the database and server alive:

```bash
QTC360_E2E_KEEP_DB=1 uv run pytest tests/e2e/e2e_documents -k <test_name>
```

## CI

`.github/workflows/ci.yml` spins up Postgres 16, runs migrations, then
`uv run pytest -v --tb=short`. Collection errors fail the build (see
`strict = true` in `pyproject.toml`).
