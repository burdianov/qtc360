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
8. Serial numbers are scoped per (project + document_type + discipline) combination. Decremented on hard-delete of unsubmitted docs so the number can be reused; preserved on supersede.
9. Work items are rolled back when a document is rejected.
10. RBAC permissions are enforced on write endpoints (`require_permission`).
11. **Project isolation**: documents, approvals, assets, requirements, tag targets, work items are strictly per-project. Only common masters (disciplines, services, contractors, users, approver companies, designations) are shared across projects. Frontend queries MUST pass `project_id` to project-scoped endpoints.
12. **Returned approval PDFs are NOT split**. Saved as a single file. Additional attachments are uploaded separately with `insert_after_page` to control their position in the merged bundle.

### Backend Structure

```
backend/app/
├── api/v1/          # Routers: auth, master, admin, documents, commissioning, reports, notifications, ref_config
├── models/          # ORM: commissioning.py, document.py, gate_override.py, designation.py, audit_log.py, + core entities
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
│   ├── admin/           # users, roles, permissions, settings
│   └── dashboard/
├── components/
│   ├── commissioning-linkage.tsx     # Reusable panel for WIR/CIR/MIR/FAT requirement linking + work breakdown + gate override dialog
│   ├── document-attachments.tsx      # Reusable attachment manager with drag-reorder, page-position editing, bundle download
│   ├── approval/                     # action panel, submit dialog, record-response dialog, rounds list, region picker
│   ├── data-table/                   # Reusable DataTable system (RowAction now supports per-row dynamic label/confirm)
│   ├── layout/                       # Sidebar, navbar, project switcher
│   └── ui/                           # shadcn components + progress, switch
├── hooks/             # use-auth, use-project
├── config/            # navigation.ts
└── lib/               # api.ts, utils.ts, csv.ts, format-date.ts
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
POST        /api/v1/documents/{id}/approval-rounds/{round_id}/extract  (region OCR)
POST        /api/v1/documents/{id}/approval-rounds/{round_id}/remarks  (optional Approver-2 remarks PDF)
POST        /api/v1/documents/{id}/approval-rounds/{round_id}/attachments?insert_after_page=N
GET         /api/v1/documents/{id}/approval-rounds/{round_id}/bundle  (merged PDF download)
POST        /api/v1/documents/{id}/extract-preview  (stateless region OCR pre-save)
POST        /api/v1/documents/{id}/start-new-revision

# Document attachments (with page-position support)
GET         /api/v1/documents/{id}/attachments
POST        /api/v1/documents/{id}/attachments?insert_after_page=N (optional)
DELETE      /api/v1/documents/{id}/attachments/{att_id}
PATCH       /api/v1/documents/{id}/attachments/reorder
GET         /api/v1/documents/{id}/bundle      (generated PDF + attachments merged at page positions)

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
GET/POST/PATCH/DELETE /api/v1/project-approvers  (scoped per doc_type + order)
```

### Security Model

- `require_admin` gate on `/admin` router — requires admin or super_admin role (or is_superuser)
- `require_permission("commissioning.manage")` — template/requirement CRUD
- `require_permission("documents.submit")` — document creation, work items
- `require_permission("documents.delete")` — document deletion (further gated to creator or admin/super_admin in the endpoint itself)
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
5. Attachments — uses reusable `DocumentAttachments` component (drag-reorder, edit page-position, Download Bundle button)
6. Both "Save as Draft" and "Save & Notify" process commissioning linkage

## Completed This Session — Attachment System Overhaul + Project Isolation + Supersede/Delete

### ✅ PDF Attachment System — No-split + Insert-at-Position + Merged Bundles

The Aconex returned-PDF splitting is gone. PDFs stay intact. Attachments declare where they should be inserted, and the bundle download produces the merged result.

