# QTC360 Code Map

## Backend routes

- auth.py: login, refresh, auth flows
- admin.py: users, roles, permissions, settings
- master.py: master data
- documents.py: document lifecycle, uploads, approvals
- reports.py: PDF/report generation
- commissioning.py: commissioning requirements/tracking
- checklist.py: checklist generation/export
- dashboard.py: dashboard data
- notifications.py: notifications
- ref_config.py: reference number config

## Frontend areas

- dashboard/page.tsx: dashboard
- documents/page.tsx: document list
- documents/templates/page.tsx: templates
- qaqc/*/page.tsx: WIR/MIR/CIR/FAT lists
- qaqc/*/new/page.tsx: large creation forms
- commissioning/*: commissioning pages
- admin/*: admin pages
- master-data/*: master data CRUD
- frontend/src/lib/api.ts: API client