# Document Attachments Changes — WIR/MIR/CIR/FAT

## Summary

Extended the "no-split, insert-at-position" attachment functionality to regular document forms (WIR, MIR, CIR, FAT). Users can now specify where each attachment should be inserted in the final PDF and download a merged bundle.

---

## Changes Made

### 1. Backend API Changes

**File**: `backend/app/api/v1/documents.py`

#### Modified: `upload_attachment` endpoint
- Added optional `insert_after_page` query parameter (0-indexed)
- Stores page position in `DocumentAttachment.insert_after_page`
- Returns `insert_after_page` in response

```python
POST /documents/{doc_id}/attachments?insert_after_page=2
```

#### New Endpoint: Download Document Bundle
```python
GET /documents/{doc_id}/bundle
```
- Generates the document PDF (WIR/MIR/CIR/FAT)
- Loads all user attachments with `insert_after_page` set
- Merges them using `merge_pdf_bundle()` service
- Returns complete merged PDF
- If no attachments with positions, returns generated PDF as-is

---

### 2. Frontend Component

**File**: `frontend/src/components/document-attachments.tsx` (NEW)

Reusable component for managing document attachments with features:
- **Drag-and-drop reordering** — Visual reordering of attachments
- **Add files** — Multi-file upload (PDF, PNG, JPG)
- **Delete attachments** — Remove with confirmation
- **Edit page position** — Dialog to set `insert_after_page` for each attachment
- **Download bundle** — Button to download merged PDF with all attachments
- **File size display** — Shows size in KB
- **Page position indicator** — Shows "Insert after page X" when set

Props:
```typescript
interface Props {
  documentId?: string;                    // Document ID (for API calls)
  attachments: Attachment[];              // Current attachments
  onAttachmentsChange: (att[]) => void;   // Callback when attachments change
  onDirtyChange?: () => void;             // Mark form as dirty
  showPagePosition?: boolean;             // Show page position controls
  showDownloadBundle?: boolean;           // Show download bundle button
}
```

---

### 3. Integration with Forms

The component can be integrated into WIR/MIR/CIR/FAT forms by:

1. **Import the component**:
```typescript
import { DocumentAttachments } from "@/components/document-attachments";
```

2. **Replace existing attachment UI** with:
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

3. **Update attachment state type** to include `insert_after_page`:
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

4. **Update upload logic** to include page position:
```typescript
// When uploading new attachments
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

## Usage Flow

### Setting Page Positions

1. User uploads attachments to WIR/MIR/CIR/FAT form
2. Clicks **Edit** (pencil icon) next to an attachment
3. Dialog opens with page position input
4. Enters page number (0-indexed): `0` = after first page, `1` = after second page, etc.
5. Can leave empty for no specific position
6. Clicks **Save**
7. Attachment shows "Insert after page X" indicator

### Downloading Bundle

1. User completes and saves the document
2. Clicks **Download Bundle** button
3. System:
   - Generates the document PDF (WIR/MIR/CIR/FAT template filled with data)
   - Loads all attachments with `insert_after_page` set
   - Merges them at specified positions
   - Downloads as `{reference_no}_Bundle.pdf`

---

## API Examples

### Upload Attachment with Page Position
```bash
curl -X POST \
  "http://localhost:8000/api/v1/documents/{doc_id}/attachments?insert_after_page=2" \
  -H "Authorization: Bearer {token}" \
  -F "file=@attachment.pdf"
```

### Download Document Bundle
```bash
curl -X GET \
  "http://localhost:8000/api/v1/documents/{doc_id}/bundle" \
  -H "Authorization: Bearer {token}" \
  -o bundle.pdf
```

---

## Differences from Approval Round Attachments

| Feature | Approval Round Attachments | Document Attachments |
|---------|---------------------------|---------------------|
| **Source PDF** | Returned PDF from approver | Generated document PDF (from template) |
| **Attachment Kind** | `user_attachment` | `user` |
| **Upload Endpoint** | `/documents/{id}/approval-rounds/{round_id}/attachments` | `/documents/{id}/attachments` |
| **Bundle Endpoint** | `/documents/{id}/approval-rounds/{round_id}/bundle` | `/documents/{id}/bundle` |
| **When Used** | After receiving approver response | During document creation/editing |
| **UI Location** | Approval rounds list (collapsible sections) | Document form (attachments section) |

---

## Files Modified/Created

### Backend
- `backend/app/api/v1/documents.py` — Modified `upload_attachment`, added `download_document_bundle` endpoint

### Frontend
- `frontend/src/components/document-attachments.tsx` — NEW reusable component

### To Be Integrated (Next Steps)
- `frontend/src/app/(dashboard)/qaqc/wir/new/page.tsx` — Replace attachment UI
- `frontend/src/app/(dashboard)/qaqc/mir/new/page.tsx` — Replace attachment UI
- `frontend/src/app/(dashboard)/qaqc/cir/new/page.tsx` — Replace attachment UI
- `frontend/src/app/(dashboard)/qaqc/fat/new/page.tsx` — Replace attachment UI

---

## Testing Checklist

- [ ] Upload attachment without page position (should work as before)
- [ ] Upload attachment with page position
- [ ] Edit page position of existing attachment
- [ ] Remove page position (set to empty)
- [ ] Download bundle with no attachments (returns generated PDF)
- [ ] Download bundle with attachments at various positions
- [ ] Verify page positions are respected (0-indexed)
- [ ] Drag-and-drop reorder attachments
- [ ] Delete attachments
- [ ] Bundle includes only PDF attachments with positions set
- [ ] Image attachments without positions are excluded from bundle

---

## Notes

- Only **PDF attachments** with `insert_after_page` set are included in the bundle
- Image attachments (PNG, JPG) are still uploaded but not merged into the bundle
- The generated document PDF is the base, attachments are inserted at specified positions
- Page numbering is **0-indexed** (0 = after first page)
- If multiple attachments have the same `insert_after_page`, they're inserted in `sort_order`
- The component handles both new uploads and existing attachments
- Drag-and-drop reordering updates `sort_order` but doesn't affect page positions
