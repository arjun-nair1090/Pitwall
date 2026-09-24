import numpy as np
import pandas as pd
import pytest

from app.services import race_replay as rr
from app.services import session_info as si


def td(seconds):
    return pd.Timedelta(seconds=seconds)


# ---- lap windows ----

def _laps():
    # Two drivers, three laps. AAA leads; BBB finishes each lap 4 s later.
    rows = []
    for drv, num, offset in (("AAA", "1", 0.0), ("BBB", "2", 4.0)):
        for lap in (1, 2, 3):
            end = 100.0 * lap + offset
            rows.append({
                "Driver": drv, "DriverNumber": num, "LapNumber": float(lap), "Position": 1.0 if drv == "AAA" else 2.0,
                "LapStartTime": td(end - 100.0), "Time": td(end), "LapTime": td(100.0),
                "Compound": "MEDIUM", "TyreLife": float(lap), "PitInTime": pd.NaT, "PitOutTime": pd.NaT,
            })
    return pd.DataFrame(rows)


def test_the_window_is_the_leaders_lap():
    assert rr.lap_window(_laps(), 2) == (100.0, 200.0)


def test_the_window_falls_back_to_lap_time_when_the_start_is_missing():
    laps = _laps()
    laps.loc[(laps["Driver"] == "AAA") & (laps["LapNumber"] == 2), "LapStartTime"] = pd.NaT
    assert rr.lap_window(laps, 2) == (100.0, 200.0)


def test_the_window_falls_back_to_the_previous_lap_end():
    laps = _laps()
    mask = (laps["Driver"] == "AAA") & (laps["LapNumber"] == 2)
    laps.loc[mask, ["LapStartTime", "LapTime"]] = pd.NaT
    assert rr.lap_window(laps, 2) == (100.0, 200.0)


def test_a_lap_the_race_never_reached_is_explained():
    with pytest.raises(si.SessionDataError, match="only 3 laps"):
        rr.lap_window(_laps(), 9)


def test_lap_numbers_start_at_one():
    with pytest.raises(si.SessionDataError):
        rr.lap_window(_laps(), 0)


# ---- resampling ----

def test_the_grid_runs_from_zero_to_the_end_of_the_window_inclusive():
    assert rr.frame_times(2.0, 0.5).tolist() == [0.0, 0.5, 1.0, 1.5, 2.0]


def test_the_grid_always_ends_exactly_on_the_window_end():
    times = rr.frame_times(2.2, 0.5)
    assert times[0] == 0.0 and times[-1] == pytest.approx(2.2)
    assert np.all(np.diff(times) > 0)


def test_smooth_channels_are_interpolated_between_samples():
    session_times = np.array([10.0, 12.0])
    assert rr.interpolate(session_times, np.array([0.0, 100.0]), np.array([10.0, 11.0, 12.0])).tolist() == [0.0, 50.0, 100.0]


def test_stepped_channels_hold_the_last_value_rather_than_blending():
    session_times = np.array([10.0, 12.0, 14.0])
    gears = np.array([3, 4, 5])
    assert rr.hold(session_times, gears, np.array([10.0, 11.9, 12.0, 13.9])).tolist() == [3, 3, 4, 4]


def test_holding_before_the_first_sample_uses_the_first_value():
    assert rr.hold(np.array([10.0, 12.0]), np.array([3, 4]), np.array([5.0])).tolist() == [3]


# ---- the payload ----

class FakeReplaySession:
    def __init__(self, laps=None):
        self.laps = _laps() if laps is None else laps
        self.event = {"EventName": "Test Grand Prix", "Location": "Testville", "RoundNumber": 7}
        self.results = pd.DataFrame([
            {"Abbreviation": "AAA", "DriverNumber": "1", "FullName": "Ann Ahead", "TeamName": "Red", "TeamColor": "FF0000", "Position": 1.0},
            {"Abbreviation": "BBB", "DriverNumber": "2", "FullName": "Bob Behind", "TeamName": "Blue", "TeamColor": "0000FF", "Position": 2.0},
        ])
        # 0.25 s samples over 0..400 s. Position: x = time, y = 2*time. Speed = time/10.
        times = np.arange(0, 400.0, 0.25)
        self.pos_data = {}
        self.car_data = {}
        for num, lag in (("1", 0.0), ("2", 4.0)):
            lagged = times - lag
            self.pos_data[num] = pd.DataFrame({"SessionTime": pd.to_timedelta(times, unit="s"), "X": lagged * 1.0, "Y": lagged * 2.0})
            self.car_data[num] = pd.DataFrame({
                "SessionTime": pd.to_timedelta(times, unit="s"),
                "Speed": lagged / 10.0, "Throttle": np.full(len(times), 100.0), "Brake": np.zeros(len(times), dtype=bool),
                "nGear": np.full(len(times), 5), "RPM": np.full(len(times), 11000.0), "DRS": np.zeros(len(times), dtype=int),
            })


