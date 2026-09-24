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


# ---- fuel-corrected model ----

def _race(base=None, deg=None, fuel=-0.05, plans=None):
    """Synthetic multi-driver race with known coefficients: t = base[c] + deg[c]*tyre_life + fuel*(lap-1)."""
    base = base or {"MEDIUM": 90.0, "HARD": 90.8}
    deg = deg or {"MEDIUM": 0.10, "HARD": 0.05}
    plans = plans or {
        "AAA": [("MEDIUM", 20), ("HARD", 30)],
        "BBB": [("HARD", 30), ("MEDIUM", 20)],
        "CCC": [("MEDIUM", 10), ("HARD", 30), ("MEDIUM", 10)],
    }
    rows = []
    for driver, stints in plans.items():
        lap = 0
        for compound, count in stints:
            for tyre_life in range(1, count + 1):
                lap += 1
                seconds = base[compound] + deg[compound] * tyre_life + fuel * (lap - 1)
                rows.append(_lap(driver, lap, compound, tyre_life, seconds))
    return pd.DataFrame(rows)


def test_fuel_burn_off_is_separated_from_tyre_degradation():
    stats = compute_compound_stats(_race())
    assert stats["MEDIUM"]["fuel_rate"] == pytest.approx(-0.05, abs=0.005)
    assert stats["MEDIUM"]["deg_rate"] == pytest.approx(0.10, abs=0.01)
    assert stats["HARD"]["deg_rate"] == pytest.approx(0.05, abs=0.01)
    assert stats["MEDIUM"]["base_pace"] == pytest.approx(90.0, abs=0.2)


def test_tyres_never_get_faster_with_age():
    # Laps only improve with fuel burn: with fuel effect removed there is no wear, so deg must not go negative.
    stats = compute_compound_stats(_race(deg={"MEDIUM": 0.0, "HARD": 0.0}, fuel=-0.08))
    assert stats["MEDIUM"]["deg_rate"] >= 0.0
    assert stats["HARD"]["deg_rate"] >= 0.0


def test_fuel_effect_is_not_invented_when_it_cannot_be_separated_from_wear():
    # one driver, one stint: tyre age and lap number are the same thing, so no fuel correction is applied
    laps = pd.DataFrame([_lap("VER", n, "MEDIUM", n, 90 + 0.1 * n) for n in range(1, 41)])
    stats = compute_compound_stats(laps)
    assert stats["MEDIUM"]["fuel_rate"] == 0.0
    assert stats["MEDIUM"]["deg_rate"] == pytest.approx(0.1, abs=0.01)


def test_simulation_applies_the_fuel_effect_across_the_race():
    stats = {"MEDIUM": {"base_pace": 90.0, "deg_rate": 0.0, "fuel_rate": -0.1, "sample_size": 10}}
    result = simulate_stint_plan(stats, [{"compound": "MEDIUM", "laps": 3}], pit_loss_seconds=22.0)
    assert result["predicted_total_seconds"] == pytest.approx(90.0 + 89.9 + 89.8, abs=0.001)


def test_simulation_reports_each_stints_lap_range_and_time():
    stats = {
        "MEDIUM": {"base_pace": 90.0, "deg_rate": 0.0, "sample_size": 10},
        "HARD": {"base_pace": 91.0, "deg_rate": 0.0, "sample_size": 10},
    }
    result = simulate_stint_plan(stats, [{"compound": "MEDIUM", "laps": 2}, {"compound": "HARD", "laps": 3}], pit_loss_seconds=20.0)
    first, second = result["stints"]
    assert (first["compound"], first["start_lap"], first["end_lap"], first["laps"]) == ("MEDIUM", 1, 2, 2)
    assert first["seconds"] == pytest.approx(180.0)
    assert (second["compound"], second["start_lap"], second["end_lap"]) == ("HARD", 3, 5)
    assert second["seconds"] == pytest.approx(273.0)
    assert second["avg_lap_seconds"] == pytest.approx(91.0)


def test_validation_says_how_many_laps_are_missing_or_extra():
    short = validate_stint_plan([{"compound": "MEDIUM", "laps": 40}], expected_total_laps=44)
    long = validate_stint_plan([{"compound": "MEDIUM", "laps": 50}], expected_total_laps=44)
    assert "4 laps short" in short and "44" in short
    assert "6 laps over" in long and "44" in long


def test_actual_total_uses_the_clock_when_lap_one_has_no_time():
    laps = pd.DataFrame([
        {"Driver": "VER", "LapNumber": 1, "LapTime": pd.NaT,
         "LapStartTime": pd.Timedelta(seconds=3600), "Time": pd.Timedelta(seconds=3695)},
        {"Driver": "VER", "LapNumber": 2, "LapTime": pd.Timedelta(seconds=90),
         "LapStartTime": pd.Timedelta(seconds=3695), "Time": pd.Timedelta(seconds=3785)},
    ])
    assert get_actual_driver_total_seconds(laps, "VER") == pytest.approx(185.0)


def test_actual_total_is_withheld_for_a_driver_who_did_not_finish_the_distance():
    laps = pd.DataFrame([_lap("VER", n, "MEDIUM", n, 90.0) for n in range(1, 11)])
    assert get_actual_driver_total_seconds(laps, "VER", expected_laps=44) is None
    assert get_actual_driver_total_seconds(laps, "VER", expected_laps=10) == pytest.approx(900.0)
