# Complete PDF Attachment System Changes — Summary

## Overview

Implemented a comprehensive "no-split, insert-at-position" PDF attachment system across the entire QTC360 application. Users can now upload PDF attachments, specify where they should be inserted (by page number), and download complete merged bundles.

---

## What Was Changed

### 1. Approval Workflow (Approver Response PDFs)
**When**: Recording responses from external approvers (Aconex workflow)

**Before**:
- Returned PDF was split into cover + individual page attachments
- Each page became a separate file
- No way to add additional attachments

**After**:
- Returned PDF saved as single file (no splitting)
- Users can upload additional attachments separately
- Each attachment specifies insertion position (page number)
- "Download Bundle" merges everything in correct order

**Files Changed**:
- `backend/app/models/document_attachment.py` — Added `insert_after_page` field
- `backend/app/api/v1/documents.py` — Modified `record_response_endpoint`, added 2 endpoints
- `backend/app/services/pdf_merge.py` — NEW merge service
- `backend/migrations/versions/7031919285ed_*.py` — NEW migration
- `frontend/src/components/approval/record-response-dialog.tsx` — Updated message
- `frontend/src/components/approval/approval-rounds-list.tsx` — Added buttons & upload dialog

**Endpoints**:
```
POST /documents/{id}/approval-rounds/{round_id}/attachments?insert_after_page=N
GET  /documents/{id}/approval-rounds/{round_id}/bundle
```

---

### 2. Document Forms (WIR/MIR/CIR/FAT Attachments)
**When**: Creating/editing documents, uploading supporting files

**Before**:
- Attachments uploaded as individual files
- No control over insertion position
- No merged bundle download

**After**:
- Attachments can have page positions set
- "Download Bundle" generates document PDF + merges attachments
- Reusable component for all document types

**Files Changed**:
- `backend/app/api/v1/documents.py` — Modified `upload_attachment`, added bundle endpoint
- `frontend/src/components/document-attachments.tsx` — NEW reusable component

**Endpoints**:
```
POST /documents/{id}/attachments?insert_after_page=N
GET  /documents/{id}/bundle
```

---

## Database Schema

**Migration**: `7031919285ed_add_insert_after_page_to_attachments.py`

Added to `document_attachments` table:
```sql
ALTER TABLE document_attachments 
ADD COLUMN insert_after_page INTEGER NULL;
```

---

## Backend Services

### PDF Merge Service
**File**: `backend/app/services/pdf_merge.py`

```python
def merge_pdf_bundle(
    returned_pdf_bytes: bytes,
    attachments: list[tuple[bytes, int]]
) -> bytes
```

- Takes main PDF + list of (attachment_bytes, insert_after_page)
- Sorts attachments by page position
- Inserts each attachment after specified page
- Returns merged PDF bytes

---

## Frontend Components

### 1. Approval Rounds List
**File**: `frontend/src/components/approval/approval-rounds-list.tsx`

Features:
- **Download Bundle** button per round
- **Add Attachment** button opens upload dialog
- Upload dialog with file picker + page position input
- Shows existing attachments with positions

### 2. Document Attachments Component
**File**: `frontend/src/components/document-attachments.tsx`

Reusable component with:
- Drag-and-drop reordering
- Add files (multi-select)
- Delete attachments
- Edit page position (dialog)
- Download bundle button
- Visual indicators for page positions

Props:
```typescript
<DocumentAttachments
  documentId={editId}
  attachments={attachments}
  onAttachmentsChange={setAttachments}
  onDirtyChange={() => setIsDirty(true)}
  showPagePosition={true}
  showDownloadBundle={true}
/>
```

---

## Attachment Kinds

| Kind | Description | Used In |
|------|-------------|---------|
| `returned_pdf` | Complete returned PDF from approver (not split) | Approval workflow |
| `user_attachment` | Additional PDF uploaded to approval round | Approval workflow |
| `user` | Regular document attachment | WIR/MIR/CIR/FAT forms |
| `cover` | **DEPRECATED** — Previously split cover pages | Legacy |
| `response_attachment` | **DEPRECATED** — Previously split pages | Legacy |

---

## API Endpoints Summary

### Approval Workflow
```bash
# Submit to approver (no change)
POST /documents/{id}/submit-to-approver

# Record response (modified - no longer splits PDF)
POST /documents/{id}/approval-rounds
  Query: approver_order, decision_status_id, signatory_name, response_date, comments
  Body: multipart/form-data with returned PDF

# Upload additional attachment to round
POST /documents/{id}/approval-rounds/{round_id}/attachments
  Query: insert_after_page (0-indexed)
  Body: multipart/form-data with PDF

# Download merged bundle for round
GET /documents/{id}/approval-rounds/{round_id}/bundle
  Returns: Complete merged PDF
```

