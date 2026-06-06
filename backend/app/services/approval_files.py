"""PR2: per-round file storage for the external approval workflow.

File layout (under ``settings.upload_dir``)::

    responses/{doc_id}/S1.pdf
    responses/{doc_id}/R1.pdf
    responses/{doc_id}/S2.pdf
    responses/{doc_id}/R2.pdf
    ...

Each stage (S = submission bundle, R = returned PDF) is one file on disk
whose name maps directly to the stage. The DB column
``document_approval_rounds.submitted_file_path`` / ``returned_file_path``
mirrors the same string so we can do existence checks without a DB
lookup, but the stage *name* (``S1``, ``R1``, ``S2``, ``R2``) is the
authoritative identifier.

A complete 2-approver cycle produces 4 files. A 1-approver cycle produces
2. A revision (rejected → new doc row) gets its own folder.

**Locked PDFs.** Aconex returned PDFs are frequently encrypted. pypdf can
still open files that have only an *owner* password (the "permissions"
password); pypdf needs a separate *user* password for files that lock
the content. We:

* Try ``reader.decrypt("")`` on every upload. If it returns 0 (or
  raises) we mark the round ``returned_file_locked = True`` and the
  frontend will ask the user for the password on the next submit.
* For S2 (R1 + new attachments) we attempt the same trick. If it
  fails, the submit endpoint returns 400 with a ``code`` field the
  frontend can use to render the password field.
"""
from __future__ import annotations

import io
import logging
from typing import Iterable

from fastapi import HTTPException
from pypdf import PdfReader, PdfWriter
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.types import MAX_BUNDLE_BYTES, _mb
from app.services.storage import storage


logger = logging.getLogger(__name__)


# ─── paths ────────────────────────────────────────────────────────────────


def _response_path(doc_id: str, stage: str) -> str:
    """Build the storage key for a stage file (e.g. 'S1', 'R2')."""
    if not stage or stage[0] not in ("S", "R"):
        raise ValueError(f"Invalid stage {stage!r}; must start with S or R")
    return f"responses/{doc_id}/{stage}.pdf"


def submitted_path(doc_id: str, round_order: int) -> str:
    return _response_path(doc_id, f"S{round_order}")


def returned_path(doc_id: str, round_order: int) -> str:
    return _response_path(doc_id, f"R{round_order}")


# ─── save ─────────────────────────────────────────────────────────────────


def save_submission(doc_id: str, round_order: int, data: bytes) -> tuple[str, int]:
    """Write the assembled S-round bundle to disk. Returns (key, size)."""
    key = submitted_path(doc_id, round_order)
    storage.save(key, data)
    return key, len(data)


def save_response(doc_id: str, round_order: int, data: bytes) -> tuple[str, int, bool]:
    """Write the returned R-round PDF to disk.

    Returns ``(key, size, requires_password)``. ``requires_password`` is
    True when the file is encrypted and ``decrypt("")`` cannot open it
    (i.e. a real *user* password is set).
    """
    key = returned_path(doc_id, round_order)
    storage.save(key, data)
    _, locked = _detect_lock(data)
    return key, len(data), locked


# ─── password detection ──────────────────────────────────────────────────


def _detect_lock(data: bytes) -> tuple[bool, bool]:
    """Return ``(opened, requires_password)``.

    * ``opened`` is True if pypdf was able to read the file at all
      (including owner-password-only files).
    * ``requires_password`` is True if the file is encrypted and
      empty-password decryption did not succeed.
    """
    try:
        reader = PdfReader(io.BytesIO(data))
    except Exception:
        return False, True

    if not reader.is_encrypted:
        return True, False

    # Try empty password. Returns 0 (failed) or 1/2 (succeeded).
    try:
        result = reader.decrypt("")
    except Exception:
        return False, True
    return result != 0, result == 0


def detect_response_lock(data: bytes) -> bool:
    """Public wrapper: returns True iff the response PDF needs a password
    we don't have to read its pages."""
    _, locked = _detect_lock(data)
    return locked


# ─── assembly: S-round bundle ────────────────────────────────────────────


