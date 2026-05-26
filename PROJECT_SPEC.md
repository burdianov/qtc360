# QTC360 — Project Specification & Architecture Brief

## PROJECT OVERVIEW

QTC360 is a modern enterprise QA/QC + Commissioning management platform for construction and industrial projects.

The system will gradually evolve through VERY SHORT SPRINTS.

We will start with:

1. Authentication & authorization foundation
2. Master data management
3. Relationships between entities
4. Then gradually implement operational workflows

The application will eventually support:

- MIR (Material Inspection Requests)
- WIR (Work Inspection Requests)
- CIR (Commissioning Inspection Requests)
- FAT Reports tracking
- QA/QC workflows
- Commissioning workflows
- Document management
- Approval processes (we we'll prepare the documents for approval in QTC360, record everything for our tracking, but will submit the documents externally via Aconex)
- Asset tracking (this is very important, everything is built around it)
- OCR capabilities
- Possibly AI-assisted workflows later

We will progressively discuss and refine:

- Business logic
- Relationships
- Workflows
- Approval chains
- Automation
- OCR usage
- AI integrations
- Production infrastructure

DO NOT over-engineer speculative business logic now.
Build a SOLID, SCALABLE FOUNDATION.

---

## TECH STACK — MANDATORY

### FRONTEND

- Next.js 16+
- TypeScript latest stable
- Tailwind CSS latest
- shadcn/ui
- React Query / TanStack Query
- Zustand only if needed
- Zod
- React Hook Form
- Axios or native fetch abstraction
- Strict typing everywhere

### BACKEND

- FastAPI (async architecture)
- SQLAlchemy 2.x async
- Alembic
- PostgreSQL
- uv package manager
- Pydantic latest
- Modular clean architecture
- Strict typing
- Async-first architecture

### DATABASE

- PostgreSQL
- Local development via Docker

### LOCAL DEVELOPMENT

- Frontend local
- Backend local
- PostgreSQL inside Docker
- Docker Compose for local stack

### DEMO ENVIRONMENT

- Use free online services where practical
- Minimize infrastructure complexity
- Keep deployment lightweight

### PRODUCTION

To be discussed later.

---

## APPLICATION DEVELOPMENT STRATEGY

Build incrementally in VERY SHORT SPRINTS.

DO NOT attempt to implement the entire product immediately.

Every sprint must:

- Preserve architecture quality
- Preserve design consistency
- Preserve scalability
- Avoid technical debt
- Avoid duplicated patterns

---

## INITIAL DEVELOPMENT PHASES

### PHASE 1 — FOUNDATION

- Monorepo/project structure
- Frontend architecture
- Backend architecture
- Docker setup
- Environment management
- Authentication foundation
- RBAC foundation
- Design system
- API architecture
- DB migration architecture

### PHASE 2 — MASTER TABLES

Before we proceed with that, I need to explain something important to you. For an asset to progress in the commissioning process it whould achieve some milestones. Let me explain what milestones are. Each asset aka equipment, must get some approvals in order to complete a commissioning Level. There are 4 documents (entitites) by means of which a milestone can be achieved: Factory Acceptance Test (FAT), Material Inspection Request (MIR), Work Inspection Request (WIR), and Commissioning Inspection Request (CIR). MIRs are done for material delivery. Some MIR are milestone DELIVERIES which deliver assets, and the relevant assets should be mentioned in the MIR. WIRs are done for the inspection of an executed ACTIVITY. Some activities are milestone ACTIVITIES, and the list of relevant assets should be mentioned in the WIR prepared for submission. Some CIRs are milestone TESTS, an the list of relevant assets should be mentioned when the CIR is prepared for submission. FAT will be discussed below. Let me take you through the commissioning cycle of a MDB for your understanding. It's important that you understand that because the data modelling and relationships depends heavily on that. In Level 1 the MDB should have an approved FAT. We are not sumitting this document, but we need to create a record in the system and mention the reference of the Factory Acceptance Test. This is a mandatory requirement, and from now on we will call these requirements milestones. In the beginning of the project we assign all the requirements to the assets, and we know exactly what needs to be achieve in order for the asset to pass levels and get labels. So, getting a FAT approved (wherever applicable, as it doesn't apply for all assets), is achieving a milestone. We must record these achievements by recording the milestones. In case of FAT, we will record the milestone when we create the record for the FAT and while doing that, we select against which asset it has effect (a FAT usually is done either for the entire asset type, e.g. all MDBs; or all Split Units, or for a subgroup of the type, e.g. we have the type Generators, but sub types Generators 1000kVA and Generators 1250kVA). So, when we create the FAT record in the system, we need to select they asset type for the respective discipline and service and we'll get the list of all relevant assets. Now, we can select the assets for which the FAT in question apply and we are done for this milestone, it can be tracked in the system. Just to clarify, the project has several disciplines. Each discipline has services. Each service has asset types. Each type can have subtypes, but not always, the assets can be directly under them. I believe when we model the data, we need to keep the table types a parent of assets, but add to assets table a new field called is_asset and use it for data filtering while viewing or filtering the data. Or if there is a better way to model this, I will need your advice.
Now, after getting the FAT approved, the asset MDB progresses to level 2A. In Level 2A the MDB has 2 milestones:

1. Get approved the material delivery of the equipment via submitting a Material Inspection Request (MIR). The MIR is prepared in the system (complete details will be discussed later). When preparing the MIR, the list of relevant assets against which the relevant DELIVERY is done must be recorded, thus, if the MIR is approved, this milestone is achieved
2. WIR for the placement and anchoring of the asset. This ACTIVITY is an approval milestone, so once the WIR is approved, the milestone is achieved.
   Next is level 2B. Here we have several ACTIVITY milestones, achievable via submitting and getting approved WIRs, and several TEST milestones, achievable via submitting and getting approved CIRs. Level 2B has final CIR which is called Level 2B. It is submitted after all other level 2B relevant WIRs and CIRs are approved.
   Comming back to the approval of WIRs, as mentioned above, their ACTIVITY is linked to a milestone. However, sometimes the one ACTIVITY can't be performed in one session. Therefore, we need to split it into sub-activities on the fly, while preparing the WIR (it should be possible to do this breakdown in advance, if the information is clear). For example, the milestone ACTIVITY is "MDB outgoing cable pulling". However, there are 20 outgoing cables. If not all cables are yet pulled, we need to get approval for part of that, for example only for the cables from MDB to DB-1 and DB-2. The other 18 DBs will remain to be done later. So, in this case, we didn't achieve the milestone, but we need to have a clear record that it is partially achieved and maybe we need a different color for that when building the tracking charts. Other case could be that we have one Fire Panel asset only, but we need to test 50 separate circuits in order to achieve the milestone, so we need to be able to break this ACTIVITY of testing the circuits into multiple sub-activities. The sub-activities might need to have another field. For example, we are testing the Panel circuits You need to advise on data model to tackle this.
   Next is Level 3. In level 3 the milestones are achieved by testing each asset standalone. Milestone achievement is confirmed via the respective CIR.
   Next is Level 4. Here we have several integration tests. In each test, several types of assets participate, but not necessarily all the assets in of that asset type. Some assets can take part in multiple tests. It is known in advance in what tests the certain assets should participate, and the milestones are achieved accordingly. The list of assets is listed in CIR as usual and linked with the milestones. Once all the milestones for a certain asset are achieved, the level is complete.
   Upon completing any level the equipment gets the respective color tag (tagging colors explained below). It would be great if we cound present this visually in the application.
   One of the main objectives of all this work si to have a clear record of where each asset is in the navigation through commissioning level.
   Also, in the beginning of the project, each asset is assigned dates when the tags are required to be achieved. So our reporting should give clear indication, warnings, etc. in this regard.
   Given all the above, refine the below data related content.