- **Schema**: migration `7031919285ed_add_insert_after_page_to_attachments.py` adds nullable `insert_after_page` (integer, 0-indexed) to `document_attachments`.
- **Service**: `app/services/pdf_merge.py` with `merge_pdf_bundle(main_pdf_bytes, attachments)`. Sorts attachments by `insert_after_page`, walks the main PDF page-by-page, inserts each attachment's pages after its target page, appends remaining attachments at the end.
- **Approval workflow** (`record_response_endpoint`): saves the returned PDF as a single `kind="returned_pdf"` attachment instead of splitting into cover + per-page pieces. The legacy `split_returned_pdf()` is no longer called (still in `pdf.py` for reference).
- **Round attachments endpoint**: `POST /documents/{id}/approval-rounds/{round_id}/attachments?insert_after_page=N` (multipart PDF). Stored as `kind="user_attachment"`.
- **Round bundle endpoint**: `GET /documents/{id}/approval-rounds/{round_id}/bundle` — merges returned PDF with all `user_attachment` rows for that round.
- **Document attachment upload**: `POST /documents/{id}/attachments` now accepts optional `insert_after_page` query param.
- **Document bundle endpoint**: `GET /documents/{id}/bundle` — generates the document PDF (via existing reports flow) then merges any `kind="user"` attachments that have `insert_after_page` set. PDFs without a position are not included in the bundle (they remain as standalone attachments).
- **Frontend**:
  - `RecordResponseDialog` footer message updated (no longer mentions splitting).
  - `ApprovalRoundsList` rounds now have **Download Bundle** + **Add Attachment** buttons; new `UploadAttachmentDialog` collects file + page position.
  - New reusable `DocumentAttachments` component handles add/remove/drag-reorder/edit-page-position/download-bundle for any document form.
  - Integrated into WIR, MIR, CIR forms (FAT does not yet have an attachments section). Removed the inline attachment UI and `addAttachment`/`removeAttachment` helpers from those three forms.
- **Attachment kinds**:
  - `returned_pdf` — full approver return, single file
  - `user_attachment` — uploaded to an approval round with a page position
  - `user` — regular document attachment (page position optional)
  - `cover` / `response_attachment` — DEPRECATED (legacy split rows; left in place for old data)

### ✅ Project Isolation — Strict Per-project Data Scoping

Audit + fix sweep. Frontend was fetching across all projects on several pages, which is wrong. Backend CRUD endpoints already supported `project_id` filtering — the frontend just wasn't passing it.

Pattern applied (`useQuery` with `project?.id` in the queryKey, `params: { project_id }` on the request, `enabled: !!project?.id`) to:
- `dashboard/page.tsx` — `LevelProgress` and `TagSummary` were globally fetching `/commissioning/asset-requirements`
- `commissioning/tag-targets/page.tsx` — assets and tag-targets queries
- `commissioning/tracking/page.tsx` — assets query
- `commissioning/requirements/page.tsx` — assets query
- `master-data/assets/page.tsx` — assets query
- `qaqc/wir/new/page.tsx`, `mir/new/page.tsx`, `cir/new/page.tsx`, `fat/new/page.tsx` — assets queries

`PROJECT_ISOLATION_AUDIT.md` documents the issue, the pattern, and the common-master vs project-specific split.

### ✅ Document Supersede vs Hard-delete

`DELETE /documents/{id}` rewritten with branching logic:
- **Authorization**: only the document creator OR a user with `admin`/`super_admin` role (or `is_superuser`) can call it. Returns 403 otherwise.
- **If submitted to any approver** (any `DocumentApprovalRound` exists OR status ∈ {`with_approver_1`, `with_approver_2`, `approver_1_returned`, `approved`, `approved_with_comments`, `rejected`}) → **SUPERSEDE**: status = `superseded`, soft-delete (`is_deleted = True`). Serial number is preserved.
- **If not submitted** → **HARD DELETE**: removes attachment files from disk (paths validated to stay inside `upload_root`), hard-deletes `document_attachments`, `document_assets`, and the `documents` row itself, then **decrements `next_serial`** on the matching `reference_number_configs` row so the same serial can be reused on the next document. Floor-clamped at `serial_start`.
- Audit log entry distinguishes the two paths (`action="supersede"` vs `action="delete"`).

