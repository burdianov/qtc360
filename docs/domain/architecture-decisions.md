# QTC360 — Architecture Decisions

> This document records important implementation decisions made during the commissioning engine refactoring.

---

## ADR-001: Unified Document Engine

**Date**: 2026-05-27  
**Status**: Accepted

### Context

The previous implementation had separate handling for MIR, WIR, and CIR documents with type-specific columns on a single `documents` table (e.g., `activity_id`, `test_id`, `is_milestone_delivery`, `is_milestone_activity`, `is_milestone_test`). This created tight coupling between document types and business logic.

### Decision

Adopt a unified document engine where:
- All document types (FAT, MIR, WIR, CIR) share the same core `documents` table
- Type-specific fields are removed from the core table
- Documents link to requirements via `document_requirement_links` (many-to-many)
- Documents link to assets via `document_assets` (many-to-many)

### Consequences

- Simpler document CRUD operations
- Flexible linking: one document can prove multiple requirements across multiple assets
- FAT documents are no longer a separate entity (`fats` table) — they become documents with `document_type = 'FAT'`

---

## ADR-002: Requirement-Driven Progress (Not Document-Driven)

**Date**: 2026-05-27  
**Status**: Accepted

### Context

The old model tracked progress via milestone flags on documents (`is_milestone_delivery`, `is_milestone_activity`, `is_milestone_test`). This conflated evidence with progress.

### Decision

- Progress is tracked through `AssetRequirement` entities
- Documents are evidence that prove requirements are achieved
- Requirement status is **calculated** from linked document approval states and work item completion
- Users never manually edit requirement statuses

### Consequences

- Single source of truth: document approval status drives everything
- No synchronization bugs between document status and requirement status
- Backend must implement status calculation logic (triggered on document status change)

---

## ADR-003: Work Breakdown Items for Partial Progress

**Date**: 2026-05-27  
**Status**: Accepted

### Context

Some requirements (e.g., "Cable Tray Installation") involve multiple discrete work items. The old model used `sub_activities` but didn't properly link them to asset-level progress tracking.

### Decision

- Introduce `RequirementWorkItem` entity linked to `AssetRequirement`
- Work items can be created statically (from templates) or dynamically (during WIR/CIR preparation)
- Each work item can be individually linked to a document
- Progress = (approved items / total items)

### Consequences

- Granular progress tracking without creating separate requirements
- Dynamic work item creation supports real-world workflows
- Status calculation must account for work item completion ratios

---

## ADR-004: Calculated Tags (Not Manual Assignment)

**Date**: 2026-05-27  
**Status**: Accepted

### Context

Tags (Red, Yellow, Green, Blue) represent commissioning milestones. They should reflect actual completion state.

### Decision

- Tags are never manually assigned
- Tag achievement is calculated: all requirements for the corresponding levels must be in `achieved` status
- `asset_tag_targets` tracks target dates and actual achievement dates
- Tag status is derived (not_started, in_progress, achieved, delayed, at_risk)

### Consequences

- Tags always reflect reality
- Dashboard/reporting can be built on calculated state
- No manual override means no data integrity issues

---

## ADR-005: Soft Gate Requirements (Warnings, Not Hard Blocks)

**Date**: 2026-05-27  
**Status**: Accepted

### Context

Level progression (e.g., completing L2B before L3) should be encouraged but not enforced at the database level.

### Decision

- Gate requirements are enforced via application-level warnings
- The system warns users when prerequisites are incomplete
- Users can proceed despite warnings
- No foreign key constraints or DB triggers enforce level ordering

### Consequences

- Flexibility for real-world scenarios where strict ordering isn't always possible
- UI must implement warning display logic
- Audit trail should capture when users proceed despite warnings

---

## ADR-006: Asset Type / Asset Separation

**Date**: 2026-05-27  
**Status**: Accepted (preserving existing correct design)

### Context

The existing schema already correctly separates `asset_types` (catalog/classification) from `assets` (physical instances). The self-referential `parent_type_id` on `asset_types` supports subtypes.

### Decision

- Keep the existing `asset_types` → `assets` relationship
- AssetType supports subtypes via `parent_type_id`
- Never merge types and instances
- Never use `is_asset` flags

### Consequences

