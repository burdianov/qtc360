# Implementation Complete — PDF Attachment System

## ✅ What Was Completed

### Backend (100% Complete)
1. ✅ Added `insert_after_page` field to `DocumentAttachment` model
2. ✅ Created migration `7031919285ed_add_insert_after_page_to_attachments.py`
3. ✅ Created `pdf_merge.py` service for merging PDFs at specified positions
4. ✅ Modified `record_response_endpoint` to save returned PDFs as single files (no splitting)
5. ✅ Added endpoint: `POST /documents/{id}/approval-rounds/{round_id}/attachments` (upload with page position)
6. ✅ Added endpoint: `GET /documents/{id}/approval-rounds/{round_id}/bundle` (download merged bundle)
7. ✅ Modified `upload_attachment` endpoint to accept `insert_after_page` parameter
8. ✅ Added endpoint: `GET /documents/{id}/bundle` (download document bundle)

### Frontend Components (100% Complete)
1. ✅ Updated `RecordResponseDialog` message (no longer mentions splitting)
2. ✅ Enhanced `ApprovalRoundsList` with:
   - Download Bundle button
   - Add Attachment button
   - Upload dialog with page position input
3. ✅ Created reusable `DocumentAttachments` component with:
   - Drag-and-drop reordering
   - Add files (multi-select)
   - Delete attachments
   - Edit page position dialog
   - Download bundle button
   - Visual page position indicators

### Form Integration (75% Complete)
1. ✅ **WIR Form** — Fully integrated with new component
2. ✅ **MIR Form** — Fully integrated with new component
3. ✅ **CIR Form** — Fully integrated with new component
4. ⚠️ **FAT Form** — Does not have attachments feature yet (needs to be added separately)

---

## 📋 To Apply Changes

### 1. Run Migration
```bash
cd D:\QTC360\qtc360

# Start PostgreSQL
docker compose up -d

# Run migration
cd backend
uv run alembic upgrade head
```

### 2. Start Services
```bash
# Backend (in backend directory)
uv run uvicorn app.main:app --reload

# Frontend (in new terminal)
cd ../frontend
npm run dev
```

---

## 🎯 How It Works

### Approval Workflow
1. **Record Response**: Upload returned PDF → saved as single file
2. **Add Attachments**: Click "Add Attachment" → upload PDF, set page position (e.g., "2" = after page 3)
3. **Download Bundle**: Click "Download Bundle" → get merged PDF with all attachments

### Document Forms (WIR/MIR/CIR)
1. **Create Document**: Fill form, upload attachments
2. **Set Page Positions**: Click edit icon → set where each attachment should be inserted
3. **Download Bundle**: Click "Download Bundle" → get generated document + attachments merged

---

## 📊 Page Numbering (0-indexed)

| Input | Meaning |
|-------|---------|
| `0` | Insert after **first** page |
| `1` | Insert after **second** page |
| `5` | Insert after **sixth** page |
| Empty | No specific position (not included in bundle) |

---

## 🔧 API Endpoints

### Approval Workflow
```
POST /documents/{id}/approval-rounds
  - Records approver response
  - Saves returned PDF as single file (no splitting)

POST /documents/{id}/approval-rounds/{round_id}/attachments?insert_after_page=N
  - Uploads additional attachment with page position

GET /documents/{id}/approval-rounds/{round_id}/bundle
  - Downloads merged PDF bundle
```

### Document Forms
```
POST /documents/{id}/attachments?insert_after_page=N
  - Uploads attachment with optional page position

GET /documents/{id}/bundle
  - Downloads generated document + attachments merged
```

---

## 📁 Files Changed

### Backend
- `backend/app/models/document_attachment.py`
- `backend/app/api/v1/documents.py`
- `backend/app/services/pdf_merge.py` (NEW)
- `backend/migrations/versions/7031919285ed_*.py` (NEW)

### Frontend
- `frontend/src/components/approval/record-response-dialog.tsx`
- `frontend/src/components/approval/approval-rounds-list.tsx`
- `frontend/src/components/document-attachments.tsx` (NEW)
- `frontend/src/app/(dashboard)/qaqc/wir/new/page.tsx`
- `frontend/src/app/(dashboard)/qaqc/mir/new/page.tsx`
- `frontend/src/app/(dashboard)/qaqc/cir/new/page.tsx`

---

## 📖 Documentation

- `APPROVAL_WORKFLOW_CHANGES.md` — Approval workflow details
- `DOCUMENT_ATTACHMENTS_CHANGES.md` — Document form details
- `COMPLETE_CHANGES_SUMMARY.md` — Complete overview
- `IMPLEMENTATION_COMPLETE.md` — This file

---

## ✨ Key Features

- ✅ No PDF splitting — files stay intact
- ✅ Page position control — insert attachments after specific pages
- ✅ One-click bundle download — merged PDFs
- ✅ Reusable component — consistent UX
- ✅ Backward compatible — old data still works
- ✅ Drag-and-drop reordering
- ✅ Visual indicators for page positions

---

## 🧪 Testing Checklist

### Approval Workflow
- [ ] Record approver response saves PDF as single file
- [ ] Upload additional attachment with page position
- [ ] Download bundle merges PDFs correctly
- [ ] Page positions are respected (0-indexed)
- [ ] Multiple attachments at different positions work

### Document Forms (WIR/MIR/CIR)
- [ ] Upload attachment without page position
- [ ] Upload attachment with page position
- [ ] Edit page position of existing attachment
- [ ] Download bundle generates document + merges attachments
- [ ] Drag-and-drop reorder works
- [ ] Delete attachments works

---

## 🚀 Ready to Use!

All backend and frontend changes are complete. The system is ready for testing and deployment.

**Note**: FAT form does not currently have attachments functionality. If needed, it can be added by following the same pattern used for WIR/MIR/CIR.
