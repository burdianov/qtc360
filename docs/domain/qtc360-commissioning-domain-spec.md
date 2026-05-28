# QTC360 — Complete Project Specification

> **STATUS**: Authoritative Source of Truth  
> **Created**: 2026-05-27  
> **Supersedes**: All previous domain assumptions, PROJECT_SPEC.md, NEXT_SESSION_PROMPT.md

---

## IMPORTANT — SESSION INSTRUCTIONS

This document MUST be loaded and read at the beginning of every new session.  
It is the authoritative business/domain specification for QTC360.  
If implementation conflicts with this specification, update implementation — not the specification.

---

## TECH STACK — MANDATORY

### Frontend

- Next.js 16+
- TypeScript latest stable
- Tailwind CSS latest
- shadcn/ui
- @base-ui/react (Select components)
- React Query / TanStack Query
- Zustand (only if needed)
- Zod
- React Hook Form
- Axios or native fetch abstraction
- Strict typing everywhere

### Backend

- FastAPI (async architecture)
- SQLAlchemy 2.x async
- Alembic
- PostgreSQL
- uv package manager
- Pydantic latest
- Modular clean architecture (routers → services → repositories)
- Strict typing
- Async-first architecture

### Database

- PostgreSQL (Docker for local dev)
- UUID primary keys
- Timestamps + audit fields
- Soft delete where useful
- Proper indexing strategy

### Local Development

- Frontend: local (npm run dev)
- Backend: local (uv run uvicorn app.main:app --reload)
- PostgreSQL: Docker container
- Docker Compose for local stack

### Report Generation

- Word DOCX templates uploaded per project+doc_type
- `docxtpl` fills placeholders with form data
- LibreOffice headless converts DOCX → PDF
- Signatures rendered as PNG images using script fonts (DocuSign-style)
- Templates stored in DB (binary), generated files served on-demand

### Reference Number System

- Pattern: `{project_code}-{contractor_code}-{discipline_code}-{doc_type}-{serial:04d}`
- Example: `MERC-JMJV-EL-WIR-0031`
- Serial counts per project+discipline+doc_type combination
- Configurable via Admin Settings per project

---

## DESIGN SYSTEM — CRITICAL

### Primary Visual Reference

https://zenith-shadcn.dashboardpack.com/dashboard

Screenshots in `D:\QTC360\screenshots` are the PRIMARY VISUAL SOURCE OF TRUTH.

### Design Language

- Matte black
- Charcoal surfaces
- Subtle borders
- Restrained accents
- Monochromatic hierarchy
- Blue is ONLY an accent color

### DO NOT

- Add blue ambient backgrounds
- Add purple gradients
- Create cyberpunk styling
- Oversaturate surfaces
- Create glowing effects
- Create random custom UI
- Use inconsistent spacing
- Use random gray shades
- Use overly rounded components
- Create flashy gradients
- Use glassmorphism
- Create oversized cards
- Use heavy shadows

### The UI must feel like

Linear + Vercel + Zenith + shadcn:
- Enterprise-grade
- Highly polished
- Scalable
- Modern
- Premium
- Cohesive
- Intentionally engineered

### Color System

- Background: #09090B
- Elevated surfaces: #111113
- Secondary surfaces: #151518
- Subtle borders
- Muted typography
- Off-white primary text
- Accent colors ONLY for: active nav, charts, status badges, buttons, progress indicators

### Application Shell

- Dark matte sidebar with grouped navigation
- Compact density
- Subtle separators
- Professional top navbar
- Command/search bar
- Breadcrumbs
- Notifications
- Profile menu
- Responsive behavior
- Dark and light themes

### Icon System

- Lucide icons (closest to Zenith style)
- Preserve: spacing, stroke width, sizing, visual weight, muted appearance
- Centralized icon management

---

## FORM COMPONENT CONVENTIONS (MANDATORY)

### Date Fields

- ALWAYS use the styled `DatePicker` component (`@/components/ui/date-picker`)
- NEVER use native `<Input type="date" />`
- Display format: `dd-MMM-yy` (e.g. 27-May-26) — use `formatDate()` from `@/lib/format-date`
- Storage format: `yyyy-MM-dd` (ISO)

