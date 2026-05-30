# QTC360 — Session Continuation Prompt

Read the domain specification at `docs/domain/qtc360-commissioning-domain-spec.md` and architecture decisions at `docs/domain/architecture-decisions.md` before making any changes. These are the authoritative source of truth.

---

## Project Location

```
D:\QTC360\qtc360
```

## Tech Stack

- **Backend**: FastAPI + SQLAlchemy 2.x async + PostgreSQL + Alembic + uv
- **Frontend**: Next.js 16 + TypeScript + Tailwind + shadcn/ui + @base-ui/react + TanStack Query + React Hook Form + Zod + Recharts
- **DB**: PostgreSQL in Docker (`docker compose up -d`) — migrating to Neon (serverless PG)
- **Repo**: git@github.com:burdianov/qtc360.git (main branch)
- **Deployment**: Vercel (frontend) + Render (backend) + Neon (DB) + Cloudflare R2 (files) — in progress

## Running

```bash
# Docker (PostgreSQL)
cd D:\QTC360\qtc360 && docker compose up -d

# Backend
cd D:\QTC360\qtc360\backend && uv run alembic upgrade head && uv run python -m app.seed && uv run python -m app.seed_commissioning && uv run python -m app.seed_demo && uv run uvicorn app.main:app --reload

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
Designation (master lookup for user job titles)
AppSetting (key-value store for app configuration)
```

### Key Rules

1. Documents are generic QA/QC records. Only those linked via `document_requirement_links` affect commissioning.
2. `AssetRequirement.status` is NEVER user-editable — calculated by backend from document approvals + work item completion.
3. Tags (red/yellow/green/blue) are calculated, never manually assigned.
4. Work breakdown items are created dynamically during WIR/CIR preparation.
5. Soft gate requirements = warnings only, no hard DB constraints. Override acknowledgements stored in audit trail.
6. `requirement_category` ≠ `evidence_document_type` — both fields serve different purposes.
7. Document status transitions are enforced via state machine (draft→submitted→approved/rejected).
8. Serial numbers are scoped per (project + document_type + discipline) combination. Decremented on hard-delete of unsubmitted docs so the number can be reused; preserved on supersede.
9. Work items are rolled back when a document is rejected.
10. RBAC permissions are enforced on write endpoints (`require_permission`).
11. **Project isolation**: documents, approvals, assets, requirements, tag targets, work items are strictly per-project. Only common masters (disciplines, services, contractors, users, approver companies, designations) are shared across projects. Frontend queries MUST pass `project_id` to project-scoped endpoints.
12. **Returned approval PDFs are NOT split**. Saved as a single file. Additional attachments are uploaded separately with `insert_after_page` to control their position in the merged bundle.
13. **Never use generic HTML date/time pickers** — always use the app's styled `DatePicker` component for dates and the styled `TimePicker` component for time.
14. **Date format is admin-configurable** via `app_settings` table (key: `date_format`). Default: `DD.MM.YYYY`. Frontend reads it on mount; backend reads it for PDF generation.
15. **Signatures in PDFs are vector** — rendered as font glyphs via reportlab directly onto the PDF (not raster images). The `render_signature()` function is only used for browser preview (72px).
16. **Admin pages** (`/admin/*`) are restricted to admin/super_admin roles only — both via frontend layout guard and sidebar visibility.
17. **Document Templates page** (`/documents/templates`) is admin-only — page redirects non-admins, sidebar hides link via `adminOnly` flag.
18. **Asset custom fields** are dynamic — defined in `app_settings` key `asset_custom_fields` (JSON array of `{id, label}`), stored in `assets.custom_fields` JSONB column. Admin configures fields in Settings → General → Asset Custom Fields.
19. **Inline table editing** — all DataTable instances support per-cell inline editing via `editableColumns` + `onRowUpdate` props. Click a cell to edit, Enter to save, Escape to cancel. Modal editing remains via row actions.
20. **Column visibility persisted** per user via `user_preferences` table (key: `col_vis{path}`).
21. **Aconex date tracking** — every approval submission records `aconex_submitted_date`, every response records `aconex_received_date` on the `document_approval_rounds` table.
22. **MIR has single signatory** — only `site_engineer` signs. Backend transitions to `internally_signed` after one signature.
23. **FAT has no approval workflow** — status is always `"approved"` on create. No signing, no state machine. Always editable. Just a record.
24. **All dates use configured format** — admin-configurable via `app_settings` key `date_format`. Applies to PDF generation and frontend display. No hardcoded formats.
25. **Centralized constants** — `backend/app/core/types.py` is the single source of truth for shared types, enums, and magic numbers. Frontend uses `lib/constants.ts`.
26. **No em-dashes in UI** — use hyphens (-) everywhere in user-facing text.
27. **Level progression rule** — for an asset to have activity at level N, all requirements at level N-1 must be achieved first. Not yet enforced in code, but demo data respects this.
28. **Dashboard is interactive** — all charts/cards are clickable and navigate to filtered detail pages via URL query params.

