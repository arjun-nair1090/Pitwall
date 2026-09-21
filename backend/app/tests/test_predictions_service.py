from datetime import datetime

import pandas as pd
import pytest

from app.services.predictions_service import (
    normalize_code,
    race_has_started,
    race_start_utc,
    score_prediction,
    validate_prediction,
)


# --- validate_prediction / normalize_code -----------------------------------

def test_validate_prediction_accepts_three_distinct_codes():
    assert validate_prediction("VER", "NOR", "LEC") is None


def test_validate_prediction_accepts_lowercase_and_padded_input():
    assert validate_prediction("ver", " nor ", "Lec") is None


def test_validate_prediction_accepts_drivers_outside_the_2024_grid():
    # Codes come from the real season grid on the frontend; the server must not
    # reject a legitimate driver just because they weren't racing in 2024.
    assert validate_prediction("ANT", "BEA", "HAD") is None


@pytest.mark.parametrize("bad", ["", "VE", "VERS", "V3R", "V R", "12A", "ÜÖÄ", "ßA", "ıAB"])
def test_validate_prediction_rejects_malformed_codes(bad):
    error = validate_prediction("VER", "NOR", bad)
    assert error is not None


def test_validate_prediction_rejects_duplicate_codes():
    error = validate_prediction("VER", "VER", "LEC")
    assert error is not None
    assert "distinct" in error.lower()


def test_validate_prediction_rejects_duplicates_that_differ_only_by_case():
    # "VER" and "ver" are the same driver -- this used to slip through and get
    # stored as VER/VER/LEC.
    error = validate_prediction("VER", "ver", "LEC")
    assert error is not None
    assert "distinct" in error.lower()


def test_normalize_code_uppercases_and_strips():
    assert normalize_code("  ver ") == "VER"


# --- race_start_utc / race_has_started --------------------------------------

def _schedule_row(race_slot=5, date_value=None, date_utc_value=None, race_name="Race"):
    row = {f"Session{i}": None for i in range(1, 6)}
    row.update({f"Session{i}Date": None for i in range(1, 6)})
    row.update({f"Session{i}DateUtc": None for i in range(1, 6)})
    row[f"Session{race_slot}"] = race_name
    row[f"Session{race_slot}Date"] = date_value
    row[f"Session{race_slot}DateUtc"] = date_utc_value
    return pd.Series(row)


def test_race_start_utc_prefers_the_explicit_utc_column():
    row = _schedule_row(
        date_value=pd.Timestamp("2026-03-08 15:00:00", tz="Etc/GMT-11"),  # +11:00
        date_utc_value=pd.Timestamp("2026-03-08 04:00:00"),
    )
    assert race_start_utc(row) == pd.Timestamp("2026-03-08 04:00:00")


def test_race_start_utc_converts_tz_aware_local_time_to_utc():
    # Only the local, tz-aware column is present. 15:00 at +11:00 is 04:00 UTC --
    # merely stripping the tz would leave 15:00 and be off by the UTC offset.
    row = _schedule_row(date_value=pd.Timestamp("2026-03-08 15:00:00", tz="Etc/GMT-11"))
    assert race_start_utc(row) == pd.Timestamp("2026-03-08 04:00:00")


def test_race_start_utc_treats_naive_datetimes_as_utc():
    row = _schedule_row(date_value=pd.Timestamp("2026-03-08 04:00:00"))
    assert race_start_utc(row) == pd.Timestamp("2026-03-08 04:00:00")


def test_race_start_utc_finds_the_race_even_when_not_session5():
    # Sprint weekend: Race is Session4, not Session5
    row = _schedule_row(race_slot=4, date_utc_value=pd.Timestamp("2023-01-01 12:00:00"))
    assert race_start_utc(row) == pd.Timestamp("2023-01-01 12:00:00")


def test_race_start_utc_is_none_when_there_is_no_race_session():
    row = _schedule_row(race_name="Practice 1", date_utc_value=pd.Timestamp("2023-01-01"))
    assert race_start_utc(row) is None


