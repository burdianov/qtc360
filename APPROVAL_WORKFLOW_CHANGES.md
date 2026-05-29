# Approval Workflow Changes — No PDF Splitting

## Summary

Modified the external approval workflow to **stop splitting returned PDFs** into individual pages. Instead:
- The returned PDF is saved as a single file
- Users can upload additional attachments separately
- Each attachment specifies where it should be inserted (after which page)
- A new endpoint generates a merged PDF bundle with all attachments in the correct order

---

## Changes Made

### 1. Database Schema

**File**: `backend/app/models/document_attachment.py`
- Added `insert_after_page: Mapped[int | None]` field to track insertion position

**Migration**: `backend/migrations/versions/7031919285ed_add_insert_after_page_to_attachments.py`
- Adds `insert_after_page` column to `document_attachments` table
- Run with: `cd backend && uv run alembic upgrade head`

---

### 2. Backend Services

#### New PDF Merge Service
**File**: `backend/app/services/pdf_merge.py` (NEW)
- `merge_pdf_bundle(returned_pdf_bytes, attachments)` — Merges the returned PDF with additional attachments at specified page positions
- Attachments are sorted by `insert_after_page` and inserted in the correct order
- Uses `pypdf` library for PDF manipulation

---

### 3. Backend API Changes

**File**: `backend/app/api/v1/documents.py`

#### Modified: `record_response_endpoint` (line ~624)
**Before**: Split returned PDF into cover + individual page attachments
**After**: Save returned PDF as a single attachment with `kind="returned_pdf"`

Changes:
- Removed call to `split_returned_pdf()`
- Removed loop creating individual page attachments
- Now creates single `DocumentAttachment` with `kind="returned_pdf"`

#### New Endpoint: Upload Additional Attachment
```
POST /documents/{doc_id}/approval-rounds/{round_id}/attachments
Query params: insert_after_page (int, 0-indexed)
Body: multipart/form-data with PDF file
```
- Uploads a PDF attachment to a specific approval round
- Stores `insert_after_page` value for later merging
- Creates `DocumentAttachment` with `kind="user_attachment"`

#### New Endpoint: Download Merged Bundle
```
GET /documents/{doc_id}/approval-rounds/{round_id}/bundle
```
- Retrieves the returned PDF and all user attachments for the round
- Merges them using `merge_pdf_bundle()` service
- Returns the complete merged PDF for download
- If no attachments exist, returns the returned PDF as-is

---

### 4. Frontend Changes

#### Modified: RecordResponseDialog
**File**: `frontend/src/components/approval/record-response-dialog.tsx` (line ~210)

Changed footer message:
- **Before**: "File splits into cover + per-page attachments on save."
- **After**: "PDF will be saved as a single file. You can add attachments later."

#### Modified: ApprovalRoundsList
**File**: `frontend/src/components/approval/approval-rounds-list.tsx`

Added new functionality:
1. **Download Bundle Button** — Downloads the complete merged PDF bundle
2. **Add Attachment Button** — Opens dialog to upload additional attachments
3. **UploadAttachmentDialog Component** (NEW) — Modal for uploading attachments with page position selector

Features:
- File picker for PDF attachments
- Input field for `insert_after_page` (0-indexed)
- Explanation text: "Page numbers are 0-indexed. Enter 0 to insert after the first page, 1 for after the second page, etc."
- Upload mutation with error handling
- Invalidates document query on success to refresh UI

---

## Attachment Kinds

The system now uses these `kind` values for `DocumentAttachment`:

| Kind | Description |
|------|-------------|
| `returned_pdf` | The complete returned PDF from approver (not split) |
| `user_attachment` | Additional PDF uploaded by user with `insert_after_page` |
| `user` | Regular document attachments (not related to approval rounds) |
| `cover` | **DEPRECATED** — Previously used for split cover pages |
| `response_attachment` | **DEPRECATED** — Previously used for split individual pages |

---

## Migration Path

### For Existing Data
Existing approval rounds that were created with the old splitting logic will have:
- `kind="cover"` — The cover pages
- `kind="response_attachment"` — Individual page attachments

These will continue to work but won't have the merge functionality. The new workflow only applies to approval rounds created after this change.

### To Apply Changes