### Select / Dropdown Fields

- Use `@base-ui/react` Select components (`@/components/ui/select`)
- Pass `value` and `onValueChange` directly from react-hook-form's `field.onChange`
- For optional FK fields: `value={field.value || undefined}` so placeholder shows when empty
- Render display label as children of `SelectValue`

### Form Dirty State

- Edit mode: Save/Update button MUST be disabled if form is not dirty
- Use `form.formState.isDirty` from react-hook-form

### Modal Close on Save

- On mutation success, close dialog by setting state directly (`setDialogOpen(false)`)

---

## TABLE SYSTEM

Enterprise-grade reusable DataTable infrastructure:

- Filtering, sorting, search
- Export (CSV)
- Pagination
- Column visibility + reorder (persisted to localStorage)
- Status badges
- Row actions, bulk actions
- Row click navigation
- Future server-side pagination

---

## SIDEBAR STRUCTURE

### OVERVIEW

- Dashboard
- Analytics
- Activity

### MASTER DATA

- Employees
- Projects
- Disciplines
- Services
- Activities
- Sub-Activities
- Tests
- Assets
- Systems
- Contractors
- Client
- Approvers

### QA/QC

- MIR
- WIR
- CIR
- FAT Reports

### COMMISSIONING

- Systems
- Levels
- Handover
- Tracking

### DOCUMENTS

- Documents
- Templates
- Uploads

### ADMINISTRATION

- Users
- Roles
- Permissions
- Settings

---

## AUTHENTICATION / AUTHORIZATION

- JWT auth (access + refresh tokens)
- RBAC: User → Roles → Permissions (many-to-many)
- Project-level access (user_projects)
- Approval authority chains

### Roles

- **super_admin** — Developer / top-level administrator
- **admin** — Project administrator
- **site_engineer** — Submits and tracks field inspections
- **qaqc_engineer** — Reviews, approves, manages quality documents
- **qaqc_manager** — Same rights as qaqc_engineer (to be differentiated later)

---

## SIGNATURE SYSTEM

- Users choose signature font + custom text in Profile page
- 9 fonts: Dancing Script, Great Vibes, Allura, Alex Brush, Parisienne, Mrs Saint Delafield, Herr Von Muellerhoff, Meddon, Sacramento
- Rendered as PNG via Pillow, injected into DOCX via InlineImage

---

## QA/QC APPROVAL WORKFLOW

### Internal Signing

Before submission to external approvers, documents must be signed by:
- 1 Site Engineer
- 1 QA/QC Engineer or QA/QC Manager

No specific order required. Until both sign, document remains in Draft.

### Approval Statuses (per project — configurable)

| Letter | Name                   | Description                      | Action   |
| ------ | ---------------------- | -------------------------------- | -------- |
| A      | Approved               | Work may proceed                 | approved |
| B      | Approved with Comments | Incorporate comments and proceed | approved |
| C      | Revise and Resubmit    | Work may not proceed             | rejected |
| D      | Review not Required    | Work may proceed                 | approved |

### External Approver Chains (per project, per doc_type)

Approver chains are configured **per project AND per document type**. WIR/MIR and CIR have separate chains.

Default chain mapping (seeded; admins can override per project):

| Document Type | Order 1            | Order 2            |
| ------------- | ------------------ | ------------------ |
| WIR           | AESG               | Core Emirates      |
| MIR           | AESG               | Core Emirates      |
| CIR           | RED Engineering    | Sudlows            |
| FAT           | (project-specific) | (project-specific) |

The approver entity represents a **company / approval party**. The individual signatory who signs on behalf of that party is captured **per round** (people change; the company does not).

Configuration UI: Admin → Settings → Project Approvers, with doc_type filter/tab. Each row: `{project, document_type, order, approver_party}`.

### Approval Chain Logic

Aconex is the external transmittal system. QTC360 is **not** integrated with Aconex; every Aconex action is mirrored by a click in QTC360 to keep records in sync.

