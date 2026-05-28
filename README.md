# QTC360

Enterprise QA/QC + Commissioning Management Platform.

## Stack

- **Frontend:** Next.js 16+, TypeScript, Tailwind, shadcn/ui
- **Backend:** FastAPI, SQLAlchemy 2.x async, Alembic
- **Database:** PostgreSQL 16 (Docker)
- **Package Manager:** uv (backend), npm (frontend)

## Quick Start

### Prerequisites

- Node.js 20+
- Python 3.12+
- uv (`pip install uv`)
- Docker & Docker Compose

### 1. Environment

```bash
cp .env.example .env
```

### 2. Start Docker Services

```bash
docker compose up -d
```

This starts:
- **PostgreSQL** on port 5432 (required for backend)
- **pgAdmin** on port 5050 (optional, for DB management)

### 3. Backend

```bash
cd backend
uv sync
uv run alembic upgrade head
uv run python -m app.seed                # Seeds roles, users, and base master data
uv run python -m app.seed_commissioning  # Seeds commissioning master data (depends on app.seed)
uv run uvicorn app.main:app --reload --port 8000
```

### 4. Frontend

```bash
cd frontend
npm install
npm run dev
```

## Access

| Service | URL | Credentials |
|---------|-----|-------------|
| Frontend | http://localhost:3000 | See below |
| Backend API | http://localhost:8000 | — |
| API Docs | http://localhost:8000/docs | — |
| pgAdmin | http://localhost:5050 | admin@qtc360.local / admin |

## Test Accounts

| Role | Email | Password |
|------|-------|----------|
| Super Admin | dev@jlwme.com | Dev12345 |
| Admin | admin@jlwme.com | Admin123 |
| Site Engineer | site@jlwme.com | Site1234 |
| QA/QC Engineer | qaqc@jlwme.com | Qaqc1234 |
| QA/QC Manager | jerry@jlwme.com | Jerry123 |
