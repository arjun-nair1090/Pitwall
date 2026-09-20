from datetime import datetime

import pandas as pd
import pytest

from app.services.predictions_service import (
    race_has_started,
    score_prediction,
    validate_prediction,
)


def test_validate_prediction_accepts_three_distinct_known_codes():
    assert validate_prediction("VER", "NOR", "LEC") is None


def test_validate_prediction_rejects_unknown_code():
    error = validate_prediction("VER", "NOR", "ZZZ")
    assert error is not None


def test_validate_prediction_rejects_duplicate_codes():
    error = validate_prediction("VER", "VER", "LEC")
    assert error is not None
    assert "distinct" in error.lower()


def _schedule_row(session_name_col, session_date_col, date_value):
    row = {f"Session{i}": None for i in range(1, 6)}
    row.update({f"Session{i}Date": None for i in range(1, 6)})
    row[session_name_col] = "Race"
    row[session_date_col] = date_value
    return pd.Series(row)


def test_race_has_started_true_when_race_session_is_in_the_past():
    row = _schedule_row("Session5", "Session5Date", pd.Timestamp("2023-01-01", tz="UTC"))
    assert race_has_started(row, now=datetime(2024, 1, 1)) is True


def test_race_has_started_false_when_race_session_is_in_the_future():
    row = _schedule_row("Session5", "Session5Date", pd.Timestamp("2030-01-01", tz="UTC"))
    assert race_has_started(row, now=datetime(2024, 1, 1)) is False


def test_race_has_started_finds_race_session_even_when_not_session5():
    # Sprint weekend: Race is Session4, not Session5
    row = _schedule_row("Session4", "Session4Date", pd.Timestamp("2023-01-01", tz="UTC"))
    assert race_has_started(row, now=datetime(2024, 1, 1)) is True


def test_score_prediction_exact_match_scores_25():
    assert score_prediction(("VER", "NOR", "LEC"), ("VER", "NOR", "LEC")) == 25


def test_score_prediction_right_drivers_wrong_order_scores_partial():
    assert score_prediction(("NOR", "VER", "LEC"), ("VER", "NOR", "LEC")) == 30  # 10 each, 3 correct drivers


def test_score_prediction_one_correct_driver_scores_10():
    assert score_prediction(("VER", "HAM", "ALO"), ("VER", "NOR", "LEC")) == 10


def test_score_prediction_no_correct_drivers_scores_0():
    assert score_prediction(("HAM", "ALO", "GAS"), ("VER", "NOR", "LEC")) == 0
