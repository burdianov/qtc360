"""Checklist API endpoints — master items CRUD + document checklist operations."""

import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel as PydanticBase
from sqlalchemy import delete, select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.deps import assert_user_in_project, get_current_user, require_permission
from app.core.types import AttachmentKind
from app.models.checklist import (
    ChecklistItem,
    DocumentChecklist,
    DocumentChecklistResponse,
)
from app.models.commissioning import RequirementTemplate
from app.models.document import Document
from app.models.document_attachment import DocumentAttachment
from app.models.user import User
from app.services.storage import storage

# Checklist signature marker. Must match the string written into the
# fillable XLSX template (see ``signer_sign`` below). The main report
# generator uses ``SIGMARK1``/``SIGMARK2``; checklist templates use
# ``__SIG1__`` because they are XLSX (not DOCX) and the two rendering
# pipelines redact the marker independently. If you change this string,
# also update the corresponding placeholder in the XLSX checklist
# template stored under ``uploads/templates/`` (search for __SIG1__).
CHECKLIST_SIG_MARKER = "__SIG1__"

router = APIRouter(prefix="/checklists", tags=["checklists"])


# ─── Schemas ─────────────────────────────────────────────────────────────────


class ChecklistItemOut(PydanticBase):
    id: uuid.UUID
    requirement_template_id: uuid.UUID
    text: str
    sort_order: int

    model_config = {"from_attributes": True}


class ChecklistItemCreate(PydanticBase):
    text: str
    sort_order: int = 0


class ChecklistItemBulk(PydanticBase):
    items: list[ChecklistItemCreate]


class ReorderItem(PydanticBase):
    id: uuid.UUID
    sort_order: int


class ReorderRequest(PydanticBase):
    items: list[ReorderItem]


class ChecklistResponseIn(PydanticBase):
    checklist_item_id: uuid.UUID
    response: str  # yes, no, na
    notes: str | None = None
    display_order: int
    item_text: str


class DocumentChecklistSave(PydanticBase):
    document_id: uuid.UUID
    requirement_template_id: uuid.UUID
    responses: list[ChecklistResponseIn]
    comments: str | None = None


class ChecklistResponseOut(PydanticBase):
    id: uuid.UUID
    checklist_item_id: uuid.UUID
    response: str
    notes: str | None = None
    display_order: int
    item_text: str

    model_config = {"from_attributes": True}


class DocumentChecklistOut(PydanticBase):
    id: uuid.UUID
    document_id: uuid.UUID
    requirement_template_id: uuid.UUID
    comments: str | None
    sort_order: int
    attachment_id: uuid.UUID | None
    responses: list[ChecklistResponseOut]

    model_config = {"from_attributes": True}


# ─── Master Checklist Items (per RequirementTemplate) ────────────────────────


@router.get("/templates/{template_id}/items", response_model=list[ChecklistItemOut])
async def list_checklist_items(
    template_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(ChecklistItem)
        .where(
            ChecklistItem.requirement_template_id == template_id,
            ChecklistItem.is_deleted == False, )  # noqa: E712
        .order_by(ChecklistItem.sort_order)
    )
    return result.scalars().all()


@router.post(
    "/templates/{template_id}/items",
    response_model=list[ChecklistItemOut],
    status_code=201,
)
async def bulk_create_checklist_items(
    template_id: uuid.UUID,
    body: ChecklistItemBulk,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("commissioning.manage")),
):
    # Verify template exists
    tmpl = await db.get(RequirementTemplate, template_id)
    if not tmpl or tmpl.is_deleted:
        raise HTTPException(status_code=404, detail="Requirement template not found")

    created = []
    for item in body.items:
        obj = ChecklistItem(
            requirement_template_id=template_id,
            text=item.text,
            sort_order=item.sort_order,
        )
        db.add(obj)
        created.append(obj)
    await db.commit()
    for obj in created:
        await db.refresh(obj)
    return created


@router.patch("/items/{item_id}", response_model=ChecklistItemOut)
async def update_checklist_item(
    item_id: uuid.UUID,
    body: ChecklistItemCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("commissioning.manage")),
):
    item = await db.get(ChecklistItem, item_id)
    if not item or item.is_deleted:
        raise HTTPException(status_code=404, detail="Checklist item not found")
    item.text = body.text
    item.sort_order = body.sort_order
    await db.commit()
    await db.refresh(item)
    return item


@router.delete("/items/{item_id}", status_code=204)
async def delete_checklist_item(
    item_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("commissioning.manage")),
):
    item = await db.get(ChecklistItem, item_id)
    if not item or item.is_deleted:
        raise HTTPException(status_code=404, detail="Checklist item not found")
    item.is_deleted = True
    await db.commit()


