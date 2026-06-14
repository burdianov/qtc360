# QTC360 Claude Guide

QTC360 is a Next.js 16 + FastAPI QA/QC and commissioning platform.

## Main areas

Backend:

- backend/app/api/v1/ = FastAPI route modules
- backend/app/models/ = SQLAlchemy models
- backend/app/schemas/ = Pydantic schemas
- backend/app/services/ = business logic
- backend/tests/e2e/ = live-backend HTTP tests

Frontend:

- frontend/src/app/(dashboard)/ = Next.js pages
- frontend/src/components/ = shared React components
- frontend/src/lib/api.ts = Axios API client
- frontend/src/config/navigation.ts = sidebar/navigation

## Token rules

- Read only files directly needed for the task.
- Prefer grep/search before opening large files.
- Never read package-lock.json, uv.lock, fonts, db dumps, .env, .next, node_modules, or migrations unless explicitly requested.
- Avoid reading large route/page files fully. Use grep and small line ranges.
- Before editing, state the exact files you need.
- Make the smallest safe change.
- Do not run full test suites unless requested.

## Common commands

Backend:

- cd backend && uv run pytest tests/e2e -k <keyword>
- cd backend && uv run python -m compileall app

Frontend:

- cd frontend && npm run lint
- cd frontend && npx tsc --noEmit

Do not run npm install, uv sync, docker compose, migrations, or seed scripts unless explicitly requested.