Master tables include (some masters will be company wise, others will be project wise):

- Employees (list of emplyees involved in submissions and tracking)
- Projects (list of projects)
- Disciplines
- Services (the parent is Disciplines)
- Activities (the parent is Services)
- Sub-Activities (the parent is Activities)
- Tests
- Assets
- Asset Types
- Locations
- Systems
- Subsystems
- Contractors
- Clients
- Tags
- Documents
- Approval roles
- Levels
- Milestones
- Approval Statuses

Admin users must be able to:

- CRUD all master data
- Bulk upload/import data
- Manage relationships
- Search/filter data
- Export/import datasets

---

## DOMAIN MODEL — HIGH LEVEL

### Core Hierarchy

```
Project → Disciplines → Services → Asset Types (→ Subtypes via self-ref) → Assets
```

### Asset Commissioning Lifecycle

Assets progress through levels by achieving milestones:
- **L1:** FAT approved (where applicable)
- **L2A:** Material delivery (MIR) + placement/anchoring activity (WIR)
- **L2B:** Multiple activities (WIR) + tests (CIR), final CIR = "Level 2B"
- **L3:** Standalone tests per asset (CIR)
- **L4:** Integration tests across asset types (CIR)
- **L5:** TBD

### Milestone Achievement Mechanisms

| Document | Milestone Type | Achievement |
|----------|---------------|-------------|
| FAT | Factory acceptance | Record created, linked to asset type/subtype |
| MIR | Delivery | Approved MIR with asset list |
| WIR | Activity | Approved WIR with asset list |
| CIR | Test | Approved CIR with asset list |

### Key Data Model Decisions

- `asset_types` has `service_id` FK only (discipline derived via service)
- `asset_types` has `parent_type_id` (self-ref, nullable) for subtypes
- `assets` has `asset_type_id` FK — assets are physical instances of types
- Milestone assignments link assets to required milestones per level
- Partial achievement supported (sub-activities, progress tracking)
- Target dates per asset per level for reporting/warnings
- Approvers: 2 parties for MIR/WIR, 2 parties for CIR, separate party for FAT

### Sub-Activity Splitting

Activities can be split into sub-activities dynamically when preparing a WIR (or in advance). This supports partial milestone achievement with distinct visual status (not started / partial / achieved).

---

## CORE BUSINESS MODULES

1. **MIR** — Material Inspection Requests
2. **WIR** — Work Inspection Requests
3. **CIR** — Commissioning Inspection Requests
4. **FAT Report Tracking** — Upload reports, track approvals, mark internal approval status
5. **Document Management**
6. **Asset Management**
7. **Commissioning Tracking**

---

## COMMISSIONING LEVELS

- L1 — Red Tag
- L2A — Red Tag
- L2B — Yellow Tag
- L3 — Green Tag
- L4 — Blue Tag
- L5 — White Tag

These are CRITICAL domain entities. The system must support:

- Relationships
- Workflow transitions
- Filtering
- Dashboards
- Status tracking
- Reporting
- Future automation

---

## OCR + AI

Prepare architecture for:

- OCR ingestion
- Document parsing
- Metadata extraction
- AI-assisted workflows (future)

May later integrate:

- LLM APIs
- Document intelligence
- Automation
- Validation
- Summarization

DO NOT implement speculative AI logic now. ONLY prepare clean extensible architecture.

---

## DESIGN SYSTEM — CRITICAL

### Primary Visual Reference

https://zenith-shadcn.dashboardpack.com/dashboard

Screenshots in `D:\QTC360\screenshots` are the PRIMARY VISUAL SOURCE OF TRUTH.
The links are secondary references.

### Design Language

- Matte black
- Charcoal surfaces
- Subtle borders
- Restrained accents
- Monochromatic hierarchy

Blue is ONLY an accent color.

### DO NOT

