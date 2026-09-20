import numpy as np
import pandas as pd
import pytest

from app.services.strategy_simulator import (
    FALLBACK_DEGRADATION_RATES,
    compute_compound_stats,
    estimate_pit_loss_seconds,
    get_actual_driver_total_seconds,
    simulate_stint_plan,
    validate_stint_plan,
)


def _lap(driver, lap_number, compound, tyre_life, lap_time_s, pit_in=False, pit_out=False):
    return {
        "Driver": driver,
        "LapNumber": lap_number,
        "Compound": compound,
        "TyreLife": tyre_life,
        "LapTime": pd.Timedelta(seconds=lap_time_s),
        "PitInTime": pd.Timedelta(seconds=1) if pit_in else pd.NaT,
        "PitOutTime": pd.Timedelta(seconds=1) if pit_out else pd.NaT,
    }


def test_compute_compound_stats_fits_base_pace_and_degradation():
    laps = pd.DataFrame([
        _lap("VER", 1, "MEDIUM", 0, 90.0),
        _lap("VER", 2, "MEDIUM", 1, 90.1),
        _lap("VER", 3, "MEDIUM", 2, 90.2),
        _lap("HAM", 1, "MEDIUM", 0, 90.0),
        _lap("HAM", 2, "MEDIUM", 1, 90.1),
        _lap("HAM", 3, "MEDIUM", 2, 90.2),
    ])
    stats = compute_compound_stats(laps)
    assert stats["MEDIUM"]["sample_size"] == 6
    assert stats["MEDIUM"]["base_pace"] == pytest.approx(90.0, abs=0.01)
    assert stats["MEDIUM"]["deg_rate"] == pytest.approx(0.1, abs=0.01)


def test_compute_compound_stats_excludes_pit_in_out_laps():
    laps = pd.DataFrame([
        _lap("VER", 1, "MEDIUM", 0, 90.0),
        _lap("VER", 2, "MEDIUM", 1, 90.1),
        _lap("VER", 3, "MEDIUM", 2, 90.2),
        _lap("VER", 4, "MEDIUM", 3, 130.0, pit_in=True),
    ])
    stats = compute_compound_stats(laps)
    assert stats["MEDIUM"]["sample_size"] == 3
    assert stats["MEDIUM"]["base_pace"] == pytest.approx(90.0, abs=0.01)


def test_compute_compound_stats_falls_back_to_static_rate_when_sparse():
    laps = pd.DataFrame([_lap("VER", 1, "HARD", 0, 91.0)])
    stats = compute_compound_stats(laps)
    assert stats["HARD"]["deg_rate"] == FALLBACK_DEGRADATION_RATES["HARD"]
    assert stats["HARD"]["base_pace"] == pytest.approx(91.0, abs=0.01)


def test_estimate_pit_loss_seconds_from_real_pit_stops():
    compound_stats = {"MEDIUM": {"base_pace": 90.0, "deg_rate": 0.1, "sample_size": 10}, "HARD": {"base_pace": 91.0, "deg_rate": 0.05, "sample_size": 10}}
    laps = pd.DataFrame([
        _lap("VER", 10, "MEDIUM", 9, 91.0, pit_in=True),
        _lap("VER", 11, "HARD", 0, 101.0, pit_out=True),
    ])
    loss = estimate_pit_loss_seconds(laps, compound_stats)
    assert loss == pytest.approx(11.0, abs=0.1)


def test_estimate_pit_loss_seconds_falls_back_when_no_pit_stops_in_data():
    compound_stats = {"MEDIUM": {"base_pace": 90.0, "deg_rate": 0.1, "sample_size": 10}}
    laps = pd.DataFrame([_lap("VER", 1, "MEDIUM", 0, 90.0)])
    assert estimate_pit_loss_seconds(laps, compound_stats) == 22.0


def test_validate_stint_plan_rejects_lap_count_mismatch():
    error = validate_stint_plan([{"compound": "MEDIUM", "laps": 20}], expected_total_laps=44)
    assert error is not None
    assert "44" in error


def test_validate_stint_plan_rejects_unknown_compound():
    error = validate_stint_plan([{"compound": "SLICK", "laps": 44}], expected_total_laps=44)
    assert error is not None


def test_validate_stint_plan_accepts_matching_plan():
    error = validate_stint_plan([{"compound": "MEDIUM", "laps": 20}, {"compound": "HARD", "laps": 24}], expected_total_laps=44)
    assert error is None


def test_simulate_stint_plan_computes_total_time_and_pit_stops():
    compound_stats = {"MEDIUM": {"base_pace": 90.0, "deg_rate": 0.1, "sample_size": 10}}
    result = simulate_stint_plan(compound_stats, [{"compound": "MEDIUM", "laps": 3}], pit_loss_seconds=22.0)
    assert result["predicted_total_seconds"] == pytest.approx(270.3, abs=0.01)
    assert result["num_pit_stops"] == 0
    assert result["predicted_avg_lap_seconds"] == pytest.approx(90.1, abs=0.01)


def test_simulate_stint_plan_adds_pit_loss_per_stop():
    compound_stats = {
        "MEDIUM": {"base_pace": 90.0, "deg_rate": 0.0, "sample_size": 10},
        "HARD": {"base_pace": 91.0, "deg_rate": 0.0, "sample_size": 10},
    }
    result = simulate_stint_plan(
        compound_stats,
        [{"compound": "MEDIUM", "laps": 2}, {"compound": "HARD", "laps": 2}],
        pit_loss_seconds=20.0,
    )
    assert result["predicted_total_seconds"] == pytest.approx(382.0, abs=0.01)
    assert result["num_pit_stops"] == 1


def test_get_actual_driver_total_seconds_sums_real_laps():
    laps = pd.DataFrame([
        _lap("VER", 1, "MEDIUM", 0, 90.0),
        _lap("VER", 2, "MEDIUM", 1, 90.1),
        _lap("HAM", 1, "MEDIUM", 0, 89.0),
    ])
    assert get_actual_driver_total_seconds(laps, "VER") == pytest.approx(180.1, abs=0.01)


def test_get_actual_driver_total_seconds_returns_none_for_unknown_driver():
    laps = pd.DataFrame([_lap("VER", 1, "MEDIUM", 0, 90.0)])
    assert get_actual_driver_total_seconds(laps, "XXX") is None
