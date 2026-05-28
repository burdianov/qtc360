"""PDF utilities for the external approval workflow.

Three core operations:

* count_pages — used at template upload to populate cover_page_count.
* split_returned_pdf — split a returned approval PDF into cover + per-page
  attachments using the document's snapshot of cover_page_count.
* extract_region_text — region-based text extraction with native-text-first,
  Tesseract OCR fallback. Powers the user-driven "draw a box, capture text"
  flow on returned PDFs. Handles flattened (rasterized) PDFs by detecting
  image overlap with the requested region and preferring OCR in that case,
  with preprocessing tuned for scanned/stamped Aconex transmittals.
"""
from __future__ import annotations

import io
import logging
import subprocess
import tempfile
from pathlib import Path

import fitz  # PyMuPDF
from pypdf import PdfReader, PdfWriter

from app.core.config import settings

logger = logging.getLogger(__name__)


# Tesseract page-segmentation modes by target field. Default is 3 ("auto"),
# which often mis-segments a single line on a stamped form. 7 = single line,
# 6 = uniform block of text. Significant accuracy boost on scanned content.
PSM_BY_FIELD = {
    "signatory_name": 7,
    "response_date": 7,
    "comments": 6,
}


def count_pages(pdf_bytes: bytes) -> int:
    reader = PdfReader(io.BytesIO(pdf_bytes))
    return len(reader.pages)


def count_pages_in_docx(docx_bytes: bytes) -> int:
    """Convert DOCX → PDF via LibreOffice headless and count the pages.

    Mirrors the conversion path used in reports.py so a template's reported
    page count matches what gets generated for real documents.
    """
    libre = settings.libreoffice_path
    with tempfile.TemporaryDirectory() as tmp_dir:
        docx_path = Path(tmp_dir) / "template.docx"
        docx_path.write_bytes(docx_bytes)
        cmd = [
            libre,
            "--headless",
            "--norestore",
            "--nologo",
            "--nofirststartwizard",
            "--convert-to",
            "pdf",
            "--outdir",
            tmp_dir,
            str(docx_path),
        ]
        try:
            proc = subprocess.run(cmd, capture_output=True, timeout=60)
        except (FileNotFoundError, subprocess.TimeoutExpired):
            logger.exception("LibreOffice unavailable; defaulting cover_page_count to 1")
            return 1
        if proc.returncode != 0:
            logger.warning(
                "LibreOffice page count failed (%s); defaulting to 1", proc.returncode
            )
            return 1
        pdf_path = Path(tmp_dir) / "template.pdf"
        if not pdf_path.exists():
            return 1
        return count_pages(pdf_path.read_bytes())


def split_returned_pdf(
    pdf_bytes: bytes, cover_page_count: int
) -> tuple[bytes, list[bytes]]:
    """Split a returned PDF into (cover_pdf, [attachment_pdfs])."""
    reader = PdfReader(io.BytesIO(pdf_bytes))
    total_pages = len(reader.pages)
    if total_pages == 0:
        raise ValueError("Returned PDF has no pages")

    cover_count = max(1, min(cover_page_count, total_pages))

    cover_writer = PdfWriter()
    for i in range(cover_count):
        cover_writer.add_page(reader.pages[i])
    cover_buf = io.BytesIO()
    cover_writer.write(cover_buf)
    cover_pdf = cover_buf.getvalue()

    attachments: list[bytes] = []
    for i in range(cover_count, total_pages):
        att_writer = PdfWriter()
        att_writer.add_page(reader.pages[i])
        att_buf = io.BytesIO()
        att_writer.write(att_buf)
        attachments.append(att_buf.getvalue())

    return cover_pdf, attachments


def _region_is_flattened(page: "fitz.Page", rect: "fitz.Rect") -> bool:
    """Detect whether the requested region is covered by a rasterized image.

    Aconex transmittals frequently come back with the printed/stamped form
    flattened into a page-sized image, sometimes with text-like glyphs that
    PyMuPDF still reports as "native text" (because the embedded image has
    its own OCR layer). When we see significant image overlap with the
    requested region we prefer OCR over the unreliable native text.
    """
    try:
        image_rects = []
        for img in page.get_images(full=True):
            for rect_obj in page.get_image_rects(img[0]):
                image_rects.append(rect_obj)
    except Exception:
        return False

    region_area = rect.get_area()
    if region_area <= 0:
        return False
    for img_rect in image_rects:
        intersection = rect & img_rect
        if intersection.is_empty:
            continue
        overlap = intersection.get_area() / region_area
        if overlap >= 0.5:
            return True
    return False