### Document Forms
```bash
# Upload attachment (modified - added page position)
POST /documents/{id}/attachments
  Query: insert_after_page (optional, 0-indexed)
  Body: multipart/form-data with file

# Download merged bundle for document
GET /documents/{id}/bundle
  Returns: Generated document PDF + attachments merged
```

---

## Integration Guide

### For WIR/MIR/CIR/FAT Forms

1. **Import component**:
```typescript
import { DocumentAttachments } from "@/components/document-attachments";
```

2. **Update attachment state**:
```typescript
const [attachments, setAttachments] = useState<{
  id?: string;
  file?: File;
  name: string;
  size: number;
  isExisting?: boolean;
  insert_after_page?: number | null;
}[]>([]);
```

3. **Replace existing attachment UI**:
```tsx
<DocumentAttachments
  documentId={editId || undefined}
  attachments={attachments}
  onAttachmentsChange={setAttachments}
  onDirtyChange={() => setIsDirty(true)}
  showPagePosition={true}
  showDownloadBundle={true}
/>
```

4. **Update upload logic** to include page position:
```typescript
for (const att of attachments.filter((a) => !a.isExisting && a.file)) {
  const fd = new FormData();
  fd.append("file", att.file);
  const params = att.insert_after_page !== undefined && att.insert_after_page !== null
    ? `?insert_after_page=${att.insert_after_page}`
    : "";
  await api.post(`/documents/${docId}/attachments${params}`, fd, {
    headers: { "Content-Type": "multipart/form-data" },
  });
}
```

---

## Page Numbering

**IMPORTANT**: All page numbers are **0-indexed**

| User Input | Meaning |
|------------|---------|
| `0` | Insert after the **first** page |
| `1` | Insert after the **second** page |
| `5` | Insert after the **sixth** page |
| Empty/null | No specific position (not included in bundle) |

---

## Usage Examples

### Approval Workflow
1. Record approver response → Upload returned PDF (saved as single file)
2. Click "Add Attachment" → Upload additional PDF, set position (e.g., "2" = after page 3)
3. Click "Download Bundle" → Get merged PDF with all attachments

### Document Forms (WIR/MIR/CIR/FAT)
1. Create document → Upload attachments
2. Click edit icon next to attachment → Set page position
3. Save document
4. Click "Download Bundle" → Get generated document + attachments merged

---

## Migration Steps

1. **Start PostgreSQL**:
```bash
cd D:\QTC360\qtc360
docker compose up -d
```

2. **Run Migration**:
```bash
cd backend
uv run alembic upgrade head
```

3. **Start Backend**:
```bash
uv run uvicorn app.main:app --reload
```

4. **Start Frontend**:
```bash
cd ../frontend
npm run dev
```

5. **Integrate Component** (optional, for immediate use):
   - Update WIR form: `frontend/src/app/(dashboard)/qaqc/wir/new/page.tsx`
   - Update MIR form: `frontend/src/app/(dashboard)/qaqc/mir/new/page.tsx`
   - Update CIR form: `frontend/src/app/(dashboard)/qaqc/cir/new/page.tsx`
   - Update FAT form: `frontend/src/app/(dashboard)/qaqc/fat/new/page.tsx`

---

## Testing Checklist

### Approval Workflow
- [ ] Record approver response saves PDF as single file (not split)
- [ ] Upload additional attachment with page position
- [ ] Download bundle merges PDFs correctly
- [ ] Page positions are respected (0-indexed)
- [ ] Multiple attachments at different positions work
- [ ] Bundle download with no attachments returns returned PDF

### Document Forms
- [ ] Upload attachment without page position works
- [ ] Upload attachment with page position
- [ ] Edit page position of existing attachment
- [ ] Remove page position (set to empty)
- [ ] Download bundle generates document + merges attachments
- [ ] Drag-and-drop reorder works
- [ ] Delete attachments works
- [ ] Only PDF attachments with positions are included in bundle

---

## Documentation Files

- `APPROVAL_WORKFLOW_CHANGES.md` — Detailed approval workflow changes
- `DOCUMENT_ATTACHMENTS_CHANGES.md` — Detailed document form changes
- `COMPLETE_CHANGES_SUMMARY.md` — This file (complete overview)

---

## Key Benefits

1. **No More Splitting** — PDFs stay intact, easier to manage
2. **Flexible Insertion** — Control exactly where attachments go
3. **Complete Bundles** — One-click download of merged documents
4. **Reusable Component** — Consistent UX across all forms
5. **Backward Compatible** — Old attachments still work
6. **0-indexed Clarity** — Clear page numbering system

---

## Notes

- The old `split_returned_pdf()` function is no longer used but kept for reference
- `cover_page_count` field is no longer used for splitting but kept for backward compatibility
- Only PDF attachments with `insert_after_page` set are included in bundles
- Image attachments (PNG, JPG) can be uploaded but won't be merged into bundles
- Existing approval rounds with split attachments will continue to work (legacy data)
- The merge algorithm handles edge cases (missing files, invalid paths, etc.)
