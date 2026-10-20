import fastf1
import pandas as pd
import pytest

from app.services import session_info as si


def _laps():
    rows = []
    # VER: 5 laps, two stints (MEDIUM x3, HARD x2). NOR: 4 laps on one stint (retired). PIA never appears.
    for n, comp, stint in [(1, "MEDIUM", 1), (2, "MEDIUM", 1), (3, "MEDIUM", 1), (4, "HARD", 2), (5, "HARD", 2)]:
        rows.append({"Driver": "VER", "LapNumber": float(n), "Stint": float(stint), "Compound": comp,
                     "LapTime": pd.Timedelta(seconds=90 + n)})
    for n in range(1, 5):
        rows.append({"Driver": "NOR", "LapNumber": float(n), "Stint": 1.0, "Compound": "SOFT",
                     "LapTime": pd.Timedelta(seconds=91 + n) if n != 2 else pd.NaT})
    return pd.DataFrame(rows)


def _results():
    return pd.DataFrame([
        {"Abbreviation": "NOR", "FullName": "Lando Norris", "TeamName": "McLaren", "TeamColor": "FF8000", "Position": 2.0, "GridPosition": 1.0, "Status": "Finished"},
        {"Abbreviation": "VER", "FullName": "Max Verstappen", "TeamName": "Red Bull Racing", "TeamColor": "3671C6", "Position": 1.0, "GridPosition": 3.0, "Status": "+1 Lap"},
        {"Abbreviation": "PIA", "FullName": "Oscar Piastri", "TeamName": "McLaren", "TeamColor": "FF8000", "Position": 3.0, "GridPosition": 2.0},
    ])


class FakeSession:
    def __init__(self, laps=None, results=None, loaded=True):
        self._laps = _laps() if laps is None else laps
        self.results = _results() if results is None else results
        self.event = {"EventName": "Belgian Grand Prix", "RoundNumber": 14}
        self._loaded = loaded

    def load(self, **kwargs):
        self.load_kwargs = kwargs

    @property
    def laps(self):
        if not self._loaded:
            raise fastf1.exceptions.DataNotLoadedError("The data you are trying to access has not been loaded yet.")
        return self._laps


@pytest.fixture(autouse=True)
def _clear_memo():
    si.clear_cache()


def _patch(monkeypatch, session, seen=None):
    def fake_get_session(year, event, name):
        if seen is not None:
            seen.append((year, event, name))
        return session

    monkeypatch.setattr(fastf1, "get_session", fake_get_session)


def test_round_number_is_preferred_over_the_name(monkeypatch):
    seen = []
    _patch(monkeypatch, FakeSession(), seen)
    si.load_session(2024, "Belgium", "R", round_number=14)
    assert seen == [(2024, 14, "R")]


def test_name_is_used_when_there_is_no_round(monkeypatch):
    seen = []
    _patch(monkeypatch, FakeSession(), seen)
    si.load_session(2024, "Belgium", "R")
    assert seen == [(2024, "Belgium", "R")]


def test_unloadable_session_becomes_a_clear_error(monkeypatch):
    _patch(monkeypatch, FakeSession(loaded=False))
    with pytest.raises(si.SessionDataError, match="hasn't taken place|no data"):
        si.load_session(2026, "Abu Dhabi", "R")


def test_empty_laps_becomes_a_clear_error(monkeypatch):
    _patch(monkeypatch, FakeSession(laps=pd.DataFrame(columns=["Driver", "LapNumber"])))
    with pytest.raises(si.SessionDataError):
        si.load_session(2024, "Belgium", "R")


def test_unknown_event_becomes_a_clear_error(monkeypatch):
    def boom(*args):
        raise ValueError("Invalid event")

    monkeypatch.setattr(fastf1, "get_session", boom)
    with pytest.raises(si.SessionDataError, match="find"):
        si.load_session(2024, "Nowhere", "R")


def test_session_info_reports_race_distance_and_only_drivers_who_ran_laps(monkeypatch):
    _patch(monkeypatch, FakeSession())
    info = si.session_info(2024, "Belgium", "R")
    assert info["total_laps"] == 5
    assert info["event_name"] == "Belgian Grand Prix"
    assert info["round"] == 14
    assert [d["code"] for d in info["drivers"]] == ["VER", "NOR"]  # PIA has results but no laps; ordered by finish


def test_session_info_carries_team_colours_and_names(monkeypatch):
    _patch(monkeypatch, FakeSession())
    ver = si.session_info(2024, "Belgium", "R")["drivers"][0]
    assert ver["name"] == "Max Verstappen"
    assert ver["team"] == "Red Bull Racing"
    assert ver["color"] == "#3671C6"


def test_session_info_reports_laps_completed_and_fastest_lap(monkeypatch):
    _patch(monkeypatch, FakeSession())
    drivers = {d["code"]: d for d in si.session_info(2024, "Belgium", "R")["drivers"]}
    assert drivers["VER"]["laps"] == 5
    assert drivers["VER"]["fastest_lap"] == 1
    assert drivers["VER"]["fastest_time"] == pytest.approx(91.0)
    assert drivers["NOR"]["laps"] == 4
    assert drivers["NOR"]["fastest_lap"] == 1  # lap 2 has no time


