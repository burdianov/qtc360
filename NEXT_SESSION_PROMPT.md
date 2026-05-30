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

### Backend Structure

```
backend/app/
├── api/v1/          # Routers: auth, master, admin, documents, commissioning, reports, notifications, ref_config
├── models/          # ORM: commissioning.py, document.py, gate_override.py, designation.py, audit_log.py, app_setting.py, asset.py (custom_fields JSONB), + core entities
├── schemas/         # Pydantic: commissioning.py (with Literal types), document.py (with state machine), master.py, auth.py, admin.py
├── services/        # commissioning.py (status calculation engine), signature.py, audit.py, pdf.py (OCR), pdf_merge.py, approval.py
├── core/            # config, database, deps (require_permission), security
└── seed.py / seed_commissioning.py
```

### Frontend Structure

```
frontend/src/
├── app/(dashboard)/
│   ├── commissioning/   # tracking, requirements, tag-targets
│   ├── master-data/     # projects, disciplines, services, assets, asset-types, approvers, requirement-templates, designations, etc.
│   ├── qaqc/            # wir (form + list), mir, cir, fat
│   ├── documents/       # templates (admin-only, tabbed by doc type)
│   ├── admin/           # users, roles, permissions, settings (layout-guarded to admin only)
│   └── dashboard/
├── components/
│   ├── commissioning-linkage.tsx     # Reusable panel for WIR/CIR/MIR/FAT requirement linking + work breakdown + gate override dialog
│   ├── document-attachments.tsx      # Reusable attachment manager with drag-reorder, delete confirmation, bundle download
│   ├── approval/                     # action panel, submit dialog (with Aconex date), record-response dialog (with Aconex date), rounds list, region picker
│   ├── data-table/                   # Reusable DataTable system (inline editing, column visibility persistence, drag reorder, RowAction supports per-row dynamic label/confirm)
│   ├── layout/                       # Sidebar (admin-filtered + adminOnly items), navbar, project switcher
│   └── ui/                           # shadcn components + progress, switch, date-picker, time-picker (AM/PM with scrollable columns)
├── hooks/             # use-auth, use-project
├── config/            # navigation.ts (with adminOnly flag)
└── lib/               # api.ts (FormData-aware Content-Type), utils.ts, csv.ts, format-date.ts (configurable format)
```

### API Endpoints (key ones)

```
POST/GET    /api/v1/documents
DELETE      /api/v1/documents/{id}             # supersede if submitted, hard-delete + serial reuse if not
POST        /api/v1/documents/{id}/sign
POST        /api/v1/documents/{id}/notify-signatories

# External approval workflow
GET         /api/v1/documents/{id}/approval-rounds
POST        /api/v1/documents/{id}/submit-to-approver  (with aconex_submitted_date)
POST        /api/v1/documents/{id}/approval-rounds  (multipart: returned PDF + decision + signatory + aconex_received_date)
PUT         /api/v1/documents/{id}/approval-rounds/{round_id}/file
POST        /api/v1/documents/{id}/approval-rounds/{round_id}/attachments?insert_after_page=N
GET         /api/v1/documents/{id}/approval-rounds/{round_id}/bundle

# Document attachments
GET/POST/DELETE /api/v1/documents/{id}/attachments
PATCH       /api/v1/documents/{id}/attachments/reorder
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

GET/POST/PATCH/DELETE /api/v1/designations
GET/PUT     /api/v1/admin/settings/{key}  (app settings: date_format, asset_custom_fields, etc.)
GET         /api/v1/admin/audit-logs
GET         /api/v1/reports/pdf-engine/health
POST        /api/v1/reports/generate/{doc_type}
GET         /api/v1/auth/users
GET/POST/PATCH/DELETE /api/v1/project-approvers
DELETE      /api/v1/notifications/{id}  (soft-delete single)
DELETE      /api/v1/notifications  (clear all)
```

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
- Admin pages layout-guarded + sidebar hidden for non-admin users
- Document Templates page admin-only (redirect + sidebar `adminOnly` flag)