Frontend (WIR list page only — same treatment NOT yet applied to MIR/CIR/FAT lists):
- `DataTableRowActions` extended: `RowAction.label` and `RowAction.confirm` now accept either a string or a `(row) => string` function. Dialog title and primary button label both follow the resolved label.
- WIR list action shows **Supersede** vs **Delete** dynamically per-row, with a confirmation message that explains the serial-number consequence.

### ✅ DB Cleanup — Clean Slate for WIR Testing

Deleted all WIR data + orphaned upload directories so the next WIR test starts from `WIR-0001`.
- 1 WIR document + 6 attachments + 1 approval round + 51 requirement-links + 12 orphaned work items + 3 asset links removed.
- 4 upload directories under `uploads/attachments/` deleted (1 belonging to the WIR, 3 orphaned from prior sessions).
- `reference_number_configs.next_serial` for WIR reset to `1`.

### ✅ Sidebar UX Polish

- Added `ChevronsUpDown` icon to the user profile button at the bottom of the sidebar to indicate the dropdown.
- Dropdown popup width matches the trigger button width via `w-[var(--radix-dropdown-menu-trigger-width)]` + `align="start"`.

### Migration Required for This Session

Run on first pull:
```bash
cd backend && uv run alembic upgrade head
```
Adds `document_attachments.insert_after_page`.

## Next Priorities

1. **Apply supersede/delete logic to MIR/CIR/FAT list pages** — same dynamic action label + confirmation message pattern as WIR. Right now only WIR uses it.
2. **End-to-end test of the new attachment + bundle flow** — create WIR → add attachments with page positions → submit to approver → record response (single returned PDF) → upload extra round attachments at positions → download merged round bundle. Verify page order in the output PDF.
3. **End-to-end test of approval workflow** — drive through WIR submit → AESG response (try OCR region capture on a real Aconex transmittal) → resubmit → Core Emirates → approved. Still untested in browser.
4. **Tesseract install instructions** — add to README and Docker setup. Currently the OCR fallback silently disables itself if the binary isn't present.
5. **Round file download endpoint** — the rounds list links to `/approval-rounds/{round_id}/file` but no such endpoint exists yet. Stub it or rewire to attachment download URLs.
6. **FAT attachments** — FAT form has no attachments section yet; integrate the `DocumentAttachments` component when needed.
7. **Document list pages — server-side pagination** for WIR/MIR/CIR/FAT.
8. **Report templates** — Upload MIR/CIR/FAT DOCX templates, test PDF generation for each type.
9. **Commissioning dashboard enhancements** — Breakdown by discipline, delayed items, at-risk targets.
10. **CSV import for assets** — Bulk import assets from CSV with validation.
11. **Bulk operations on commissioning tracking** — Bulk assign/remove requirements, bulk update target dates.
12. **Audit log expansion** — Add audit logging to commissioning operations (requirement changes, tag target updates).

## Previously Completed (Earlier Sessions)

### External Approval Workflow

- ✅ Schema migrations: `e1f2a3b4c5d6_external_approval_workflow.py` (project_approvers per doc_type, document_approval_rounds, status enum) and `f1a2b3c4d5e6_document_template_lock.py` (document.template_id + cover_page_count snapshot).
- ✅ Services: `app/services/pdf.py` (count_pages_in_docx, extract_region_text with PyMuPDF native-text-first + Tesseract fallback + image-overlap detection + force-OCR), `app/services/approval.py` state machine.
- ✅ All 6 approval endpoints + Admin Settings ProjectApproversCard with doc-type segmented selector.
- ✅ Document form ApprovalActionPanel + SubmitToApproverDialog + RecordResponseDialog (PDF preview + region-OCR) + AddRemarksDialog + ApprovalRoundsList wired into WIR/MIR/CIR/FAT.
- ✅ Seed: WIR/MIR → AESG → Core Emirates; CIR → RED Engineering → Sudlows.
- ✅ MIR/CIR feature parity with WIR (template selector, attachments, Preview PDF, isDirty, linkage-first flow, etc.).

