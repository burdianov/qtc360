# QTC360 — Session Continuation Prompt

Use this prompt to continue development in a new session.

---

We're building QTC360 — an enterprise QA/QC + Commissioning management platform. The project is at D:\QTC360\qtc360.

PROJECT_SPEC.md in the root has the full specification. Screenshots are at D:\QTC360\screenshots\.

## CURRENT STATUS — Phase 3 Complete (Document Workflows + Template Builder)

### Backend (FastAPI + SQLAlchemy 2.x async + PostgreSQL)
- ✅ Auth: JWT access/refresh tokens, login endpoint, get_current_user dependency
- ✅ Password policy: min 8 chars, 1 uppercase, 1 number. Admin reset sets temp password (1hr expiry), user must change on login
- ✅ Registration is admin-only (requires superuser token)
- ✅ RBAC: User, Role, Permission models with many-to-many, require_permission dependency
- ✅ Roles seeded: super_admin, admin, site_engineer, qaqc_engineer, qaqc_manager
- ✅ Users seeded: dev@jlwme.com/Dev12345, admin@jlwme.com/Admin123, site@jlwme.com/Site1234, qaqc@jlwme.com/Qaqc1234, jerry@jlwme.com/Jerry123
- ✅ Master tables: Client, Project, ApproverTitle, Approver, ProjectApprover, Discipline, Service, AssetType, Asset, ApprovalStatus, Employee, Activity, SubActivity, Test, System, Contractor
- ✅ Document models: Document (single table for MIR/WIR/CIR with doc_type), DocumentApproval, document_assets, FAT, fat_assets
- ✅ Template models: DocumentTemplate (JSONB schema for cover sheet layout), ReferenceNumberConfig (pattern-based auto-numbering)
- ✅ Generic CRUD router factory + dedicated document/FAT/template endpoints
- ✅ Document workflow: sign (site_engineer/qaqc_engineer), approval chain (respond → advance/reject)
- ✅ Reference number generation: /templates/ref-config/generate (pattern: {project_code}-{contractor_code}-{discipline_code}-{doc_type}-{serial:04d})
- ✅ Dashboard stats endpoint: /dashboard/stats?project_id=
- ✅ Alembic migrations applied (8 total)
- ✅ Seed get_or_create restores soft-deleted records

### Frontend (Next.js 16 + React 19 + shadcn/ui + @base-ui/react)
- ✅ Dark/light theme with Zenith-inspired design
- ✅ Login page: SVG background, theme toggle, password change flow
- ✅ Responsive sidebar: collapses to icons on tablet, Sheet overlay on mobile
- ✅ Sidebar: controlled collapsible groups, auto-opens group on navigation, scrolls to active item
- ✅ Sidebar logo: 32x32 icon centered in collapsed mode
- ✅ Auth: useLogin, useCurrentUser, useLogout, useChangePassword hooks
- ✅ API layer: Axios instance with JWT interceptor + auto-refresh on 401
- ✅ React Query provider + project_id in query keys
- ✅ Project selection: modal after login (localStorage), ProjectSwitcher in navbar
- ✅ DataTable system: sorting, search, pagination, column visibility, row actions (with confirm dialog), bulk actions, CSV export/import
- ✅ Form system: RHF + Zod, Select uses value (controlled)
- ✅ Master table pages: Projects, Clients, Disciplines, Services, Approvers, Assets, Employees, Activities, Sub-Activities, Tests, Systems, Contractors
- ✅ Admin pages: Users, Roles, Permissions, Settings
- ✅ Dashboard page: 7 stat cards with colored icon badges, placeholder charts
- ✅ QA/QC pages: MIR, WIR (list + full-page form at /qaqc/wir/new), CIR, FAT Reports
- ✅ WIR form: date, discipline, subject, description, location, floor, RAMS, drawing ref, service/activity/sub-activity selects, multi-asset selection, 2 inspectors with click-to-sign, attachments
- ✅ Template Builder: /documents/templates/builder — visual section/row/cell editor
  - Settings: name, doc_type, font, fontSize, margins, header image, section gap
  - Footer editor (repeats on all pages)
  - Sections: collapsible, labeled, configurable gap
  - Rows: height, evenCells, isTitle + color, expandToFooter
  - Cells: type (label/data), variant (text/checkbox), width %, value/fieldKey/checkboxLabel
  - Data binding to form fields (reference_number, revision, date, subject, discipline, inspectors, signatures, page_number, etc.)
- ✅ Templates list page: /documents/templates with CRUD
- ✅ Loading.tsx at dashboard layout level
- ✅ Card component with Zenith-style border (oklch(0.28)) and background (oklch(0.20))
- ✅ Global scrollbar: thin, subtle, no arrows, touches top edge
- ✅ Delete confirmation on all row actions

### Important Rules
- After any database migration or seed, create a database dump into `backend/db_dump/` — each table as a separate CSV file.

### What's Next
- Signature system refinement (script fonts, Docusign-style)
- PDF generation from template + form data (cover sheet + attachments)
- Reference number config UI in project settings
- Milestone tracking system
- Commissioning level tracking
- MIR and CIR full-page forms (similar to WIR)

### Key Files
- frontend/src/components/layout/app-sidebar.tsx — sidebar with controlled collapsibles + scroll-to-active
- frontend/src/app/(dashboard)/layout.tsx — dashboard layout
- frontend/src/app/(dashboard)/loading.tsx — loading spinner
- frontend/src/config/navigation.ts — all nav items (FAT Reports first in QA/QC)
- frontend/src/app/globals.css — theme tokens, scrollbar styles
- frontend/src/lib/api.ts — Axios instance with JWT interceptor
- frontend/src/hooks/use-project.ts — project selection (localStorage)
- frontend/src/components/data-table/ — reusable DataTable system
- frontend/src/components/data-table/data-table-row-actions.tsx — row actions with confirm dialog
- frontend/src/components/ui/card.tsx — Card (border instead of ring)
- frontend/src/app/(dashboard)/dashboard/page.tsx — dashboard with stats
- frontend/src/app/(dashboard)/qaqc/wir/new/page.tsx — WIR full-page form
- frontend/src/app/(dashboard)/qaqc/wir/page.tsx — WIR list (navigates to /new)
- frontend/src/app/(dashboard)/documents/templates/page.tsx — templates list
- frontend/src/app/(dashboard)/documents/templates/builder/page.tsx — template builder UI
- backend/app/models/document.py — Document model (MIR/WIR/CIR single table)
- backend/app/models/document_approval.py — DocumentApproval + document_assets
- backend/app/models/fat.py — FAT + fat_assets
- backend/app/models/document_template.py — DocumentTemplate (JSONB schema)
- backend/app/models/reference_number_config.py — ReferenceNumberConfig
- backend/app/api/v1/documents.py — document CRUD + sign + approval workflow
- backend/app/api/v1/fats.py — FAT CRUD
- backend/app/api/v1/templates.py — template CRUD + ref-config + generate ref number
- backend/app/api/v1/dashboard.py — dashboard stats
- backend/app/api/v1/crud.py — generic CRUD router
- backend/app/seed.py — seed script (restores soft-deleted)

### Running the Project
```bash
# Start Docker services (PostgreSQL + pgAdmin)
cd D:\QTC360\qtc360 && docker compose up -d

# Backend
cd D:\QTC360\qtc360\backend && uv run alembic upgrade head && uv run python -m app.seed && uv run uvicorn app.main:app --reload

# Frontend
cd D:\QTC360\qtc360\frontend && npm run dev
```

### GitHub
Repository: git@github.com:burdianov/qtc360.git