def test_race_start_utc_is_none_when_the_date_is_missing():
    assert race_start_utc(_schedule_row(date_value=pd.NaT, date_utc_value=pd.NaT)) is None


def test_race_has_started_true_when_race_is_in_the_past():
    row = _schedule_row(date_utc_value=pd.Timestamp("2023-01-01"))
    assert race_has_started(row, now=datetime(2024, 1, 1)) is True


def test_race_has_started_false_when_race_is_in_the_future():
    row = _schedule_row(date_utc_value=pd.Timestamp("2030-01-01"))
    assert race_has_started(row, now=datetime(2024, 1, 1)) is False


def test_race_has_started_respects_the_track_utc_offset():
    # Race lights-out 04:00 UTC (15:00 local at +11). At 10:00 UTC the race is
    # underway. Comparing the local wall-clock 15:00 against UTC would wrongly
    # report "not started" for another five hours.
    row = _schedule_row(date_value=pd.Timestamp("2026-03-08 15:00:00", tz="Etc/GMT-11"))
    assert race_has_started(row, now=datetime(2026, 3, 8, 10, 0)) is True
    assert race_has_started(row, now=datetime(2026, 3, 8, 3, 59)) is False


def test_race_has_started_fails_closed_when_start_time_is_unknown():
    # Unknown start => predictions must stay locked rather than open indefinitely.
    assert race_has_started(_schedule_row(date_value=pd.NaT, date_utc_value=pd.NaT), now=datetime(2024, 1, 1)) is True
    assert race_has_started(_schedule_row(race_name="Qualifying", date_utc_value=pd.Timestamp("2030-01-01")), now=datetime(2024, 1, 1)) is True


# --- score_prediction --------------------------------------------------------

def test_score_prediction_exact_match_scores_25():
    assert score_prediction(("VER", "NOR", "LEC"), ("VER", "NOR", "LEC")) == 25


def test_score_prediction_right_drivers_wrong_order_scores_partial():
    assert score_prediction(("NOR", "VER", "LEC"), ("VER", "NOR", "LEC")) == 30  # 10 each, 3 correct drivers


def test_score_prediction_one_correct_driver_scores_10():
    assert score_prediction(("VER", "HAM", "ALO"), ("VER", "NOR", "LEC")) == 10


def test_score_prediction_no_correct_drivers_scores_0():
    assert score_prediction(("HAM", "ALO", "GAS"), ("VER", "NOR", "LEC")) == 0


# --- top3_from_results --------------------------------------------------------

from app.services.predictions_service import top3_from_results  # noqa: E402


def _results(rows):
    return pd.DataFrame(rows, columns=["Position", "Abbreviation"])


def test_top3_from_results_returns_the_podium_in_finishing_order():
    df = _results([(3.0, "LEC"), (1.0, "VER"), (2.0, "PER"), (4.0, "HAM")])
    assert top3_from_results(df) == ("VER", "PER", "LEC")


def test_top3_from_results_is_none_for_an_empty_or_missing_frame():
    assert top3_from_results(None) is None
    assert top3_from_results(_results([])) is None


def test_top3_from_results_is_none_when_fewer_than_three_classified():
    assert top3_from_results(_results([(1.0, "VER"), (2.0, "PER")])) is None


def test_top3_from_results_is_none_when_positions_are_not_final():
    # A partially populated result (NaN positions) must not be scored as final.
    df = _results([(1.0, "VER"), (float("nan"), "PER"), (float("nan"), "LEC"), (float("nan"), "HAM")])
    assert top3_from_results(df) is None


def test_top3_from_results_is_none_when_the_podium_is_not_p1_p2_p3():
    assert top3_from_results(_results([(2.0, "PER"), (3.0, "LEC"), (4.0, "HAM")])) is None


def test_top3_from_results_is_none_when_a_podium_code_is_missing():
    assert top3_from_results(_results([(1.0, "VER"), (2.0, None), (3.0, "LEC")])) is None


def test_top3_from_results_is_none_without_the_expected_columns():
    assert top3_from_results(pd.DataFrame({"foo": [1, 2, 3]})) is None
