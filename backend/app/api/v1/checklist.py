"""Checklist API endpoints — master items CRUD + document checklist operations."""

import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel as PydanticBase
from sqlalchemy import delete, select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.deps import assert_user_in_project, get_current_user, require_permission
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
            display_order=r.display_order,
            item_text=r.item_text,
        )
        db.add(resp)

    await db.commit()

    # Generate PDF and attach
    await _generate_and_attach_checklist_pdf(db, checklist.id)

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
            .options(selectinload(Document.project))
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
        # Use XLSX template approach
        tmpl = checklist.requirement_template
        display_name = tmpl.display_name or tmpl.name if tmpl else ""
        responses = sorted(checklist.responses, key=lambda r: r.display_order)
        response_data = [
            {"item_text": r.item_text, "response": r.response} for r in responses
        ]
        ctx = build_checklist_context(display_name, response_data)
        ctx["wir_no"] = doc.reference_no or ""
        filled_xlsx = fill_xlsx_template(xlsx_template.file, ctx)
        pdf_bytes = await convert_xlsx_to_pdf(filled_xlsx)
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
            kind="checklist",
        )
        db.add(att)
        await db.flush()
        checklist.attachment_id = att.id

    await db.commit()