### WIR/MIR/CIR Form Flow

1. General info (ref number auto-generated per project+discipline+doc_type, date, discipline, subject, description, location fields)
2. Commissioning Linkage (toggle on/off)
3. Assets (collapsible, disabled until linkage is on)
4. Signatories (DocuSign-style):
   - Two columns (Signatory 1 & 2) with grid alignment
   - Each: user select → signature box → "Change signature style" link
   - Date (DatePicker) + Time (TimePicker) — only editable by the assigned signatory
   - Remarks textarea (placeholder: "Remarks...")
5. Attachments — uses reusable `DocumentAttachments` component
6. Actions: Save as Draft, Notify Signatories (only notify, no save; enabled when saved + other signatory assigned), Preview PDF, Download Document
7. **Form locking**: after approver 1 returns, General Info + Signatories + Attachments + Actions are disabled. Only Commissioning Linkage + Assets remain editable.
8. External Approval panel (shown after internal signing):
   - Submit to Approver dialog (with Aconex upload date)
   - Record Response dialog (with Aconex received date)
   - Rounds list showing Aconex dates

### Inline Table Editing

All master data tables support per-cell inline editing:
- Click an editable cell → input appears with ✓/✗ buttons
- Enter saves, Escape cancels
- Dropdown fields show human-readable names (not UUIDs)
- `editableColumns` prop: `Record<colId, { type: 'text' | 'number' | 'select', options?: [...] }>`
- `onRowUpdate` prop: `(row, updates) => Promise<void>`
- Column width controllable via `meta: { width: "170px" }`

## Completed This Session

### ✅ Notification Delete/Clear
- DELETE /notifications/{id} (soft-delete single) + DELETE /notifications (clear all)
- Per-notification X button (hover reveal, slide-out animation)
- "Clear all" button with confirmation dialog + staggered fade-out animation

### ✅ Document Templates — Admin Only + Tabs
- Page redirects non-admin users to /dashboard
- Sidebar hides "Templates" link for non-admins via `adminOnly` nav item flag
- Tabs per document type (WIR, MIR, CIR, FAT)
- Fixed file input alignment (moved "Accepted format: DOCX" below row)
- Download uses authenticated blob request (fixed "Not authenticated" error)

### ✅ Asset Custom Fields System
- `custom_fields` JSONB column on `assets` table (migration `e2f3a4b5c6d7`)
- Field definitions in `app_settings` key `asset_custom_fields` (JSON array of `{id, label}`)
- Admin Settings → General → "Asset Custom Fields" card (add/rename/remove fields)
- Assets page renders dynamic fields in form + table columns
- Default field: "POD" (migrated from old `location` column)
- Removed hardcoded `status` field from assets (redundant with tag system)

### ✅ Asset Types Master Page
- New page at `/master-data/asset-types` with full CRUD
- Fields: Name, Code, Service (dropdown), Parent Type (optional), Sort Order
- Added `sort_order` column to `asset_types` (migration `f3a4b5c6d7e8`)
- Added to sidebar with Boxes icon

### ✅ Inline Table Editing (All Tables)
- Per-cell editing (click to edit individual cell, not whole row)
- Text, number, and select (dropdown) input types
- ✓/✗ buttons inline with the editing cell
- Enter saves, Escape cancels
- Applied to: disciplines, services, systems, clients, contractors, designations, approvers, projects, assets, asset-types

### ✅ Column Visibility Persistence
- Saved per-user per-page in `user_preferences` table (key: `col_vis{path}`)
- Restored on page load alongside column order
- Actions column always stays last (enforced in drag handlers)

### ✅ Column Width Control
- `meta: { width: "170px" }` on column definitions
- Applied as `width` + `minWidth` on `<th>` elements

### ✅ Asset Tag Reformatting
- All 37 assets updated to format `MERC:POD:ITEM_CODE:SERIAL`
- POD values (P1/P2/P3) also stored in `custom_fields.field_1`

