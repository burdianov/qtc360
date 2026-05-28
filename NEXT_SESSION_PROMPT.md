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
```

### Key Rules

1. Documents are generic QA/QC records. Only those linked via `document_requirement_links` affect commissioning.
2. `AssetRequirement.status` is NEVER user-editable — calculated by backend from document approvals + work item completion.
3. Tags (red/yellow/green/blue) are calculated, never manually assigned.
4. Work breakdown items are created dynamically during WIR/CIR preparation.
5. Soft gate requirements = warnings only, no hard DB constraints. Override acknowledgements stored in audit trail.
6. `requirement_category` ≠ `evidence_document_type` — both fields serve different purposes.
7. Document status transitions are enforced via state machine (draft→submitted→approved/rejected).
8. Serial numbers are scoped per (project + document_type + discipline) combination.
9. Work items are rolled back when a document is rejected.
10. RBAC permissions are enforced on write endpoints (`require_permission`).

### Backend Structure

```
backend/app/
├── api/v1/          # Routers: auth, master, admin, documents, commissioning, reports, notifications, ref_config
├── models/          # ORM: commissioning.py, document.py, gate_override.py, designation.py, audit_log.py, + core entities
├── schemas/         # Pydantic: commissioning.py (with Literal types), document.py (with state machine), master.py, auth.py, admin.py
├── services/        # commissioning.py (status calculation engine), signature.py, audit.py
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
│   ├── admin/           # users, roles, permissions, settings
│   └── dashboard/
├── components/
│   ├── commissioning-linkage.tsx  # Reusable panel for WIR/CIR/MIR/FAT requirement linking + work breakdown + gate override dialog
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

