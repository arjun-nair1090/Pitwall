import json
import math
from types import SimpleNamespace

import numpy as np
import pandas as pd
import pytest

from app.services import corner_analysis as ca
from app.services import duel_telemetry as dt


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
    # the car crosses its own line at 900 m: that sample is strictly nearer in X/Y than anything near 500 m
    distance = np.arange(0, 1001, 10)
    x = distance.astype(float)
    x[distance == 900] = 502.0
    tel = _tel(distance, x=x)
    corner = {**_corner(500), "x": 502.0}
    assert ca.corner_markers(tel, [corner]) == [500.0]


def test_markers_never_go_backwards():
    # the second corner's nearest point (300 m) lies before the first corner's marker (500 m)
    tel = _tel(np.arange(0, 1001, 10))
    corners = [_corner(500), {**_corner(600, number=2), "x": 300.0}]
    assert ca.corner_markers(tel, corners) == [500.0, 500.0]


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


def test_braking_run_that_starts_in_the_previous_zone_is_measured_in_full():
    distance = np.arange(0, 1001, 10)
    speed = np.full(len(distance), 250.0)
    speed[distance == 500] = 80.0
    brake = (distance >= 380) & (distance <= 490)  # zone boundary between the corners is 450 m
    tel = _tel(distance, speed=speed, brake=brake)
    metrics = ca.corner_metrics(tel, [_corner(400), _corner(500, number=2)])
    assert metrics[1]["brake_before_m"] == 120


def test_apex_is_never_above_entry_or_exit_when_a_zone_ends_mid_deceleration():
    distance = np.arange(0, 1001, 100)
    speed = [250, 250, 250, 200, 150, 50, 60, 120, 200, 250, 250]
    tel = _tel(distance, speed=speed)
    metrics = ca.corner_metrics(tel, [_corner(300), _corner(600, number=2)])
    first = metrics[0]  # zone ends at 450 m, between the 150 and 50 km/h samples
    assert first["exit_speed"] == pytest.approx(100.0)
    assert first["apex_speed"] == pytest.approx(100.0)
    for row in metrics:
        assert row["apex_speed"] <= row["entry_speed"]
        assert row["apex_speed"] <= row["exit_speed"]


def test_zone_without_samples_still_gets_finite_metrics():
    distance = np.concatenate([np.arange(0, 151, 10), np.arange(850, 1001, 10)])
    tel = _tel(distance)
    corners = [_corner(100), _corner(500, number=2), _corner(950, number=3)]
    assert ca.corner_markers(tel, corners)[1] == 500.0  # fallback: no sample within the window
    middle = ca.corner_metrics(tel, corners)[1]  # zone 300-725 m falls inside the data gap
    assert all(math.isfinite(v) for k, v in middle.items() if k != "brake_before_m")
    assert middle["brake_before_m"] is None


def test_nan_samples_do_not_leak_into_the_metrics():
    distance = np.arange(0, 1001, 10)
    speed = np.full(len(distance), 250.0)
    speed[distance == 500] = 80.0
    speed[distance == 480] = np.nan
    brake = np.zeros(len(distance), dtype=object)
    brake[:] = False
    brake[distance == 490] = np.nan  # a missing flag is not braking
    tel = _tel(distance, speed=speed, brake=np.zeros(len(distance)))
    tel["Brake"] = brake
    metrics = ca.corner_metrics(tel, [_corner(500)])[0]
    assert all(v is None or math.isfinite(v) for v in metrics.values())
    assert metrics["apex_speed"] == 80
    assert metrics["brake_before_m"] is None


def _duel_laps():
    distance = np.arange(0, 2001, 10)
    fast = _tel(distance)
    slow = _tel(distance, seconds=distance / 30.0 * 1.1)
    return fast, slow, [_corner(500, 1), _corner(1000, 2, "a"), _corner(1500, 3)]


def test_corner_duel_pairs_each_corner_with_both_drivers_metrics():
    fast, slow, corners = _duel_laps()
    rows = ca.corner_duel(corners, fast, slow)
    assert [r["label"] for r in rows] == ["T1", "T2a", "T3"]
    assert rows[1]["number"] == 2 and rows[1]["letter"] == "a"
    assert (rows[1]["x"], rows[1]["y"], rows[1]["angle"]) == (1000.0, 0.0, 0.0)
    assert set(rows[0]) == {"label", "number", "letter", "x", "y", "angle", "driver1", "driver2", "time_delta"}
    assert all(r["time_delta"] > 0 for r in rows)
    assert rows[0]["driver2"]["zone_time"] > rows[0]["driver1"]["zone_time"]


