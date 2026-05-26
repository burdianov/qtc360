# QTC360 — Session Continuation Prompt

Use this prompt to continue development in a new session.

---

We're building QTC360 — an enterprise QA/QC + Commissioning management platform. The project is at D:\QTC360\qtc360.

PROJECT_SPEC.md in the root has the full specification. Screenshots are at D:\QTC360\screenshots\.

## CURRENT STATUS — Phase 3+ (Template Builder + WIR Form — In Progress)

We are still working on fixing and refining the Template Builder and WIR form.

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
- ✅ ProjectHeaderImage model: stores header images per project+cell_id (LargeBinary in DB)
- ✅ Generic CRUD router factory + dedicated document/FAT/template endpoints
- ✅ Header image endpoints: POST/GET /templates/header-image/{project_id}/{cell_id}
- ✅ PDF generation: POST /pdf/generate — WeasyPrint server-side rendering with binary search for expand-to-footer rows
- ✅ Template create is upsert (handles duplicate project+doc_type gracefully)
- ✅ Document workflow: sign (site_engineer/qaqc_engineer), approval chain (respond → advance/reject)
- ✅ Reference number generation: /templates/ref-config/generate
- ✅ Dashboard stats endpoint: /dashboard/stats?project_id=
- ✅ Alembic migrations applied (10 total)
- ✅ Seed get_or_create restores soft-deleted records

### Frontend (Next.js 16 + React 19 + shadcn/ui + @base-ui/react)
- ✅ Dark/light theme with Zenith-inspired design
- ✅ Login page: SVG background, theme toggle, password change flow, "Proudly by LB®"
- ✅ Responsive sidebar: collapses to icons on tablet, Sheet overlay on mobile
- ✅ Auth: useLogin, useCurrentUser, useLogout, useChangePassword hooks
- ✅ API layer: Axios instance with JWT interceptor + auto-refresh on 401
- ✅ React Query provider + project_id in query keys
- ✅ Project selection: modal after login (localStorage), ProjectSwitcher in navbar
- ✅ DataTable system: sorting, search, pagination, column visibility, row actions, bulk actions, CSV export/import
- ✅ Form system: RHF + Zod, Select uses value (controlled)
- ✅ Master table pages: Projects, Clients, Disciplines, Services, Approvers, Assets, Employees, Activities, Sub-Activities, Tests, Systems, Contractors
- ✅ Admin pages: Users, Roles, Permissions, Settings
- ✅ Dashboard page: 7 stat cards with colored icon badges, placeholder charts
- ✅ QA/QC pages: MIR, WIR (list + full-page form at /qaqc/wir/new), CIR, FAT Reports
- ✅ WIR form (in progress):
  - Full width layout, grid-based form fields
  - DatePicker component (react-day-picker + popover calendar)
  - Discipline, subject, description, location, floor, RAMS, drawing ref
  - Service/activity/sub-activity cascade selects
  - Multi-asset selection with badges
  - 2 inspectors with click-to-sign
  - Attachments
- ✅ Template Builder: /documents/templates/builder (in progress)
  - Auto-save (debounced 800ms) — no manual save button
  - Header: rows/cells structure, each cell has individual image upload + scale slider
  - Header images stored in DB per project+cell_id
  - Settings: name, doc_type, font (select dropdown), fontSize, margins
  - Footer editor (repeats on all pages)
  - Sections: collapsible, labeled, individual gap per section
  - Rows: Row Height, isTitle + color, expandToFooter, internalBorders toggle, Row Background (color picker with gray swatches)
  - Cells: draggable borders between cells to resize, Reset Widths button, type (label/data), variant (text/checkbox), fieldKey binding
  - When gap=0 between sections, they share one border line (margin-top:-1px)
  - Floating preview button (blue, with tooltip) — calls server-side PDF generation
  - Close button with navigation
  - Toast notifications (sonner, theme-aware)
- ✅ PDF Preview: server-side WeasyPrint generation
  - position:fixed header/footer repeats on every page
  - Expand-to-footer rows: binary search (25 iterations) finds exact max height via WeasyPrint's own layout engine — no hardcoded values
  - Header images embedded as base64 data URIs
  - Background colors, font sizes, internal borders all rendered correctly
  - print-color-adjust: exact for background colors
- ✅ Select/DropdownMenu: modal={false}, alignItemWithTrigger={false} to prevent scroll lock
- ✅ Delete confirmation on all row actions
- ✅ Toaster: sonner with theme="system", custom popover styling

### Important Rules
- After any database migration or seed, create a database dump into `backend/db_dump/` — each table as a separate CSV file.

### What's Next (after Template Builder + WIR are finalized)
- Signature system refinement (script fonts, Docusign-style)
- Reference number config UI in project settings
- Milestone tracking system
- Commissioning level tracking
- MIR and CIR full-page forms (similar to WIR)

### Key Files
- frontend/src/components/layout/app-sidebar.tsx — sidebar
- frontend/src/app/(dashboard)/layout.tsx — dashboard layout
- frontend/src/config/navigation.ts — nav items
- frontend/src/app/globals.css — theme tokens, scrollbar styles
- frontend/src/lib/api.ts — Axios instance with JWT interceptor
- frontend/src/hooks/use-project.ts — project selection (localStorage)
- frontend/src/components/data-table/ — reusable DataTable system
- frontend/src/components/ui/card.tsx — Card
- frontend/src/components/ui/select.tsx — Select with modal={false}
- frontend/src/components/ui/dropdown-menu.tsx — DropdownMenu with modal={false}
- frontend/src/components/ui/date-picker.tsx — DatePicker (react-day-picker + popover)
- frontend/src/app/(dashboard)/dashboard/page.tsx — dashboard with stats
- frontend/src/app/(dashboard)/qaqc/wir/new/page.tsx — WIR full-page form
- frontend/src/app/(dashboard)/documents/templates/builder/page.tsx — template builder UI
- backend/app/models/document.py — Document model
- backend/app/models/document_template.py — DocumentTemplate (JSONB schema)
- backend/app/models/project_header_image.py — ProjectHeaderImage (project_id + cell_id + image bytes)
- backend/app/api/v1/templates.py — template CRUD + header image upload
- backend/app/api/v1/pdf.py — PDF generation (WeasyPrint + binary search for expand rows)
- backend/app/api/v1/documents.py — document CRUD + sign + approval workflow
- backend/app/seed.py — seed script

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