async def assemble_submission_for_round(
    db: AsyncSession,
    doc,
    round_order: int,
    extra_attachments: Iterable[tuple[bytes, str]] = (),
    password: str | None = None,
) -> bytes:
    """Build the bytes for the S-round PDF.

    For round 1: render the doc template (DOCX → PDF) and append the
    doc-level user attachments, exactly like the existing
    ``GET /documents/{id}/bundle`` endpoint.

    For round N>1: load the previous round's R file (decrypt with
    ``password`` if needed) and append ``extra_attachments`` in the
    order supplied. The doc-level user attachments are *not*
    re-included — they were already part of S1 and are therefore in R1.

    ``extra_attachments`` is an iterable of ``(bytes, filename)``;
    images are converted to single-page PDFs by the merger.

    Raises HTTPException(400) if the previous round's response is locked
    and no usable password was provided. Raises HTTPException(413) if
    the assembled bundle exceeds MAX_BUNDLE_BYTES.
    """
    if round_order <= 1:
        return await _assemble_s1(db, doc)

    # Round 2+
    return await _assemble_sN(db, doc, round_order, extra_attachments, password)


async def _assemble_s1(db: AsyncSession, doc) -> bytes:
    """S1 = template-fill + doc-level user attachments (mirrors GET /bundle)."""
    # Imported lazily to avoid a circular import at module load time.
    from sqlalchemy.orm import selectinload
    from sqlalchemy import select
    from app.models.doc_template import DocTemplate
    from app.models.document_attachment import DocumentAttachment
    from app.api.v1.reports import (
        _build_context, _fill_template, _convert_to_pdf, _stamp_vector_signatures,
        _merge_attachments_with_status,
    )
    from app.models.app_setting import AppSetting
    from app.models.user import User
    import json as _json

    # Eager-load everything _build_context + _fill_template touch.
    result = await db.execute(
        select(doc.__class__)
        .where(doc.__class__.id == doc.id)
        .options(
            selectinload(doc.__class__.discipline),
            selectinload(doc.__class__.project),
            selectinload(doc.__class__.site_engineer).selectinload(User.designation),
            selectinload(doc.__class__.qaqc_engineer).selectinload(User.designation),
        )
    )
    doc_loaded = result.scalar_one()

    # Template
    if doc_loaded.template_id:
        template = (await db.execute(
            select(DocTemplate).where(DocTemplate.id == doc_loaded.template_id)
        )).scalar_one_or_none()
    else:
        template = (await db.execute(
            select(DocTemplate).where(
                DocTemplate.project_id == doc_loaded.project_id,
                DocTemplate.doc_type == doc_loaded.document_type,
                DocTemplate.is_active == True,  # noqa: E712
                DocTemplate.is_deleted == False,  # noqa: E712
            )
        )).scalar_one_or_none()
    if template is None:
        raise HTTPException(
            status_code=400,
            detail=f"No active {doc_loaded.document_type} template for this project",
        )

    context = _build_context(doc_loaded)
    docx_bytes = _fill_template(template.file, context, doc_loaded)
    main_pdf_bytes = await _convert_to_pdf(docx_bytes)

    _sig_default = {"font_size": 36, "cell_width": 75, "x_offset": -0.3, "color": "#1a237e"}
    _sig_setting = (await db.execute(
        select(AppSetting).where(AppSetting.key == "signature_config")
    )).scalar_one_or_none()
    _sig_cfg = _sig_default
    if _sig_setting:
        try:
            _sig_cfg = _json.loads(_sig_setting.value).get(doc_loaded.document_type, _sig_default)
        except Exception:
            pass
    main_pdf_bytes = _stamp_vector_signatures(main_pdf_bytes, doc_loaded, _sig_cfg)

    # Doc-level user attachments (kind="user").
    attachments_result = await db.execute(
        select(DocumentAttachment)
        .where(
            DocumentAttachment.document_id == doc_loaded.id,
            DocumentAttachment.kind == "user",
            DocumentAttachment.is_deleted == False,  # noqa: E712
        )
        .order_by(DocumentAttachment.sort_order)
    )
    attachments = attachments_result.scalars().all()

    if not attachments:
        return main_pdf_bytes

    try:
        merged_pdf, _ = _merge_attachments_with_status(main_pdf_bytes, attachments)
    except ValueError as e:
        raise HTTPException(status_code=413, detail=str(e))
    return merged_pdf