### Backend Structure

```
backend/app/
├── api/v1/          # Routers: auth, master, admin, documents, commissioning, reports, notifications, ref_config, dashboard
├── models/          # ORM: commissioning.py, document.py, gate_override.py, designation.py, audit_log.py, app_setting.py, asset.py (custom_fields JSONB), + core entities
├── schemas/         # Pydantic: commissioning.py (with Literal types), document.py (with state machine), master.py, auth.py, admin.py
├── services/        # commissioning.py (status calculation engine), signature.py, audit.py, pdf.py (OCR), pdf_merge.py, approval.py
├── core/            # config, database, deps (require_permission), security
├── seed.py / seed_commissioning.py / seed_demo.py
├── cleanup_documents.py   # Wipes all docs + resets counters/statuses
└── tests/test_e2e_approval.py  # End-to-end approval workflow tests
```

### Frontend Structure

```
frontend/src/
├── app/(dashboard)/
│   ├── commissioning/   # tracking (with POD filter), requirements, tag-targets (with tag/week/status filters)
│   ├── master-data/     # projects, disciplines, services, assets, asset-types, approvers, requirement-templates, designations, etc.
│   ├── qaqc/            # wir (form + list), mir, cir, fat
│   ├── documents/       # all documents (with status + type + discipline filters), templates (admin-only)
│   ├── admin/           # users, roles, permissions, settings (layout-guarded to admin only)
│   └── dashboard/       # Analytics dashboard with charts (recharts)
├── components/
│   ├── commissioning-linkage.tsx     # Reusable panel for WIR/CIR/MIR/FAT requirement linking + work breakdown + gate override dialog
│   ├── document-attachments.tsx      # Reusable attachment manager with drag-reorder, delete confirmation, bundle download
│   ├── approval/                     # action panel, submit dialog (with Aconex date), record-response dialog (with Aconex date), rounds list, region picker
│   ├── data-table/                   # Reusable DataTable system (inline editing, column visibility persistence, drag reorder)
│   ├── layout/                       # Sidebar (admin-filtered + adminOnly items), navbar, project switcher
│   └── ui/                           # shadcn components + progress, switch, date-picker, time-picker (AM/PM with scrollable columns)
├── hooks/             # use-auth, use-project
├── config/            # navigation.ts (with adminOnly flag)
└── lib/               # api.ts (FormData-aware Content-Type), utils.ts, csv.ts, format-date.ts (configurable format), constants.ts
```

### API Endpoints (key ones)

