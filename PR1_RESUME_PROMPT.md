# Resume prompt — QTC360 size limits, storage leaks, and page-level PDF assembly

## Context

You are continuing work on the **QTC360** project (workspace `D:\QTC360\qtc360`). The project is a document-management system for QA/QC inspection documents (WIR, MIR, CIR, FAT, CRS) with an approval workflow. Stack: **FastAPI** backend (Python 3.12) + **Next.js 16** frontend (TypeScript, React 19), local-filesystem storage under `uploads/`.

Two big topics were in flight across the last two sessions:

1. **Upload-size limits and storage leaks** — small, contained work, now **PR1 is COMPLETE**.
2. **A page-level PDF assembly system** — large feature, to be done in PR2 (backend) and PR3 (frontend picker UI). This is what you should pick up next.

## What was just finished — PR1 (DONE, do not redo)

The following files were modified in PR1. They are all in git as uncommitted changes:

### Backend (all in `backend/`)
- `app/core/types.py` — bumped `MAX_ATTACHMENT_BYTES` to 50 MB, added `MAX_BUNDLE_BYTES = 50 MB`, added `MAX_HEADER_IMAGE_BYTES = 5 MB`, added `_mb(n)` helper.
- `app/services/pdf_merge.py` — `merge_pdf_bundle()` raises `ValueError("Bundle too large (XMB > 50MB limit)…")` when total input exceeds `MAX_BUNDLE_BYTES`. Caller must translate to HTTP 413.
- `app/api/v1/documents.py` —
  - 6 upload endpoints now use `f"File too large (max {_mb(MAX_ATTACHMENT_BYTES)}MB)"` (was hardcoded "20MB").
  - `download_round_bundle` (line ~1475) wraps `merge_pdf_bundle` in `try/except ValueError → HTTPException(413)`.
  - `download_document_bundle` (line ~1703) wraps `_merge_attachments_with_status` (from `reports.py`) in same try/except.
  - `delete_document` (line ~497) — new helper `_purge_document_storage(db, doc_id)` collects all `DocumentAttachment.storage_path` keys **plus** `DocumentApprovalRound.returned_file_path` and `remarks_file_path`, best-effort `storage.delete`s each. Called on **both** the hard-delete and supersede paths.
  - `delete_attachment` (line ~1681) — captures `storage_path`, commits the soft-delete, then best-effort `storage.delete`s the file.
- `app/api/v1/reports.py` — `_merge_attachments_with_status` now tracks `running_total` and raises `ValueError` if it exceeds `MAX_BUNDLE_BYTES`. The other caller (line ~351) wraps in try/except → HTTP 413.
- `app/api/v1/admin.py` — `upload_crs_header` uses `MAX_HEADER_IMAGE_BYTES` and the `_mb()` helper. Message is now "Image must be under 5MB".

### Frontend (all in `frontend/src/`)
- `lib/constants.ts` — added `MAX_ATTACHMENT_BYTES = 50 MB`, `MAX_BUNDLE_BYTES = 50 MB`, `MAX_HEADER_IMAGE_BYTES = 5 MB` (mirrored from backend).
- `lib/upload.ts` — NEW file. Exports `formatSizeCap(bytes)`, `validateFileSize(file, max, label) → bool` (toasts on fail), `filterBySize(files[], max, label) → File[]` (drops oversized, toasts each).
- `lib/api.ts` — axios instance now has `maxBodyLength: Infinity, maxContentLength: Infinity`.
- `components/document-attachments.tsx` — `handleAddAttachments` uses `filterBySize` for multi-pick; help text shows the cap.
- `components/approval/approval-rounds-list.tsx` — `UploadAttachmentDialog` uses `validateFileSize`; help text shows the cap.
- `components/approval/record-response-dialog.tsx` — `FileInput` uses `validateFileSize`; help text shows the cap.
- `components/approval/add-remarks-dialog.tsx` — `Input` (remarks uploader) uses `validateFileSize`; help text shows the cap.
- `app/(dashboard)/admin/settings/page.tsx` — `CrsHeaderCard.handleUpload` uses `MAX_HEADER_IMAGE_BYTES` and resets `e.target.value` on rejection; help text shows the cap.

### Infra
- `Caddyfile` — `api.qtc360.com` block now has `request_body { max_size 60MB }` (20% headroom over the 50 MB app cap).

### Verification done
- `npx tsc --noEmit` → 0 errors.
- `npm run lint` → 0 errors (19 pre-existing warnings, all in unrelated `qaqc/*/new` pages).
- Smoke test: bundle-guard raises `ValueError` for a 60 MB input.
- `grep "20MB\|2MB"` over backend + frontend returns no stragglers (the magic numbers are gone everywhere).

