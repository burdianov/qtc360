"""Internal helpers for report generation — date formatting, context building,
template filling, signature stamping, PDF conversion, and attachment merging."""

import asyncio
import io
import logging
import tempfile
from pathlib import Path
from urllib.parse import quote

from docxtpl import DocxTemplate
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.types import (
    DEFAULT_SIGNATURE_FONT,
    DEFAULT_SIGNATURE_COLOR,
    FONTS_DIR,
    LIBREOFFICE_TIMEOUT,
    GOTENBERG_TIMEOUT,
    DEFAULT_DATE_FORMAT,
    MAX_BUNDLE_BYTES,
    DEFAULT_SIG_CONFIG,
    _mb,
)
from app.models.document import Document
from app.services.storage import storage

logger = logging.getLogger(__name__)

# Date format cache (loaded once per process from DB)
_date_format_cache: str | None = None
_date_format_lock = asyncio.Lock()


async def _load_date_format(db: AsyncSession) -> str:
    global _date_format_cache
    if _date_format_cache is not None:
        return _date_format_cache
    async with _date_format_lock:
        if _date_format_cache is not None:
            return _date_format_cache
        from app.models.app_setting import AppSetting

        result = await db.execute(
            select(AppSetting).where(AppSetting.key == "date_format")
        )
        item = result.scalar_one_or_none()
        _date_format_cache = item.value if item else DEFAULT_DATE_FORMAT
        return _date_format_cache

from sqlalchemy import select  # noqa: E402


def reset_date_format_cache() -> None:
    """Invalidate the cached date format so it is reloaded from DB on next use."""
    global _date_format_cache
    _date_format_cache = None


_FORMAT_MAP = {
    "DD.MM.YYYY": "%d.%m.%Y",
    "MM/DD/YYYY": "%m/%d/%Y",
    "YYYY-MM-DD": "%Y-%m-%d",
    "DD-MM-YYYY": "%d-%m-%Y",
    "DD/MM/YYYY": "%d/%m/%Y",
}


def _format_date(dt, fmt: str | None = None) -> str:
    if not dt:
        return ""
    from datetime import datetime as dt_cls

    if isinstance(dt, str):
        try:
            dt = dt_cls.fromisoformat(dt)
        except ValueError:
            return dt
    py_fmt = _FORMAT_MAP.get(
        fmt or _date_format_cache or DEFAULT_DATE_FORMAT, "%d.%m.%Y"
    )
    return dt.strftime(py_fmt)


def _safe_filename_for_disposition(name: str) -> str:
    """Build a safe Content-Disposition filename, blocking header-splitting via CR/LF."""
    safe_ascii = "".join(
        c if 32 <= ord(c) < 127 and c not in '"\\' else "_" for c in name
    )
    encoded = quote(name, safe="")
    return f"filename=\"{safe_ascii}\"; filename*=UTF-8''{encoded}"


# ── Context builder ──────────────────────────────────────────────────────────

