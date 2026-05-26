# QTC360 — Session Continuation Prompt

Use this prompt to continue development in a new session.

---

We're building QTC360 — an enterprise QA/QC + Commissioning management platform. The project is at D:\QTC360\qtc360.

PROJECT_SPEC.md in the root has the full specification. Screenshots are at D:\QTC360\screenshots\.

## CURRENT STATUS — Phase 2 Complete

### Backend (FastAPI + SQLAlchemy 2.x async + PostgreSQL)
- ✅ Auth: JWT access/refresh tokens, login endpoint, get_current_user dependency
- ✅ Registration is admin-only (requires superuser token)
- ✅ RBAC: User, Role, Permission models with many-to-many, require_permission dependency
- ✅ Roles seeded: super_admin, admin, site_engineer, qaqc_engineer, qaqc_manager
- ✅ Users seeded: dev@jlwme.com/dev123, admin@jlwme.com/admin123, site@jlwme.com/site123, qaqc@jlwme.com/qaqc123
- ✅ Master tables: Client, Project, ApproverTitle, Approver, ProjectApprover, Discipline, Service, AssetType, Asset, ApprovalStatus
- ✅ user_projects association table (users assigned to projects)
- ✅ Generic CRUD router factory (list, get, create, patch, soft-delete)
- ✅ All endpoints at /api/v1/: auth, clients, projects, approver-titles, approvers, project-approvers, disciplines, services, asset-types, assets
- ✅ /auth/me/projects endpoint returns user's assigned projects
- ✅ Seed data: 2 clients, 2 projects (AUH-08/1733, DU Mercury/1728), 4 approver titles, 4 approvers, project approvers for 1728, 7 disciplines for 1728, 4 approval statuses for 1728
- ✅ bcrypt used directly (passlib incompatible with bcrypt 5.x)
- ✅ Alembic migrations applied (3 total)

### Frontend (Next.js 16 + React 19 + shadcn/ui + @base-ui/react)
- ✅ Dark/light theme with Zenith-inspired design
- ✅ Responsive sidebar: collapses to icons on tablet (768-1023px), Sheet overlay on mobile (<768px)
- ✅ Logo: separate SVG variants for light/dark themes (logo.svg, logo-light.svg, logo-icon.svg, logo-icon-light.svg). Light uses #2563eb blue, dark uses original #014EFC
- ✅ Sidebar active links use var(--primary) blue
- ✅ Sidebar item text: 70% opacity default, full on hover (uses sidebar-accent-foreground)
- ✅ Login page with RHF + Zod validation, no browser validation, "Proudly by LB" at bottom
- ✅ Auth: useLogin, useCurrentUser, useLogout hooks, AuthGuard component
- ✅ Logout clears tokens + selected_project from localStorage
- ✅ API layer: Axios instance with JWT interceptor + auto-refresh on 401
- ✅ React Query provider
- ✅ Project selection: modal after login (if multiple projects), ProjectSwitcher in navbar (desktop: bordered pill right of search, mobile: right-aligned next to hamburger+logo)
- ✅ DataTable system: sorting, search, pagination, column visibility, faceted filters, row actions, row selection with checkboxes (Zenith-style subtle borders), bulk actions (delete with confirmation dialog, export selected), CSV export (resolves FK objects to names), import (dialog with template download)
- ✅ Form system: RHF + Zod, FormField/FormItem/FormLabel/FormControl/FormMessage, field wrappers
- ✅ Master table pages: Projects, Clients, Disciplines, Services, Approvers, Assets — each with DataTable + add/edit dialog + export/import + bulk delete
- ✅ Button destructive variant: solid red-600, white text (Zenith style)
- ✅ Checkboxes: subtle border (foreground/20), no bg, hover brightens, disabled uses data-disabled with pointer-events-none
- ✅ Scrollbar: 4px, flush right, no arrows, hover darkens
- ✅ cursor: pointer on all buttons globally
- ✅ Pagination shows "Showing 1-10 of X results"
- ✅ Actions column has "Actions" header label

### Key Architecture Decisions
- shadcn/ui uses @base-ui/react (NOT Radix) — no `asChild` prop, triggers render children directly
- DropdownMenuLabel must be inside DropdownMenuGroup
- Zod v4 with @hookform/resolvers — avoid .default() and .optional() in schemas (use explicit string types with defaultValues)
- useSyncExternalStore for project selection (cached snapshot to avoid infinite loops)
- Tailwind v4 with @tailwindcss/postcss — standard breakpoints (sm=640, md=768, lg=1024)
- base-ui checkbox uses `data-disabled` not native `disabled` attribute for styling

### What's Next
- Frontend pages for remaining master tables (Employees, Activities, Sub-Activities, Tests, Systems, Contractors)
- Admin pages (Users management, Roles, Permissions, Settings)
- Dashboard page with actual content
- Phase 3: Document submission workflows (MIR, WIR, CIR, FAT)
- Milestone tracking system
- Commissioning level tracking

### Key Files
- frontend/src/components/ui/sidebar.tsx — shadcn sidebar (@base-ui/react)
- frontend/src/app/(dashboard)/layout.tsx — dashboard layout with AuthGuard + SidebarProvider
- frontend/src/config/navigation.ts — all nav items
- frontend/src/app/globals.css — theme tokens and custom styles
- frontend/src/lib/api.ts — Axios instance with JWT interceptor
- frontend/src/lib/csv.ts — CSV export/import utilities
- frontend/src/hooks/use-auth.ts — auth hooks
- frontend/src/hooks/use-project.ts — project selection hooks
- frontend/src/components/data-table/ — reusable DataTable system
- frontend/src/components/form/ — reusable form system
- frontend/src/components/ui/button.tsx — button with destructive variant (solid red)
- frontend/src/components/ui/checkbox.tsx — checkbox with Zenith-style subtle borders
- backend/app/models/ — all SQLAlchemy models
- backend/app/api/v1/crud.py — generic CRUD router factory
- backend/app/api/v1/master.py — master table routes
- backend/app/core/security.py — JWT + bcrypt
- backend/app/core/deps.py — auth dependencies (get_current_user, require_permission)
- backend/app/seed.py — seed script for all data

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