- Add blue ambient backgrounds
- Add purple gradients
- Create cyberpunk styling
- Oversaturate surfaces
- Create glowing effects

### The UI must feel

- Mature
- Enterprise-grade
- Premium
- Restrained
- Intentionally designed
- Cohesive
- Scalable

### Design Stack

- shadcn/ui
- Tailwind
- Semantic theme tokens
- Reusable component architecture

---

## COLOR SYSTEM

Approximate visual palette:

- Background: #09090B
- Elevated surfaces: #111113
- Secondary surfaces: #151518
- Subtle borders
- Muted typography
- Off-white primary text

Accent colors ONLY for:

- Active nav
- Charts
- Status badges
- Buttons
- Progress indicators

---

## QA/QC STATUS SYSTEM

### Document Lifecycle (Submission Status)

A document (MIR, WIR, CIR) goes through the following submission statuses:

1. **Draft** — Document is being prepared, not yet signed by internal team
2. **Pending Review (Approver 1)** — Signed by site engineer + QA/QC engineer/manager, submitted to 1st approver
3. **Pending Review (Approver 2)** — Approved by 1st approver, now with 2nd approver (if applicable)
4. **Pending Review (Approver N)** — For projects with more than 2 approvers
5. **Approved** — All approvers have given a positive response (A, B, or D)
6. **Rejected** — Any approver responded with a negative status (C); requires resubmission with new revision

### Submission Status Colors

- Draft: slate gray
- Pending Review (Approver N): amber
- Approved: muted green
- Rejected: muted red

### Internal Signing

Before submission to external approvers, documents must be signed by:
- 1 Site Engineer
- 1 QA/QC Engineer or QA/QC Manager

No specific order required. Until both sign, the document remains in Draft status.

### Approval Statuses (per project — configurable)

Each approver responds with one of the project's configured approval statuses. These are stored in an `approval_statuses` master table with the following fields:

| Field | Description | Example |
|-------|-------------|---------|
| `letter` | Short code | A, B, C, D |
| `name` | Full status name | Approved, Approved with Comments, Revise and Resubmit, Review not Required |
| `description` | Meaning | Work may proceed, Incorporate comments and proceed, Work may not proceed, Work may proceed |
| `action` | Go-ahead action (approved/rejected) | approved, approved, rejected, approved |

#### Project 1728 Approval Statuses:

| Letter | Name | Description | Action |
|--------|------|-------------|--------|
| A | Approved | Work may proceed | approved |
| B | Approved with Comments | Incorporate comments and proceed | approved |
| C | Revise and Resubmit | Work may not proceed | rejected |
| D | Review not Required | Work may proceed | approved |

### Approval Workflow Logic

1. Document signed internally → status becomes "Pending Review (Approver 1)"
2. Approver 1 responds:
   - If action = **approved** → status becomes "Pending Review (Approver 2)" (if exists) or "Approved"
   - If action = **rejected** → status becomes "Rejected" (resubmit with new revision)
3. Approver 2 responds (if applicable):
   - If action = **approved** → status becomes "Pending Review (Approver 3)" (if exists) or "Approved"
   - If action = **rejected** → status becomes "Rejected"
4. Pattern continues for N approvers

### Document Categories

Documents fall into two categories:

1. **Milestone-linked documents** — Related to assets and their milestones (FAT, MIR with delivery milestone, WIR with activity milestone, CIR with test milestone). When approved, these directly contribute to milestone achievement for the listed assets.
2. **Non-milestone documents** — General submissions not tied to asset commissioning progress.

### Milestone Achievement Rules

- A milestone is **achieved** only when the document covering the **full scope** of the activity/delivery/test is approved.
- If a document covers a **partially executed activity** (e.g., only some cables pulled out of many), the approval does NOT achieve the milestone — the asset_milestone status remains **partial**.
- The milestone transitions to **achieved** only when all sub-activities are approved and the full scope is complete.
- Partial approvals are tracked for progress visibility but do not trigger level completion.