### ✅ Aconex Date Tracking
- `aconex_submitted_date` + `aconex_received_date` on `document_approval_rounds` (migration `a4b5c6d7e8f9`)
- Submit to Approver dialog: "Aconex upload date" DatePicker
- Record Response dialog: "Aconex received date" DatePicker
- Approval Rounds list displays both dates in expanded card

### ✅ Notify Signatories Button Rework
- WIR/CIR: Renamed to "Notify Signatories", only notifies (no save), disabled when both signed or no other signatory
- MIR: "Notify Signatory" (single), disabled when current user IS the signatory or already signed

### ✅ UI Label Updates
- "Inspected By" → "Signatories" (card title, WIR/CIR) / "Signatory" (MIR)
- "Inspected by 1/2" → "Signatory 1/2" (WIR/CIR) / "Name" (MIR)
- "Inspector remarks..." → "Remarks..." (placeholder)
- All em-dashes (—) replaced with hyphens (-) across entire UI

### ✅ MIR Single Signatory
- Removed inspector 2 dropdown, signature box, date/time, remarks
- Backend: MIR transitions to `internally_signed` after single signature
- Download Document enabled after single signature
- Approval workflow works with 2 approvers (configured in admin)

### ✅ FAT Form Rewrite
- Reference number: simple editable input (optional, no auto-generation)
- Description: optional textarea
- Discipline: required dropdown
- Commissioning Linkage: same as WIR (toggle, template, full/partial scope, work items)
- Assets: same as WIR (collapsible, searchable, filterable by discipline + asset type)
- No signatories, no signing, no approval workflow
- Always editable, status auto-set to "approved" on create
- Two buttons only: Cancel + Save
- Status transition validation skipped for FAT

### ✅ Form Locking After Submission
- All forms (WIR/MIR/CIR/FAT) fully locked after submission to approver
- Preview PDF + Download Document remain enabled (outside fieldset)
- Save/Notify/Cancel hidden when locked
- Assets section auto-expands when locked

### ✅ Code Audit Fixes (P0-P3)
- Created `backend/app/core/types.py`: TAG_LEVEL_MAP, PermissionCode enum, DocStatus, ReqStatus, signature/attachment/pagination constants
- All backend files import from `core/types.py` instead of inline definitions
- Frontend `lib/constants.ts` expanded: DOC_STATUS, statusColors, reqStatusColors, STORAGE_KEYS, PAGE_SIZE_OPTIONS
- STORAGE_KEYS used in api.ts, use-auth.ts, use-project.ts, auth-guard.tsx
- Signature rendering: named constants for padding/offset magic numbers
- OCR_ZOOM, MAX_APPROVERS, DEFAULT_SERIAL_START, GOTENBERG_TIMEOUT centralized

### ✅ Bug Fixes
- Attachment reorder: reload attachments after save so `isExisting` is set correctly
- Commissioning linkage: `useRef` for dirty flag (avoids stale closure), loads on refresh
- `saveCommissioningLinkage` only runs when linkage actually changed (performance fix)
- Document delete: removes `document_requirement_links` before hard-delete
- PDF merge: handles image attachments (converts to PDF via Pillow)
- Signature size normalization across fonts
- `/me` endpoint returns roles + permissions (fixes admin guard)
- Template auto-select handles deleted templates
- `_format_date` handles string dates
- Template syntax errors: caught on upload + shown to user on generate
- `recalculate_requirement_status`: fixed `requirement_id` → `asset_requirement_id` typo
- Approval round response schema: `aconex_*_date` fields use `date` type not `str`
- Round attachments accept images (PNG/JPG) in addition to PDF
- Generate report: filters attachments by `kind == "user"`
- Profile page invalidates `["users"]` query on signature save

### ✅ PDF Template Improvements
- Discipline checkboxes: ☒/☐ + word (e.g. "☒ Electrical")
- Matching by discipline code (AR, CS, MC, EL, PL, FF, OT) AND name
- MIR `{{ inspected_by }}` outputs "Name - Designation" format
- `{{ date_1 }}` formatted using configured date format
- Template validation on upload (Jinja2 syntax check)
- Better error messages on PDF generation failure (shows actual detail)