@router.put("/templates/{template_id}/reorder", status_code=204)
async def reorder_checklist_items(
    template_id: uuid.UUID,
    body: ReorderRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("commissioning.manage")),
):
    for entry in body.items:
        item = await db.get(ChecklistItem, entry.id)
        if item and not item.is_deleted and item.requirement_template_id == template_id:
            item.sort_order = entry.sort_order
    await db.commit()


# ─── Document Checklist (filled per document) ────────────────────────────────


@router.get("/documents/{document_id}", response_model=list[DocumentChecklistOut])
async def list_document_checklists(
    document_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(DocumentChecklist)
        .where(
            DocumentChecklist.document_id == document_id,
            DocumentChecklist.is_deleted == False, )  # noqa: E712
        .options(selectinload(DocumentChecklist.responses))
        .order_by(DocumentChecklist.sort_order)
    )
    return result.scalars().all()


@router.post("/documents", response_model=DocumentChecklistOut, status_code=201)
async def save_document_checklist(
    body: DocumentChecklistSave,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("documents.edit")),
):
    # Verify document
    doc = await db.get(Document, body.document_id)
    if not doc or doc.is_deleted:
        raise HTTPException(status_code=404, detail="Document not found")
    await assert_user_in_project(user, doc.project_id)

    # Check if checklist already exists for this doc+requirement
    existing = (
        await db.execute(
            select(DocumentChecklist).where(
                DocumentChecklist.document_id == body.document_id,
                DocumentChecklist.requirement_template_id
                == body.requirement_template_id,
                DocumentChecklist.is_deleted == False, )  # noqa: E712
        )
    ).scalar_one_or_none()

    if existing:
        # Delete old responses and update
        await db.execute(
            delete(DocumentChecklistResponse).where(
                DocumentChecklistResponse.checklist_id == existing.id
            )
        )
        existing.comments = body.comments
        checklist = existing
    else:
        # Determine sort_order (next position)
        count_res = await db.execute(
            select(func.count())
            .select_from(DocumentChecklist)
            .where(
                DocumentChecklist.document_id == body.document_id,
                DocumentChecklist.is_deleted == False, )  # noqa: E712
        )
        sort_order = count_res.scalar() or 0
        checklist = DocumentChecklist(
            document_id=body.document_id,
            requirement_template_id=body.requirement_template_id,
            comments=body.comments,
            sort_order=sort_order,
        )
        db.add(checklist)
        await db.flush()

    # Add responses
    for r in body.responses:
        resp = DocumentChecklistResponse(
            checklist_id=checklist.id,
            checklist_item_id=r.checklist_item_id,
            response=r.response,
            notes=r.notes,
            display_order=r.display_order,
            item_text=r.item_text,
        )
        db.add(resp)

    await db.commit()

    # Only generate PDF if there are actual filled responses.
    # Empty checklists (just added, no data) should not produce attachments.
    has_filled = any(r.response or (r.notes or "").strip() for r in body.responses)
    if has_filled:
        background_tasks.add_task(_generate_checklist_pdf_background, checklist.id)
    elif checklist.attachment_id:
        # All responses were cleared — remove the old attachment
        att = await db.get(DocumentAttachment, checklist.attachment_id)
        if att:
            storage.delete(att.storage_path)
            att.is_deleted = True
        checklist.attachment_id = None
        await db.commit()

    # Reload with responses
    await db.refresh(checklist)
    result = await db.execute(
        select(DocumentChecklist)
        .where(DocumentChecklist.id == checklist.id)
        .options(selectinload(DocumentChecklist.responses))
    )
    return result.scalar_one()


@router.delete("/documents/{document_id}/{requirement_template_id}", status_code=204)
async def remove_document_checklist(
    document_id: uuid.UUID,
    requirement_template_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("documents.edit")),
):
    checklist = (
        await db.execute(
            select(DocumentChecklist).where(
                DocumentChecklist.document_id == document_id,
                DocumentChecklist.requirement_template_id == requirement_template_id,
                DocumentChecklist.is_deleted == False, )  # noqa: E712
        )
    ).scalar_one_or_none()
    if not checklist:
        raise HTTPException(status_code=404, detail="Checklist not found")

    # Remove associated attachment
    if checklist.attachment_id:
        att = await db.get(DocumentAttachment, checklist.attachment_id)
        if att:
            storage.delete(att.storage_path)
            att.is_deleted = True

    checklist.is_deleted = True
    await db.commit()


