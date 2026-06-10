"""Shared helpers for the documents API — reference-number allocation, storage
purge, download-filename building, and document-loading for attachments."""

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.types import (
    ALLOWED_ATTACHMENT_SUFFIXES,
    ALLOWED_ATTACHMENT_MIMES,
    MAX_ATTACHMENT_BYTES,
    MAX_ATTACHMENTS_PER_DOC,
    DEFAULT_PAGE_LIMIT,
    MAX_PAGE_LIMIT,
    MAX_APPROVERS,
    _mb,
)
from app.models.document import Document
from app.models.document_approval_round import DocumentApprovalRound
from app.models.reference_number_config import ReferenceNumberConfig
from app.models.reference_number_counter import ReferenceNumberCounter


async def build_download_filename(db: AsyncSession, doc: Document) -> str:
    """Build PDF download filename as REFERENCE_NO_REVISION.pdf."""
    ref = doc.reference_no or "document"
    rev = int(doc.revision_no or 0)
    return f"{ref}_{rev:02d}.pdf"


async def purge_document_storage(db: AsyncSession, doc_id: UUID) -> int:
    """Best-effort delete every file on disk that belongs to this document.

    Covers:
    - All DocumentAttachment rows (doc-level, round-level, returned_pdf)
    - Approval round files that are NOT in DocumentAttachment
      (remarks.pdf, plus returned_file_path if no DocumentAttachment row exists)
    - The entire ``responses/{doc_id}/`` folder (S1, R1, S2, R2, ...)

    Returns the number of files we attempted to unlink. Each unlink is
    wrapped in try/except — we never want storage cleanup to abort a delete.
    """
    from app.models.document_attachment import DocumentAttachment

    keys: set[str] = set()

    att_result = await db.execute(
        select(DocumentAttachment).where(DocumentAttachment.document_id == doc_id)
    )
    for att in att_result.scalars().all():
        if att.storage_path:
            keys.add(att.storage_path)

    rounds_result = await db.execute(
        select(DocumentApprovalRound).where(
            DocumentApprovalRound.document_id == doc_id,
        )
    )
    for round_ in rounds_result.scalars().all():
        if round_.returned_file_path:
            keys.add(round_.returned_file_path)
        if round_.remarks_file_path:
            keys.add(round_.remarks_file_path)
        if round_.submitted_file_path:
            keys.add(round_.submitted_file_path)

    from app.services.storage import storage

    for key in keys:
        try:
            storage.delete(key)
        except Exception:
            pass  # Best-effort; missing file is acceptable

    # Also wipe responses/{doc_id}/ (catches the case where a round was
    # created but the doc was deleted before the S or R file was recorded
    # in the column — unlikely but possible).
    from app.services.approval_files import purge_doc_responses

    try:
        purge_doc_responses(str(doc_id))
    except Exception:
        pass

    return len(keys)


async def allocate_serial(
    db: AsyncSession,
    *,
    project_id: UUID,
    doc_type: str,
    discipline_id: UUID,
) -> tuple[ReferenceNumberConfig | None, int]:
    doc_type = doc_type.upper()
    config_result = await db.execute(
        select(ReferenceNumberConfig)
        .where(
            ReferenceNumberConfig.project_id == project_id,
            ReferenceNumberConfig.doc_type == doc_type,
            ReferenceNumberConfig.is_deleted == False, )  # noqa: E712
        .with_for_update()
    )
    config = config_result.scalar_one_or_none()
    if config is None:
        return None, 0

    counter_result = await db.execute(
        select(ReferenceNumberCounter)
        .where(
            ReferenceNumberCounter.project_id == project_id,
            ReferenceNumberCounter.doc_type == doc_type,
            ReferenceNumberCounter.discipline_id == discipline_id,
        )
        .with_for_update()
    )
    counter = counter_result.scalar_one_or_none()

    if counter is None:
        counter = ReferenceNumberCounter(
            project_id=project_id,
            doc_type=doc_type,
            discipline_id=discipline_id,
            next_serial=config.serial_start or 1,
        )
        db.add(counter)
        await db.flush()

    serial = int(counter.next_serial)
    counter.next_serial = serial + 1
    return config, serial


def format_reference(
    config: ReferenceNumberConfig | None,
    *,
    doc_type: str,
    discipline_code: str,
    serial: int,
    fallback_serial: int = 1,
) -> str:
    """Render a reference number from the configured pattern."""
    if config is None:
        return f"{doc_type}-{fallback_serial:04d}"
    return config.pattern.format(
        project_code=config.project_code,
        contractor_code=config.contractor_code,
        discipline_code=discipline_code,
        doc_type=doc_type,
        serial=serial,
    )


async def auto_create_ref_config(
    db: AsyncSession,
    *,
    project_id: UUID,
    doc_type: str,
) -> ReferenceNumberConfig:
    """Create a default ReferenceNumberConfig for (project, doc_type) when
    none exists."""
    from app.models.project import Project

    project = (
        await db.execute(select(Project).where(Project.id == project_id))
    ).scalar_one()
    code = (getattr(project, "code", None) or "PROJ")[:50]
    config = ReferenceNumberConfig(
        project_id=project_id,
        doc_type=doc_type,
        pattern="{project_code}-{contractor_code}-{discipline_code}-{doc_type}-{serial:04d}",
        project_code=code,
        contractor_code="",
        serial_start=1,
    )
    db.add(config)
    await db.flush()
    return config


async def load_doc_for_attachment(
    db: AsyncSession, doc_id: UUID, user
) -> Document:
    """Load a document and assert the user is in its project. Used by
    attachment endpoints."""
    from fastapi import HTTPException
    from app.core.deps import assert_user_in_project

    doc = (
        await db.execute(
            select(Document).where(Document.id == doc_id, Document.is_deleted == False)  # noqa: E712
        )
    ).scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    await assert_user_in_project(user, doc.project_id)
    return doc