Per-revision lifecycle:

1. Document filled and signed by Site Engineer + QA/QC Engineer → status `internally_signed`.
2. User downloads the generated PDF, uploads to Aconex, transmits to Approver 1.
3. User clicks **Submit to Approver 1** in QTC360 → status `with_approver_1`, submission date stamped.
4. Approver 1 returns the document via Aconex. User downloads it and clicks **Record Approver 1 Response** → uploads the returned PDF, captures status (A/B/C/D), signatory, response date, comments → status `approver_1_returned`.
5. Branch on Approver 1's status:
   - **A or D** → "Submit to Approver 2" is enabled.
   - **B** → optional "Our Remarks for Approver 2" file slot becomes available; after attaching (if needed), "Submit to Approver 2" is enabled. Remarks are drafted in a different application; QTC360 only stores the resulting PDF.
   - **C** → cycle closed for this revision. "Start New Revision" is the only forward action.
6. User uploads the merged bundle (cover + attachments + optional remarks) to Aconex for Approver 2, then clicks **Submit to Approver 2** → status `with_approver_2`.
7. Approver 2 returns. User clicks **Record Approver 2 Response** → same capture flow as step 4.
8. Final status:
   - **A or D** → document status `approved` (milestone achieved).
   - **B** → document status `approved_with_comments` (milestone achieved).
   - **C** → document status `rejected`; "Start New Revision" is the only forward action.

### Document Status Values (per revision)

| Status                   | Meaning                                               | Set by                                     |
| ------------------------ | ----------------------------------------------------- | ------------------------------------------ |
| `draft`                  | Being filled; one or both internal signatures missing | system                                     |
| `internally_signed`      | Both internal signatures present                      | system (auto on second internal signature) |
| `with_approver_1`        | Submitted to Approver 1 via Aconex                    | "Submit to Approver 1" action              |
| `approver_1_returned`    | Approver 1 responded; awaiting next action            | "Record Approver 1 Response" action        |
| `with_approver_2`        | Submitted to Approver 2 via Aconex                    | "Submit to Approver 2" action              |
| `approved`               | Final approver returned A or D                        | "Record final response" with status A/D    |
| `approved_with_comments` | Final approver returned B                             | "Record final response" with status B      |
| `rejected`               | Any approver returned C                               | "Record response" with status C            |
| `superseded`             | A newer revision exists for this `reference_no`       | system (auto on new revision creation)     |
| `cancelled`              | Manually voided                                       | admin action                               |

The four-letter approver decision (A/B/C/D) lives on the **DocumentApprovalRound** record. The document's `status` reflects where the document is in the chain right now.

### Action Panel

The document form's right-rail shows a **single primary action** based on current state. No menus, no hunting:

| Document state                       | Primary action                                  |
| ------------------------------------ | ----------------------------------------------- |
| `draft`, internal signatures missing | (none — fill form, sign internally)             |
| `internally_signed`                  | Submit to Approver 1                            |
| `with_approver_1`                    | Record Approver 1 Response                      |
| `approver_1_returned`, status A/D    | Submit to Approver 2                            |
| `approver_1_returned`, status B      | (Optional: Add Remarks) → Submit to Approver 2  |
| `approver_1_returned`, status C      | Start New Revision                              |
| `with_approver_2`                    | Record Approver 2 Response                      |
| `approved` / `approved_with_comments`| (none — terminal)                               |
| `rejected`                           | Start New Revision                              |

For the time being, **any project member** can perform these actions. The audit log captures actor + action + timestamp; that is the authority for "who did what when" on the approval chain.

### Returned Document Splitting

When a returned PDF is uploaded via "Record Approver N Response":

- Backend splits the file into two pieces using the project's DOCX template page count for that doc_type:
  - **Cover** = first K pages, where K = `cover_page_count` of the matching DocTemplate.
  - **Attachments** = remaining pages, split into individual files named `Attachment-1`, `Attachment-2`, … in source order.