async def _assemble_sN(
    db: AsyncSession,
    doc,
    round_order: int,
    extra_attachments: Iterable[tuple[bytes, str]],
    password: str | None,
) -> bytes:
    """S{N} = R{N-1} (decrypted if needed) + extra_attachments appended."""
    prev_path = returned_path(str(doc.id), round_order - 1)
    if not storage.exists(prev_path):
        raise HTTPException(
            status_code=400,
            detail=(
                f"Cannot assemble S{round_order}: previous response R{round_order - 1} "
                f"is missing from storage"
            ),
        )
    prev_bytes = storage.read(prev_path)

    # Decrypt if needed.
    if _is_encrypted_bytes(prev_bytes):
        decrypted = _decrypt_with_password(prev_bytes, password)
        if decrypted is None:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "PDF_PASSWORD_REQUIRED",
                    "message": (
                        f"R{round_order - 1} is password-protected. "
                        "Provide the password to include its pages in the new submission."
                    ),
                },
            )
        prev_bytes = decrypted

    # Bundle size guard.
    extras = list(extra_attachments)
    total = len(prev_bytes) + sum(len(b) for b, _ in extras)
    if total > MAX_BUNDLE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=(
                f"Bundle too large ({_mb(total)}MB > {_mb(MAX_BUNDLE_BYTES)}MB). "
                "Reduce the number or size of attachments."
            ),
        )

    writer = PdfWriter()
    for page in PdfReader(io.BytesIO(prev_bytes)).pages:
        writer.add_page(page)
    for att_bytes, _name in extras:
        for page in _bytes_to_pdf_pages(att_bytes):
            writer.add_page(page)

    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


# ─── pdf helpers ──────────────────────────────────────────────────────────


def _is_encrypted_bytes(data: bytes) -> bool:
    try:
        return bool(PdfReader(io.BytesIO(data)).is_encrypted)
    except Exception:
        return True  # treat unreadable as encrypted


def _decrypt_with_password(data: bytes, password: str | None) -> bytes | None:
    """Try to decrypt with the given password (or empty string). Returns
    the re-serialized PDF bytes, or None if the password was wrong.

    A successful decrypt with an empty string is the common case for
    Aconex PDFs (owner-password-only)."""
    try:
        reader = PdfReader(io.BytesIO(data))
        if not reader.is_encrypted:
            return data
        result = reader.decrypt(password or "")
        if result == 0:
            return None
        writer = PdfWriter()
        for page in reader.pages:
            writer.add_page(page)
        buf = io.BytesIO()
        writer.write(buf)
        return buf.getvalue()
    except Exception:
        logger.exception("PDF decryption failed")
        return None


def _bytes_to_pdf_pages(data: bytes) -> list:
    """Convert bytes (PDF or image) to a list of pypdf page objects."""
    if data[:4] == b"%PDF":
        return list(PdfReader(io.BytesIO(data)).pages)
    # Image → single-page PDF.
    from PIL import Image
    img = Image.open(io.BytesIO(data))
    if img.mode == "RGBA":
        img = img.convert("RGB")
    buf = io.BytesIO()
    img.save(buf, format="PDF")
    buf.seek(0)
    return list(PdfReader(buf).pages)


# ─── purge ────────────────────────────────────────────────────────────────


def purge_doc_responses(doc_id: str) -> int:
    """Delete every S*.pdf / R*.pdf file under ``responses/{doc_id}/``.

    Returns the number of files we attempted to unlink. Best-effort —
    missing files are silently ignored."""
    import os
    root = storage._root / "responses" / str(doc_id)  # noqa: SLF001
    if not root.exists():
        return 0
    count = 0
    for entry in os.listdir(root):
        if entry.lower().endswith(".pdf"):
            try:
                (root / entry).unlink()
                count += 1
            except Exception:
                pass
    # Best-effort: remove the now-empty folder too.
    try:
        if not any(root.iterdir()):
            root.rmdir()
    except Exception:
        pass
    return count
