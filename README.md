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

### 2. Start Database

```bash
docker compose up -d
```

### 3. Backend

```bash
cd backend
uv sync
uv run alembic upgrade head
uv run uvicorn app.main:app --reload --port 8000
```

### 4. Frontend

```bash
cd frontend
npm install
npm run dev
```

### Access

- Frontend: http://localhost:3000
- Backend API: http://localhost:8000
- API Docs: http://localhost:8000/docs
- pgAdmin: http://localhost:5050