## Known unrelated diffs in working tree

`git status` shows two unrelated files modified that were **NOT** touched in this PR — they're carry-overs from a previous session, do not touch them:
- `frontend/src/app/(dashboard)/qaqc/fat/new/page.tsx`
- `frontend/src/app/(dashboard)/qaqc/wir/new/page.tsx`

## What you should do next — PR2 (page-level PDF assembly backend)

### Goals
1. No redundant page storage. A page lives in exactly one physical file. Only pointers change.
2. 4 frozen snapshots per document so we can always download any stage:
   - "What we sent to Approver 1" (S1)
   - "Approver 1 response" (raw, as-is)
   - "What we sent to Approver 2" (S2)
   - "Approver 2 response" (raw, as-is)
3. Picker UI: user picks which response pages replace which cover pages, and which response pages to insert where.
4. Locked (passwordless, owner-restricted) PDFs handled — try empty password, else 400.
5. **No legacy data** (user confirmed: clean slate, drop the old `returned_file_path` / `remarks_file_path` columns in this PR, no migration).

### Data model (your design, already agreed)

A `page_bank` is a JSONB array of ordered entries:

```ts
type PageEntry = {
  id: string;              // uuid
  role: "cover_template" | "user_attachment" | "response_replaces" | "response_inserts";
  source: {
    kind: "template" | "attachment" | "response";
    ref: string;           // e.g. "snapshots/S1/template.pdf" or "attachments/{uuid}" or "responses/{round-uuid}"
    page_index: number;    // 0-indexed page within that source
  };
  replaces_entry_id?: string;  // audit trail for response_replaces
};
```

Storage layout per document (new):
- `snapshots/{doc_id}/S1/template.pdf` — rendered cover at submit-time (frozen, never re-rendered even if admin re-uploads template)
- `snapshots/{doc_id}/S2/template.pdf` — same for S2
- `responses/{round-uuid}.pdf` — whole approver response PDF (1 file, sliced on read with PyMuPDF)
- `attachments/{doc_id}/{att-uuid}.pdf` — unchanged from current
- `page_banks/{doc_id}/S1.json` — frozen at submit-to-A1
- `page_banks/{doc_id}/S2.json` — frozen at submit-to-A2
- `page_banks/{doc_id}/working.json` — mutable, current state

A new SQLAlchemy model `DocumentSnapshot` for the frozen rows (so we can list them, know their sequence_no, etc.). The page_bank itself lives as JSONB on that row.

### Endpoints to add

- `GET /documents/{doc_id}/version/submitted-to-approver-1` — render S1 page_bank
- `GET /documents/{doc_id}/version/approver-1-response` — stream raw A1 response PDF
- `GET /documents/{doc_id}/version/submitted-to-approver-2` — render S2 page_bank
- `GET /documents/{doc_id}/version/approver-2-response` — stream raw A2 response PDF
- `POST /documents/{doc_id}/approval-rounds/{round_id}/apply-picks` — body is `PageOp[]`:
  ```ts
  type PageOp =
    | { op: "replace"; target_position: number; source_page_index: number }
    | { op: "insert"; after_position: number; source_page_index: number };
  ```
  Server validates that `source_page_index < response_page_count` and applies them to `working.json`.
- The existing `record-response` upload endpoint continues to accept the full PDF, but writes to `responses/{round-uuid}.pdf` and also pre-extracts text via the existing `extract_region_text` flow (no change there).

### Locked-PDF helper

New `app/services/pdf_unlock.py`:
```python
def ensure_unlocked(data: bytes) -> bytes:
    """If data is encrypted with an empty (owner-only) password, decrypt it.
    Otherwise raise ValueError("PDF is password-protected")."""
```
Used by all response/remarks upload endpoints and by the new picker pre-extract.

### Render helper

New `app/services/page_assembler.py`:
- `render_page_bank(page_bank: list[PageEntry]) -> bytes` — walks the entries, slices the source PDFs with PyMuPDF (`doc.load_page(i)`), assembles a `pypdf.PdfWriter`, returns bytes.
- Enforces the existing `MAX_BUNDLE_BYTES` guard from PR1 (it already lives in `pdf_merge.py` — reuse it or factor out).

### Migration / cleanup