def _preprocess_for_ocr(png_bytes: bytes) -> bytes:
    """Light preprocessing pipeline for scanned/flattened content.

    Grayscale → adaptive threshold → light denoise. Fast, no external deps
    beyond Pillow. Skipped silently if Pillow features unavailable.
    """
    try:
        from PIL import Image, ImageFilter, ImageOps
    except ImportError:
        return png_bytes
    try:
        img = Image.open(io.BytesIO(png_bytes))
        gray = ImageOps.grayscale(img)
        # Boost contrast so faint stamps and faded scans become legible.
        gray = ImageOps.autocontrast(gray, cutoff=2)
        # Light median filter knocks out salt-and-pepper noise from low-res scans.
        gray = gray.filter(ImageFilter.MedianFilter(size=3))
        out = io.BytesIO()
        gray.save(out, format="PNG")
        return out.getvalue()
    except Exception:
        logger.exception("OCR preprocessing failed; using original image")
        return png_bytes


def extract_region_text(
    pdf_bytes: bytes,
    page: int,
    bbox: tuple[float, float, float, float],
    target_field: str | None = None,
    force_ocr: bool = False,
) -> tuple[str, str]:
    """Extract text from a region of a PDF.

    page is 1-indexed. bbox is ``(x, y, width, height)`` in PDF user-space
    coordinates (origin top-left, matching what PDF.js gives us on the
    frontend).

    Returns ``(text, via)`` where via is "native" if pypdf/PyMuPDF returned
    text from the region, or "ocr" if Tesseract was used as fallback.

    target_field steers Tesseract page-segmentation mode (single-line for
    name/date, block-of-text for comments). force_ocr skips native text
    extraction entirely — used by the "Try OCR instead" UI affordance for
    flattened PDFs whose embedded text is unreliable.
    """
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        if page < 1 or page > doc.page_count:
            raise ValueError(f"Page {page} out of range (1..{doc.page_count})")
        pdf_page = doc.load_page(page - 1)
        x, y, w, h = bbox
        rect = fitz.Rect(x, y, x + w, y + h)

        prefer_ocr = force_ocr or _region_is_flattened(pdf_page, rect)
        if not prefer_ocr:
            native = pdf_page.get_textbox(rect)
            if native and native.strip():
                return native.strip(), "native"

        # OCR path: render the region at 3x for legibility, preprocess, then
        # call Tesseract with a field-appropriate page-segmentation mode.
        try:
            import pytesseract
            from PIL import Image
        except ImportError:
            logger.warning("pytesseract/PIL not installed; OCR fallback unavailable")
            return "", "native"

        zoom = 3.0
        matrix = fitz.Matrix(zoom, zoom)
        pix = pdf_page.get_pixmap(matrix=matrix, clip=rect, alpha=False)
        png = _preprocess_for_ocr(pix.tobytes("png"))
        psm = PSM_BY_FIELD.get(target_field or "", 6)
        config = f"--psm {psm}"
        try:
            text = pytesseract.image_to_string(Image.open(io.BytesIO(png)), config=config)
        except pytesseract.TesseractNotFoundError:
            logger.warning(
                "Tesseract binary not found; native text was empty for this region"
            )
            return "", "native"
        except Exception:
            logger.exception("Tesseract OCR failed")
            return "", "native"
        return text.strip(), "ocr"
    finally:
        doc.close()


def normalize_date_text(text: str) -> str | None:
    """Best-effort normalization of an OCR'd or extracted date string to ISO.

    Returns ``yyyy-MM-dd`` or None if nothing parseable is found.
    """
    if not text or not text.strip():
        return None
    try:
        import dateparser
    except ImportError:
        return None
    parsed = dateparser.parse(
        text.strip(),
        settings={"PREFER_DAY_OF_MONTH": "first", "DATE_ORDER": "DMY"},
    )
    if parsed is None:
        return None
    return parsed.date().isoformat()