- `cover_page_count` is **auto-detected** when a DOCX template is uploaded: the system converts the template to PDF (LibreOffice headless, same as report generation) and counts pages. Stored on the template row.
- The form renders a new collapsible section per round: **"Approver N — {Company} — Round {n}"** showing party, signatory, date, status badge, revision_no, comments, cover preview, and attachment list.
- For a status-B response from Approver 1, the form additionally exposes an optional **"Our Remarks for Approver 2"** file slot, attached to the round.

### Resubmission and Revisions

- A status-C response closes the current revision cycle.
- **Start New Revision** increments `revision_no`, copies metadata, blanks attachments and approval rounds, marks the previous revision as `superseded`, and starts the new revision at `draft`.
- Within a single revision, an approver returns at most once. Multiple rounds against the same `approver_order` are not used: status C ends the revision; A/B/D advances or terminates.

### OCR Capture (Region-Based)

The returned PDF is previewed in-form. The user drags a dotted rectangle around the **signatory name**, **date**, or **comments** region; the system extracts the text and fills the corresponding field. The user confirms each capture before saving.

Status (A/B/C/D) is **not** OCR'd — it is a manual dropdown.

Implementation (mandatory):

- **Frontend**: PDF.js via `react-pdf` for the preview canvas. Overlay canvas captures `{page, x, y, width, height}` in PDF user-space coordinates. Per-field "Capture from Document" toggle arms region selection and routes the result to the active field.
- **Backend extraction endpoint**: accepts `{document_id, round_id, page, bbox, target_field}` and returns extracted text.
  - **Step 1** — native text via `PyMuPDF.page.get_textbox(rect)`. Aconex-generated PDFs typically contain selectable text — instant, exact.
  - **Step 2** — fall back to `pytesseract` on a high-DPI crop of the region only if step 1 returns empty/whitespace.
  - For `target_field = date`, run extracted text through `dateparser` and return ISO `yyyy-MM-dd`.
- Tesseract binary must be available on the host. Documented in README and added to local stack.
- All captured fields remain editable; OCR populates a suggestion that the user confirms.

---

## OCR + AI (FUTURE)

Prepare architecture for:
- OCR ingestion, document parsing, metadata extraction
- AI-assisted workflows (LLM APIs, document intelligence, automation)

DO NOT implement speculative AI logic now. ONLY prepare clean extensible architecture.

---

## DEVELOPMENT STRATEGY

Build incrementally in VERY SHORT SPRINTS.

Every sprint must:
- Preserve architecture quality
- Preserve design consistency
- Preserve scalability
- Avoid technical debt
- Avoid duplicated patterns

---

## GITHUB

Repository: git@github.com:burdianov/qtc360.git

---

## PROJECT PURPOSE

QTC360 is NOT merely a WIR/MIR/CIR application.

QTC360 is:

# A Rules-Based Asset Commissioning Tracking System

where:

* Assets progress through commissioning levels
* Levels contain requirements
* Requirements are achieved through approved evidence documents
* Approved evidence documents generate progress
* Progress generates commissioning tags
* Target dates are tracked against actual achievement

---

## CORE DOMAIN CONCEPT

The most important business rule:

```
Documents do NOT define progress.
Documents PROVE that requirements are achieved.
```

This distinction is critical.

---

## COMMISSIONING FLOW

Assets must obtain tags through commissioning progression.

### Levels

```
L1
L2A
L2B
L3
L4
L5 (future)
```

### Tags

```
Red Tag    = L1 + L2A complete
Yellow Tag = L2B complete
Green Tag  = L3 complete
Blue Tag   = L4 complete
White Tag  = future implementation
```

---

## CORE HIERARCHY

```
Project
 → Discipline
   → Service
     → Asset Type
       → Asset Subtype (optional)
         → Asset
```

IMPORTANT:

* AssetType is a classification/catalog entity
* Asset is a physical equipment instance
* DO NOT merge them
* DO NOT use is_asset flags

---

## EXAMPLES

### Asset Types

```
Generator
MDB
DB
FCU
```

### Asset Subtypes

```
1000kVA Generator
1250kVA Generator
```

### Assets

```
Generator-1
Generator-2
MDB-01
```

