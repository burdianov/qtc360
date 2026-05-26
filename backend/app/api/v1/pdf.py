"""PDF generation endpoint using WeasyPrint for precise paged layout."""
import base64
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel as PydanticModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.document_template import DocumentTemplate
from app.models.project_header_image import ProjectHeaderImage

router = APIRouter(prefix="/pdf", tags=["pdf"])


class PDFRequest(PydanticModel):
    template_id: UUID
    # Form data to fill in data-bound fields (optional for preview)
    form_data: dict = {}


@router.post("/generate")
async def generate_pdf(
    body: PDFRequest,
    db: AsyncSession = Depends(get_db),
    _: Any = Depends(get_current_user),
):
    # Load template
    result = await db.execute(
        select(DocumentTemplate).where(
            DocumentTemplate.id == body.template_id,
            DocumentTemplate.is_deleted == False,  # noqa: E712
        )
    )
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    schema = template.schema
    if not schema:
        raise HTTPException(status_code=400, detail="Template has no schema")

    # Load all header images for this project
    img_result = await db.execute(
        select(ProjectHeaderImage).where(
            ProjectHeaderImage.project_id == template.project_id
        )
    )
    images = {img.cell_id: img for img in img_result.scalars().all()}

    # Build HTML
    html = build_html(schema, images, body.form_data)

    # Two-pass rendering: measure actual content height, then set expand rows
    from weasyprint import HTML
    import re

    placeholders = re.findall(r'EXPAND_PLACEHOLDER_(\d+)', html)
    if placeholders:
        # Get content area from WeasyPrint (no hardcoded values)
        minimal_html = re.sub(r'height:EXPAND_PLACEHOLDER_\d+pt', 'height:10pt', html)
        content_area_pt = HTML(string=minimal_html).render().pages[0]._page_box.height * 0.75

        # Process each expand section sequentially
        for i, section in enumerate(schema.get("sections", [])):
            rows = section.get("rows", [])
            if not any(r.get("expandToFooter") for r in rows):
                continue
            placeholder = f'EXPAND_PLACEHOLDER_{i}'
            if placeholder not in html:
                continue

            # Baseline: current html with this at 10pt, remaining unresolved at 10pt
            baseline_html = html.replace(f'height:{placeholder}pt', 'height:10pt')
            baseline_html = re.sub(r'height:EXPAND_PLACEHOLDER_\d+pt', 'height:10pt', baseline_html)
            baseline_pages = len(HTML(string=baseline_html).render().pages)

            # Binary search: max height that doesn't exceed baseline page count
            lo, hi = 10.0, content_area_pt
            for _ in range(25):
                mid = (lo + hi) / 2
                test_html = html.replace(f'height:{placeholder}pt', f'height:{mid}pt')
                test_html = re.sub(r'height:EXPAND_PLACEHOLDER_\d+pt', 'height:10pt', test_html)
                pages = len(HTML(string=test_html).render().pages)
                if pages <= baseline_pages:
                    lo = mid
                else:
                    hi = mid

            # Resolve this placeholder so next iteration uses it
            html = html.replace(f'height:{placeholder}pt', f'height:{lo:.1f}pt')

    pdf_bytes = HTML(string=html).write_pdf()

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": "inline; filename=preview.pdf"},
    )


