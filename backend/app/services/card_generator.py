import io
from pathlib import Path
from typing import List, Optional, Tuple

from PIL import Image, ImageDraw, ImageFont

ASSETS_DIR = Path(__file__).resolve().parent.parent / "assets" / "fonts"

CARD_WIDTH = 1200
CARD_HEIGHT = 630
BACKGROUND_COLOR = (5, 5, 8)
TEXT_PRIMARY = (255, 255, 255)
TEXT_MUTED = (150, 150, 160)
ACCENT_BAR_WIDTH = 16


def hex_to_rgb(hex_color: str) -> Tuple[int, int, int]:
    hex_color = hex_color.lstrip("#")
    return tuple(int(hex_color[i:i + 2], 16) for i in (0, 2, 4))


def wrap_text(text: str, font: ImageFont.FreeTypeFont, max_width: int) -> List[str]:
    words = text.split(" ")
    lines: List[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        bbox = font.getbbox(candidate)
        if bbox[2] - bbox[0] <= max_width:
            current = candidate
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def _font(name: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(ASSETS_DIR / name), size)


def render_result_card(
    driver_code: str,
    team_color: str,
    position: Optional[int],
    year: int,
    event_name: str,
    session_name: str,
    fastest_lap_str: str,
    strategy_text: str,
) -> bytes:
    img = Image.new("RGB", (CARD_WIDTH, CARD_HEIGHT), BACKGROUND_COLOR)
    draw = ImageDraw.Draw(img)

    accent = hex_to_rgb(team_color)
    draw.rectangle([0, 0, ACCENT_BAR_WIDTH, CARD_HEIGHT], fill=accent)

    content_left = 60

    draw.text((content_left, 40), "F1 PIT WALL", font=_font("TitilliumWeb-SemiBold.ttf", 28), fill=TEXT_MUTED)
    draw.text(
        (content_left, 80),
        f"{year} {event_name.upper()} — {session_name.upper()}",
        font=_font("TitilliumWeb-Regular.ttf", 24),
        fill=TEXT_MUTED,
    )

    draw.text((content_left, 150), driver_code.upper(), font=_font("TitilliumWeb-Bold.ttf", 160), fill=TEXT_PRIMARY)

    position_text = f"P{position}" if position else "—"
    draw.text((content_left, 330), position_text, font=_font("TitilliumWeb-Bold.ttf", 72), fill=accent)

    draw.text(
        (content_left, 430),
        f"FASTEST LAP: {fastest_lap_str}",
        font=_font("TitilliumWeb-SemiBold.ttf", 32),
        fill=TEXT_PRIMARY,
    )

    strategy_font = _font("TitilliumWeb-Regular.ttf", 22)
    wrapped = wrap_text(strategy_text, strategy_font, CARD_WIDTH - content_left - 60)
    y = 485
    for line in wrapped[:3]:
        draw.text((content_left, y), line, font=strategy_font, fill=TEXT_MUTED)
        y += 30

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()
