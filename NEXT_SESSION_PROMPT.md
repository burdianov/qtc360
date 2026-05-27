# QTC360 — Session Continuation Prompt

Use this prompt to continue development in a new session.

---

We're building QTC360 — an enterprise QA/QC + Commissioning management platform. The project is at D:\QTC360\qtc360.

PROJECT_SPEC.md in the root has the full specification. Screenshots are at D:\QTC360\screenshots\.

## CURRENT STATUS — Phase 4 (WIR Workflow + Report Generation)

### Architecture Decision: Word Template-Based Reports
- ❌ OLD: Custom template builder (HTML→PDF, WeasyPrint) — REMOVED
- ✅ NEW: Upload Word DOCX templates → docxtpl fills placeholders → LibreOffice converts to PDF
- Templates stored in DB per project+doc_type
- Signatures rendered as PNG images using script fonts (DocuSign-style)

### Backend (FastAPI + SQLAlchemy 2.x async + PostgreSQL)
- ✅ Auth: JWT access/refresh tokens, login, register (admin-only), change password
- ✅ RBAC: User, Role, Permission with many-to-many
- ✅ Users: email, full_name, phone, position, signature_font, signature_text
- ✅ Master tables: Client, Project (code + external_code), Discipline, Service, Activity, SubActivity, Test, System, Contractor, Asset, Approver, ApproverTitle, ProjectApprover, ApprovalStatus
- ✅ Document model: single table for MIR/WIR/CIR with doc_type, includes location, floor_level, rams_ref, drawing_ref, inspection_date, site_engineer_signed, qaqc_engineer_signed
- ✅ DocTemplate model: stores uploaded DOCX templates per project+doc_type (binary in DB)
- ✅ ReferenceNumberConfig: pattern-based auto-numbering per project+doc_type (e.g. MERC-JMJV-EL-WIR-0031)
- ✅ Notification model: in-app notifications with user_id, title, message, link, is_read
- ✅ Report generation: POST /reports/generate/{doc_type} — docxtpl + LibreOffice headless
- ✅ Signature service: 9 script fonts, renders name as PNG, injected via InlineImage
- ✅ Reference number: GET /documents/generate-ref-number — serial per project+discipline+doc_type
- ✅ Ref config CRUD: GET/POST/DELETE /ref-config
- ✅ Notifications: GET /notifications, PATCH /{id}/read, GET /unread-count
- ✅ Document notify: POST /documents/{id}/notify-signatories
- ✅ PDF health check: GET /reports/pdf-engine/health
- ✅ User preferences: PATCH /auth/me (signature_font, signature_text)
- ✅ LibreOffice: configurable via LIBREOFFICE_PATH env var

### Frontend (Next.js 16 + React 19 + shadcn/ui + @base-ui/react)
- ✅ Dark/light theme, responsive sidebar, auth flow
- ✅ DataTable: sorting, search, pagination, column visibility+reorder (persisted to localStorage), row actions, bulk actions, CSV export/import, row click navigation
- ✅ Master table pages: Projects, Clients, Disciplines, Services, Approvers, Assets, Activities, Sub-Activities, Tests, Systems, Contractors
- ✅ Admin pages: Users (with designation, bulk upload/download), Roles, Permissions, Settings (ref number config)
- ✅ Document Templates page: upload/list/delete DOCX templates per project
- ✅ Profile page: signature font picker (9 fonts), custom signature text, live preview
- ✅ WIR list page: row click opens form, Generate PDF action, delete with confirmation
- ✅ WIR form (/qaqc/wir/new?id=...): 
  - Create new or edit existing (loads data when ?id= present)
  - All fields: date, discipline, subject, description, location, floor, RAMS, drawing ref
  - Service → Activity → Sub-Activity cascade selects
  - Multi-asset selection with badges
  - Inspected By 1 & 2: shows Name: Designation in dropdown, displays name when selected
  - Signature fields: only current user can sign their own, shows actual font-rendered signature
  - Link to signature profile for active signatory
  - Save as Draft / Save & Notify Signatories buttons
  - Dirty form check on navigation
  - Signatures persisted (site_engineer_signed, qaqc_engineer_signed)
- ✅ Navbar: user dropdown with Profile link
- ✅ Input/Textarea: white text in dark mode globally

### WIR Template Placeholders (uploaded DOCX)
{{ ref_no }}, {{ revision }}, {{ prj_no }}, {{ nm }}, {{ date }}, {{ subject }},
{{ description_of_inspection }}, {{ gen_loc }}, {{ floor_level_room }},
{{ appr_rams }}, {{ dwg_ref }}, {{ arch_cb }}...{{ others_cb }},
{{ inspected_by_1 }}, {{ designation_1 }}, {{ insp_sign_1 }}, {{ date_1 }}, {{ time_1 }}, {{ remarks_1 }},
{{ inspected_by_2 }}, {{ designation_2 }}, {{ insp_sign_2 }}, {{ date_2 }}, {{ time_2 }}, {{ remarks_2 }}

### Remaining Tasks (Priority Order)
1. **Sub-activity inline creation** — create new sub-activities from WIR form (must have >1 to split)
2. **Sub-activity completion tracking** — show which sub-activities are done vs pending per activity
3. **Milestone auto-detection** — all sub-activities complete for an activity = milestone achieved
4. **Revision system** — auto-increment per workflow spec
5. **Submit workflow** — can only submit when all signatories have signed
6. **Approval chain** — after submit, goes through approvers
7. **MIR and CIR forms** — similar to WIR
8. **Commissioning tracking** — levels, systems, handover

### Key Files
- backend/app/api/v1/reports.py — report generation (docxtpl + LibreOffice)
- backend/app/api/v1/documents.py — document CRUD + ref number + notify
- backend/app/api/v1/ref_config.py — reference number config CRUD
- backend/app/api/v1/notifications.py — notifications API
- backend/app/services/signature.py — signature PNG rendering
- backend/app/models/document.py — Document model
- backend/app/models/doc_template.py — DocTemplate model
- backend/app/models/notification.py — Notification model
- backend/app/models/reference_number_config.py — ReferenceNumberConfig
- frontend/src/app/(dashboard)/qaqc/wir/new/page.tsx — WIR form
- frontend/src/app/(dashboard)/qaqc/wir/page.tsx — WIR list
- frontend/src/app/(dashboard)/documents/templates/page.tsx — template upload
- frontend/src/app/(dashboard)/profile/page.tsx — signature settings
- frontend/src/app/(dashboard)/admin/settings/page.tsx — ref number config
- frontend/src/components/data-table/ — reusable DataTable system

### Running the Project
```bash
# Docker (PostgreSQL + pgAdmin)
cd D:\QTC360\qtc360 && docker compose up -d

# Backend
cd D:\QTC360\qtc360\backend && uv run alembic upgrade head && uv run python -m app.seed && uv run uvicorn app.main:app --reload

# Frontend
cd D:\QTC360\qtc360\frontend && npm run dev
```

### GitHub
Repository: git@github.com:burdianov/qtc360.git
