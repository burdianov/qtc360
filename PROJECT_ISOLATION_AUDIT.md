# Project Isolation Audit & Fixes

## Issue
Data was being fetched across all projects instead of being filtered by the selected project. Projects should be completely isolated - they can only share common masters (like disciplines, services), but documents, approvals, assets, requirements, etc. must be project-specific.

## Root Cause
Frontend queries were not passing `project_id` parameter to backend endpoints, even though the backend CRUD endpoints support project filtering via `?project_id=xxx` query parameter.

## Fixed Locations

### Dashboard (`frontend/src/app/(dashboard)/dashboard/page.tsx`)
- ✅ `LevelProgress` component - Added project filtering to asset-requirements query
- ✅ `TagSummary` component - Added project filtering to asset-requirements query

### Tag Targets (`frontend/src/app/(dashboard)/commissioning/tag-targets/page.tsx`)
- ✅ Assets query - Added project filtering
- ✅ Tag targets query - Added project filtering

## Locations That Need Fixing

### Assets Queries (Need project_id parameter)
1. `frontend/src/app/(dashboard)/qaqc/wir/new/page.tsx` - Line 92
2. `frontend/src/app/(dashboard)/qaqc/mir/new/page.tsx` - Line 79
3. `frontend/src/app/(dashboard)/qaqc/cir/new/page.tsx` - Line 78
4. `frontend/src/app/(dashboard)/qaqc/fat/new/page.tsx` - Line 83
5. `frontend/src/app/(dashboard)/master-data/assets/page.tsx` - Line 40
6. `frontend/src/app/(dashboard)/commissioning/tracking/page.tsx` - Line 77
7. `frontend/src/app/(dashboard)/commissioning/requirements/page.tsx` - Line 48

### Disciplines Queries (Common master - may not need filtering)
These are typically shared across projects, but should verify:
1. `frontend/src/app/(dashboard)/qaqc/wir/new/page.tsx` - Line 82
2. `frontend/src/app/(dashboard)/qaqc/mir/new/page.tsx` - Line 77
3. `frontend/src/app/(dashboard)/qaqc/cir/new/page.tsx` - Line 76
4. `frontend/src/app/(dashboard)/qaqc/fat/new/page.tsx` - Line 68
5. `frontend/src/app/(dashboard)/commissioning/tracking/page.tsx` - Line 82

## Pattern to Apply

### Before (Wrong):
```typescript
const { data: assets = [] } = useQuery<Asset[]>({
  queryKey: ["assets"],
  queryFn: async () => (await api.get("/assets")).data,
});
```

### After (Correct):
```typescript
const { data: assets = [] } = useQuery<Asset[]>({
  queryKey: ["assets", project?.id],
  queryFn: async () => (await api.get("/assets", { params: { project_id: project?.id } })).data,
  enabled: !!project?.id,
});
```

## Backend Support
The backend CRUD endpoints (in `backend/app/api/v1/crud.py`) already support project filtering:
- Line 58: `project_id: UUID | None = Query(None)`
- Line 63-65: Filters by project_id if provided
- Line 66-67: Otherwise scopes to user's accessible projects

## Common Masters vs Project-Specific Data

### Common Masters (Shared across projects):
- Disciplines
- Services  
- Contractors
- Users
- Approvers (companies)

### Project-Specific (Must be isolated):
- Assets
- Documents
- Approval Rounds
- Asset Requirements
- Requirement Templates (can be project-specific or global)
- Tag Targets
- Work Items
- Document Links
- Systems (project-specific)

## Testing Checklist
- [ ] Switch between projects and verify dashboard shows different data
- [ ] Verify WIR/MIR/CIR forms only show assets from selected project
- [ ] Verify commissioning tracking only shows data from selected project
- [ ] Verify tag targets only show assets from selected project
- [ ] Verify documents list only shows documents from selected project
- [ ] Verify approval rounds are project-isolated

## Next Steps
1. Apply the pattern fix to all remaining locations
2. Test project switching thoroughly
3. Verify no cross-project data leakage
4. Consider adding backend validation to reject requests without project_id for project-specific endpoints