def _build_context(document: Document) -> dict:
    """Build template context from a Document model."""
    ctx = {
        "ref_no": document.reference_no or "",
        "revision": str(document.revision_no or 0),
        "prj_no": "",
        "date": _format_date(document.inspection_date),
        "subject": document.title or "",
        "description_of_inspection": document.description or "",
        "gen_loc": document.location or "",
        "floor_level_room": document.floor_level or "",
        "appr_rams": document.rams_ref or "",
        "dwg_ref": document.drawing_ref or "",
    }

    doc_discipline = ""
    disc_code = ""
    if document.discipline:
        doc_discipline = (document.discipline.name or "").lower()
        disc_code = (document.discipline.code or "").upper()

    def cb(selected: bool) -> str:
        return "☒" if selected else "☐"

    ctx["arch_cb"] = (
        cb(disc_code == "AR" or "architectural" in doc_discipline) + " Architectural"
    )
    ctx["civil_struct_cb"] = (
        cb(
            disc_code == "CS"
            or "civil" in doc_discipline
            or "structural" in doc_discipline
        )
        + " Civil/Structural"
    )
    ctx["mechanical_cb"] = (
        cb(disc_code == "MC" or "mechanical" in doc_discipline) + " Mechanical"
    )
    ctx["electrical_cb"] = (
        cb(disc_code == "EL" or "electrical" in doc_discipline) + " Electrical"
    )
    ctx["plumbing_cb"] = (
        cb(disc_code == "PL" or "plumbing" in doc_discipline) + " Plumbing"
    )
    ctx["firefighting_cb"] = (
        cb(disc_code == "FF" or "fire" in doc_discipline) + " Fire Fighting"
    )
    ctx["others_cb"] = cb(disc_code == "OT" or "other" in doc_discipline) + " Others"

    # Per-inspector fields. Doc has at most two inspectors
    # (site_engineer + qaqc_engineer). The two sets of placeholders must
    # come from their respective fields, not be aliased to inspector #1.
    inspectors = [document.site_engineer, document.qaqc_engineer]
    for i, inspector in enumerate(inspectors, start=1):
        if inspector:
            name = inspector.full_name
            desig = inspector.designation.name if inspector.designation else ""
            ctx[f"inspected_by_{i}"] = name
            ctx[f"designation_{i}"] = desig
        else:
            ctx[f"inspected_by_{i}"] = ""
            ctx[f"designation_{i}"] = ""
        # inspector_date_1 / inspector_date_2 are stored as ISO strings in the
        # DB (see Document model). Format them to the project date format.
        date_attr = getattr(document, f"inspector_date_{i}", None)
        time_attr = getattr(document, f"inspector_time_{i}", None)
        ctx[f"date_{i}"] = _format_date(date_attr) if date_attr else ""
        ctx[f"time_{i}"] = time_attr or ""

    # Single-inspector aliases for legacy templates that reference a generic
    # signatory (the most common case: a single WIR inspector).
    ctx["inspected_by"] = ctx.get("inspected_by_1", "")
    ctx["ins_date"] = ctx.get("date_1", "")
    ctx["ins_time"] = ctx.get("time_1", "")
    ctx["signatory_date"] = ctx.get("date_1", "")
    # Two-inspector templates should also have unambiguous per-inspector
    # signatory-date fields. Until we migrate inspector_date_2 to a proper
    # Date column, fall back to inspector_date_1 so existing templates work.
    ctx["signatory_date_1"] = ctx.get("date_1", "")
    ctx["signatory_date_2"] = ctx.get("date_2", "") or ctx.get("date_1", "")
    ctx["inspected_by_2"] = ctx.get("inspected_by_2", "")

    if document.project:
        ctx["prj_no"] = document.project.code or ""
        ctx["ec"] = document.project.external_code or ""
        ctx["nm"] = document.project.external_code or ""

    ctx["discipline"] = document.discipline.name if document.discipline else ""

    ctx["delivery_notes"] = document.delivery_note or ""
    ctx["delivery_note"] = document.delivery_note or ""
    ctx["material_submittals"] = document.material_submittals or ""
    ctx["materials_description"] = document.description or ""
    ctx["qty"] = document.qty or ""
    ctx["location"] = document.location or ""

    return ctx


# ── Template filler ──────────────────────────────────────────────────────────

def _fill_template(template_bytes: bytes, context: dict, document: Document) -> bytes:
    """Fill a DOCX template with context data, using a sandboxed Jinja env."""
    from jinja2.sandbox import SandboxedEnvironment
    from jinja2 import TemplateSyntaxError, Undefined

    doc = DocxTemplate(io.BytesIO(template_bytes))

    signed_flags = [document.site_engineer_signed, document.qaqc_engineer_signed]
    for i, inspector in enumerate(
        [document.site_engineer, document.qaqc_engineer], start=1
    ):
        key = f"insp_sign_{i}"
        if inspector and signed_flags[i - 1]:
            context[key] = f"SIGMARK{i}"
        else:
            context[key] = ""

    context["inspected_by_sign"] = context.get("insp_sign_1", "")

    sandbox_env = SandboxedEnvironment(undefined=Undefined)
    try:
        doc.render(context, jinja_env=sandbox_env)
    except TemplateSyntaxError as e:
        raise HTTPException(
            status_code=400,
            detail=f"Template syntax error at line {e.lineno}: {e.message}. Check your DOCX template placeholders (use underscores, not spaces).",
        )
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


# ── Signature stamping ───────────────────────────────────────────────────────

