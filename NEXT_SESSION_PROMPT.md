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

### Backend Structure

```
backend/app/
├── api/v1/          # Routers: auth, master, admin, documents, commissioning, reports, notifications, ref_config
├── models/          # ORM: commissioning.py, document.py, gate_override.py, designation.py, audit_log.py, app_setting.py, + core entities
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
│   ├── master-data/     # projects, disciplines, services, assets, approvers, requirement-templates, designations, etc.
│   ├── qaqc/            # wir (form + list), mir, cir, fat
│   ├── documents/       # templates
│   ├── admin/           # users, roles, permissions, settings (layout-guarded to admin only)
│   └── dashboard/
├── components/
│   ├── commissioning-linkage.tsx     # Reusable panel for WIR/CIR/MIR/FAT requirement linking + work breakdown + gate override dialog
│   ├── document-attachments.tsx      # Reusable attachment manager with drag-reorder, delete confirmation, bundle download
│   ├── approval/                     # action panel, submit dialog, record-response dialog (with OCR capture), rounds list, region picker
│   ├── data-table/                   # Reusable DataTable system (RowAction supports per-row dynamic label/confirm)
│   ├── layout/                       # Sidebar (admin-filtered), navbar, project switcher
│   └── ui/                           # shadcn components + progress, switch, date-picker, time-picker (AM/PM with scrollable columns)
├── hooks/             # use-auth, use-project
├── config/            # navigation.ts
└── lib/               # api.ts (FormData-aware Content-Type), utils.ts, csv.ts, format-date.ts (configurable format)
```

### API Endpoints (key ones)

```
POST/GET    /api/v1/documents
DELETE      /api/v1/documents/{id}             # supersede if submitted, hard-delete + serial reuse if not
POST        /api/v1/documents/{id}/sign

# External approval workflow
GET         /api/v1/documents/{id}/approval-rounds
POST        /api/v1/documents/{id}/submit-to-approver
POST        /api/v1/documents/{id}/approval-rounds  (multipart: returned PDF + decision + signatory; PDF saved as single file)
PUT         /api/v1/documents/{id}/approval-rounds/{round_id}/file  (replace returned PDF + overwrite all metadata)
POST        /api/v1/documents/{id}/approval-rounds/{round_id}/extract  (region OCR)
POST        /api/v1/documents/{id}/approval-rounds/{round_id}/attachments?insert_after_page=N
GET         /api/v1/documents/{id}/approval-rounds/{round_id}/bundle  (merged PDF download)
POST        /api/v1/documents/{id}/extract-preview  (stateless region OCR pre-save)
POST        /api/v1/documents/{id}/start-new-revision

# Document attachments
GET         /api/v1/documents/{id}/attachments
POST        /api/v1/documents/{id}/attachments?insert_after_page=N (optional)
DELETE      /api/v1/documents/{id}/attachments/{att_id}
PATCH       /api/v1/documents/{id}/attachments/reorder
GET         /api/v1/documents/{id}/bundle      (generated PDF + all attachments merged)

GET/POST    /api/v1/commissioning/requirement-templates
GET/POST    /api/v1/commissioning/asset-requirements
POST        /api/v1/commissioning/asset-requirements/bulk
POST        /api/v1/commissioning/asset-requirements/bulk-by-type
GET/POST/DELETE /api/v1/commissioning/work-items
POST/GET    /api/v1/commissioning/document-links
GET/POST/PATCH /api/v1/commissioning/tag-targets
GET         /api/v1/commissioning/progress  (server-side calculated)
GET         /api/v1/commissioning/gate-check
POST/GET    /api/v1/commissioning/gate-overrides

GET/POST/PATCH/DELETE /api/v1/designations
GET/PUT     /api/v1/admin/settings/{key}  (app settings: date_format, etc.)
GET         /api/v1/admin/audit-logs  (filterable by action, entity_type)
GET         /api/v1/reports/pdf-engine/health
POST        /api/v1/reports/generate/{doc_type}  → PDF generation (vector signatures)
GET         /api/v1/auth/users  (basic user info for all authenticated users)
GET/POST/PATCH/DELETE /api/v1/project-approvers  (hard-delete, scoped per doc_type + order)
```

### Security Model