def test_corner_duel_deltas_sum_to_the_lap_time_difference():
    fast, slow, corners = _duel_laps()
    rows = ca.corner_duel(corners, fast, slow)
    lap1 = fast["Time"].iloc[-1].total_seconds()
    lap2 = slow["Time"].iloc[-1].total_seconds()
    assert sum(r["time_delta"] for r in rows) == pytest.approx(lap2 - lap1)


def test_corner_duel_is_empty_without_corners():
    fast, slow, _ = _duel_laps()
    assert ca.corner_duel([], fast, slow) == []


# ---- consistency over a driver's clean laps ----

@pytest.fixture(autouse=True)
def _clear_consistency_memo():
    ca.clear_cache()


def _laps_frame(rows):
    """rows: (lap number, seconds, in-lap, out-lap, deleted)."""
    return pd.DataFrame({
        "Driver": "VER",
        "LapNumber": [r[0] for r in rows],
        "LapTime": [pd.Timedelta(seconds=r[1]) if r[1] is not None else pd.NaT for r in rows],
        "PitInTime": [pd.Timedelta(seconds=1) if r[2] else pd.NaT for r in rows],
        "PitOutTime": [pd.Timedelta(seconds=1) if r[3] else pd.NaT for r in rows],
        "Deleted": [r[4] for r in rows],
    })


def test_clean_laps_drop_pit_deleted_and_slow_laps():
    laps = _laps_frame([
        (1, 100.0, True, False, False),   # in-lap
        (2, 100.0, False, True, False),   # out-lap
        (3, 100.0, False, False, True),   # deleted
        (4, 110.0, False, False, False),  # 110% of the best
        (5, 100.0, False, False, False),
        (6, 101.0, False, False, False),
        (7, 102.0, False, False, False),
        (8, None, False, False, False),   # untimed
    ])
    assert list(ca.clean_laps(laps)["LapNumber"]) == [5, 6, 7]


def test_clean_laps_treat_a_missing_or_blank_deleted_flag_as_not_deleted():
    rows = [(1, 100.0, False, False, False), (2, 101.0, False, False, False)]
    assert list(ca.clean_laps(_laps_frame(rows).drop(columns="Deleted"))["LapNumber"]) == [1, 2]
    laps = _laps_frame(rows)
    laps["Deleted"] = [np.nan, False]
    assert list(ca.clean_laps(laps)["LapNumber"]) == [1, 2]


def _metrics(zone_time, apex=100.0, brake=50.0):
    return {"zone_time": zone_time, "apex_speed": apex, "entry_speed": 200.0, "exit_speed": 150.0, "brake_before_m": brake}


CORNERS = [_corner(100, 1), _corner(300, 2)]


def test_summary_finds_best_mean_spread_and_ideal_lap():
    per_lap = {
        7: [_metrics(10.0, apex=100.0), _metrics(20.0, apex=80.0)],
        5: [_metrics(11.0, apex=110.0), _metrics(19.0, apex=90.0)],
        6: [_metrics(12.0, apex=120.0), _metrics(21.0, apex=70.0)],
    }
    summary = ca.summarise_consistency(CORNERS, per_lap)
    assert summary["laps"] == [5, 6, 7]
    t1, t2 = summary["corners"]
    assert t1["label"] == "T1" and t1["number"] == 1 and t1["letter"] == ""
    assert t1["zone_time"] == {"best": 10.0, "mean": 11.0, "sd": pytest.approx(1.0)}
    assert t1["apex_speed"] == {"mean": pytest.approx(110.0), "sd": pytest.approx(10.0)}
    assert t2["zone_time"]["best"] == 19.0
    assert t2["zone_time"]["sd"] == pytest.approx(float(np.std([20.0, 19.0, 21.0], ddof=1)))
    assert [row["lap"] for row in t1["per_lap"]] == [5, 6, 7]
    assert [row["delta_to_best"] for row in t1["per_lap"]] == [pytest.approx(1.0), pytest.approx(2.0), 0.0]
    assert t1["per_lap"][0]["apex_speed"] == 110.0
    assert summary["ideal_lap"] == pytest.approx(29.0)   # 10 + 19
    assert summary["best_lap"] == pytest.approx(30.0)    # lap 5: 11 + 19, lap 7: 10 + 20


def test_summary_leaves_brake_point_out_for_a_corner_never_braked_for():
    per_lap = {lap: [_metrics(10.0 + lap, brake=None), _metrics(20.0, brake=40.0 + lap)] for lap in (1, 2, 3)}
    flat, braked = ca.summarise_consistency(CORNERS, per_lap)["corners"]
    assert flat["brake_before_m"] is None
    assert all(row["brake_before_m"] is None for row in flat["per_lap"])
    assert braked["brake_before_m"]["mean"] == pytest.approx(42.0)