1. **Start PostgreSQL**:
   ```bash
   cd D:\QTC360\qtc360
   docker compose up -d
   ```

2. **Run Migration**:
   ```bash
   cd D:\QTC360\qtc360\backend
   uv run alembic upgrade head
   ```

3. **Start Backend**:
   ```bash
   cd D:\QTC360\qtc360\backend
   uv run uvicorn app.main:app --reload
   ```

4. **Start Frontend**:
   ```bash
   cd D:\QTC360\qtc360\frontend
   npm run dev
   ```

---

## Usage Flow

### Recording an Approver Response (New Workflow)

1. User clicks **"Record Approver N Response"**
2. Uploads the returned PDF from Aconex
3. Uses OCR region capture to extract signatory, date, comments
4. Selects decision status (A/B/C/D)
5. Clicks **"Save response"**
   - PDF is saved as a single file (not split)
   - Status message: "PDF will be saved as a single file. You can add attachments later."

### Adding Additional Attachments

1. In the approval rounds list, expand the round
2. Click **"Add Attachment"** button
3. Select a PDF file
4. Enter the page number after which to insert (0-indexed)
   - Example: Enter `0` to insert after the first page
   - Example: Enter `5` to insert after the sixth page
5. Click **"Upload"**
6. Attachment is stored with `insert_after_page` value

### Downloading the Complete Bundle

1. In the approval rounds list, expand the round
2. Click **"Download Bundle"** button
3. System merges:
   - The returned PDF (main document)
   - All user attachments at their specified positions
4. Downloads as `Approver_N_Bundle.pdf`

---

## Technical Details

### Page Numbering
- All page numbers are **0-indexed**
- `insert_after_page = 0` means "insert after the first page"
- `insert_after_page = 5` means "insert after the sixth page"

### Merge Algorithm
1. Load the returned PDF
2. Load all user attachments for the round
3. Sort attachments by `insert_after_page` (ascending)
4. Iterate through returned PDF pages:
   - Add each page from returned PDF
   - After each page, check if any attachments should be inserted
   - Insert all pages from matching attachments
5. Add any remaining attachments at the end

### File Storage
```
uploads/
  approval-rounds/
    {round_id}/
      returned.pdf              # The complete returned PDF
      attachments/
        {uuid}.pdf              # User-uploaded attachments
```

---

## API Examples

### Upload Attachment
```bash
curl -X POST \
  "http://localhost:8000/api/v1/documents/{doc_id}/approval-rounds/{round_id}/attachments?insert_after_page=2" \
  -H "Authorization: Bearer {token}" \
  -F "file=@attachment.pdf"
```

### Download Bundle
```bash
curl -X GET \
  "http://localhost:8000/api/v1/documents/{doc_id}/approval-rounds/{round_id}/bundle" \
  -H "Authorization: Bearer {token}" \
  -o bundle.pdf
```

---

## Testing Checklist

- [ ] Database migration runs successfully
- [ ] Record approver response saves PDF as single file
- [ ] Upload additional attachment with page position
- [ ] Download bundle merges PDFs correctly
- [ ] Page positions are respected (0-indexed)
- [ ] Multiple attachments at different positions work
- [ ] Bundle download works with no attachments (returns returned PDF)
- [ ] UI buttons appear in approval rounds list
- [ ] Upload dialog validates PDF files only
- [ ] Error handling works for missing files

---

## Files Modified

### Backend
- `backend/app/models/document_attachment.py` — Added `insert_after_page` field
- `backend/app/api/v1/documents.py` — Modified `record_response_endpoint`, added 2 new endpoints
- `backend/app/services/pdf_merge.py` — NEW file with merge logic
- `backend/migrations/versions/7031919285ed_add_insert_after_page_to_attachments.py` — NEW migration

### Frontend
- `frontend/src/components/approval/record-response-dialog.tsx` — Updated message
- `frontend/src/components/approval/approval-rounds-list.tsx` — Added buttons and upload dialog

---

## Notes

- The old `split_returned_pdf()` function in `backend/app/services/pdf.py` is no longer used but kept for reference
- The `cover_page_count` field on documents is no longer used for splitting but kept for backward compatibility
- Template locking logic remains unchanged (still snapshots template at submission time)
- OCR region capture functionality is unchanged