# External approval workflow (Phase 2)
GET         /api/v1/documents/{id}/approval-rounds
POST        /api/v1/documents/{id}/submit-to-approver
POST        /api/v1/documents/{id}/approval-rounds  (multipart: returned PDF + decision + signatory)
POST        /api/v1/documents/{id}/approval-rounds/{round_id}/extract  (region OCR)
POST        /api/v1/documents/{id}/approval-rounds/{round_id}/remarks  (optional Approver-2 remarks PDF)
POST        /api/v1/documents/{id}/extract-preview  (stateless region OCR pre-save)
POST        /api/v1/documents/{id}/start-new-revision

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
GET         /api/v1/admin/audit-logs  (filterable by action, entity_type)
GET         /api/v1/reports/pdf-engine/health
POST        /api/v1/reports/generate/{doc_type}  → PDF generation
GET         /api/v1/auth/users  (basic user info for all authenticated users)
PATCH       /api/v1/documents/{id}/attachments/reorder
GET/POST/PATCH/DELETE /api/v1/project-approvers  (now scoped per doc_type + order)
```

### Security Model

- `require_admin` gate on `/admin` router — requires admin or super_admin role (or is_superuser)
- `require_permission("commissioning.manage")` — template/requirement CRUD
- `require_permission("documents.submit")` — document creation, work items
- `require_project_access()` — validates user has access to the requested project_id (documents, commissioning endpoints)
- Role assignment: admin can assign all roles except super_admin; super_admin/is_superuser can assign all
- Approval order enforced (can't skip queue)
- Sign endpoint validates user has appropriate role (site_engineer/qaqc_engineer)
- Document status state machine prevents invalid transitions
- `is_superuser` flag hidden from UI — only for dev account, bypasses all checks

### WIR Form Flow

1. General info (ref number auto-generated per project+discipline+doc_type, date, discipline, subject, description, location fields)
2. Commissioning Linkage (toggle on/off):
   - Select requirement template (filtered by evidence_document_type=WIR AND discipline)
   - Full scope OR partial scope
   - Partial: shows existing work items (approved=disabled, pending=checkable/deletable), add new items
   - Only checked items get linked to this document
   - Gate override: confirmation dialog with notes field, stored in audit trail
3. Assets (disabled until linkage is on):
   - Filtered by discipline (via AssetType → Service → Discipline chain)
   - Filtered by selected requirement template (only assets with that requirement assigned)
   - Filterable by asset type dropdown
   - Searchable by name/tag number
   - Multi-select checkboxes with scrollable list
   - Selected shown as removable badges
   - Disabling linkage with assets selected shows styled confirmation dialog
4. Inspectors & signatures (DocuSign-style)
5. Attachments (drag-and-drop reorder)
6. Both "Save as Draft" and "Save & Notify" process commissioning linkage

## Completed This Session — External Approval Workflow

This session implemented the full Aconex-mirrored external approval workflow described in the spec's "External Approval Workflow" section. Backend, schema, services, API, and frontend.

- ✅ **Spec updated** with External Approver Chains, click-flow state machine, returned-PDF splitting rules, region-OCR approach, and a concrete implementation task list.
- ✅ **Phase 1 — Schema**
  - Migration `e1f2a3b4c5d6_external_approval_workflow.py`: `project_approvers` extended with `document_type` + `approver_order` (unique on project+doc_type+order); `doc_templates.cover_page_count` added; legacy `document_approvals` dropped, replaced by `document_approval_rounds`; `document_attachments` gained `document_approval_round_id` + `kind`; document `status` enum updated (`submitted` → `internally_signed`/`with_approver_1`/`approver_1_returned`/`with_approver_2`).
  - Migration `f1a2b3c4d5e6_document_template_lock.py`: `documents.template_id` + `documents.cover_page_count` snapshot — locked at first approver submission so admin uploading a newer template version mid-flight can't shift the split boundary.
- ✅ **Phase 2 — Services + API**
  - `app/services/pdf.py`: `count_pages_in_docx` (LibreOffice-based, populated on template upload), `split_returned_pdf`, `extract_region_text` (PyMuPDF native-text-first, Tesseract fallback with PSM hints, image-overlap detection for flattened PDFs, force-OCR override), `normalize_date_text` via dateparser.
  - `app/services/approval.py`: state machine (`submit_to_approver`, `record_response`, `attach_remarks`, `_lock_template`).
  - 6 endpoints: list rounds, submit-to-approver, record response (multipart), region OCR (persisted), region OCR (stateless pre-save), upload remarks, start new revision.
  - Deps: `pymupdf`, `pytesseract`, `dateparser`. Tesseract binary required on host for OCR fallback.
  - Seed populates default chains for project 1728: WIR/MIR → AESG → Core Emirates; CIR → RED Engineering → Sudlows.
- ✅ **Phase 3 — Admin UI**
  - New `ProjectApproversCard` on Admin → Settings. Doc-type segmented selector (WIR/MIR/CIR/FAT), ordered chain list, add-approver dialog with auto-next-order, trash button re-sequences remaining slots so there's never a gap.
- ✅ **Phase 4 — Document form action panel + region-OCR dialog**
  - `ApprovalActionPanel` wired into all four QA/QC forms (WIR/MIR/CIR/FAT). Renders one primary action per state per the spec table.
  - `SubmitToApproverDialog` (one-click confirmation, captures submission date).
  - `RecordResponseDialog`: split layout — PDF preview (`react-pdf` + PDF.js) + form. Per-field "Capture" arms region selection; user drags box; backend extracts via `/extract-preview`; pre-fills field. Per-field "OCR" button re-extracts via Tesseract for flattened PDFs. All fields editable.
  - `AddRemarksDialog`: optional Approver-2 remarks PDF, only when Approver 1 returned status B.
  - `ApprovalRoundsList`: collapsible per-round sections with party, signatory, decision badge, dates, comments, file links.
  - Start-New-Revision action handles status C and resubmission post-approval.
  - Stale legacy `<ApprovalChain>` deleted.
- ✅ **MIR/CIR feature parity with WIR**
  - Both forms now have: template selector, attachments with drag-reorder, Preview PDF, Save & Notify Signatories, isDirty tracking + handleBack unsaved-changes prompt, linkage-first flow with applicable template/asset filtering, asset filter+search+checkbox panel, restore linkage and attachments on edit, confirm-disable-linkage dialog. Match WIR feature set.

## Next Priorities

1. **End-to-end test of approval workflow** — drive through WIR submit → AESG response (try OCR region capture on a real Aconex transmittal) → resubmit → Core Emirates → approved. None of this has been tested in a browser yet.
2. **Tesseract install instructions** — add to README and Docker setup. Currently the OCR fallback silently disables itself if the binary isn't present.
3. **Round file download endpoint** — the rounds list links to `/approval-rounds/{round_id}/file` but no such endpoint exists yet. Stub it or rewire to attachment download URLs.
4. **Document list pages** — Use server-side pagination for WIR/MIR/CIR/FAT list pages
5. **Report templates** — Upload MIR/CIR/FAT DOCX templates, test PDF generation for each type
6. **Commissioning dashboard enhancements** — Breakdown by discipline, delayed items, at-risk targets
7. **CSV import for assets** — Bulk import assets from CSV with validation
8. **Bulk operations on commissioning tracking** — Bulk assign/remove requirements, bulk update target dates
9. **Audit log expansion** — Add audit logging to commissioning operations (requirement changes, tag target updates)

## Previously Completed (Earlier Sessions)

- ✅ Full commissioning engine refactor (backend + frontend)
- ✅ Domain spec + architecture decisions docs
- ✅ Fresh schema with clean migrations
- ✅ Realistic data center MEP seed data (36 assets, 26 requirement templates, 455 assignments)
- ✅ Requirement Templates CRUD page
- ✅ Commissioning Tracking page (progress + tag badges)
- ✅ Asset Requirements page (per-asset view)
- ✅ Tag Targets page (target date management + bulk assign)
- ✅ WIR/CIR/MIR/FAT full forms with commissioning linkage + work breakdown
- ✅ Reference number auto-generation (serial per project+discipline+doc_type)
- ✅ Approval workflow UI (assign approvers, record responses, sequential chain)
- ✅ Document revision system (resubmit rejected docs)
- ✅ Gate check API + gate override confirmation dialog with notes
- ✅ Notifications page (read/unread, mark-all-read)
- ✅ Dashboard with commissioning progress charts
- ✅ Document approval → work items approved → requirement recalculated → tag achieved
- ✅ Work item rollback on document rejection
- ✅ All Select dropdowns show labels not IDs
- ✅ LF line endings enforced
- ✅ **Designation master table** — replaces free-text position field with lookup dropdown
- ✅ **Comprehensive bug fixes** (see below)
- ✅ **Column order persistence** — draggable table headers + dropdown, saved to DB per user
- ✅ **RBAC enforcement** — admin can assign roles (except super_admin), super_admin can assign all, regular users blocked
- ✅ **WIR form overhaul** — linkage-first flow, discipline-filtered requirements/assets, searchable multi-select, confirmation dialogs
- ✅ **Asset type filter on commissioning tracking** — cascading Discipline → Service → Asset Type dropdowns
- ✅ **Audit log system** — `audit_logs` table, `record_audit` service, `GET /admin/audit-logs` endpoint, frontend page with filters
- ✅ **Document PDF generation** — verified end-to-end (docxtpl → LibreOffice → PDF, 134KB output)
- ✅ **Server-side pagination** — `paginated=true` param on CRUD/documents endpoints, DataTable `serverPagination` prop
- ✅ **FAT form full flow tested** — create → link requirement → sign → approve → requirement achieved (100%)
- ✅ **Profile page designation display** — read-only, loaded via `/auth/me`, "Not assigned" fallback
- ✅ **Signature contrast fix** — theme-aware colors (near-white dark mode, near-black light mode)
- ✅ **Signature fit-to-cell in PDF** — post-processes DOCX with python-docx, reads cell dimensions, fits proportionally
- ✅ **WIR form sign via API** — click-to-sign calls `POST /documents/{id}/sign`, persists to DB (fixes PDF missing signature)
- ✅ **PDF attachments working** — installed `reportlab`, images now rendered as PDF pages and appended
- ✅ **Attachment reorder persisted** — `PATCH /documents/{id}/attachments/reorder` endpoint, existing attachments loaded on edit
- ✅ **Attachment delete from server** — removing existing attachment calls DELETE endpoint immediately
- ✅ **Notifications project-scoped** — `project_id` on notifications table, filtered by selected project in UI + navbar badge
- ✅ **Public users endpoint** — `GET /auth/users` accessible to all authenticated users (fixes inspector names for non-admins)
- ✅ **Project access enforcement** — `require_project_access()` dependency on documents/commissioning endpoints, returns 403 for unauthorized projects
- ✅ **Commissioning linkage restored on reload** — fetches document-links, restores template + scope + work items
- ✅ **Selected assets restored on reload** — `asset_ids` added to DocumentResponse, loaded from server on edit
- ✅ **Discipline labels in PDF** — checkbox variables now include discipline name text (e.g. `[X] Electrical`)

### Bug Fixes Applied This Session

**Critical:**
- C1: Work items rolled back on document rejection (prevents stuck "achieved" status)
- C2+C3: Race condition in ref number generation fixed (FOR UPDATE lock + unique constraint)
- C4: Document status state machine with valid transitions enforced
- FAT form field names fixed (inspector_1_id → site_engineer_id)
- FAT added to doc type selectors in Settings and Templates pages
- "Save & Notify" now processes commissioning linkage (was skipping it)

**Security:**
- H1+H2: `require_permission` wired to commissioning and document write endpoints
- H3: Approval order validation (can't skip queue, can't respond twice)
- H4: Sign endpoint validates user has appropriate RBAC role
- H5+H6: Literal type constraints on all enum fields (level_code, doc_type, categories, tags)

**Data Integrity:**
- H7: Document delete triggers requirement recalculation
- H8: bulk-by-type POST uses Pydantic body (not Query params)
- H9: N+1 query eliminated in recalculate_requirements_for_document
- M1: Server-side ref number generation on document create
- M2: Signed fields removed from DocumentUpdate (only via /sign endpoint)
- M5: Discipline fallback raises 400 instead of silently counting all
- M6: Unique approver_order per document validated
- M7+M8: Gate override immutability enforced + type annotation fixed

**New Endpoints:**
- GET /commissioning/progress — server-side calculated AssetCommissioningProgress
- GET/POST/PATCH/DELETE /designations — designation master CRUD

**Frontend:**
- Gate override level_code uses template's actual level (not hardcoded L2B)
- Commissioning tracking page filters by project_id
- Unused state variables removed
- updated_at added to DocumentResponse

## Login Credentials

```
dev@jlwme.com / Dev12345 (super_admin)
admin@jlwme.com / Admin123 (admin)
site@jlwme.com / Site1234 (site_engineer)
qaqc@jlwme.com / Qaqc1234 (qaqc_engineer)
```
