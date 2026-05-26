# QTC360 — Session Continuation Prompt

Use this prompt to continue development in a new session.

---

We're building QTC360 — an enterprise QA/QC + Commissioning management platform. The project is at D:\QTC360\qtc360.

PROJECT_SPEC.md in the root has the full specification. Screenshots are at D:\QTC360\screenshots\.

## CURRENT STATUS — Phase 2 Complete + Admin + Dashboard + UX Polish

### Backend (FastAPI + SQLAlchemy 2.x async + PostgreSQL)
- ✅ Auth: JWT access/refresh tokens, login endpoint, get_current_user dependency
- ✅ Password policy: min 8 chars, 1 uppercase, 1 number. Admin reset sets temp password (1hr expiry), user must change on login
- ✅ Registration is admin-only (requires superuser token)
- ✅ RBAC: User, Role, Permission models with many-to-many, require_permission dependency
- ✅ Roles seeded: super_admin, admin, site_engineer, qaqc_engineer, qaqc_manager
- ✅ Users seeded: dev@jlwme.com/Dev12345, admin@jlwme.com/Admin123, site@jlwme.com/Site1234, qaqc@jlwme.com/Qaqc1234, jerry@jlwme.com/Jerry123
- ✅ Master tables: Client, Project, ApproverTitle, Approver, ProjectApprover, Discipline, Service, AssetType, Asset, ApprovalStatus, Employee, Activity, SubActivity, Test, System, Contractor
- ✅ user_projects association table (users assigned to projects)
- ✅ Generic CRUD router factory with: pagination (skip/limit), IntegrityError handling (409), separate update_schema (optional fields), eager loading support
- ✅ All endpoints at /api/v1/: auth, clients, projects, approver-titles, approvers, project-approvers, disciplines, services, asset-types, assets, approval-statuses, employees, activities, sub-activities, tests, systems, contractors
- ✅ Admin endpoints at /api/v1/admin/: users (CRUD + role assignment + password reset), roles (CRUD + permission assignment), permissions (CRUD)
- ✅ Dashboard endpoint at /api/v1/dashboard/stats?project_id= (counts: disciplines, services, systems, contractors, employees, tests, approvers)
- ✅ Schemas in dedicated files: schemas/master.py, schemas/auth.py, schemas/admin.py
- ✅ Token sub field validated as UUID in deps.py
- ✅ Register email check filters is_deleted
- ✅ Explicit selectinload (no lazy=selectin on models)
- ✅ UniqueConstraints on code fields (scoped by parent FK)
- ✅ ApproverTitle in its own model file
- ✅ Alembic migrations applied (6 total)
- ✅ Seed data: 2 clients, 2 projects, 5 users, 5 roles, 4 approver titles, 4 approvers, project approvers, 7 disciplines, 4 approval statuses
- ✅ Seed get_or_create restores soft-deleted records (is_deleted = False)

### Frontend (Next.js 16 + React 19 + shadcn/ui + @base-ui/react)
- ✅ Dark/light theme with Zenith-inspired design
- ✅ Login page: SVG background (construction/commissioning themed), theme toggle, password change flow
- ✅ Responsive sidebar: collapses to icons on tablet, Sheet overlay on mobile
- ✅ Sidebar footer with user avatar (centered when collapsed)
- ✅ Sidebar logo: 32x32 icon centered in collapsed mode, full logo in expanded mode
- ✅ Logo: separate SVG variants for light/dark themes
- ✅ Auth: useLogin, useCurrentUser, useLogout (useCallback), useChangePassword hooks
- ✅ API layer: Axios instance with JWT interceptor + auto-refresh on 401
- ✅ React Query provider + project_id in query keys for project-scoped pages
- ✅ Project selection: modal after login, ProjectSwitcher in navbar
- ✅ DataTable system: sorting, search, pagination, column visibility, row actions, bulk actions (Promise.allSettled), CSV export/import
- ✅ DataTable row actions: delete confirmation dialog (confirm property on RowAction)
- ✅ Form system: RHF + Zod, Select uses value (controlled)
- ✅ Master table pages: Projects, Clients, Disciplines, Services, Approvers, Assets, Employees, Activities, Sub-Activities, Tests, Systems, Contractors
- ✅ Admin pages: Users (CRUD + role assignment + Reset Password dialog), Roles, Permissions, Settings
- ✅ Dashboard page: 7 stat cards with colored icon badges, placeholder charts for commissioning progress and recent activity
- ✅ Loading.tsx at dashboard layout level (instant navigation feedback)
- ✅ Toast notifications (sonner)
- ✅ Next.js Image component used throughout
- ✅ cursor: pointer on buttons, [role="button"], [role="menuitem"]
- ✅ Route: /master-data/clients (plural, consistent)
- ✅ Card component (shadcn) with border styling matching Zenith
- ✅ Dark theme card background: oklch(0.20), border: oklch(0.28)
- ✅ Global scrollbar: thin, subtle (oklch(0.2)), lighter on hover (oklch(0.25)), no arrows, touches top edge

### Important Rules
- After any database migration or seed, create a database dump into `backend/db_dump/` — each table as a separate CSV file.

### What's Next
- Phase 3: Document submission workflows (MIR, WIR, CIR, FAT)
- Milestone tracking system
- Commissioning level tracking

### Key Files
- frontend/src/components/layout/app-sidebar.tsx — sidebar (no footer logout, just user info)
- frontend/src/app/(dashboard)/layout.tsx — dashboard layout
- frontend/src/app/(dashboard)/loading.tsx — loading spinner for navigation
- frontend/src/config/navigation.ts — all nav items
- frontend/src/app/globals.css — theme tokens, scrollbar styles, custom styles
- frontend/src/lib/api.ts — Axios instance with JWT interceptor
- frontend/src/lib/csv.ts — CSV export/import (limitation documented)
- frontend/src/hooks/use-auth.ts — auth hooks (useCallback on logout)
- frontend/src/hooks/use-project.ts — project selection hooks
- frontend/src/components/data-table/ — reusable DataTable system
- frontend/src/components/data-table/data-table-row-actions.tsx — row actions with confirm dialog
- frontend/src/components/form/ — reusable form system
- frontend/src/components/ui/card.tsx — Card component (border instead of ring)
- frontend/src/app/(dashboard)/dashboard/page.tsx — dashboard with stats cards
- frontend/src/app/login/page.tsx — login + password change + theme toggle
- frontend/public/login-bg.svg, login-bg-light.svg — login backgrounds
- backend/app/models/ — all SQLAlchemy models (no lazy=selectin)
- backend/app/api/v1/crud.py — generic CRUD router (pagination, eager, IntegrityError)
- backend/app/api/v1/master.py — master table routes with update schemas
- backend/app/api/v1/admin.py — admin routes (imports from schemas/admin.py)
- backend/app/api/v1/auth.py — auth routes (imports from schemas/auth.py)
- backend/app/api/v1/dashboard.py — dashboard stats endpoint
- backend/app/schemas/ — master.py, auth.py, admin.py
- backend/app/core/security.py — JWT + bcrypt + validate_password
- backend/app/core/deps.py — auth dependencies (UUID validation, selectinload)
- backend/app/seed.py — seed script (valid passwords, restores soft-deleted)

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
