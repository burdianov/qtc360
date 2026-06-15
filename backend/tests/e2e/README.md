# QTC360 end-to-end tests

The `tests/e2e/` directory holds a real-backend end-to-end suite: it
spins up a Postgres database, runs Alembic migrations + seeds, starts
its own uvicorn instance, and exercises the HTTP API the way the
frontend does.

It is **not** part of the default `pytest` run. Run it with the
docker-based one-shot runner:

```bash
# from the repo root
./scripts/run_e2e.sh                 # full suite (~260 tests)
./scripts/run_e2e.sh -k checklist    # one keyword
./scripts/run_e2e.sh tests/e2e/test_ref_config.py -v
```

Or on Windows:

```powershell
pwsh scripts/run_e2e.ps1
pwsh scripts/run_e2e.ps1 -k checklist
```

The runner is a thin wrapper around `docker compose -f
docker-compose.e2e.yml up --abort-on-container-exit --exit-code-from
backend-e2e`. It brings up Postgres 16, Gotenberg 8 (with the
LibreOffice module), and a one-shot `backend-e2e` container that runs
the test suite. The host machine only needs Docker — no Postgres
install, no `qtc360` role, no LibreOffice or Tesseract on PATH.

## What the suite covers

| File | Area |
| --- | --- |
| `e2e_documents/test_document_*.py` | Document lifecycle (the original suite): creation, signing, submission, approval rounds, attachments, bundles, concurrency, captured information, state machine, permissions. |
| `test_auth_and_profile.py` | `/auth/*` — login, refresh, profile, signature upload/download, delegations, preferences. |
| `test_admin_users_roles_audit.py` | `/admin/*` — users, roles, permissions, audit log, app settings, CRS header image. |
| `test_master_data_crud.py` | Generic CRUD over all 13 master-data prefixes: clients, projects, disciplines, systems, contractors, approval-statuses, … |
| `test_dashboard_analytics.py` | `/dashboard/*` — stats, analytics, weekly targets, tracker export. |
| `test_commissioning_requirements.py` | `/commissioning/asset-requirements`, templates, document links, progress, gate-check, inspection-tracker. |
| `test_tag_targets_and_work_items.py` | `/commissioning/tag-targets`, `/commissioning/work-items` (CRUD, ordering, delete-blocked). |
| `test_document_checklists.py` | `/checklists/*` — items, reorder, document save, PDF download. |
| `test_notifications.py` | `/notifications/*` — list, mark read, mark all read, delete, unread count. |
| `test_reports_engine.py` | `/reports/generate`, `/reports/latest-pdf`, `/reports/generate-crs`, `/reports/templates`, `/reports/signature-*`. |
| `test_reports_bundle.py` | `/reports/bundle-pages`, `/reports/bundle-compose`. |
| `test_ref_config.py` | `/ref-config/*` — pattern validation (rejects unknown placeholders and `{0.__class__}` traversal). |
| `test_crs_lifecycle.py` | `/documents/{id}/resubmit`, `/documents/{id}/start-new-revision`, `/documents/crs-by-source`. |
| `test_documents_pagination_and_filters.py` | `/documents` list — pagination, filters (document_type, status, has_comments, discipline_id), sort. |

## Isolation contract

- **No impact on the project database.** The fixture at
  `e2e_documents/conftest.py::e2e_context` creates a uniquely-named
  throwaway database (`qtc360_e2e_<pid>_<rand>`) per session, runs
  Alembic migrations + seeds against *that* database, starts uvicorn
  pointed at it, and drops it on teardown. The host's `qtc360` database
  is never touched.
- **No impact on the host filesystem.** `UPLOAD_DIR` points at a
  per-session temp directory that's removed after the run.
- **No impact on the host's env.** `POSTGRES_*`, `SECRET_KEY`,
  `UPLOAD_DIR`, `ENVIRONMENT` are stashed before the session and
  restored on teardown.
- **No external network beyond the compose network.** Gotenberg talks
  to the backend container via the in-network DNS name `gotenberg`;
  Postgres via `postgres`. The runner doesn't bind any host ports.

## Environment variables

The runner sets these for the `backend-e2e` container:

| Var | Value | Purpose |
| --- | --- | --- |
| `POSTGRES_HOST` | `postgres` | In-network DNS name of the Postgres service. |
| `POSTGRES_PORT` | `5432` | |
| `POSTGRES_USER` | `qtc360` | Matches the `POSTGRES_USER` baked into the Postgres service. |
| `POSTGRES_PASSWORD` | `qtc360_dev` | Matches the `POSTGRES_PASSWORD` baked into the Postgres service. |
| `POSTGRES_DB` | `qtc360_e2e_maintenance` | A throwaway DB the fixture uses to connect for `CREATE DATABASE`. |
| `GOTENBERG_URL` | `http://gotenberg:3000` | In-network DNS name + container port. |
| `SECRET_KEY` | `e2e-secret-key-that-is-long-enough-for-tests-only` | Set automatically; passes the ≥32-char validator. |
| `UPLOAD_DIR` | `/tmp/qtc360_e2e_uploads` | Per-session temp dir inside the container. |
| `PYTEST_ARGS` | (empty) | Override to pass flags / file paths to pytest. |
| `ENVIRONMENT` | `development` | Disables production CORS / TLS guards. |

## Troubleshooting

### `database "qtc360" does not exist`

The fixture's `_connect_maintenance()` connects to `POSTGRES_DB` to
`CREATE DATABASE` the throwaway. The compose file sets
`POSTGRES_DB=qtc360_e2e_maintenance` to avoid clashing with a developer's
local `qtc360` DB. If you bring your own compose file, ensure the
maintenance DB exists in the Postgres image.

### Gotenberg keeps failing the health check

`gotenberg:8` is a 1.5 GB image with Chromium + LibreOffice baked in.
The first `docker compose up` will pull it; subsequent runs use the
cache. On slow connections, bump `retries:` in
`docker-compose.e2e.yml`.

### I want to run a single test

```bash
./scripts/run_e2e.sh tests/e2e/test_ref_config.py -v
```

The runner forwards extra args as the `PYTEST_ARGS` env var, which
the compose `command:` re-splits into pytest args.

### The container OOMs on the full suite

Bump Docker Desktop's memory limit (Settings → Resources → Memory).
The full ~260-test suite runs comfortably in 4 GB.