def test_summary_uses_only_the_laps_that_braked():
    per_lap = {
        1: [_metrics(10.0, brake=60.0), _metrics(20.0)],
        2: [_metrics(10.0, brake=None), _metrics(20.0)],
        3: [_metrics(10.0, brake=80.0), _metrics(20.0)],
    }
    first = ca.summarise_consistency(CORNERS, per_lap)["corners"][0]
    assert first["brake_before_m"]["mean"] == pytest.approx(70.0)
    assert first["brake_before_m"]["sd"] == pytest.approx(float(np.std([60.0, 80.0], ddof=1)))
    assert first["per_lap"][1]["brake_before_m"] is None


CORNER_FRAME = pd.DataFrame({
    "X": [100.0, 300.0], "Y": [0.0, 0.0], "Number": [1, 2], "Letter": ["", ""],
    "Angle": [0.0, 0.0], "Distance": [100.0, 300.0],
})


class _Laps(pd.DataFrame):
    """A laps frame whose rows can be walked with iterlaps, as FastF1's can."""
    @property
    def _constructor(self):
        return _Laps

    def iterlaps(self):
        return self.iterrows()


def _patch_session(monkeypatch, lap_numbers, corners_frame=CORNER_FRAME, no_telemetry=()):
    frame = _laps_frame([(n, 100.0 + n, False, False, False) for n in lap_numbers])
    session = SimpleNamespace(
        laps=_Laps(frame),
        get_circuit_info=lambda: SimpleNamespace(corners=corners_frame),
        results=pd.DataFrame({"Abbreviation": ["VER"], "FullName": ["Max Verstappen"],
                              "TeamName": ["Red Bull"], "TeamColor": ["3671C6"]}),
    )

    def lap_telemetry(lap, code):
        number = int(lap["LapNumber"])
        if number in no_telemetry:
            raise ca.SessionDataError(f"No telemetry was recorded for {code}'s lap {number}.")
        distance = np.arange(0.0, 501.0, 10.0)
        return _tel(distance, seconds=distance / (30.0 + number))

    monkeypatch.setattr(dt, "_lap_telemetry", lap_telemetry)
    monkeypatch.setattr(ca, "load_session", lambda *a, **k: session)


def test_payload_summarises_clean_laps_with_driver_details(monkeypatch):
    _patch_session(monkeypatch, [1, 2, 3, 4])
    payload = ca.corner_consistency_payload(2024, "Belgium", "R", "VER")
    assert payload["driver"] == {"code": "VER", "name": "Max Verstappen", "team": "Red Bull", "color": "#3671C6"}
    assert payload["laps"] == [1, 2, 3, 4]
    assert [c["label"] for c in payload["corners"]] == ["T1", "T2"]
    json.dumps(payload, allow_nan=False)


def test_payload_refuses_too_few_clean_laps(monkeypatch):
    _patch_session(monkeypatch, [1, 2])
    with pytest.raises(ca.SessionDataError, match="at least 3"):
        ca.corner_consistency_payload(2024, "Belgium", "Q", "VER")


def test_payload_rechecks_the_minimum_after_skipping_laps_without_telemetry(monkeypatch):
    _patch_session(monkeypatch, [1, 2, 3], no_telemetry=[2])
    with pytest.raises(ca.SessionDataError, match="only 2 clean laps"):
        ca.corner_consistency_payload(2024, "Belgium", "R", "VER")


def test_payload_skips_a_lap_without_telemetry(monkeypatch):
    _patch_session(monkeypatch, [1, 2, 3, 4], no_telemetry=[2])
    assert ca.corner_consistency_payload(2024, "Belgium", "R", "VER")["laps"] == [1, 3, 4]


def test_payload_refuses_when_corner_data_is_missing(monkeypatch):
    _patch_session(monkeypatch, [1, 2, 3, 4], corners_frame=None)
    with pytest.raises(ca.SessionDataError, match="Corner data isn't available for this session."):
        ca.corner_consistency_payload(2024, "Belgium", "R", "VER")


def test_payload_is_memoised(monkeypatch):
    _patch_session(monkeypatch, [1, 2, 3, 4])
    first = ca.corner_consistency_payload(2024, "Belgium", "R", "VER")
    monkeypatch.setattr(ca, "load_session", lambda *a, **k: pytest.fail("should be served from the memo"))
    assert ca.corner_consistency_payload(2024, "Belgium", "R", "VER") is first
