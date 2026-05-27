# QTC360 — Session Continuation Prompt

Read the domain specification at `docs/domain/qtc360-commissioning-domain-spec.md` and architecture decisions at `docs/domain/architecture-decisions.md` before making any changes. These are the authoritative source of truth.

---

## Project Location

```
D:\QTC360\qtc360
```

## Tech Stack

- **Backend**: FastAPI + SQLAlchemy 2.x async + PostgreSQL + Alembic + uv
- **Frontend**: Next.js 16 + TypeScript + Tailwind + shadcn/ui + @base-ui/react + TanStack Query + React Hook Form + Zod
- **DB**: PostgreSQL in Docker (`docker compose up -d`)
- **Repo**: git@github.com:burdianov/qtc360.git (main branch)

## Running

```bash
# Docker (PostgreSQL)
cd D:\QTC360\qtc360 && docker compose up -d

# Backend
cd D:\QTC360\qtc360\backend && uv run alembic upgrade head && uv run python -m app.seed && uv run python -m app.seed_commissioning && uv run uvicorn app.main:app --reload

# Frontend
cd D:\QTC360\qtc360\frontend && npm run dev
```

## Current Architecture

### Domain Model (Commissioning Engine)

```
Project → Discipline → Service → AssetType (→ Subtypes) → Asset
RequirementTemplate → AssetRequirement → RequirementWorkItem
Document → DocumentRequirementLink → AssetRequirement/WorkItem
AssetTagTarget (calculated tag achievement)
GateOverrideAcknowledgement (audit trail)
```

### Key Rules

1. Documents are generic QA/QC records. Only those linked via `document_requirement_links` affect commissioning.
2. `AssetRequirement.status` is NEVER user-editable — calculated by backend from document approvals + work item completion.
3. Tags (red/yellow/green/blue) are calculated, never manually assigned.
4. Work breakdown items are created dynamically during WIR/CIR preparation.
5. Soft gate requirements = warnings only, no hard DB constraints.
6. `requirement_category` ≠ `evidence_document_type` — both fields serve different purposes.

### Backend Structure

```
backend/app/
├── api/v1/          # Routers: auth, master, admin, documents, commissioning, reports, notifications, ref_config
├── models/          # ORM: commissioning.py, document.py, gate_override.py, + core entities
├── schemas/         # Pydantic: commissioning.py, document.py, master.py, auth.py, admin.py
├── services/        # commissioning.py (status calculation engine), signature.py
├── core/            # config, database, deps, security
└── seed.py / seed_commissioning.py
```

### Frontend Structure

```
frontend/src/
├── app/(dashboard)/
│   ├── commissioning/   # tracking, requirements, tag-targets
│   ├── master-data/     # projects, disciplines, services, assets, approvers, requirement-templates, etc.
│   ├── qaqc/            # wir (form + list), mir, cir
│   ├── documents/       # templates
│   ├── admin/           # users, roles, permissions, settings
│   └── dashboard/
├── components/
│   ├── commissioning-linkage.tsx  # Reusable panel for WIR/CIR/MIR requirement linking + work breakdown
│   ├── data-table/                # Reusable DataTable system
│   ├── layout/                    # Sidebar, navbar, project switcher
│   └── ui/                        # shadcn components + progress, switch
├── hooks/             # use-auth, use-project
├── config/            # navigation.ts
└── lib/               # api.ts, utils.ts, csv.ts, format-date.ts
```

### API Endpoints (key ones)

```
POST/GET    /api/v1/documents
POST        /api/v1/documents/{id}/sign
POST        /api/v1/documents/{id}/approvals/{id}/respond  → triggers requirement recalculation

GET/POST    /api/v1/commissioning/requirement-templates
GET/POST    /api/v1/commissioning/asset-requirements
POST        /api/v1/commissioning/asset-requirements/bulk
POST        /api/v1/commissioning/asset-requirements/bulk-by-type
GET/POST/DELETE /api/v1/commissioning/work-items
POST/GET    /api/v1/commissioning/document-links
GET/POST/PATCH /api/v1/commissioning/tag-targets
POST/GET    /api/v1/commissioning/gate-overrides
```

### WIR Form Flow

1. General info (ref number auto-generated, date, discipline, subject, description, location fields)
2. Assets (multi-select with badges)
3. Commissioning Linkage (optional toggle):
   - Select requirement template (filtered by evidence_document_type=WIR)
   - Full scope OR partial scope
   - Partial: shows existing work items (approved=disabled, pending=checkable/deletable), add new items
   - Only checked items get linked to this document
4. Inspectors & signatures (DocuSign-style)
5. Attachments (drag-and-drop reorder)

## Completed This Session

- ✅ Full commissioning engine refactor (backend + frontend)
- ✅ Domain spec + architecture decisions docs
- ✅ Fresh schema with 2 clean migrations
- ✅ Realistic data center MEP seed data (36 assets, 26 requirement templates, 455 assignments)
- ✅ Requirement Templates CRUD page
- ✅ Commissioning Tracking page (progress + tag badges)
- ✅ Asset Requirements page (per-asset view)
- ✅ Tag Targets page (target date management)
- ✅ WIR form with commissioning linkage + work breakdown
- ✅ Reference number auto-generation
- ✅ Stale project auto-correction
- ✅ LF line endings enforced

## Next Priorities

1. **Approval workflow UI** — After both signatories sign, show approval chain progress, allow approvers to respond
2. **Commissioning dashboard charts** — Visual progress bars per level, at-risk indicators
3. **Bulk tag target assignment** — Set target dates for all assets of a type at once
4. **Gate override warning UI** — Show warning when submitting L2B Final with incomplete prerequisites
5. **Document revision system** — Auto-increment revision on resubmission after rejection

## Login Credentials

```
dev@jlwme.com / Dev12345 (super_admin)
admin@jlwme.com / Admin123 (admin)
site@jlwme.com / Site1234 (site_engineer)
qaqc@jlwme.com / Qaqc1234 (qaqc_engineer)
```
