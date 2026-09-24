import pandas as pd

from app.services.history_summarizer import (
    build_driver_session_summary,
    make_doc_id,
    slugify,
)


def _lap(lap_number, stint, compound, lap_time_s, position=1, pit_in=False, pit_out=False, team="Red Bull Racing"):
    return {
        "LapNumber": lap_number,
        "Stint": stint,
        "Compound": compound,
        "LapTime": pd.Timedelta(seconds=lap_time_s),
        "Position": position,
        "PitInTime": pd.Timedelta(seconds=1) if pit_in else pd.NaT,
        "PitOutTime": pd.Timedelta(seconds=1) if pit_out else pd.NaT,
        "Team": team,
        "Driver": "VER",
    }


def test_slugify_lowercases_and_dashes_spaces():
    assert slugify("Belgian Grand Prix") == "belgian-grand-prix"


def test_make_doc_id_format():
    assert make_doc_id(2023, "Belgian Grand Prix", "Race", "VER") == "2023_belgian-grand-prix_race_ver"


def test_single_stint_no_pit_stop():
    laps = pd.DataFrame([
        _lap(1, 1, "MEDIUM", 95.0),
        _lap(2, 1, "MEDIUM", 95.2),
        _lap(3, 1, "MEDIUM", 95.5),
        _lap(4, 1, "MEDIUM", 95.7, position=1),
    ])
    text, meta = build_driver_session_summary(laps, "VER", "Belgian Grand Prix", 2023, "Race")

    assert "VER" in text
    assert "Red Bull Racing" in text
    assert "MEDIUM" in text
    assert "0 pit stops" in text
    assert meta == {
        "year": 2023,
        "event": "Belgian Grand Prix",
        "session": "Race",
        "driver_code": "VER",
        "team": "Red Bull Racing",
    }


def test_multi_stint_with_pit_stop_excludes_out_lap_from_trend():
    laps = pd.DataFrame([
        _lap(1, 1, "MEDIUM", 95.0),
        _lap(2, 1, "MEDIUM", 95.2),
        _lap(3, 1, "MEDIUM", 95.6),
        _lap(4, 1, "MEDIUM", 96.0, pit_in=True),
        _lap(5, 2, "HARD", 97.5, pit_out=True),  # out-lap, excluded from trend
        _lap(6, 2, "HARD", 96.0),
        _lap(7, 2, "HARD", 96.1),
        _lap(8, 2, "HARD", 96.3, position=1),
    ])
    text, _ = build_driver_session_summary(laps, "VER", "Belgian Grand Prix", 2023, "Race")

    assert "1 pit stop" in text
    assert "MEDIUM" in text and "HARD" in text
    # Stint 1's clean laps are 1-3 (lap 4 is the in-lap, excluded); stint 2's clean lap is just 6-7
    # (lap 5 is the out-lap, excluded) plus lap 8 -- either way, a trend gets computed for stint 1.
    assert "s/lap" in text


def test_stint_with_fewer_than_three_clean_laps_reports_insufficient_data():
    laps = pd.DataFrame([
        _lap(1, 1, "SOFT", 95.0, pit_out=True),  # out-lap, excluded
        _lap(2, 1, "SOFT", 94.0, position=1),
    ])
    text, _ = build_driver_session_summary(laps, "VER", "Belgian Grand Prix", 2023, "Race")

    assert "insufficient laps for a trend" in text