def _stamp_vector_signatures(
    pdf_bytes: bytes,
    document: Document,
    sig_cfg: dict | None = None,
    user_sig_cfgs: dict | None = None,
) -> bytes:
    """Overlay signatures onto the PDF.

    Uses uploaded PNG signature if available, falls back to font-based rendering.
    """
    if not sig_cfg:
        sig_cfg = {"cell_width": 75, "cell_height": 25, "x_offset": 0, "y_offset": 0}
    if not user_sig_cfgs:
        user_sig_cfgs = {}
    from reportlab.pdfgen import canvas
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.lib.utils import ImageReader
    from pypdf import PdfReader, PdfWriter
    import fitz  # PyMuPDF

    signed_flags = [document.site_engineer_signed, document.qaqc_engineer_signed]
    inspectors = [document.site_engineer, document.qaqc_engineer]

    sigs_to_stamp: list[dict] = []
    for i, inspector in enumerate(inspectors, start=1):
        if inspector and signed_flags[i - 1]:
            marker = f"SIGMARK{i}"
            sig_key = f"signatures/{inspector.id}.png"
            has_png = storage.exists(sig_key)
            sigs_to_stamp.append(
                {
                    "marker": marker,
                    "user_id": str(inspector.id),
                    "name": inspector.signature_text or inspector.full_name,
                    "font_id": inspector.signature_font or DEFAULT_SIGNATURE_FONT,
                    "png_key": sig_key if has_png else None,
                }
            )

    if not sigs_to_stamp:
        return pdf_bytes

    from app.services.signature import SIGNATURE_FONTS

    registered_fonts: set[str] = set()
    for sig in sigs_to_stamp:
        if not sig["png_key"]:
            fid = sig["font_id"]
            if fid not in registered_fonts:
                font_file = SIGNATURE_FONTS.get(fid, SIGNATURE_FONTS["dancing_script"])
                font_path = FONTS_DIR / font_file
                try:
                    pdfmetrics.registerFont(TTFont(fid, str(font_path)))
                except Exception:
                    pass
                registered_fonts.add(fid)

    pdf_doc = fitz.open(stream=pdf_bytes, filetype="pdf")

    for sig in sigs_to_stamp:
        marker = sig["marker"]
        for page_idx in range(len(pdf_doc)):
            page = pdf_doc[page_idx]
            instances = page.search_for(marker)
            if instances:
                rect = instances[0]
                sig["page"] = page_idx
                sig["x"] = rect.x0
                sig["y"] = rect.y0
                sig["width"] = rect.width
                sig["height"] = rect.height
                sig["page_height"] = page.rect.height
                for inst in instances:
                    page.add_redact_annot(inst, fill=(1, 1, 1))
                page.apply_redactions()
                break

    redacted_bytes = pdf_doc.tobytes()
    pdf_doc.close()

    reader = PdfReader(io.BytesIO(redacted_bytes))
    writer = PdfWriter()

    cell_width = sig_cfg.get("cell_width", 75)
    cell_height = sig_cfg.get("cell_height", 25)
    x_offset = sig_cfg.get("x_offset", 0)

    for page_idx in range(len(reader.pages)):
        page = reader.pages[page_idx]
        page_width = float(page.mediabox.width)
        page_height = float(page.mediabox.height)

        page_sigs = [s for s in sigs_to_stamp if s.get("page") == page_idx]

        if page_sigs:
            overlay_buf = io.BytesIO()
            c = canvas.Canvas(overlay_buf, pagesize=(page_width, page_height))

            for sig in page_sigs:
                ucfg = user_sig_cfgs.get(sig["user_id"], sig_cfg)
                cw = ucfg.get("cell_width", cell_width)
                ch = ucfg.get("cell_height", cell_height)
                xo = ucfg.get("x_offset", x_offset)
                yo = ucfg.get("y_offset", 0)

                x = sig["x"] + xo
                y = page_height - sig["y"] - sig["height"] + yo

                if sig["png_key"]:
                    png_bytes = storage.read(sig["png_key"])
                    img = ImageReader(io.BytesIO(png_bytes))
                    iw, ih = img.getSize()
                    scale = min(cw / iw, ch / ih)
                    draw_w = iw * scale
                    draw_h = ih * scale
                    y_adj = y + (ch - draw_h) / 2
                    c.drawImage(img, x, y_adj, width=draw_w, height=draw_h, mask="auto")
                else:
                    font_id = sig["font_id"]
                    name = sig["name"]
                    font_size = 36
                    try:
                        c.setFont(font_id, font_size)
                    except Exception:
                        c.setFont("Helvetica", font_size)
                    from reportlab.pdfbase.pdfmetrics import stringWidth

                    text_width = stringWidth(name, font_id, font_size)
                    if text_width > cw and text_width > 0:
                        font_size = font_size * (cw / text_width)
                        try:
                            c.setFont(font_id, font_size)
                        except Exception:
                            c.setFont("Helvetica", font_size)
                    c.setFillColorRGB(0.1, 0.14, 0.49)
                    c.drawString(x, y, name)

            c.save()
            overlay_buf.seek(0)

            overlay_reader = PdfReader(overlay_buf)
            page.merge_page(overlay_reader.pages[0])

        writer.add_page(page)

    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


# ── PDF conversion ───────────────────────────────────────────────────────────

