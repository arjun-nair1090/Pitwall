import math
from types import SimpleNamespace

import numpy as np
import pandas as pd
import pytest

from app.services import corner_analysis as ca


def _tel(distance, speed=None, brake=None, seconds=None, x=None):
    """Telemetry on a straight line: X = Distance (unless given) and Y = 0."""
    distance = np.asarray(distance, dtype=float)
    n = len(distance)
    speed = np.full(n, 200.0) if speed is None else np.asarray(speed, dtype=float)
    seconds = distance / 30.0 if seconds is None else np.asarray(seconds, dtype=float)
    return pd.DataFrame({
        "Time": pd.to_timedelta(seconds, unit="s"),
        "Distance": distance,
        "Speed": speed,
        "Brake": np.zeros(n, dtype=bool) if brake is None else np.asarray(brake, dtype=bool),
        "X": distance if x is None else np.asarray(x, dtype=float),
        "Y": np.zeros(n),
    })


def _corner(distance, number=1, letter=""):
    return {"number": number, "letter": letter, "label": f"T{number}{letter}",
            "x": float(distance), "y": 0.0, "angle": 0.0, "distance": float(distance)}


def _session(frame=None, error=None):
    def get_circuit_info():
        if error:
            raise error
        return SimpleNamespace(corners=frame)
    return SimpleNamespace(get_circuit_info=get_circuit_info)


def test_circuit_corners_reads_the_official_list_in_lap_order():
    frame = pd.DataFrame({
        "X": [200.0, 100.0], "Y": [0.0, 5.0], "Number": [2, 1], "Letter": ["", "a"],
        "Angle": [45.0, 10.0], "Distance": [900.0, 400.0],
    })
    corners = ca.circuit_corners(_session(frame))
    assert [c["label"] for c in corners] == ["T1a", "T2"]
    assert set(corners[0]) == {"number", "letter", "label", "x", "y", "angle", "distance"}
    assert corners[0] == {"number": 1, "letter": "a", "label": "T1a", "x": 100.0, "y": 5.0,
                          "angle": 10.0, "distance": 400.0}


def test_circuit_corners_is_empty_when_fastf1_cannot_build_it():
    assert ca.circuit_corners(_session(error=RuntimeError("no circuit info"))) == []


def test_markers_snap_to_the_nearest_point_within_the_window():
    tel = _tel(np.arange(0, 1001, 10))
    corner = {**_corner(500), "x": 521.0}
    assert ca.corner_markers(tel, [corner]) == [520.0]


def test_markers_ignore_a_closer_point_outside_the_window():
    # the car crosses its own line at 900 m: that sample is nearer in X/Y than anything near 500 m
    distance = np.arange(0, 1001, 10)
    x = distance.astype(float)
    x[distance == 900] = 500.0
    tel = _tel(distance, x=x)
    assert ca.corner_markers(tel, [_corner(500)]) == [500.0]


def test_markers_fall_back_to_the_clamped_reference_distance_and_never_go_backwards():
    tel = _tel(np.arange(0, 1001, 100))
    corners = [_corner(5000), _corner(2000, number=2)]  # nothing within the window of either
    assert ca.corner_markers(tel, corners) == [1000.0, 1000.0]


def test_zone_times_add_up_to_the_lap():
    tel = _tel(np.arange(0, 3001, 50))  # 3000 m at 30 m/s
    corners = [_corner(400), _corner(1500, number=2), _corner(2600, number=3)]
    metrics = ca.corner_metrics(tel, corners)
    assert len(metrics) == 3
    lap = tel["Time"].iloc[-1].total_seconds() - tel["Time"].iloc[0].total_seconds()
    assert sum(m["zone_time"] for m in metrics) == pytest.approx(lap, abs=1e-6)


def test_apex_entry_and_exit_speeds():
    distance = np.arange(0, 1001, 100)
    speed = [300, 300, 300, 200, 90, 150, 250, 250, 250, 250, 250]
    tel = _tel(distance, speed=speed)
    metrics = ca.corner_metrics(tel, [_corner(400)])[0]
    assert metrics["apex_speed"] == 90
    assert metrics["entry_speed"] == 300
    assert metrics["exit_speed"] == pytest.approx(float(np.interp(1000, distance, speed)))


def test_brake_point_is_the_start_of_the_braking_run_before_the_apex():
    distance = np.arange(0, 1001, 10)
    speed = np.full(len(distance), 250.0)
    speed[distance == 500] = 80.0
    brake = (distance >= 380) & (distance <= 470)
    brake |= distance == 100  # an earlier dab doesn't count as the braking point
    metrics = ca.corner_metrics(_tel(distance, speed=speed, brake=brake), [_corner(500)])[0]
    assert metrics["brake_before_m"] == 120


def test_flat_out_corner_has_no_brake_point():
    distance = np.arange(0, 1001, 10)
    speed = np.full(len(distance), 300.0)
    speed[distance == 500] = 280.0
    metrics = ca.corner_metrics(_tel(distance, speed=speed), [_corner(500)])[0]
    assert metrics["brake_before_m"] is None


def test_corners_closer_than_the_sample_spacing_still_get_metrics():
    tel = _tel(np.arange(0, 2001, 100))
    metrics = ca.corner_metrics(tel, [_corner(1000), _corner(1040, number=2)])
    assert len(metrics) == 2
    for row in metrics:
        assert set(row) == {"zone_time", "apex_speed", "entry_speed", "exit_speed", "brake_before_m"}
        assert all(math.isfinite(v) for k, v in row.items() if k != "brake_before_m")
        assert row["brake_before_m"] is None


def test_no_corners_gives_no_metrics():
    assert ca.corner_metrics(_tel(np.arange(0, 1001, 100)), []) == []
