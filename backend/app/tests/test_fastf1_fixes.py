import fastf1
import pandas as pd

from app.services import fastf1_fixes


def test_day_prefixed_car_and_position_lines_get_a_plain_timestamp():
    # The 2026 Mexico City race feed opened a day early, so its lines run past 24 hours as
    # "1.01:46:26.209..."; FastF1 slices a fixed 12-character "HH:MM:SS.mmm" off the front.
    lines = ['00:10:16.432"abc"', '1.01:46:26.209"def"', '12.03:00:00.000"ghi"']
    fetch = fastf1_fixes.day_tolerant(lambda path, name: lines)
    assert fetch("/static/x/", "car_data") == ['00:10:16.432"abc"', '01:46:26.209"def"', '03:00:00.000"ghi"']
    assert fetch("/static/x/", "position") == ['00:10:16.432"abc"', '01:46:26.209"def"', '03:00:00.000"ghi"']


def test_other_pages_pass_through_untouched():
    parsed = {"Messages": []}
    assert fastf1_fixes.day_tolerant(lambda path, name: parsed)("/static/x/", "race_control_messages") is parsed


def test_fastf1_uses_the_patched_fetch():
    assert fastf1._api.fetch_page.__wrapped__ is not None


def test_a_stand_in_with_none_for_a_team_gets_the_team_mates_team_and_a_blank_name():
    # F1's driver list for Hirakawa at the 2026 Mexico City GP; only Ergast's TeamId was real.
    results = pd.DataFrame({
        "Abbreviation": ["BEA", "HIR", "ALB"],
        "FullName": ["Oliver Bearman", "None None", "Alexander Albon"],
        "TeamName": ["Haas F1 Team", "None", "Williams"],
        "TeamColor": ["9C9FA2", "None", "1868DB"],
        "TeamId": ["haas", "haas", "williams"],
    })
    out = fastf1_fixes.fill_placeholders(results).set_index("Abbreviation")
    assert out.loc["HIR", "TeamName"] == "Haas F1 Team"
    assert out.loc["HIR", "TeamColor"] == "9C9FA2"
    assert pd.isna(out.loc["HIR", "FullName"])
    assert out.loc["ALB", "TeamName"] == "Williams"


def test_fastf1_uses_the_cleaned_results():
    assert fastf1.core.Session._load_drivers_results.pitwall_cleaned