async def _convert_to_pdf(docx_bytes: bytes) -> bytes:
    """Convert DOCX to PDF via Gotenberg (preferred) or LibreOffice fallback."""
    import httpx

    gotenberg_url = settings.gotenberg_url.rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=GOTENBERG_TIMEOUT) as client:
            resp = await client.post(
                f"{gotenberg_url}/forms/libreoffice/convert",
                files={
                    "files": (
                        "document.docx",
                        docx_bytes,
                        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    )
                },
            )
            if resp.status_code == 200:
                return resp.content
            logger.warning(
                "Gotenberg returned %s, falling back to local LibreOffice",
                resp.status_code,
            )
    except Exception as e:
        logger.warning(
            "Gotenberg unavailable (%s), falling back to local LibreOffice", e
        )

    libre = settings.libreoffice_path
    with tempfile.TemporaryDirectory() as tmp_dir:
        docx_path = Path(tmp_dir) / "document.docx"
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
            import subprocess

            proc = await asyncio.to_thread(
                subprocess.run,
                cmd,
                capture_output=True,
                timeout=LIBREOFFICE_TIMEOUT,
            )
        except FileNotFoundError:
            raise HTTPException(
                status_code=500,
                detail="PDF engine not configured (Gotenberg down, LibreOffice not found)",
            )
        except subprocess.TimeoutExpired:
            raise HTTPException(status_code=500, detail="PDF generation timed out")
        if proc.returncode != 0:
            logger.error(
                "LibreOffice exited %s; stderr=%r",
                proc.returncode,
                proc.stderr[-500:] if proc.stderr else b"",
            )
            raise HTTPException(status_code=500, detail="Report generation failed")

        pdf_path = Path(tmp_dir) / "document.pdf"
        if not pdf_path.exists():
            raise HTTPException(status_code=500, detail="PDF not generated")
        return pdf_path.read_bytes()


# ── Attachment merger ────────────────────────────────────────────────────────

def _merge_attachments_with_status(
    main_pdf: bytes, attachments
) -> tuple[bytes, list[str]]:
    """Merge attachment files from web server storage into the main PDF.

    Raises:
        ValueError: if the total input size exceeds MAX_BUNDLE_BYTES.
    """
    try:
        from pypdf import PdfReader, PdfWriter
    except ImportError:
        return main_pdf, []

    running_total = len(main_pdf)

    writer = PdfWriter()
    reader = PdfReader(io.BytesIO(main_pdf))
    for page in reader.pages:
        writer.add_page(page)

    missing_files = []
    for att in attachments:
        if not storage.exists(att.storage_path):
            missing_files.append(att.filename)
            continue

        att_bytes = storage.read(att.storage_path)
        running_total += len(att_bytes)
        if running_total > MAX_BUNDLE_BYTES:
            raise ValueError(
                f"Bundle too large (>{_mb(MAX_BUNDLE_BYTES)}MB limit). "
                "Reduce the number or size of attachments."
            )
        suffix = Path(att.storage_path).suffix.lower()
        if suffix == ".pdf":
            try:
                att_reader = PdfReader(io.BytesIO(att_bytes))
                for page in att_reader.pages:
                    writer.add_page(page)
            except Exception:
                logger.exception("Failed to read attachment PDF %s", att.storage_path)
                missing_files.append(att.filename)
        elif suffix in (".jpg", ".jpeg", ".png"):
            try:
                from PIL import Image as PILImage
                from reportlab.lib.pagesizes import A4
                from reportlab.pdfgen import canvas as rl_canvas
                from reportlab.lib.utils import ImageReader

                with PILImage.open(io.BytesIO(att_bytes)) as img:
                    img_buf = io.BytesIO()
                    c = rl_canvas.Canvas(img_buf, pagesize=A4)
                    max_w, max_h = A4[0] - 72, A4[1] - 72
                    ratio = min(max_w / img.width, max_h / img.height)
                    w, h = img.width * ratio, img.height * ratio
                    c.drawImage(
                        ImageReader(io.BytesIO(att_bytes)),
                        36,
                        A4[1] - h - 36,
                        w,
                        h,
                    )
                    c.save()
                    img_buf.seek(0)
                    img_reader = PdfReader(img_buf)
                    for page in img_reader.pages:
                        writer.add_page(page)
            except Exception:
                logger.exception(
                    "Failed to render attachment image %s", att.storage_path
                )
                missing_files.append(att.filename)
        else:
            missing_files.append(att.filename)

    output = io.BytesIO()
    writer.write(output)

    return output.getvalue(), missing_files
