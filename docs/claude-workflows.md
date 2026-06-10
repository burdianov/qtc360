# Claude Workflows

## Backend endpoint change

Read:
- docs/claude-map.md
- target route file
- related schema/model/service only if needed

Avoid:
- opening all backend/app/api/v1
- opening migrations unless schema migration requested
- opening full documents.py unless required

Validation:
- uv run python -m compileall app
- uv run pytest tests/e2e -k <keyword> only when relevant

## Frontend page change

Read:
- target page/component
- frontend/src/lib/api.ts only if API behavior changes
- related shared component only if imported

Validation:
- npx tsc --noEmit
- npm run lint only if needed

## Full-stack feature

Phase 1: backend only.
Phase 2: frontend API client/types only.
Phase 3: page/component only.
Phase 4: targeted test/check.