### ✅ Dropdown Overflow Fix
- Asset edit modal: `max-h-[85vh] overflow-y-auto` on DialogContent
- Asset Type dropdown: `max-h-[320px]` on SelectContent
- Asset Type field moved to first position in form

### ✅ Asset Type Dropdown Filtered by Discipline
- All forms (WIR, MIR, CIR, FAT) filter asset type dropdown options by selected discipline
- Uses AssetType → Service → Discipline chain

### Migration Required for This Session

Run on first pull:
```bash
cd backend && uv run alembic upgrade head
```
Adds: `assets.custom_fields` (JSONB), `asset_types.sort_order`, `document_approval_rounds.aconex_submitted_date`, `document_approval_rounds.aconex_received_date`, seeds `asset_custom_fields` app setting.

## Next Priorities

1. **End-to-end test of approval workflow** — WIR: submit → Approver 1 response → resubmit → Approver 2 → approved. Verify commissioning requirement achievement.
2. **MIR end-to-end** — create → sign → submit to approver → record response → approved.
3. **CIR end-to-end** — same flow as WIR with both signatories.
4. **FAT end-to-end** — create → save → verify requirement achievement via commissioning linkage.
5. **Tesseract install instructions** — add to README and Docker setup.
6. **Document list pages - server-side pagination** for WIR/MIR/CIR/FAT.
7. **Report templates** — Upload CIR/FAT DOCX templates, test PDF generation for each type.
8. **Commissioning dashboard enhancements** — Breakdown by discipline, delayed items, at-risk targets.
9. **CSV import for assets** — Bulk import assets from CSV with validation.
10. **Aconex date reports** — Generate reports showing submission/response timelines per document.
11. **Audit log expansion** — Add audit logging to commissioning operations.

## Previously Completed (Earlier Sessions)

### External Approval Workflow
- ✅ Schema migrations, services, all 6 approval endpoints + Admin Settings ProjectApproversCard
- ✅ Document form ApprovalActionPanel + SubmitToApproverDialog + RecordResponseDialog + ApprovalRoundsList
- ✅ MIR/CIR feature parity with WIR

### RBAC + Roles
- ✅ 13 permissions across 5 categories, permission matrix UI, `require_permission` enforced
- ✅ Viewer role, signing logic, template upload restricted, signature preview public
- ✅ Work items restored on form reload

### Commissioning Engine + Forms (foundation)
- ✅ Full commissioning engine, domain spec + architecture decisions docs
- ✅ Fresh schema with clean migrations, realistic seed data
- ✅ All tracking/requirements/tag-targets pages
- ✅ WIR/CIR/MIR/FAT full forms with commissioning linkage + work breakdown
- ✅ Reference number auto-generation, document revision system
- ✅ Gate check API + gate override, notifications, dashboard
- ✅ Document approval → work items → requirement recalculated → tag achieved
- ✅ Work item rollback on rejection, designation master, column order persistence
- ✅ Audit log system, document PDF generation, server-side pagination
- ✅ Profile page, signature contrast fix, PDF attachments as pages
- ✅ Notifications project-scoped, public users endpoint, `require_project_access()`

### Previous Session Highlights
- ✅ Inspector remarks + date/time fields, styled TimePicker, vector signatures in PDF
- ✅ Download Document button, project approvers fixes, admin access control
- ✅ App settings (configurable date format), attachment system improvements
- ✅ Approval workflow improvements (replace, OCR, round attachments, bundle)
- ✅ PDF region picker fix, form locking, requirements table improvements
- ✅ Supersede reverts requirement achievement, admin settings tabbed UI
- ✅ Full form locking on terminal documents (all forms)

## Login Credentials

```
dev@jlwme.com / Dev12345 (super_admin)
admin@jlwme.com / Admin123 (admin)
site@jlwme.com / Site1234 (site_engineer)
qaqc@jlwme.com / Qaqc1234 (qaqc_engineer)
jerry@jlwme.com / Jerry123 (qaqc_manager)
```