---

## REQUIREMENT ENGINE

The previous usage of the word "milestone" was overloaded and confusing.

The correct terminology going forward:

| Old Term           | New Domain Meaning     |
| ------------------ | ---------------------- |
| Milestone          | Requirement            |
| Sub-milestone      | Work Breakdown Item    |
| Activity           | Requirement Type       |
| Test               | Requirement Type       |
| FAT milestone      | Requirement            |
| Achieved milestone | Requirement Completion |

---

## REQUIREMENT TEMPLATES

A RequirementTemplate defines what is required.

Examples:

```
FAT Certificate
Equipment Delivery
Equipment Placement
Cable Tray Installation
Cold Test
Level 2B Final
Level 3 Test
BMS Integration Test
```

Fields:

```
id
project_id (nullable)
name
code
description
level_code
requirement_category
evidence_document_type
requires_work_breakdown
is_gate_requirement
is_optional
sort_order
is_active
```

### requirement_category values

```
fat
delivery
activity
test
integration_test
final_level_test
```

### evidence_document_type values

```
FAT
MIR
WIR
CIR
```

### IMPORTANT: These fields are NOT redundant

`requirement_category` and `evidence_document_type` serve DIFFERENT purposes:

* `requirement_category` = business nature of the requirement
* `evidence_document_type` = which document type proves completion

Example mapping:

| Requirement             | requirement_category | evidence_document_type |
| ----------------------- | -------------------- | ---------------------- |
| Equipment Delivery      | delivery             | MIR                    |
| Cable Tray Installation | activity             | WIR                    |
| Cold Test               | test                 | CIR                    |
| BMS Integration Test    | integration_test     | CIR                    |
| FAT Certificate         | fat                  | FAT                    |

This distinction is REQUIRED for:

* Filtering requirements in document forms (WIR form shows only `evidence_document_type = WIR` requirements)
* Document generation flows
* Requirement grouping in dashboards
* Reporting by category vs. by evidence type

IMPORTANT:

Requirements belong to commissioning levels.

Examples:

```
Equipment Delivery → L2A
Cable Tray Installation → L2B
Cold Test → L2B
BMS Integration Test → L4
```

---

## ASSET REQUIREMENTS

This is the most important business entity.

An AssetRequirement represents a requirement assigned to a specific asset.

Examples:

```
Generator-1 must complete Cable Tray Installation
Generator-1 must complete Cold Test
MDB-01 must complete FAT Certificate
```

Fields:

```
id
asset_id
requirement_template_id
status (cached/calculated)
progress_percent (cached/calculated)
required_for_tag
target_date (optional)
actual_completion_date (nullable)
notes
```

IMPORTANT:

The status of AssetRequirement is NOT manually edited by users.

It is calculated by backend logic based on approved evidence documents and work breakdown completion.

---

## ASSET REQUIREMENT STATUS RULES

The backend calculates requirement status.

Statuses:

```
not_started
submitted
partial
achieved
rejected
not_applicable
```

Rules:

### not_started

No approved evidence exists.

### submitted

Relevant document exists but is not yet approved.

### partial

Some work breakdown items approved but not all.

### achieved

All required work items approved OR requirement fully satisfied.

IMPORTANT:

Users should NEVER directly edit requirement statuses manually.

### EXPLICIT RULE: Status is System-Controlled

`AssetRequirement.status` and `AssetRequirement.progress_percent` MUST NOT be user-editable through any API endpoint, form, or admin interface. These fields are ONLY updated by backend calculation/cache logic triggered by document status changes or work item completion events. Any API request attempting to set these fields directly MUST be rejected.

---

## WORK BREAKDOWN ENGINE

This solves partial progress tracking.

Example:

Requirement:

```
Cable Tray Installation
```

May require:

```
Generator-1 → MDB-1
Generator-1 → MDB-2
Generator-1 → MDB-3
```

These are NOT separate requirements.

They are Work Breakdown Items.

---

## REQUIREMENT WORK ITEMS

Fields:

```
id
asset_requirement_id
name
description
status
linked_document_id (nullable)
approved_date (nullable)
sequence_no
created_dynamically
```

Rules:

```
0 approved items → not_started
some approved items → partial
all approved items → achieved
```

IMPORTANT:

Work breakdown items may be created dynamically during WIR/CIR preparation.

This is REQUIRED behavior.

---

## DOCUMENT ENGINE

The previous approach of separating MIR/WIR/CIR too aggressively is incorrect.

Use ONE unified document engine.

---

## DOCUMENTS

Fields:

```
id
project_id
document_type
reference_no
title
description
status
revision_no
submitted_date
approved_date
created_by
updated_by
```

### document_type values

```
FAT
MIR
WIR
CIR
```

### status values

```
draft
internally_signed
with_approver_1
approver_1_returned
with_approver_2
approved
approved_with_comments
rejected
cancelled
superseded
```

See **External Approval Workflow** above for transitions. The four-letter approver decision (A/B/C/D) is recorded on `DocumentApprovalRound`, not on the document itself.

IMPORTANT:

Document status IS manually controlled.

Document status IS the source of truth.

---

## CRITICAL: NOT ALL DOCUMENTS ARE COMMISSIONING EVIDENCE

This is a fundamental domain rule.

QTC360 supports TWO categories of documents:

### A. Commissioning-linked documents

These affect commissioning progress because they link to asset requirements via `document_requirement_links`.

Examples:

```
Cable Tray Installation WIR
Cold Test CIR
Equipment Delivery MIR
```

### B. General QA/QC documents

These are normal QA/QC records that DO NOT affect commissioning progress.

Examples:

```
Final Cleaning WIR
Painting Inspection WIR
Blockwork Inspection WIR
General Material MIR
```

### Rule

The system must NEVER assume:

```
all WIRs are commissioning milestones
all CIRs are commissioning milestones
all MIRs are commissioning milestones
```

Instead:

```
Documents are generic QA/QC records.
Some documents additionally serve as commissioning evidence.
```

Only documents linked through `document_requirement_links` affect commissioning progress.

---

## DOCUMENT RELATIONSHIPS ARE OPTIONAL

All document linking relationships are OPTIONAL:

```
document_assets → OPTIONAL (a document may or may not involve specific assets)
document_requirement_links → OPTIONAL (a document may or may not prove a requirement)
```

A document may:

* Link to assets AND requirements (commissioning evidence)
* Link only to assets (general QA/QC with asset context)
* Link to neither (standalone QA/QC record)

This distinction MUST be preserved throughout:

* Backend services
* ORM relationships
* API validation (no mandatory requirement linkage on document creation)
* Frontend forms (requirement linking is an optional step)
* Reporting logic
* Dashboard calculations

---

## DOCUMENT ↔ ASSET LINKING

A document can involve many assets.

Examples:

```
BMS CIR
→ Generator-1
→ MDB-2
→ FCU-1
```

Table: `document_assets`

Fields:

```
document_id
asset_id
```

---

## DOCUMENT ↔ REQUIREMENT LINKING

This is critical.

A document proves completion of requirements.

Table: `document_requirement_links`

Fields:

```
id
document_id
asset_requirement_id
requirement_work_item_id (nullable)
```

Examples:

```
WIR-1005
→ Generator-1
→ Cable Tray Installation
→ Work Item: Generator-1 to MDB-1
```

---

## IMPORTANT STATUS ARCHITECTURE

DO NOT maintain independent manually editable statuses for both documents and requirements.

That creates synchronization problems.

Correct architecture:

```
Document status = stored source of truth
Requirement status = calculated/cached
```

Meaning:

* Document statuses are manually updated
* Requirement statuses are calculated from document approval state and work item completion

---

## FAT LOGIC

FAT behaves differently.

FAT often applies to:

* Entire asset types
* Subtypes
* Groups of assets

Example:

```
All 1000kVA Generators share one FAT
```

The UI should allow:

```
Select Asset Type/Subtype
→ Auto-load applicable assets
→ Select applicable assets
→ Link FAT document
```

FAT remains part of the unified document engine.