@pytest.fixture(autouse=True)
def _fresh_session_cache():
    rr.clear_cache()
    yield
    rr.clear_cache()


@pytest.fixture
def replay(monkeypatch):
    fake = FakeReplaySession()
    monkeypatch.setattr(rr, "load_session", lambda *a, **k: fake)
    return rr.replay_payload(2024, "", "R", 2, round_number=7, step=0.5)


def test_the_payload_describes_the_race_and_the_window(replay):
    assert replay["lap"] == 2 and replay["total_laps"] == 3
    assert replay["event_name"] == "Test Grand Prix" and replay["round"] == 7
    assert replay["step"] == 0.5 and replay["duration"] == 100.0
    assert replay["frames"] == 201


def test_every_driver_has_one_value_per_frame_for_every_channel(replay):
    for d in replay["drivers"]:
        for channel in ("x", "y", "speed", "throttle", "brake", "gear", "rpm", "drs"):
            assert len(d[channel]) == replay["frames"], (d["code"], channel)


def test_cars_are_placed_by_real_session_time_so_gaps_are_kept(replay):
    ahead, behind = replay["drivers"]
    assert ahead["code"] == "AAA" and behind["code"] == "BBB"
    # at the start of the window (session time 100) AAA is at x=100 and BBB, four seconds behind, at x=96
    assert ahead["x"][0] == 100 and behind["x"][0] == 96
    assert ahead["y"][0] == 200 and behind["y"][0] == 192
    # both move at the same pace, so the gap persists to the end of the lap
    assert ahead["x"][-1] - behind["x"][-1] == 4


def test_drivers_come_with_their_real_name_team_and_colour(replay):
    ahead = replay["drivers"][0]
    assert (ahead["name"], ahead["team"], ahead["color"], ahead["number"]) == ("Ann Ahead", "Red", "#FF0000", "1")


def test_the_order_at_the_end_of_the_lap_has_gaps_and_tyres(replay):
    first, second = replay["order"]
    assert (first["code"], first["position"], first["gap_to_leader"]) == ("AAA", 1, 0.0)
    assert (second["code"], second["position"], second["gap_to_leader"]) == ("BBB", 2, 4.0)
    assert first["compound"] == "MEDIUM" and first["tyre_age"] == 2
    assert first["lap_time"] == 100.0


def test_a_driver_who_has_stopped_racing_is_marked_inactive(monkeypatch):
    laps = _laps()
    laps = laps[~((laps["Driver"] == "BBB") & (laps["LapNumber"] >= 2))]   # BBB retires after lap 1
    fake = FakeReplaySession(laps)
    monkeypatch.setattr(rr, "load_session", lambda *a, **k: fake)
    payload = rr.replay_payload(2024, "", "R", 2, round_number=7, step=0.5)
    flags = {d["code"]: d["active"] for d in payload["drivers"]}
    assert flags == {"AAA": True, "BBB": False}
    assert [o["code"] for o in payload["order"]] == ["AAA"]


def test_the_outline_is_the_leaders_line_at_full_resolution(replay):
    outline = replay["outline"]
    assert len(outline["x"]) == len(outline["y"]) > replay["frames"]     # finer than the frame grid
    assert outline["x"][0] == 100


def test_the_payload_has_only_plain_numbers_so_it_serialises(replay):
    import json
    json.dumps(replay)   # numpy scalars would raise here


def test_a_lap_beyond_the_race_is_explained(monkeypatch):
    monkeypatch.setattr(rr, "load_session", lambda *a, **k: FakeReplaySession())
    with pytest.raises(si.SessionDataError, match="only 3 laps"):
        rr.replay_payload(2024, "", "R", 9, round_number=7)


def test_a_session_without_position_data_is_explained(monkeypatch):
    fake = FakeReplaySession()
    fake.pos_data = {}
    monkeypatch.setattr(rr, "load_session", lambda *a, **k: fake)
    with pytest.raises(si.SessionDataError, match="position data"):
        rr.replay_payload(2024, "", "R", 2, round_number=7)


def test_a_loaded_race_is_kept_so_stepping_through_laps_is_quick(monkeypatch):
    loads = []
    fake = FakeReplaySession()

    def counting_load(*args, **kwargs):
        loads.append(args)
        return fake

    monkeypatch.setattr(rr, "load_session", counting_load)
    rr.replay_payload(2024, "", "R", 1, round_number=7)
    rr.replay_payload(2024, "", "R", 2, round_number=7)
    rr.replay_payload(2024, "", "R", 3, round_number=7)
    assert len(loads) == 1


def test_only_a_few_races_are_kept_in_memory(monkeypatch):
    loads = []
    monkeypatch.setattr(rr, "load_session", lambda *a, **k: loads.append(a) or FakeReplaySession())
    for round_number in (1, 2, 3, 4):
        rr.replay_payload(2024, "", "R", 1, round_number=round_number)
    rr.replay_payload(2024, "", "R", 1, round_number=1)    # evicted, so it loads again
    assert len(loads) == 5
