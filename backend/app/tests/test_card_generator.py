import io

from PIL import Image, ImageDraw, ImageFont

from app.services.card_generator import (
    ASSETS_DIR,
    CARD_HEIGHT,
    CARD_WIDTH,
    F1_RED,
    draw_wordmark,
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


def test_wordmark_splits_pit_and_wall_with_a_red_slash():
    img = Image.new("RGB", (600, 120), (0, 0, 0))
    end = draw_wordmark(ImageDraw.Draw(img), 20, 80, 30, (150, 150, 160))
    pixels = img.load()
    red_columns = sorted({x for x in range(600) for y in range(120) if pixels[x, y] == F1_RED})
    letter_columns = sorted({x for x in range(600) for y in range(120) if pixels[x, y] == (150, 150, 160)})
    assert red_columns, "the slash is drawn in F1 red"
    # Letters on both sides of the slash: PIT before it, WALL after it.
    assert letter_columns[0] < red_columns[0] and letter_columns[-1] > red_columns[-1]
    assert 20 < end < 600


def test_result_card_header_carries_the_wordmark():
    png = render_result_card(
        driver_code="VER", team_color="#3671C6", position=1, year=2023, event_name="Belgian Grand Prix",
        session_name="Race", fastest_lap_str="1:47.305", strategy_text="One stop.",
    )
    img = Image.open(io.BytesIO(png)).convert("RGB")
    header = [img.getpixel((x, y)) for x in range(60, 500) for y in range(30, 75)]
    assert F1_RED in header