### Roles

- **super_admin** — Developer / top-level administrator with full system access
- **admin** — Project administrator — manages users, settings, and master data
- **site_engineer** — Site engineer — submits and tracks field inspections
- **qaqc_engineer** — QA/QC engineer — reviews, approves, and manages quality documents
- **qaqc_manager** — QA/QC manager — same rights as qaqc_engineer (to be differentiated later)

### Commissioning Level Colors

- L1 — Red Tag
- L2A — Red Tag
- L2B — Yellow Tag
- L3 — Green Tag
- L4 — Blue Tag
- L5 — White Tag

---

## APPLICATION SHELL

Must visually resemble Zenith:

- Dark matte sidebar
- Grouped navigation
- Compact density
- Subtle separators
- Professional top navbar
- Command/search bar
- Breadcrumbs
- Notifications
- Profile menu
- Responsive behavior
- Dark and light themes

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
- Approvers (usually there are 2 parties approving WIRs and and MIRs, and 2 parties approving CIRs. FAT is approved prior to this by other party, which is not part of this table, however it won't hurt if we keep it)

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
- Uploads (In the first version of the application, no document will be uploaded to the cloud. The admin will upload only the fonts used for signatures, the relevant favicons and documents header jpeg - the submission documents will be generated by the system, we'll discuss about this later)

### ADMINISTRATION

- Users
- Roles
- Permissions
- Settings

---

## TABLE SYSTEM

Enterprise-grade reusable table infrastructure:

- Filtering
- Sorting
- Search
- Export
- Pagination
- Column visibility
- Status badges
- Row actions
- Bulk actions
- Future server-side pagination

Components:

- DataTable
- DataTableToolbar
- DataTableFilters
- DataTablePagination
- DataTableViewOptions

---

## FORM SYSTEM

- RHF + Zod
- Reusable field wrappers
- Validation
- Upload support
- Async selects
- Sectioned forms

---

## BACKEND ARCHITECTURE

- Async-first
- Clean separation
- Modular routers
- Modular services
- Modular repositories
- Reusable schemas
- Reusable DB models
- Migration safety
- Strict typing

---

## DATABASE REQUIREMENTS

- UUID primary keys
- Timestamps
- Audit fields
- Soft delete strategy where useful
- Normalization
- Proper relationships
- Indexing strategy
- Migration consistency
- Log all user actions

---

## AUTHENTICATION / AUTHORIZATION

- JWT auth
- Refresh tokens
- RBAC
- Permissions
- Project-level access
- Approval authority chains

Exact business logic to be defined later.

---

## ICON SYSTEM

- Use same SVG icons as Zenith where legally permitted
- Otherwise use closest Lucide equivalents
- Also use Lucide icons reflecting QA/QC and T&C activities where Zenith ones are not available
- Preserve: spacing, stroke width, sizing, visual weight, muted appearance
- Centralized icon management

---

## MANDATORY UI RULES

### DO NOT

- Create random custom UI
- Use inconsistent spacing
- Use random gray shades
- Use overly rounded components
- Create flashy gradients
- Use glassmorphism
- Create oversized cards
- Use heavy shadows

### The UI should feel like

Linear + Vercel + Zenith + shadcn

---

## COMPONENT INVENTORY (to build even if not immediately needed)

- Sidebar
- Navbar
- Page headers
- Cards
- Tables
- Forms
- Filters
- Dialogs
- Sheets
- Tabs
- Charts
- Notifications
- Kanban
- Calendar
- Profile/settings layouts
- Dashboards
- Analytics pages
- Activity feeds
- Upload zones
- OCR review screens
- Document viewers

---

## FINAL EXPECTATION

The final result must feel:

- Enterprise-grade
- Highly polished
- Scalable
- Modern
- Premium
- Cohesive
- Intentionally engineered

The platform should feel like a professional SaaS product from day one.