- `require_admin` gate on `/admin` router — requires admin or super_admin role (or is_superuser)
- `require_permission("commissioning.manage")` — template/requirement CRUD
- `require_permission("documents.submit")` — document creation, work items
- `require_permission("documents.delete")` — document deletion (further gated to creator or admin/super_admin in the endpoint itself)
- `require_permission("reports.templates")` — template upload/delete (admin only; frontend hides UI for non-admins)
- `require_project_access()` — validates user has access to the requested project_id
- Role assignment: admin can assign all roles except super_admin; super_admin/is_superuser can assign all
- Approval order enforced (can't skip queue)
- Sign endpoint validates user has appropriate role (site_engineer/qaqc_engineer)
- Document status state machine prevents invalid transitions
- `is_superuser` flag hidden from UI — only for dev account, bypasses all checks
- Admin pages layout-guarded + sidebar hidden for non-admin users

### WIR Form Flow

1. General info (ref number auto-generated per project+discipline+doc_type, date, discipline, subject, description, location fields)
2. Commissioning Linkage (toggle on/off):
   - Select requirement template (filtered by evidence_document_type=WIR AND discipline)
   - Full scope OR partial scope
   - Partial: shows existing work items (approved=disabled, pending=checkable/deletable), add new items
   - Only checked items get linked to this document
   - Gate override: confirmation dialog with notes field, stored in audit trail
3. Assets (collapsible, disabled until linkage is on):
   - Filtered by discipline (via AssetType → Service → Discipline chain)
   - Filtered by selected requirement template (only assets with that requirement assigned)
   - Filterable by asset type dropdown
   - Searchable by name/tag number
   - Multi-select checkboxes with scrollable list
   - Selected shown as removable badges
4. Inspectors & signatures (DocuSign-style):
   - Two columns (inspector 1 & 2) with grid alignment
   - Each: user select → signature box → "Change signature style" link (fixed-height container)
   - Date (DatePicker) + Time (TimePicker) — only editable by the assigned inspector
   - Remarks textarea — only editable by the assigned inspector
5. Attachments — uses reusable `DocumentAttachments` component (drag-reorder, delete confirmation, no page-position for initial submission, no download bundle)
6. Actions: Save as Draft, Save & Notify, Preview PDF (disabled when dirty), Download Document (enabled only when both signed)
7. **Form locking**: after approver 1 returns, General Info + Inspectors + Attachments + Actions are disabled. Only Commissioning Linkage + Assets remain editable.
8. External Approval panel (shown after internal signing):
   - Approval chain preview
   - Rounds list with: file name link + Replace button (opens Record Response dialog) + Download Bundle + Add Attachment
   - Action buttons below rounds (Submit to Approver N, Record Response, Start New Revision)
   - Replace button disabled after terminal status

### Record Response Dialog

- Upload PDF → preview with scrollable region picker
- OCR capture: signatory name, response date, response time, comments (all optional except decision status)
- Decision status radio buttons (A/B/C/D)
- Uses DatePicker for date field
- When replacing (roundId provided): uses PUT endpoint, overwrites all metadata
- When new: uses POST endpoint

## Completed This Session

### ✅ Supersede/Delete on MIR/CIR/FAT Lists
Applied the same dynamic action label + confirmation message pattern from WIR to all three list pages.

### ✅ Inspector Remarks + Date/Time Fields
- Added `remarks_1`, `remarks_2`, `inspector_date_1`, `inspector_time_1`, `inspector_date_2`, `inspector_time_2` to Document model + migration `a8b9c0d1e2f3`
- WIR form renders these per-inspector, only editable by the assigned inspector (fieldset disabled)
- PDF generation reads actual values for template placeholders `{{ remarks_1 }}`, `{{ date_1 }}`, `{{ time_1 }}`, etc.

### ✅ Styled TimePicker Component
- `components/ui/time-picker.tsx` — 12-hour AM/PM format with scrollable hour/minute columns
- Popover-based (same as DatePicker), theme-aware scrollbars, column headers (Hour/Min)
- Typeable inputs + scrollable lists, Tab between fields, Enter to close, Escape to revert
- Stores value as HH:mm (24h) internally

### ✅ Vector Signatures in PDF
- Signatures are now drawn as vector font glyphs directly onto the PDF using reportlab
- `_stamp_vector_signatures()` in reports.py: finds `SIGMARK1`/`SIGMARK2` markers via PyMuPDF, redacts them, overlays vector text with the correct signature font
- `render_signature()` (font_size=72) is now only used for browser preview
- Infinitely crisp at any zoom level

### ✅ Download Document Button
- Added to WIR form, enabled only when both inspectors signed + form saved
- Calls `GET /documents/{id}/bundle` which generates PDF + merges ALL attachments (PDFs appended, images converted to PDF pages)
- Filename = reference number

### ✅ Project Approvers Fixes
- Fixed unique index conflict: recreated as partial index (`WHERE is_deleted = false`)
- CRUD router now supports `hard_delete=True` (used for project-approvers)
- CRUD router supports pre-built loader options (chained selectinload for nested relationships)
- Delete confirmation dialog added
- `response_time` column added to `document_approval_rounds` (migration `c0d1e2f3a4b5`)

### ✅ Admin Access Control
- Created `admin/layout.tsx` — redirects non-admin users to dashboard
- Sidebar hides "Administration" group for non-admin users
- Template upload/delete UI hidden for non-admin users (backend already enforced)

### ✅ App Settings — Configurable Date Format
- `app_settings` table (key-value store) + migration `b9c0d1e2f3a4`
- `GET/PUT /admin/settings/{key}` endpoints
- Default `date_format` = `DD.MM.YYYY`
- Frontend `formatDate()` utility reads configured format; dashboard layout fetches on mount
- Backend PDF generation uses configured format
- Admin Settings page has Date Format card with dropdown

### ✅ Attachment System Improvements
- Delete confirmation dialog on all attachment removals
- `showPagePosition=false` and `showDownloadBundle=false` on WIR/MIR/CIR forms (page position only for approval rounds)
- Drag-and-drop fix: `stopPropagation` + container drop prevention
- Accepted format labels on all file upload points (PDF, DOCX, CSV, PNG/JPG)

### ✅ Approval Workflow Improvements
- Record Response dialog: all fields optional except decision status + file
- Replace Document flow: opens Record Response dialog (with OCR capture) instead of direct file upload
- Replace endpoint (`PUT /approval-rounds/{round_id}/file`): accepts Form fields, always overwrites all metadata
- Removed "Add remarks for Approver 2" button (consolidated into "Add Attachment" on the round)
- Action buttons moved below rounds list
- Replace button disabled after terminal status
- PDF file name link uses authenticated download (no more 404)
- Round bundle download uses authenticated request
- `response_time` field added to capture form and rounds display

### ✅ PDF Region Picker Fix
- Worker loaded from local node_modules (not CDN) — fixes "Failed to load PDF" error
- Overlay positioned relative to PDF page content (not scroll container) — fixes coordinate mismatch
- `originalWidth`/`originalHeight` used for coordinate conversion — fixes wrong region extraction
- Error handling: validation error arrays properly stringified for toast

### ✅ Form Locking After Approver Response
- After approver 1 returns: General Info, Inspectors, Attachments, Actions sections disabled
- Commissioning Linkage + Assets remain editable

### ✅ Misc Fixes
- Nested button hydration error fixed (sidebar footer `DropdownMenuTrigger` uses `render={<div />}` + `nativeButton={false}`)
- Preview PDF disabled when form is dirty or unsaved
- Template selector change marks form as dirty
- `master-data/assets/page.tsx` — added missing `useSelectedProject` import
- `api.ts` — removes `Content-Type` header for FormData requests (fixes multipart uploads)
- Assets section collapsible (collapsed by default, ChevronDown icon)

### Migration Required for This Session

Run on first pull:
```bash
cd backend && uv run alembic upgrade head
```
Adds: `documents.remarks_1/2`, `documents.inspector_date_1/time_1/date_2/time_2`, `app_settings` table, `document_approval_rounds.response_time`.

## Next Priorities

1. **End-to-end test of the new attachment + bundle flow** — create WIR → add attachments → submit to approver → record response → upload extra round attachments → download merged round bundle. Verify page order.
2. **End-to-end test of approval workflow** — drive through WIR submit → Approver 1 response → resubmit → Approver 2 → approved.
3. **Apply form locking + inspector fields to MIR/CIR/FAT forms** — same pattern as WIR.
4. **Tesseract install instructions** — add to README and Docker setup.
5. **FAT attachments** — FAT form has no attachments section yet; integrate the `DocumentAttachments` component.
6. **Document list pages — server-side pagination** for WIR/MIR/CIR/FAT.
7. **Report templates** — Upload MIR/CIR/FAT DOCX templates, test PDF generation for each type.
8. **Commissioning dashboard enhancements** — Breakdown by discipline, delayed items, at-risk targets.
9. **CSV import for assets** — Bulk import assets from CSV with validation.
10. **Bulk operations on commissioning tracking** — Bulk assign/remove requirements, bulk update target dates.
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

## Login Credentials

```
dev@jlwme.com / Dev12345 (super_admin)
admin@jlwme.com / Admin123 (admin)
site@jlwme.com / Site1234 (site_engineer)
qaqc@jlwme.com / Qaqc1234 (qaqc_engineer)
jerry@jlwme.com / Jerry123 (qaqc_manager)
```