---

## LEVEL 2B FINAL CIR

This is NOT a hard-blocking rule.

It is a SOFT GATE requirement.

Meaning:

The system should WARN users if previous L2B requirements are incomplete, but still allow proceeding.

Example warning:

```
Warning:
Generator-1 still has incomplete L2B requirements:
- Cable Tray Installation (partial)
- Cold Test (not started)

You may continue, but Yellow Tag will not be achieved until all L2B requirements are completed.
```

Do NOT enforce hard DB constraints for this logic.

This is application/business validation logic only.

### AUDIT: Soft Gate Override Acknowledgement

If a user proceeds with Level 2B Final CIR while previous L2B requirements are incomplete, the system MUST store a warning acknowledgement record. This creates an audit trail proving the user was informed and chose to proceed.

Table: `gate_override_acknowledgements`

Fields:

```
id
user_id
asset_id
document_id
level_code
incomplete_requirements (JSON array of {requirement_id, status} at time of override)
acknowledged_at
notes (optional user comment)
```

This record is immutable once created (no updates or deletes).

---

## LEVEL 4 INTEGRATION TESTS

Level 4 tests involve multiple assets.

Example:

```
BMS Integration Test
→ Generator-1
→ MDB-2
→ BMS Panel
```

One CIR may satisfy requirements for many assets simultaneously.

The schema must support many-to-many relationships.

---

## TAG ENGINE

Tags should NOT be manually assigned.

They should be calculated.

Rules:

### Red Tag

All required L1 + L2A requirements achieved.

### Yellow Tag

All required L2B requirements achieved.

### Green Tag

All required L3 requirements achieved.

### Blue Tag

All required L4 requirements achieved.

### White Tag

Future implementation.

---

## TARGET DATE TRACKING

Assets have target dates for tags.

Table: `asset_tag_targets`

Fields:

```
id
asset_id
tag_code
target_date
actual_achieved_date (nullable)
status (calculated)
```

Possible statuses:

```
not_started
in_progress
achieved
delayed
at_risk
```

---

## IMPLEMENTATION RULES

### DO NOT

* Manually sync document status and requirement status
* Manually set current asset level
* Manually assign tags
* Merge asset types and assets
* Use is_asset flags
* Create separate disconnected MIR/WIR/CIR systems

### DO

* Calculate progress dynamically
* Use documents as evidence
* Use requirements as the tracking engine
* Use work breakdown items for partial completion
* Support multi-asset documents
* Support many-to-many requirement linkage
* Cache calculated statuses for performance if needed
* Centralize approval logic

---

## REQUIRED REFACTORING TASKS

### Backend

* Refactor domain entities
* Refactor ORM models
* Refactor services
* Refactor business logic
* Refactor status calculation
* Refactor approval workflows

### Database

* Create migration strategy
* Preserve data if feasible
* Remove obsolete milestone assumptions
* Normalize requirement relationships
* Introduce work breakdown architecture

### Frontend

* Refactor forms
* Refactor WIR/CIR flows
* Add requirement selection
* Add work breakdown creation UI
* Add warnings for incomplete gate requirements
* Add commissioning dashboards
* Add tag progress visualization

---

## CURRENT IMPLEMENTATION STATUS (as of 2026-05-27)

### Completed (Preserve)

**Backend:**
- Auth: JWT access/refresh tokens, login, register (admin-only), change password
- RBAC: User, Role, Permission with many-to-many
- Users: email, full_name, phone, position, signature_font, signature_text
- Master tables: Client, Project, Discipline, Service, Activity, SubActivity, Test, System, Contractor, Asset, AssetType, Approver, ApproverTitle, ProjectApprover, ApprovalStatus
- Document model: single table for MIR/WIR/CIR with doc_type
- DocTemplate model: stores uploaded DOCX templates per project+doc_type
- ReferenceNumberConfig: pattern-based auto-numbering
- Notification model: in-app notifications
- Report generation: docxtpl + LibreOffice headless
- Signature service: 9 script fonts, renders name as PNG