@router.get("/documents/{document_id}/{requirement_template_id}/pdf")
async def download_checklist_pdf(
    document_id: uuid.UUID,
    requirement_template_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from fastapi.responses import Response

    checklist = (
        await db.execute(
            select(DocumentChecklist).where(
                DocumentChecklist.document_id == document_id,
                DocumentChecklist.requirement_template_id == requirement_template_id,
                DocumentChecklist.is_deleted == False, )  # noqa: E712
        )
    ).scalar_one_or_none()
    if not checklist or not checklist.attachment_id:
        raise HTTPException(status_code=404, detail="Checklist PDF not found")

    att = await db.get(DocumentAttachment, checklist.attachment_id)
    if not att or att.is_deleted:
        raise HTTPException(status_code=404, detail="Checklist PDF not found")

    data = storage.read(att.storage_path)
    return Response(
        content=data,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{att.filename}"'},
    )


# ─── Internal helpers ────────────────────────────────────────────────────────


async def _generate_checklist_pdf_background(checklist_id: uuid.UUID):
    """Wrapper that opens its own DB session so the background task runs independently."""
    from app.core.database import async_session_factory

    async with async_session_factory() as db:
        try:
            await _generate_and_attach_checklist_pdf(db, checklist_id)
        except Exception as exc:
            import logging

            logger = logging.getLogger(__name__)
            logger.exception("Background checklist PDF generation failed for %s: %s", checklist_id, exc)


async def _overlay_checklist_signature(pdf_bytes: bytes, inspector) -> bytes:
    """Find the __SIG1__ marker in the checklist PDF and stamp the inspector's
    signature (uploaded PNG or font-rendered text) at that position."""
    import io

    import fitz

    from pypdf import PdfReader, PdfWriter
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfgen import canvas as pdf_canvas
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from app.services.signature import FONTS_DIR, SIGNATURE_FONTS
    from app.core.types import DEFAULT_SIGNATURE_FONT
    from app.services.storage import storage

    sig_key = f"signatures/{inspector.id}.png"
    has_png = storage.exists(sig_key)

    sig_name = inspector.signature_text or inspector.full_name
    sig_font_id = inspector.signature_font or DEFAULT_SIGNATURE_FONT

    # ── Step 1: find & redact the marker ──────────────────────────────────
    pdf_doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    sig_info = None

    for page_idx in range(len(pdf_doc)):
        page = pdf_doc[page_idx]
        instances = page.search_for("__SIG1__")
        if instances:
            rect = instances[0]
            sig_info = {
                "page": page_idx,
                "x": rect.x0,
                "y": rect.y0,
                "width": rect.width,
                "height": rect.height,
                "page_height": page.rect.height,
            }
            for inst in instances:
                page.add_redact_annot(inst, fill=(1, 1, 1))
            page.apply_redactions()
            break

    redacted_bytes = pdf_doc.tobytes()
    pdf_doc.close()

    if not sig_info:
        return pdf_bytes  # marker not found — shouldn't happen, but be safe

    # ── Step 2: stamp the signature on every page that had the marker ─────
    if has_png:
        png_bytes = storage.read(sig_key)
    else:
        # Register the signature font for ReportLab
        font_file = SIGNATURE_FONTS.get(sig_font_id, SIGNATURE_FONTS["dancing_script"])
        font_path = FONTS_DIR / font_file
        try:
            pdfmetrics.registerFont(TTFont(sig_font_id, str(font_path)))
        except Exception:
            sig_font_id = "Helvetica"

    reader = PdfReader(io.BytesIO(redacted_bytes))
    writer = PdfWriter()

    for page_idx in range(len(reader.pages)):
        page = reader.pages[page_idx]
        page_width = float(page.mediabox.width)
        page_height = float(page.mediabox.height)

        if page_idx == sig_info["page"]:
            overlay_buf = io.BytesIO()
            c = pdf_canvas.Canvas(overlay_buf, pagesize=(page_width, page_height))

            x = sig_info["x"]
            y = page_height - sig_info["y"] - sig_info["height"]
            cell_w = sig_info["width"]
            cell_h = sig_info["height"]

            if has_png:
                img = ImageReader(io.BytesIO(png_bytes))
                iw, ih = img.getSize()
                scale = min(cell_w / iw, cell_h / ih) if iw > 0 and ih > 0 else 1
                scale *= 2  # signature twice larger than the cell
                draw_w = iw * scale
                draw_h = ih * scale
                y_adj = y + (cell_h - draw_h) / 2
                c.drawImage(
                    img, x, y_adj, width=draw_w, height=draw_h, mask="auto"
                )
            else:
                font_size = 72
                try:
                    c.setFont(sig_font_id, font_size)
                except Exception:
                    c.setFont("Helvetica", font_size)
                from reportlab.pdfbase.pdfmetrics import stringWidth

                text_width = stringWidth(sig_name, sig_font_id, font_size)
                if text_width > cell_w and text_width > 0:
                    font_size = font_size * (cell_w / text_width)
                    try:
                        c.setFont(sig_font_id, font_size)
                    except Exception:
                        c.setFont("Helvetica", font_size)
                c.setFillColorRGB(0.1, 0.14, 0.49)
                c.drawString(x, y, sig_name)

            c.save()
            overlay_buf.seek(0)
            overlay_reader = PdfReader(overlay_buf)
            page.merge_page(overlay_reader.pages[0])

        writer.add_page(page)

    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


async def _generate_and_attach_checklist_pdf(db: AsyncSession, checklist_id: uuid.UUID):
    """Generate checklist PDF and create/update DocumentAttachment."""
    from app.models.doc_template import DocTemplate
    from app.services.checklist_xlsx import (
        build_checklist_context,
        convert_xlsx_to_pdf,
        fill_xlsx_template,
    )

    checklist = (
        await db.execute(
            select(DocumentChecklist)
            .where(DocumentChecklist.id == checklist_id)
            .options(
                selectinload(DocumentChecklist.responses),
                selectinload(DocumentChecklist.requirement_template),
            )
        )
    ).scalar_one()

    doc = (
        await db.execute(
            select(Document)
            .where(Document.id == checklist.document_id)
            .options(
                selectinload(Document.project),
                selectinload(Document.site_engineer),
            )
        )
    ).scalar_one()

    # Try XLSX template (CHECKLIST type for the project)
    tmpl_result = await db.execute(
        select(DocTemplate).where(
            DocTemplate.project_id == doc.project_id,
            DocTemplate.doc_type == "CHECKLIST",
            DocTemplate.file_format == "xlsx",
            DocTemplate.is_active == True,  # noqa: E712
            DocTemplate.is_deleted == False,  # noqa: E712
        )
    )
    xlsx_template = tmpl_result.scalar_one_or_none()

    if xlsx_template:
        # Use XLSX template approach — load date format from project settings
        from app.api.v1.reports import _load_date_format, _format_date

        await _load_date_format(db)

        tmpl = checklist.requirement_template
        display_name = tmpl.display_name or tmpl.name if tmpl else ""
        responses = sorted(checklist.responses, key=lambda r: r.display_order)
        response_data = [
            {"item_text": r.item_text, "response": r.response, "notes": r.notes}
            for r in responses
        ]
        ctx = build_checklist_context(display_name, response_data)
        ctx["wir_no"] = doc.reference_no or ""
        ctx["wir_rev"] = f"{doc.revision_no or 0:02d}"
        ctx["wir_date"] = _format_date(doc.inspection_date)
        # First inspector (site_engineer) data
        ctx["signer_name"] = doc.site_engineer.full_name if doc.site_engineer else ""
        if doc.site_engineer and doc.site_engineer_signed:
            ctx["signer_sign"] = "__SIG1__"  # marker for PDF post-processing
        else:
            ctx["signer_sign"] = ""
        ctx["signer_date"] = _format_date(doc.inspector_date_1)
        filled_xlsx = fill_xlsx_template(xlsx_template.file, ctx)
        pdf_bytes = await convert_xlsx_to_pdf(filled_xlsx)
        # Overlay the actual signature (PNG or font-rendered) onto the PDF
        if ctx["signer_sign"]:
            pdf_bytes = await _overlay_checklist_signature(
                pdf_bytes, doc.site_engineer
            )
    else:
        # Fallback to reportlab
        from app.services.checklist_pdf import generate_checklist_pdf

        pdf_bytes = await generate_checklist_pdf(db, doc, checklist)

    filename = f"Checklist - {checklist.requirement_template.name}.pdf"
    file_id = str(uuid.uuid4())
    storage_key = f"attachments/{doc.id}/{file_id}.pdf"
    storage.save(storage_key, pdf_bytes)

    if checklist.attachment_id:
        att = await db.get(DocumentAttachment, checklist.attachment_id)
        if att:
            storage.delete(att.storage_path)
            att.storage_path = storage_key
            att.filename = filename
            att.size = len(pdf_bytes)
    else:
        # Place new checklist as first attachment; bump existing ones down
        from sqlalchemy import update as sa_update

        await db.execute(
            sa_update(DocumentAttachment)
            .where(
                DocumentAttachment.document_id == doc.id,
                DocumentAttachment.is_deleted == False, )  # noqa: E712
            .values(sort_order=DocumentAttachment.sort_order + 1)
        )
        att = DocumentAttachment(
            document_id=doc.id,
            filename=filename,
            storage_path=storage_key,
            content_type="application/pdf",
            size=len(pdf_bytes),
            sort_order=0,
            kind=AttachmentKind.CHECKLIST,
        )
        db.add(att)
        await db.flush()
        checklist.attachment_id = att.id

    await db.commit()
