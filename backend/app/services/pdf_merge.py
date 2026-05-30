"""PDF merging utilities for approval workflow.

Merges the returned PDF with additional user-uploaded attachments at specified
page positions to create a complete bundle for download.
"""
from __future__ import annotations

import io
from pathlib import Path

from pypdf import PdfReader, PdfWriter


def _bytes_to_pdf_reader(data: bytes) -> PdfReader:
    """Convert bytes to a PdfReader. If the bytes are an image, convert to PDF first."""
    # Check if it's a PDF by looking at the magic bytes
    if data[:4] == b"%PDF":
        return PdfReader(io.BytesIO(data))
    # Assume it's an image — convert to PDF via Pillow
    from PIL import Image
    img = Image.open(io.BytesIO(data))
    if img.mode == "RGBA":
        img = img.convert("RGB")
    pdf_buf = io.BytesIO()
    img.save(pdf_buf, format="PDF")
    pdf_buf.seek(0)
    return PdfReader(pdf_buf)


def merge_pdf_bundle(
    returned_pdf_bytes: bytes,
    attachments: list[tuple[bytes, int]],
) -> bytes:
    """Merge a returned PDF with additional attachments at specified positions.

    Args:
        returned_pdf_bytes: The main returned PDF from the approver
        attachments: List of (file_bytes, insert_after_page) tuples.
                    insert_after_page is 0-indexed (0 = insert after first page)
                    Files can be PDFs or images (PNG, JPG).

    Returns:
        Merged PDF as bytes
    """
    main_reader = PdfReader(io.BytesIO(returned_pdf_bytes))
    writer = PdfWriter()

    # Sort attachments by insertion position (ascending)
    sorted_attachments = sorted(attachments, key=lambda x: x[1])

    # Track how many pages we've inserted so positions shift correctly
    attachment_idx = 0

    # Add pages from main PDF, inserting attachments at specified positions
    for page_num in range(len(main_reader.pages)):
        writer.add_page(main_reader.pages[page_num])

        # Check if any attachments should be inserted after this page
        while (attachment_idx < len(sorted_attachments) and
               sorted_attachments[attachment_idx][1] == page_num):
            att_bytes, _ = sorted_attachments[attachment_idx]
            att_reader = _bytes_to_pdf_reader(att_bytes)
            for att_page in att_reader.pages:
                writer.add_page(att_page)
            attachment_idx += 1

    # Add any remaining attachments that should go after the last page
    while attachment_idx < len(sorted_attachments):
        att_bytes, _ = sorted_attachments[attachment_idx]
        att_reader = _bytes_to_pdf_reader(att_bytes)
        for att_page in att_reader.pages:
            writer.add_page(att_page)
        attachment_idx += 1

    # Write to bytes
    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()