def build_html(schema: dict, images: dict, form_data: dict) -> str:
    """Build HTML with CSS Paged Media for WeasyPrint."""
    margins = schema.get("margins", {"top": 20, "right": 15, "bottom": 20, "left": 15})
    font = schema.get("font", "Arial")
    font_size = schema.get("fontSize", 10)
    header_rows = schema.get("header", {}).get("rows", [])
    # Backward compat: old format was {imageUrl, height}
    if not header_rows and "height" in schema.get("header", {}):
        header_rows = [{"id": "legacy", "height": schema["header"]["height"], "cells": [], "internalBorders": True}]
    footer_sections = schema.get("footer", {}).get("sections", [])
    sections = schema.get("sections", [])

    header_height = sum(r.get("height", 60) for r in header_rows)
    footer_gap = footer_sections[0].get("gap", 5) if footer_sections else 5
    footer_height = sum(
        sum(r.get("height", 25) for r in s.get("rows", []))
        for s in footer_sections
    ) + footer_gap

    # Render header images as base64 data URIs
    def render_header():
        if not header_rows:
            return ""
        parts = []
        for ri, row in enumerate(header_rows):
            cells = row.get("cells", [])
            height = row.get("height", 60)
            internal = row.get("internalBorders", True)
            mt = "margin-top:-1px;" if ri > 0 else ""
            if not cells:
                parts.append(f'<table style="width:100%;border-collapse:collapse;height:{height}pt;border:1px solid #333;{mt}"><tr><td></td></tr></table>')
                continue
            cell_width = 100 / len(cells)
            tds = ""
            for ci, cell in enumerate(cells):
                img = images.get(cell.get("id", ""))
                border = f"border-left:1px solid #333;" if ci > 0 and internal else ""
                scale = cell.get("scale", 100) / 100
                if img:
                    b64 = base64.b64encode(img.image).decode()
                    img_tag = f'<img src="data:{img.content_type};base64,{b64}" style="max-width:100%;max-height:{height - 8}pt;object-fit:contain;transform:scale({scale});" />'
                else:
                    img_tag = ""
                tds += f'<td style="width:{cell_width}%;text-align:center;vertical-align:middle;padding:4px;height:{height}pt;{border}">{img_tag}</td>'
            parts.append(f'<table style="width:100%;table-layout:fixed;border-collapse:collapse;height:{height}pt;border:1px solid #333;{mt}"><tr style="height:{height}pt;">{tds}</tr></table>')
        return "".join(parts)

    def render_cells(cells: list, internal_borders: bool = True) -> str:
        result = ""
        for i, cell in enumerate(cells):
            width = f'{cell.get("width", 50)}%'
            border = "border-left:1px solid #333;" if internal_borders and i > 0 else ""
            cell_type = cell.get("type", "label")
            variant = cell.get("variant", "text")
            value = cell.get("value", "")
            field_key = cell.get("fieldKey", "")
            checkbox_label = cell.get("checkboxLabel", "")

            if cell_type == "label" and variant == "text":
                content = value
            elif cell_type == "label" and variant == "checkbox":
                content = f"☐ {checkbox_label}"
            elif cell_type == "data" and variant == "text":
                content = form_data.get(field_key, "")
            elif cell_type == "data" and variant == "checkbox":
                content = f"☐ {form_data.get(field_key, '')}"
            else:
                content = ""
            result += f'<td style="width:{width};padding:4px 6px;{border}">{content}</td>'
        return result

    def render_rows(rows: list) -> str:
        result = ""
        for row in rows:
            style = "border:1px solid #333;"
            if row.get("expandToFooter"):
                # This row will be in a flex container and grow to fill
                style += "flex:1;"
            else:
                style += f'height:{row.get("height", 25)}pt;'
            if row.get("isTitle"):
                style += f'background:{row.get("titleColor", "#1e3a5f")};color:#fff;font-weight:bold;'
            if row.get("bgColor"):
                style += f'background:{row.get("bgColor")};'
            if row.get("fontSize"):
                style += f'font-size:{row.get("fontSize")}pt;'
            internal = row.get("internalBorders", True)
            result += f'<tr style="{style}">{render_cells(row.get("cells", []), internal)}</tr>'
        return result

    def render_footer():
        if not footer_sections:
            return ""
        parts = []
        for section in footer_sections:
            rows = section.get("rows", [])
            parts.append(f'<table style="width:100%;border-collapse:collapse;border:1px solid #333;">{render_rows(rows)}</table>')
        return "".join(parts)

    def render_sections():
        parts = []
        for i, section in enumerate(sections):
            gap = section.get("gap", 5)
            rows = section.get("rows", [])
            has_expand = any(r.get("expandToFooter") for r in rows)
            mt = f"margin-top:{gap}pt;" if gap > 0 else ""

            if has_expand:
                row_html = ""
                for row in rows:
                    style = "border:1px solid #333;"
                    if row.get("expandToFooter"):
                        style += "height:EXPAND_PLACEHOLDER_" + str(i) + "pt;"
                    else:
                        style += f'height:{row.get("height", 25)}pt;'
                    if row.get("isTitle"):
                        style += f'background:{row.get("titleColor", "#1e3a5f")};color:#fff;font-weight:bold;'
                    if row.get("bgColor"):
                        style += f'background:{row.get("bgColor")};'
                    if row.get("fontSize"):
                        style += f'font-size:{row.get("fontSize")}pt;'
                    internal = row.get("internalBorders", True)
                    row_html += f'<tr style="{style}">{render_cells(row.get("cells", []), internal)}</tr>'
                parts.append(
                    f'<table style="width:100%;border-collapse:collapse;border:1px solid #333;{mt}">'
                    f'{row_html}</table>'
                )
            else:
                parts.append(
                    f'<table style="width:100%;border-collapse:collapse;border:1px solid #333;{mt}">'
                    f'{render_rows(rows)}</table>'
                )
        return "".join(parts)

    # WeasyPrint: position:fixed repeats on every page
    # @page margin includes space for header+footer so content never overlaps
    total_top = margins["top"] + header_height
    total_bottom = margins["bottom"] + footer_height

    html = f"""<!DOCTYPE html>
<html>
<head>
<style>
@page {{
    size: A4;
    margin: {total_top}pt {margins["right"]}pt {total_bottom}pt {margins["left"]}pt;
}}

* {{ box-sizing: border-box; margin: 0; padding: 0; }}
body {{
    font-family: {font}, sans-serif;
    font-size: {font_size}pt;
    color: #000;
}}

table {{ border-spacing: 0; }}

.page-header {{
    position: fixed;
    top: -{header_height}pt;
    left: 0;
    right: 0;
    height: {header_height}pt;
}}

.page-footer {{
    position: fixed;
    bottom: -{footer_height}pt;
    left: 0;
    right: 0;
    height: {footer_height}pt;
    padding-top: {footer_gap}pt;
}}
</style>
</head>
<body>
    <div class="page-header">{render_header()}</div>
    <div class="page-footer">{render_footer()}</div>
    {render_sections()}
</body>
</html>"""
    return html
