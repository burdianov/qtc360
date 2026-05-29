"""Signature rendering: generates signature images from name + font."""
import io
import re
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

FONTS_DIR = Path(__file__).parent.parent / "fonts"

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

DEFAULT_FONT = "dancing_script"
_HEX_COLOR_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")


def get_available_fonts() -> list[dict]:
    """Return list of available signature fonts."""
    return [
        {"id": k, "name": k.replace("_", " ").title()}
        for k in SIGNATURE_FONTS
    ]


@lru_cache(maxsize=64)
def _load_font(font_id: str, font_size: int) -> ImageFont.FreeTypeFont:
    font_file = SIGNATURE_FONTS.get(font_id, SIGNATURE_FONTS[DEFAULT_FONT])
    font_path = FONTS_DIR / font_file
    return ImageFont.truetype(str(font_path), font_size)


def render_signature(name: str, font_id: str = DEFAULT_FONT, font_size: int = 72, color: str = "#1a237e") -> bytes:
    """Render a name as a signature PNG image.

    Returns high-resolution PNG bytes suitable for embedding in DOCX via InlineImage.
    Rendered at large size so it remains crisp when zoomed in the final PDF.
    """
    if not _HEX_COLOR_RE.match(color or ""):
        color = "#1a237e"

    font = _load_font(font_id, font_size)

    # Measure text
    dummy = Image.new("RGBA", (1, 1))
    draw = ImageDraw.Draw(dummy)
    bbox = draw.textbbox((0, 0), name, font=font)
    text_w = bbox[2] - bbox[0] + 40  # padding
    text_h = bbox[3] - bbox[1] + 32

    # Render on transparent background
    img = Image.new("RGBA", (text_w, text_h), (255, 255, 255, 0))
    draw = ImageDraw.Draw(img)

    r = int(color[1:3], 16)
    g = int(color[3:5], 16)
    b = int(color[5:7], 16)

    draw.text((20, -bbox[1] + 16), name, font=font, fill=(r, g, b, 255))

    buf = io.BytesIO()
    img.save(buf, format="PNG", dpi=(300, 300))
    return buf.getvalue()

