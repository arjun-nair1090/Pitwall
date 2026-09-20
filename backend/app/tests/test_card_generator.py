import io

from PIL import Image, ImageFont

from app.services.card_generator import (
    ASSETS_DIR,
    CARD_HEIGHT,
    CARD_WIDTH,
    hex_to_rgb,
    render_result_card,
    wrap_text,
)


def test_hex_to_rgb_parses_hash_prefixed_hex():
    assert hex_to_rgb("#3671C6") == (0x36, 0x71, 0xC6)


def test_hex_to_rgb_parses_without_hash():
    assert hex_to_rgb("E8002D") == (0xE8, 0x00, 0x2D)


def test_wrap_text_splits_long_text_into_multiple_lines():
    font = ImageFont.truetype(str(ASSETS_DIR / "TitilliumWeb-Regular.ttf"), 22)
    text = "Strategy: MEDIUM (laps 1-13, degrading ~0.08s/lap) then HARD (laps 14-44, degrading ~0.05s/lap)."
    lines = wrap_text(text, font, max_width=400)
    assert len(lines) > 1
    for line in lines:
        assert font.getbbox(line)[2] - font.getbbox(line)[0] <= 400


def test_wrap_text_keeps_short_text_on_one_line():
    font = ImageFont.truetype(str(ASSETS_DIR / "TitilliumWeb-Regular.ttf"), 22)
    lines = wrap_text("Short text.", font, max_width=1000)
    assert lines == ["Short text."]


def test_render_result_card_produces_valid_png_of_expected_size():
    png_bytes = render_result_card(
        driver_code="VER", team_color="#3671C6", position=1, year=2023,
        event_name="Belgian Grand Prix", session_name="Race",
        fastest_lap_str="1:47.291", strategy_text="Strategy: MEDIUM then HARD.",
    )
    img = Image.open(io.BytesIO(png_bytes))
    assert img.format == "PNG"
    assert img.size == (CARD_WIDTH, CARD_HEIGHT)


def test_render_result_card_uses_team_color_for_accent_bar():
    png_bytes = render_result_card(
        driver_code="VER", team_color="#3671C6", position=1, year=2023,
        event_name="Belgian Grand Prix", session_name="Race",
        fastest_lap_str="1:47.291", strategy_text="Strategy: MEDIUM then HARD.",
    )
    img = Image.open(io.BytesIO(png_bytes))
    pixel = img.getpixel((5, 5))
    assert pixel == (0x36, 0x71, 0xC6)


def test_render_result_card_handles_missing_position():
    png_bytes = render_result_card(
        driver_code="VER", team_color="#3671C6", position=None, year=2023,
        event_name="Belgian Grand Prix", session_name="Race",
        fastest_lap_str="1:47.291", strategy_text="Strategy: MEDIUM then HARD.",
    )
    img = Image.open(io.BytesIO(png_bytes))
    assert img.format == "PNG"