def test_session_info_reports_how_each_driver_finished(monkeypatch):
    _patch(monkeypatch, FakeSession())
    drivers = {d["code"]: d for d in si.session_info(2024, "Belgium", "R")["drivers"]}
    assert drivers["VER"]["status"] == "+1 Lap"
    assert drivers["NOR"]["status"] == "Finished"


def test_session_info_status_is_none_when_the_results_do_not_record_it(monkeypatch):
    results = _results().drop(columns=["Status"])
    _patch(monkeypatch, FakeSession(results=results))
    drivers = si.session_info(2024, "Belgium", "R")["drivers"]
    assert all(d["status"] is None for d in drivers)


def test_session_info_reports_each_drivers_actual_stints(monkeypatch):
    _patch(monkeypatch, FakeSession())
    drivers = {d["code"]: d for d in si.session_info(2024, "Belgium", "R")["drivers"]}
    assert drivers["VER"]["stints"] == [{"compound": "MEDIUM", "laps": 3}, {"compound": "HARD", "laps": 2}]
    assert drivers["NOR"]["stints"] == [{"compound": "SOFT", "laps": 4}]


def test_missing_results_fall_back_to_a_neutral_colour(monkeypatch):
    _patch(monkeypatch, FakeSession(results=pd.DataFrame(columns=["Abbreviation"])))
    ver = next(d for d in si.session_info(2024, "Belgium", "R")["drivers"] if d["code"] == "VER")
    assert ver["color"] == si.FALLBACK_COLOR
    assert ver["name"] == "VER"


def test_session_info_is_memoised(monkeypatch):
    seen = []
    _patch(monkeypatch, FakeSession(), seen)
    si.session_info(2024, "Belgium", "R")
    si.session_info(2024, "Belgium", "R")
    assert len(seen) == 1


# ---- helpers used by the telemetry endpoints ----

def test_driver_laps_names_the_drivers_who_did_run_when_one_is_missing():
    with pytest.raises(si.SessionDataError) as err:
        si.driver_laps(_laps(), "PIA")
    message = str(err.value)
    assert "PIA" in message and "NOR" in message and "VER" in message


def test_pick_lap_returns_the_requested_lap():
    lap = si.pick_lap(_laps(), "VER", 4)
    assert int(lap["LapNumber"]) == 4


def test_pick_lap_explains_when_the_lap_was_not_run():
    with pytest.raises(si.SessionDataError, match="lap 9.*5 laps"):
        si.pick_lap(_laps(), "VER", 9)


def test_pick_lap_defaults_to_the_fastest_timed_lap():
    lap = si.pick_lap(_laps(), "NOR")  # lap 2 has no time; lap 1 (92s) is the quickest of the rest
    assert int(lap["LapNumber"]) == 1


def test_pick_lap_rejects_a_driver_with_no_timed_laps():
    laps = _laps()
    laps.loc[laps["Driver"] == "NOR", "LapTime"] = pd.NaT
    with pytest.raises(si.SessionDataError, match="NOR.*timed lap"):
        si.pick_lap(laps, "NOR")


def test_driver_colour_uses_the_session_results():
    assert si.driver_profile(FakeSession(), "NOR")["color"] == "#FF8000"


def test_driver_colour_falls_back_for_an_unknown_driver():
    assert si.driver_profile(FakeSession(), "XXX")["color"] == si.FALLBACK_COLOR


def test_neutralised_laps_are_those_under_a_safety_car_red_flag_or_vsc():
    statuses = pd.Series(["1", "2", "4", "5", "6", "7", "124", "671", "", None, float("nan"), 1])
    assert si.neutralised_laps(statuses).tolist() == [
        False, False, True, True, True, True, True, True, False, False, False, False,
    ]


def test_a_locked_archive_says_to_sign_in_to_f1_tv(monkeypatch):
    _patch(monkeypatch, FakeSession(loaded=False))
    monkeypatch.setattr(si, "_probe_archive", lambda year: 401)
    with pytest.raises(si.SessionDataError, match="F1 TV sign-in") as err:
        si.load_session(2026, "Singapore", "R", round_number=17)
    assert "python -m fastf1 auth f1tv --authenticate" in str(err.value)


def test_a_locked_archive_explains_empty_laps_too(monkeypatch):
    _patch(monkeypatch, FakeSession(laps=pd.DataFrame(columns=["Driver", "LapNumber"])))
    monkeypatch.setattr(si, "_probe_archive", lambda year: 401)
    with pytest.raises(si.SessionDataError, match="F1 TV sign-in"):
        si.load_session(2026, "Singapore", "R", round_number=17)


def test_an_open_archive_keeps_the_no_data_message(monkeypatch):
    _patch(monkeypatch, FakeSession(loaded=False))
    monkeypatch.setattr(si, "_probe_archive", lambda year: 200)
    with pytest.raises(si.SessionDataError, match="no data"):
        si.load_session(2026, "Abu Dhabi", "R")


def test_the_archive_check_is_cached(monkeypatch):
    calls = []
    monkeypatch.setattr(si, "_probe_archive", lambda year: calls.append(year) or 401)
    assert si.archive_locked(2026) is True
    assert si.archive_locked(2026) is True
    assert calls == [2026]


def test_an_unreachable_archive_is_not_reported_as_locked(monkeypatch):
    monkeypatch.setattr(si, "_probe_archive", lambda year: None)
    assert si.archive_locked(2026) is False