**Frontend:**
- Dark/light theme, responsive sidebar, auth flow
- DataTable: sorting, search, pagination, column visibility+reorder, row actions, bulk actions, CSV export/import
- Master table pages: Projects, Clients, Disciplines, Services, Approvers, Assets, Activities, Sub-Activities, Tests, Systems, Contractors
- Admin pages: Users, Roles, Permissions, Settings (ref number config)
- Document Templates page: upload/list/delete DOCX templates
- Profile page: signature font picker, custom signature text, live preview
- WIR list page + WIR form (create/edit, cascade selects, multi-asset, signatures)
- Navbar: user dropdown with Profile link

### Needs Refactoring (per this spec)

- Document model: remove type-specific columns (activity_id, test_id, milestone flags)
- Remove separate FAT table → unify into document engine
- Remove Activity/SubActivity/Test as separate domain concepts → become RequirementTemplates
- Add: RequirementTemplate, AssetRequirement, RequirementWorkItem, DocumentRequirementLink, AssetTagTarget
- Implement status calculation engine
- Refactor WIR/CIR forms to use requirement + work breakdown selection

### External Approval Workflow — Implementation Tasks

- Schema:
  - Add `document_type` to `project_approvers` (WIR/MIR/CIR/FAT). Unique on `(project_id, document_type, approver_order)`.
  - Replace single-row `document_approvals` with `document_approval_rounds`: `(document_id, approver_order, round_no, submitted_at, returned_at, decision, signatory_name, response_date, comments, returned_file_id, remarks_file_id)`.
  - Add `cover_page_count` (int) to `doc_templates`; populate on upload via LibreOffice page count.
  - Document `status` enum: replace `submitted` with `internally_signed`, `with_approver_1`, `approver_1_returned`, `with_approver_2`.
- Services:
  - PDF split service (PyMuPDF): split returned PDF at `cover_page_count` boundary, persist cover + per-page attachments as `DocumentAttachment` rows tagged with the round.
  - OCR region extraction service: native-text-first via PyMuPDF, Tesseract fallback for empty regions; date normalization via `dateparser`.
  - Status transition service: enforce the state machine in the table above; reject invalid transitions.
- API:
  - `POST /documents/{id}/submit-to-approver` (sets `with_approver_N`).
  - `POST /documents/{id}/approval-rounds` (multipart: returned PDF + decision + signatory + date + comments). Triggers split.
  - `POST /documents/{id}/approval-rounds/{round_id}/extract` (page + bbox + target_field) → extracted text.
  - `POST /documents/{id}/approval-rounds/{round_id}/remarks` (multipart: remarks PDF for status-B resubmissions).
  - `POST /documents/{id}/start-new-revision`.
- Frontend:
  - Document form right-rail action panel keyed off document state.
  - Submit dialog (one click + confirm), Record Response dialog (PDF preview + region OCR), Add Remarks dialog.
  - Per-round collapsible section showing party, signatory, decision badge, date, comments, cover preview, attachment list.
  - PDF preview using `react-pdf`; overlay canvas for region selection.
- Admin:
  - Project Approvers page with doc_type tab/filter.
  - Seed default chains: WIR/MIR → AESG → Core Emirates; CIR → RED Engineering → Sudlows.

### Key File Locations

- `backend/app/models/` — ORM models
- `backend/app/api/v1/` — API routers
- `backend/app/services/` — Business logic
- `backend/app/schemas/` — Pydantic schemas
- `backend/app/repositories/` — Data access
- `backend/migrations/versions/` — Alembic migrations
- `frontend/src/app/(dashboard)/` — Page routes
- `frontend/src/components/data-table/` — Reusable DataTable system
- `frontend/src/components/ui/` — shadcn/ui components

### Running the Project

```bash
# Docker (PostgreSQL + pgAdmin)
cd D:\QTC360\qtc360 && docker compose up -d

# Backend
cd D:\QTC360\qtc360\backend && uv run alembic upgrade head && uv run python -m app.seed && uv run uvicorn app.main:app --reload

# Frontend
cd D:\QTC360\qtc360\frontend && npm run dev
```