- FAT can apply to asset types/subtypes (all assets of that type)
- Requirement templates can be assigned at the type level and inherited by assets
- Clean separation of catalog vs. instance data

---

## ADR-007: Migration Strategy

**Date**: 2026-05-27  
**Status**: Pending Implementation

### Context

The refactoring requires significant schema changes. Existing data in the database must be considered.

### Decision

- Use Alembic migrations for all schema changes
- Create a phased migration plan:
  1. Add new tables (requirement_templates, asset_requirements, requirement_work_items, document_requirement_links, asset_tag_targets)
  2. Migrate existing data where possible (activities → requirement_templates, sub_activities → work items)
  3. Remove obsolete columns/tables after data migration
- Preserve existing document data and user/project/RBAC data

### Consequences

- Zero data loss for core entities (projects, users, assets, documents)
- Activity/sub-activity/test data transforms into requirement templates
- Old milestone flags become obsolete after migration

---

## ADR-008: Status Caching Strategy

**Date**: 2026-05-27  
**Status**: Pending Implementation

### Context

Calculating requirement status and tag achievement on every request could be expensive for large projects.

### Decision

- Store calculated `status` and `progress_percent` on `asset_requirements` as cached values
- Recalculate on document status change (event-driven)
- Tag achievement dates are written to `asset_tag_targets.actual_achieved_date` when all requirements for a level are met
- Consider background task for bulk recalculation if needed

### Consequences

- Fast reads for dashboards and reports
- Slight complexity in ensuring cache consistency
- Event-driven updates keep cache fresh without polling

---

## ADR-009: Soft Gate Override Audit Trail

**Date**: 2026-05-27  
**Status**: Accepted

### Context

Level 2B Final CIR (and potentially other gate requirements) can be submitted even when prerequisite requirements are incomplete. This is a business decision — hard blocks are not appropriate — but accountability is required.

### Decision

- When a user proceeds past a soft gate warning, store an immutable `gate_override_acknowledgements` record
- Record captures: who, when, which asset, which document, what was incomplete at the time
- These records cannot be updated or deleted (append-only audit log)
- The `incomplete_requirements` field stores a JSON snapshot of the state at override time

### Consequences

- Full audit trail for compliance and accountability
- No data loss even if requirements are later completed (snapshot preserves point-in-time state)
- UI must present a confirmation dialog that captures the acknowledgement before proceeding

---

## ADR-010: Documents Are Not Inherently Commissioning Evidence

**Date**: 2026-05-27  
**Status**: Accepted

### Context

Not all WIR/MIR/CIR documents are commissioning milestones. Many documents are general QA/QC records (e.g., painting inspection, final cleaning) that have no effect on commissioning progress.

### Decision

- Documents exist independently as QA/QC records
- `document_assets` and `document_requirement_links` are OPTIONAL relationships
- Only documents linked via `document_requirement_links` trigger commissioning status recalculation
- The system never assumes a document is commissioning evidence based on its `document_type` alone
- API validation does not require requirement linkage on document creation
- Frontend forms treat requirement linking as an optional step

### Consequences

- Document creation is simple and fast (no mandatory commissioning context)
- Commissioning linking can happen at creation time or later
- Status recalculation only fires when `document_requirement_links` exist for a document
- Dashboards must filter on linked documents only when calculating commissioning progress
- Reporting can distinguish "all documents" from "commissioning-linked documents"

---

## ADR-011: Requirement Category vs Evidence Document Type

**Date**: 2026-05-27  
**Status**: Accepted

### Context

`requirement_category` and `evidence_document_type` on `RequirementTemplate` appear similar but serve distinct purposes.

### Decision

Both fields are mandatory and non-redundant:

- `requirement_category` — classifies the business nature (fat, delivery, activity, test, integration_test, final_level_test)
- `evidence_document_type` — specifies which document type proves completion (FAT, MIR, WIR, CIR)

### Consequences

- WIR form filters available requirements by `evidence_document_type = 'WIR'`
- CIR form filters by `evidence_document_type = 'CIR'`
- Dashboards can group requirements by category (all activities, all tests)
- Reports can slice by either dimension independently
- Multiple categories can share the same evidence type (both `test` and `integration_test` use CIR)
