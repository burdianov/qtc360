"""Signature rendering: generates signature images from name + font."""
import io
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


def get_available_fonts() -> list[dict]:
    """Return list of available signature fonts."""
    return [
        {"id": k, "name": k.replace("_", " ").title()}
        for k in SIGNATURE_FONTS
    ]


def render_signature(name: str, font_id: str = DEFAULT_FONT, font_size: int = 48, color: str = "#1a237e") -> bytes:
    """Render a name as a signature PNG image.
    
    Returns PNG bytes suitable for embedding in DOCX via InlineImage.
    """
    font_file = SIGNATURE_FONTS.get(font_id, SIGNATURE_FONTS[DEFAULT_FONT])
    font_path = FONTS_DIR / font_file

    font = ImageFont.truetype(str(font_path), font_size)

    # Measure text
    dummy = Image.new("RGBA", (1, 1))
    draw = ImageDraw.Draw(dummy)
    bbox = draw.textbbox((0, 0), name, font=font)
    text_w = bbox[2] - bbox[0] + 20  # padding
    text_h = bbox[3] - bbox[1] + 16

    # Render on transparent background
    img = Image.new("RGBA", (text_w, text_h), (255, 255, 255, 0))
    draw = ImageDraw.Draw(img)

    # Parse color
    r = int(color[1:3], 16)
    g = int(color[3:5], 16)
    b = int(color[5:7], 16)

    draw.text((10, -bbox[1] + 8), name, font=font, fill=(r, g, b, 255))

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()