```
POST/GET    /api/v1/documents
DELETE      /api/v1/documents/{id}
POST        /api/v1/documents/{id}/sign
POST        /api/v1/documents/{id}/notify-signatories
POST        /api/v1/documents/{id}/submit-to-approver
POST        /api/v1/documents/{id}/approval-rounds
PUT         /api/v1/documents/{id}/approval-rounds/{round_id}/file
POST        /api/v1/documents/{id}/approval-rounds/{round_id}/attachments
GET         /api/v1/documents/{id}/approval-rounds/{round_id}/bundle
GET/POST/DELETE /api/v1/documents/{id}/attachments
GET         /api/v1/documents/{id}/bundle

GET/POST    /api/v1/commissioning/requirement-templates
GET/POST    /api/v1/commissioning/asset-requirements
POST        /api/v1/commissioning/asset-requirements/bulk
POST        /api/v1/commissioning/asset-requirements/bulk-by-type
GET/POST/DELETE /api/v1/commissioning/work-items
POST/GET    /api/v1/commissioning/document-links
GET/POST/PATCH /api/v1/commissioning/tag-targets
GET         /api/v1/commissioning/progress
GET         /api/v1/commissioning/gate-check
POST/GET    /api/v1/commissioning/gate-overrides

GET         /api/v1/dashboard/stats
GET         /api/v1/dashboard/analytics
GET         /api/v1/dashboard/weekly-targets
GET         /api/v1/dashboard/tracker-export

GET/POST/PATCH/DELETE /api/v1/designations
GET/PUT     /api/v1/admin/settings/{key}
GET         /api/v1/admin/audit-logs
POST        /api/v1/reports/generate/{doc_type}
GET/POST/PATCH/DELETE /api/v1/project-approvers
DELETE      /api/v1/notifications/{id}
DELETE      /api/v1/notifications
```

### Dashboard Analytics

The dashboard (`/dashboard`) provides:
- **KPI Cards**: Total Documents, Approved, Pending Approval, Commissioning % (all clickable → filtered pages)
- **Upcoming Tag Targets**: Bar chart showing tags to achieve per week (4 weeks + overdue), color-coded by tag, clickable bars → filtered tag-targets page
- **Document Submissions**: Stacked bar chart by type (WIR/MIR/CIR/FAT) + approval trend line, monthly
- **Status Distribution**: Donut chart, clickable slices → filtered documents page
- **Commissioning Progress by POD**: Progress bars (P1/P2/P3), clickable → tracking page with POD filter
- **Tag Achievement**: Stacked bars per tag showing achieved/in-progress/delayed, clickable → tag-targets
- **Approval Turnaround**: Bar chart showing avg/max response days per doc type
- **Delayed Items**: Table of assets past target date, clickable rows
- **Documents by Discipline**: Treemap chart, clickable → documents filtered by discipline
- **Tag Achievement Timing**: Scatter plot showing days early/late per asset tag, color-coded by tag level
- **Reports & Exports**: CSV downloads (Commissioning Tracker with Aconex dates, Approver Remarks)

### Security Model

