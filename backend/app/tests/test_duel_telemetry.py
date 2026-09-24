import numpy as np
import pandas as pd
import pytest

from app.services import duel_telemetry as dt


def _tel(speeds, *, throttle=None, brake=None, step_m=100.0, step_s=1.0, x0=0.0):
    n = len(speeds)
    return pd.DataFrame({
        "Time": pd.to_timedelta(np.arange(n) * step_s, unit="s"),
        "Distance": np.arange(n) * step_m,
        "Speed": np.asarray(speeds, dtype=float),
        "Throttle": np.asarray(throttle if throttle is not None else [100.0] * n, dtype=float),
        "Brake": np.asarray(brake if brake is not None else [False] * n, dtype=bool),
        "nGear": [5] * n,
        "RPM": [11000] * n,
        "DRS": [0] * n,
        "X": np.arange(n) * 10.0 + x0,
        "Y": np.arange(n) * 5.0,
    })


def test_acceleration_is_the_change_in_speed_per_second():
    tel = _tel([0, 36, 72, 108])  # +36 km/h per second = 10 m/s^2
    assert dt.acceleration(tel) == pytest.approx([10.0] * 4, abs=1e-6)


def test_acceleration_survives_repeated_timestamps():
    tel = _tel([100, 100, 100, 100])
    tel.loc[1, "Time"] = tel.loc[0, "Time"]
    assert np.isfinite(dt.acceleration(tel)).all()


def test_telemetry_points_carry_every_channel_the_charts_use():
    points = dt.telemetry_points(_tel([200, 210, 220]))
    assert len(points) == 3
    assert set(points[0]) == {"distance", "speed", "throttle", "brake", "gear", "rpm", "drs", "time", "x", "y", "acceleration"}
    assert points[1]["speed"] == 210.0
    assert points[2]["distance"] == 200.0
    assert points[1]["brake"] == 0.0


def test_telemetry_points_replace_missing_values_with_zero():
    tel = _tel([200, 210, 220])
    tel.loc[1, "Speed"] = np.nan
    assert dt.telemetry_points(tel)[1]["speed"] == 0.0


def test_pedal_shares_split_the_lap_into_four_states_summing_to_100():
    # per-sample time is the diff, so the first sample carries zero time
    tel = _tel([200] * 5,
               throttle=[100, 100, 0, 50, 0],
               brake=[False, False, True, True, False])
    shares = dt.pedal_shares(tel)
    assert shares["throttle_pct"] == pytest.approx(25.0)  # sample 1
    assert shares["brake_pct"] == pytest.approx(25.0)     # sample 2
    assert shares["both_pct"] == pytest.approx(25.0)      # sample 3
    assert shares["coast_pct"] == pytest.approx(25.0)     # sample 4
    total = sum(shares[k] for k in ("throttle_pct", "brake_pct", "both_pct", "coast_pct"))
    assert total == pytest.approx(100.0)


def test_pedal_shares_is_none_for_an_empty_or_zero_length_lap():
    assert dt.pedal_shares(_tel([])) is None
    assert dt.pedal_shares(_tel([200])) is None


def test_dominance_marks_the_faster_driver_in_each_stretch():
    fast_first_half = _tel([300] * 10 + [200] * 10)
    fast_second_half = _tel([200] * 10 + [300] * 10)
    segments = dt.dominance_segments(fast_first_half, fast_second_half, "AAA", "BBB", "#111111", "#222222", sector_m=200)
    assert segments, "expected some mini-sectors"
    assert segments[0]["dominant"] == 1 and segments[0]["dominant_driver"] == "AAA"
    assert segments[-1]["dominant"] == 2 and segments[-1]["dominant_driver"] == "BBB"
    assert segments[0]["color"] == "#111111" and segments[-1]["color"] == "#222222"
    assert all(s["speed_delta"] >= 0 for s in segments)


def test_dominance_gives_ties_to_the_first_driver():
    segments = dt.dominance_segments(_tel([250] * 20), _tel([250] * 20), "AAA", "BBB", "#111111", "#222222", sector_m=200)
    assert {s["dominant"] for s in segments} == {1}


def test_dominance_handles_a_very_short_lap_without_dividing_by_zero():
    segments = dt.dominance_segments(_tel([250] * 4), _tel([260] * 4), "AAA", "BBB", "#111111", "#222222")
    assert isinstance(segments, list)