- Alembic migration: drop the legacy columns `document_approval_rounds.returned_file_path` and `.remarks_file_path` (user confirmed no data to preserve). The `DocumentAttachment` model also has a `returned_file_path` semantic for `kind="returned_pdf"` — the file is the response, not a copy.
- Delete the legacy storage paths during the migration (no-op since there's no data).
- Remove the now-redundant code in `documents.py` that wrote to those old paths.

### Files to create

- `backend/app/services/pdf_unlock.py`
- `backend/app/services/page_assembler.py`
- `backend/app/models/document_snapshot.py`
- `backend/app/schemas/page_bank.py` (Pydantic for the PageEntry / PageOp types)
- `backend/app/api/v1/snapshots.py` (or extend `documents.py` — your call)
- `backend/migrations/versions/<ts>_page_bank_snapshots.py`

### Files to modify

- `backend/app/models/document.py` — relationship to snapshots.
- `backend/app/api/v1/documents.py` — add the version endpoints; update `record_response_endpoint` to write to `responses/{uuid}.pdf` and trigger snapshot freeze on submit-to-approver.
- `backend/app/api/v1/admin.py` — same header-image flow, no change.
- `backend/app/core/types.py` — add `MAX_PAGES_PER_DOCUMENT = 500` or similar if needed.

### Verification

- All upload tests still pass.
- New endpoint tests: S1 renders = N pages; after A1 response with 1 replace + 1 insert, working.json has N+1 entries; S2 download renders correctly.
- `git grep "returned_file_path\|remarks_file_path"` returns 0 references.
- Bundle size guard still works (re-test from PR1).

## What comes after PR2 — PR3 (picker UI)

The user already approved the wireframe (side-by-side thumbnails, mode toggle for Replace/Insert). PR3:
- `frontend/src/components/approval/page-picker.tsx` (new) — left: response thumbnails, right: current doc thumbnails, mode toggle.
- Integrate into `record-response-dialog.tsx` after upload: show the picker, on Apply call `POST /apply-picks`, refresh.
- Replace the 4 "Download Bundle" buttons in `approval-rounds-list.tsx` and `document-attachments.tsx` with a single dropdown that lists all 4 versions and the current working state.

## What NOT to do
- Don't redo any of PR1. The constants, guards, and storage-leak fixes are stable.
- Don't migrate old `returned.pdf` files — user explicitly said no legacy data, clean slate.
- Don't build undo for picker decisions. Re-record the same response and re-pick if needed.

## Quick reference: file paths you'll need

```
D:\QTC360\qtc360\backend\app\core\types.py
D:\QTC360\qtc360\backend\app\services\pdf_merge.py
D:\QTC360\qtc360\backend\app\services\pdf.py             # has split_returned_pdf
D:\QTC360\qtc360\backend\app\services\pdf_unlock.py        # NEW
D:\QTC360\qtc360\backend\app\services\page_assembler.py   # NEW
D:\QTC360\qtc360\backend\app\services\approval.py
D:\QTC360\qtc360\backend\app\api\v1\documents.py
D:\QTC360\qtc360\backend\app\api\v1\reports.py
D:\QTC360\qtc360\backend\app\api\v1\admin.py
D:\QTC360\qtc360\backend\app\models\document.py
D:\QTC360\qtc360\backend\app\models\document_approval_round.py
D:\QTC360\qtc360\backend\app\models\document_attachment.py
D:\QTC360\qtc360\backend\app\models\document_snapshot.py   # NEW
D:\QTC360\qtc360\backend\app\schemas\page_bank.py          # NEW
D:\QTC360\qtc360\backend\migrations\versions\
D:\QTC360\qtc360\frontend\src\lib\constants.ts
D:\QTC360\qtc360\frontend\src\lib\upload.ts
D:\QTC360\qtc360\frontend\src\lib\api.ts
D:\QTC360\qtc360\frontend\src\components\approval\pdf-region-picker.tsx   # visual reference for thumbnail rendering
D:\QTC360\qtc360\frontend\src\components\approval\approval-rounds-list.tsx
D:\QTC360\qtc360\frontend\src\components\approval\record-response-dialog.tsx
D:\QTC360\qtc360\frontend\src\components\document-attachments.tsx
```

## Verification commands

```bash
# Backend imports + bundle guard
& "D:\QTC360\qtc360\backend\.venv\Scripts\python.exe" -c "
from app.core.types import MAX_ATTACHMENT_BYTES, MAX_BUNDLE_BYTES, MAX_HEADER_IMAGE_BYTES
from app.services.pdf_merge import merge_pdf_bundle
print(MAX_ATTACHMENT_BYTES, MAX_BUNDLE_BYTES, MAX_HEADER_IMAGE_BYTES)
"

# Frontend typecheck + lint
npx tsc --noEmit
npm run lint
```

Good luck with PR2. Start by reading the existing `record_response_endpoint` and `submit_to_approver` to anchor the snapshot-freeze points, then draft the new `DocumentSnapshot` model + Alembic migration. Build bottom-up.