- `require_admin` gate on `/admin` router — requires admin or super_admin role (or is_superuser)
- `require_permission("commissioning.manage")` — template/requirement CRUD
- `require_permission("documents.submit")` — document creation, work items
- `require_permission("documents.delete")` — document deletion
- `require_permission("reports.templates")` — template upload/delete (admin only)
- `require_project_access()` — validates user has access to the requested project_id
- Role assignment: admin can assign all roles except super_admin; super_admin/is_superuser can assign all
- Approval order enforced (can't skip queue)
- Sign endpoint validates user has appropriate role
- Document status state machine prevents invalid transitions
- `is_superuser` flag hidden from UI — only for dev account, bypasses all checks

### Demo Data

The database is seeded with realistic demo data via `app.seed_demo`:
- **368 documents** across WIR/MIR/CIR/FAT at various approval stages
- **37 assets** across 3 PODs (P1 most advanced, P2 mid-progress, P3 early stages)
- **455 requirements** with 217 achieved (47.7% completion)
- **Tag targets** spanning Mar 2026 – Feb 2027 with achieved, delayed, and in-progress items
- **Approval rounds** with Aconex dates and approver remarks
- **50 general QA/QC documents** not linked to commissioning (painting, cleaning, structural, etc.)
- **Level progression respected** — no asset has higher-level activity without lower levels complete
- Cleanup script: `uv run python -m app.cleanup_documents` (wipes all docs, resets counters)

## Completed This Session

### ✅ Database Cleanup & Reset
- Created `cleanup_documents.py` script that wipes all document-related data and resets serial counters + calculated statuses

### ✅ End-to-End Approval Workflow Tests
- WIR: create → work items → link → sign both → Approver 1 (A) → Approver 2 (A) → approved → requirement achieved
- MIR: create → link → single sign → Approver 1 (A) → Approver 2 (A) → approved → requirement achieved
- CIR: create → link → sign both → Approver 1 (A) → Approver 2 (B) → approved_with_comments → requirement achieved
- FAT: create (auto-approved) → link → requirement immediately achieved
- All commissioning recalculation verified working correctly

### ✅ Demo Data Seeding
- 368 documents at various stages with realistic dates (Jan-May 2026)
- Tag targets with delays, in-progress, and achieved items
- Level progression validated (no violations)
- General QA/QC docs across all disciplines (AR, CS, EL, MC, PL, FF)
- Approver remarks seeded for tracker export

### ✅ Professional Dashboard with Charts (Recharts)
- KPI cards with click-through navigation
- Upcoming Tag Targets bar chart (overdue + 4 weeks, color-coded by tag)
- Document Submissions stacked bar + approval trend line
- Status Distribution donut chart (clickable slices)
- Commissioning Progress by POD (progress bars)
- Tag Achievement (stacked bars with achieved/in-progress/delayed)
- Approval Turnaround (avg/max days per doc type)
- Delayed Items table
- Documents by Discipline treemap (clickable)
- Tag Achievement Timing scatter plot (days early/late, color by tag, zero reference line)
- Reports & Exports section (CSV: Commissioning Tracker + Approver Remarks with Aconex dates)
- All charts support dark/light theme via CSS variables
- All interactive elements navigate to filtered detail pages

### ✅ Click-Through Navigation
- All dashboard elements navigate to relevant filtered pages
- Documents page: supports status + type + discipline URL filters
- Tag Targets page: supports tag + week + status URL filters
- Tracking page: supports POD + tag URL filters

### ✅ Tracker Export with Aconex Dates
- `/dashboard/tracker-export` endpoint returns full commissioning tracker data
- Includes: asset, requirement, doc reference, status, approver 1 & 2 (signatory, decision, remarks, date, aconex_sent, aconex_received)
- CSV export from dashboard (Commissioning Tracker + Approver Remarks)

### ✅ Bug Fixes
- Fixed `sort_order` Zod schema type error in asset-types page (z.coerce → z.number)
- Fixed "Actions" column header missing in 5 table pages
- Fixed tooltip readability in dark theme (donut chart, turnaround chart)
- Fixed Live Tracking button using window.location (→ router.push)

## Deployment (In Progress)

Target architecture:
- **Frontend**: Vercel (deployed, auto-deploys from main)
- **Backend**: Render (free tier, auto-deploy)
- **Database**: Neon (serverless PostgreSQL)
- **File Storage**: Cloudflare R2 (S3-compatible)
- **CI/CD**: GitHub Actions (migrations on push)

### Remaining deployment tasks:
1. Set up Neon database + migrate data
2. Deploy backend to Render with env vars
3. Set up Cloudflare R2 for file storage
4. Update backend to use S3-compatible storage adapter
5. Configure CORS and environment-based API URL
6. GitHub Actions workflow for migrations

## Next Priorities

1. **Complete cloud deployment** — Neon DB + Render backend + R2 storage + CI/CD
2. **Server-side pagination** for document list pages (WIR/MIR/CIR/FAT)
3. **Report templates** — Upload CIR/FAT DOCX templates, test PDF generation
4. **CSV import for assets** — Bulk import assets from CSV with validation
5. **Audit log expansion** — Add audit logging to commissioning operations
6. **Level progression enforcement** — Warn/block when submitting higher-level docs without lower levels complete

## Login Credentials

```
dev@jlwme.com / Dev12345 (super_admin)
admin@jlwme.com / Admin123 (admin)
site@jlwme.com / Site1234 (site_engineer)
qaqc@jlwme.com / Qaqc1234 (qaqc_engineer)
jerry@jlwme.com / Jerry123 (qaqc_manager)
```