### RBAC + Roles

- ✅ 13 permissions across 5 categories, permission matrix UI on Roles page, `require_permission` enforced.
- ✅ Viewer role (read-only).
- ✅ Signing logic simplified — any non-viewer can sign either inspector slot in any order.
- ✅ Template upload restricted to `reports.templates` permission.
- ✅ Signature preview public (so `<img>` tags work).
- ✅ Work items restored on form reload (all four QA/QC forms).

### Commissioning Engine + Forms (foundation)

- ✅ Full commissioning engine refactor (backend + frontend).
- ✅ Domain spec + architecture decisions docs.
- ✅ Fresh schema with clean migrations.
- ✅ Realistic data center MEP seed data (36 assets, 26 requirement templates, 455 assignments).
- ✅ Requirement Templates / Tracking / Asset Requirements / Tag Targets pages.
- ✅ WIR/CIR/MIR/FAT full forms with commissioning linkage + work breakdown.
- ✅ Reference number auto-generation (serial per project+discipline+doc_type, FOR UPDATE locked).
- ✅ Document revision system (resubmit rejected docs).
- ✅ Gate check API + gate override confirmation dialog with notes.
- ✅ Notifications page + dashboard with commissioning progress charts.
- ✅ Document approval → work items approved → requirement recalculated → tag achieved.
- ✅ Work item rollback on document rejection.
- ✅ Designation master table.
- ✅ Column order persistence (per-user, DB-backed).
- ✅ Asset type filter on commissioning tracking (cascading Discipline → Service → Asset Type).
- ✅ Audit log system (`audit_logs` table + `record_audit` service + `/admin/audit-logs` endpoint + frontend page).
- ✅ Document PDF generation (docxtpl → LibreOffice → PDF).
- ✅ Server-side pagination on CRUD/documents endpoints.
- ✅ FAT form full flow tested.
- ✅ Profile page designation display.
- ✅ Signature contrast fix (theme-aware) + signature fit-to-cell in PDF.
- ✅ PDF attachments rendered as PDF pages (reportlab).
- ✅ Notifications project-scoped.
- ✅ Public users endpoint (`GET /auth/users`).
- ✅ `require_project_access()` dependency on documents/commissioning endpoints.
- ✅ Commissioning linkage + selected assets restored on form reload.

### Bug Fixes (earlier)

- C1: Work items rolled back on document rejection.
- C2+C3: Race condition in ref number generation fixed (FOR UPDATE + unique constraint).
- C4: Document status state machine.
- H1+H2: `require_permission` wired to commissioning + document write endpoints.
- H3: Approval order validation.
- H4: Sign endpoint validates RBAC role.
- H5+H6: Literal type constraints on enum fields.
- H7: Document delete triggers requirement recalculation.
- H8: bulk-by-type POST uses Pydantic body.
- H9: N+1 query eliminated in `recalculate_requirements_for_document`.
- M1: Server-side ref number generation on document create.
- M2: Signed fields removed from DocumentUpdate.
- M5: Discipline fallback raises 400 instead of silently counting all.
- M6: Unique approver_order per document.
- M7+M8: Gate override immutability + type annotation fixed.
- Gate override level_code uses template's actual level (not hardcoded L2B).
- Commissioning tracking page filters by project_id.
- updated_at added to DocumentResponse.

## Login Credentials

```
dev@jlwme.com / Dev12345 (super_admin)
admin@jlwme.com / Admin123 (admin)
site@jlwme.com / Site1234 (site_engineer)
qaqc@jlwme.com / Qaqc1234 (qaqc_engineer)
```
