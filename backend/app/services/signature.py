"""Signature rendering: generates signature images from name + font."""

import io
import re
from functools import lru_cache

from PIL import Image, ImageDraw, ImageFont

from app.core.types import DEFAULT_SIGNATURE_FONT, DEFAULT_SIGNATURE_COLOR, FONTS_DIR

# ─── Signature Rendering Constants ───────────────────────────────────────────
SIGNATURE_H_PADDING = 40
SIGNATURE_V_PADDING = 32
SIGNATURE_TEXT_X = 20
SIGNATURE_TEXT_Y_OFFSET = 16

# Available signature fonts (id → filename)
SIGNATURE_FONTS = {
    "dancing_script": "DancingScript.ttf",
    "great_vibes": "GreatVibes.ttf",
    "allura": "Allura.ttf",
    "alex_brush": "AlexBrush.ttf",
    "parisienne": "Parisienne.ttf",
    "mrs_saint_delafield": "MrsSaintDelafield.ttf",
    "herr_von_muellerhoff": "HerrVonMuellerhoff.ttf",
    "meddon": "Meddon.ttf",
    "sacramento": "Sacramento.ttf",
}

DEFAULT_FONT = DEFAULT_SIGNATURE_FONT
_HEX_COLOR_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")


def get_available_fonts() -> list[dict]:
    """Return list of available signature fonts."""
    return [{"id": k, "name": k.replace("_", " ").title()} for k in SIGNATURE_FONTS]


@lru_cache(maxsize=64)
def _load_font(font_id: str, font_size: int) -> ImageFont.FreeTypeFont:
    font_file = SIGNATURE_FONTS.get(font_id, SIGNATURE_FONTS[DEFAULT_FONT])
    font_path = FONTS_DIR / font_file
    return ImageFont.truetype(str(font_path), font_size)


# Target visual height in pixels for normalization
_TARGET_HEIGHT = 60


@lru_cache(maxsize=64)
def _normalized_font_size(font_id: str, name: str, base_size: int) -> int:
    """Find font size that produces approximately _TARGET_HEIGHT pixels of visual height."""
    font = _load_font(font_id, base_size)
    dummy = Image.new("RGBA", (1, 1))
    draw = ImageDraw.Draw(dummy)
    bbox = draw.textbbox((0, 0), name, font=font)
    actual_h = bbox[3] - bbox[1]
    if actual_h <= 0:
        return base_size
    return max(16, int(base_size * _TARGET_HEIGHT / actual_h))


def render_signature(
    name: str,
    font_id: str = DEFAULT_FONT,
    font_size: int = 72,
    color: str = DEFAULT_SIGNATURE_COLOR,
) -> bytes:
    """Render a name as a signature PNG image.

    Returns high-resolution PNG bytes suitable for embedding in DOCX via InlineImage.
    Rendered at large size so it remains crisp when zoomed in the final PDF.
    """
    if not _HEX_COLOR_RE.match(color or ""):
        color = DEFAULT_SIGNATURE_COLOR

    adjusted_size = _normalized_font_size(font_id, name, font_size)
    font = _load_font(font_id, adjusted_size)

    # Measure text
    dummy = Image.new("RGBA", (1, 1))
    draw = ImageDraw.Draw(dummy)
    bbox = draw.textbbox((0, 0), name, font=font)
    text_w = bbox[2] - bbox[0] + SIGNATURE_H_PADDING  # padding
    text_h = bbox[3] - bbox[1] + SIGNATURE_V_PADDING

    # Render on transparent background
    img = Image.new("RGBA", (text_w, text_h), (255, 255, 255, 0))
    draw = ImageDraw.Draw(img)

    r = int(color[1:3], 16)
    g = int(color[3:5], 16)
    b = int(color[5:7], 16)

    draw.text(
        (SIGNATURE_TEXT_X, -bbox[1] + SIGNATURE_TEXT_Y_OFFSET),
        name,
        font=font,
        fill=(r, g, b, 255),
    )

    buf = io.BytesIO()
    img.save(buf, format="PNG", dpi=(300, 300))
    return buf.getvalue()
