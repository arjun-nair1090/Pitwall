import threading
import time

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import pit_strategy, pit_window
from app.services import session_info as si
from app.services.pit_window import PitWindowInputError

client = TestClient(app)

# code -> (offset seconds behind the leader's lap-end time, stints [(compound, first lap, last lap)])
CARS = {
    "AAA": (0.0, [("MEDIUM", 1, 6), ("HARD", 7, 12)]),
    "BBB": (2.0, [("SOFT", 1, 5), ("MEDIUM", 6, 12)]),
    "CCC": (30.0, [("HARD", 1, 7), ("MEDIUM", 8, 12)]),
}


def make_laps(cars=None, laps=12, status=None):
    cars = cars or CARS
    status = status or {}
    rows = []
    for position, (code, (offset, stints)) in enumerate(cars.items(), start=1):
        for number, (compound, first, last) in enumerate(stints, start=1):
            for lap in range(first, last + 1):
                age = lap - first + 1
                pit_in = lap == last and last < laps
                pit_out = lap == first and first > 1
                seconds = 90.0 + 0.1 * age + (0.4 if compound == "SOFT" else 0.0) - (0.3 if compound == "HARD" else 0.0)
                rows.append({
                    "Driver": code, "LapNumber": float(lap), "Position": float(position),
                    "Time": pd.Timedelta(seconds=90.0 * lap + offset),
                    "LapTime": pd.Timedelta(seconds=seconds + (25.0 if pit_in or pit_out else 0.0)),
                    "Compound": compound, "TyreLife": float(age), "Stint": float(number),
                    "TrackStatus": status.get((code, lap), "1"),
                    "PitInTime": pd.Timedelta(seconds=1) if pit_in else pd.NaT,
                    "PitOutTime": pd.Timedelta(seconds=1) if pit_out else pd.NaT,
                    "IsAccurate": True,
                })
    return pd.DataFrame(rows)


class FakeSession:
    def __init__(self, laps=None, total_laps=None, results=None):
        self.laps = make_laps() if laps is None else laps
        if total_laps is not None:
            self.total_laps = total_laps
        self.results = results if results is not None else pd.DataFrame({
            "Abbreviation": ["AAA", "BBB", "CCC"],
            "FullName": ["Ann A", "Bob B", "Cy C"],
            "TeamName": ["Red", "Blue", "Green"],
            "TeamColor": ["ff0000", "0000ff", "00ff00"],
        })


def driver(payload, code):
    return next(d for d in payload["drivers"] if d["code"] == code)


@pytest.fixture(autouse=True)
def _fresh():
    pit_window.clear_cache()
    yield
    pit_window.clear_cache()


def test_state_reads_position_compound_age_and_used():
    payload = pit_window.pit_window_payload(FakeSession(), 8)
    bbb = driver(payload, "BBB")
    assert (bbb["position"], bbb["compound"], bbb["tyre_age"]) == (2, "MEDIUM", 3)
    assert bbb["used"] == ["MEDIUM", "SOFT"]
    assert (bbb["name"], bbb["team"], bbb["color"]) == ("Bob B", "Blue", "#0000FF")
    assert driver(payload, "CCC")["used"] == ["HARD", "MEDIUM"]  # on the mediums since lap 8
    assert driver(pit_window.pit_window_payload(FakeSession(), 7), "CCC")["used"] == ["HARD"]
    assert payload["lap"] == 8 and payload["total_laps"] == 12 and payload["laps_remaining"] == 4


def test_gap_ahead_from_lap_end_times():
    laps = make_laps()
    # BBB loses a further 0.5 s every lap, so a gap read from lap 7 or 9 would differ from lap 8's
    mine = laps["Driver"] == "BBB"
    laps.loc[mine, "Time"] = laps.loc[mine, "Time"] + pd.to_timedelta(0.5 * laps.loc[mine, "LapNumber"], unit="s")
    payload = pit_window.pit_window_payload(FakeSession(laps), 8)
    assert driver(payload, "AAA")["gap_ahead"] is None
    assert driver(payload, "BBB")["gap_ahead"] == 6.0  # 2.0 + 0.5 * 8
    assert driver(payload, "CCC")["gap_ahead"] == 24.0  # 30.0 - (2.0 + 4.0)


def test_nan_lap_end_time_gives_no_gap():
    laps = make_laps()
    laps.loc[(laps["Driver"] == "BBB") & (laps["LapNumber"] == 8), "Time"] = pd.NaT
    payload = pit_window.pit_window_payload(FakeSession(laps), 8)
    assert driver(payload, "BBB")["gap_ahead"] is None
    assert driver(payload, "CCC")["gap_ahead"] is None  # its car ahead has no time either
    assert "nan" not in repr(payload).lower()


def test_only_known_laps_feed_the_model():
    laps = make_laps()
    base = pit_window.pit_window_payload(FakeSession(laps), 8)
    later = laps["LapNumber"] > 8
    laps.loc[later, "LapTime"] = pd.Timedelta(seconds=300)
    laps.loc[later, "Compound"] = "SOFT"
    laps.loc[later, "Position"] = 3.0
    laps.loc[later, "Time"] = pd.Timedelta(seconds=9999)
    assert pit_window.pit_window_payload(FakeSession(laps), 8) == base


def test_retired_driver_is_left_out():
    laps = make_laps()
    laps = laps[~((laps["Driver"] == "CCC") & (laps["LapNumber"] > 6))]
    payload = pit_window.pit_window_payload(FakeSession(laps, total_laps=12), 9)
    assert [d["code"] for d in payload["drivers"]] == ["AAA", "BBB"]


def test_total_laps_rule():
    assert pit_window.pit_window_payload(FakeSession(total_laps=15), 8)["total_laps"] == 15
    # a scheduled distance shorter than the laps run is not believed
    assert pit_window.pit_window_payload(FakeSession(total_laps=10), 8)["total_laps"] == 12
    # nor is a missing one
    assert pit_window.pit_window_payload(FakeSession(), 8)["total_laps"] == 12
    assert pit_window.pit_window_payload(FakeSession(total_laps=15), 8)["laps_remaining"] == 7
    # a float distance (FastF1 hands one back) comes out as an int
    floaty = pit_window.pit_window_payload(FakeSession(total_laps=44.0, laps=make_laps(laps=12)), 8)
    assert floaty["total_laps"] == 44 and isinstance(floaty["total_laps"], int)
    assert isinstance(floaty["laps_remaining"], int)


def test_bad_lap_is_a_422():
    for lap in (0, 12, 13, -1):
        with pytest.raises(PitWindowInputError) as err:
            pit_window.pit_window_payload(FakeSession(), lap)
        assert str(err.value) == "Pick a lap from 1 to 11."


def test_qualifying_is_a_422(monkeypatch):
    monkeypatch.setattr(pit_window, "load_session", lambda *a, **k: pytest.fail("loaded"))
    with pytest.raises(PitWindowInputError) as err:
        pit_window.pit_window_replay(2024, "Spa", "Q", None, 5)
    assert str(err.value) == "The pit window needs a race or a sprint."


def test_payload_rounding_and_order():
    payload = pit_window.pit_window_payload(FakeSession(), 6)
    assert [d["position"] for d in payload["drivers"]] == [1, 2, 3]
    assert payload["pit_loss"] == round(payload["pit_loss"], 3)
    for m in payload["model"]:
        assert m["base"] == round(m["base"], 3) and m["deg_per_lap"] == round(m["deg_per_lap"], 3)
    assert [m["compound"] for m in payload["model"]] == ["SOFT", "MEDIUM", "HARD"]
    margins = [u["margin"] for u in payload["undercuts"]]
    assert margins == sorted(margins, reverse=True)
    for d in payload["drivers"]:
        if d["best"]:
            assert d["best"]["cost"] == round(d["best"]["cost"], 1)
    assert set(payload) == {"lap", "total_laps", "laps_remaining", "pit_loss", "sc_lap",
                            "model", "drivers", "undercuts"}


def test_undercuts_are_ordered_by_margin():
    cars = {
        "AAA": (0.0, [("SOFT", 1, 3), ("HARD", 4, 12)]),
        "BBB": (2.5, [("MEDIUM", 1, 3), ("HARD", 4, 12)]),
        "CCC": (3.5, [("SOFT", 1, 2), ("MEDIUM", 3, 12)]),
    }
    results = pd.DataFrame({"Abbreviation": ["AAA", "BBB", "CCC"]})
    payload = pit_window.pit_window_payload(FakeSession(make_laps(cars), total_laps=40, results=results), 8)
    assert len(payload["undercuts"]) == 2
    margins = [u["margin"] for u in payload["undercuts"]]
    assert margins[0] > margins[1]  # the fixture's order (BBB then CCC) would be the other way round
    assert [u["chaser"] for u in payload["undercuts"]] == ["CCC", "BBB"]


def test_model_marks_unfitted_compounds_and_has_no_nan():
    payload = pit_window.pit_window_payload(FakeSession(), 2)
    assert "nan" not in repr(payload).lower()
    assert all(m["fitted"] is False for m in payload["model"])
    assert payload["pit_loss"] == 22.0


def test_fitted_compounds_use_the_fit():
    payload = pit_window.pit_window_payload(FakeSession(), 11)
    by = {m["compound"]: m for m in payload["model"]}
    assert by["MEDIUM"]["fitted"] and by["MEDIUM"]["laps"] >= 5
    assert by["MEDIUM"]["deg_per_lap"] == pytest.approx(0.1, abs=0.02)


def test_unfitted_base_is_slower_than_the_slowest_fitted():
    payload = pit_window.pit_window_payload(FakeSession(), 11)
    by = {m["compound"]: m for m in payload["model"]}
    fitted = [m["base"] for m in by.values() if m["fitted"]]
    assert fitted and not all(m["fitted"] for m in by.values())
    for m in by.values():
        if not m["fitted"]:
            assert m["base"] >= max(fitted) + pit_strategy.UNFITTED_BASE_PENALTY_S - 0.001


def test_nan_tyre_life_falls_back_to_the_stint_count():
    laps = make_laps()
    laps.loc[(laps["Driver"] == "BBB") & (laps["LapNumber"] == 8), "TyreLife"] = np.nan
    assert driver(pit_window.pit_window_payload(FakeSession(laps), 8), "BBB")["tyre_age"] == 3


def test_nan_tyre_life_and_stint_skips_the_driver():
    laps = make_laps()
    mask = (laps["Driver"] == "BBB") & (laps["LapNumber"] == 8)
    laps.loc[mask, ["TyreLife", "Stint"]] = np.nan
    payload = pit_window.pit_window_payload(FakeSession(laps), 8)
    assert [d["code"] for d in payload["drivers"]] == ["AAA", "CCC"]


def test_missing_or_unknown_compound_is_unknown_and_stays_out():
    laps = make_laps()
    laps.loc[(laps["Driver"] == "CCC") & (laps["LapNumber"] <= 8), "Compound"] = None
    laps.loc[(laps["Driver"] == "BBB") & (laps["LapNumber"] == 8), "Compound"] = "UNKNOWN"
    payload = pit_window.pit_window_payload(FakeSession(laps), 8)
    ccc, bbb = driver(payload, "CCC"), driver(payload, "BBB")
    assert ccc["compound"] == "UNKNOWN" and ccc["best"] is None and ccc["status"] == "stay out"
    assert bbb["compound"] == "UNKNOWN" and bbb["status"] == "stay out"
    assert "UNKNOWN" not in bbb["used"]


def test_nan_position_driver_is_skipped():
    laps = make_laps()
    laps.loc[(laps["Driver"] == "CCC") & (laps["LapNumber"] == 1), "Position"] = np.nan
    payload = pit_window.pit_window_payload(FakeSession(laps), 1)
    assert [d["code"] for d in payload["drivers"]] == ["AAA", "BBB"]
    assert "nan" not in repr(payload).lower()


def test_safety_car_lap_marks_cheap_stop_and_sc_lap():
    status = {(c, 6): "4" for c in CARS}
    payload = pit_window.pit_window_payload(FakeSession(laps=make_laps(status=status), total_laps=40), 6)
    assert payload["sc_lap"] is True
    assert all(d["cheap_stop"] for d in payload["drivers"])
    calm = pit_window.pit_window_payload(FakeSession(total_laps=40), 6)
    assert calm["sc_lap"] is False and not any(d["cheap_stop"] for d in calm["drivers"])


def test_undercut_pairs_use_the_car_directly_ahead():
    payload = pit_window.pit_window_payload(FakeSession(total_laps=40), 8)
    pairs = {(u["chaser"], u["leader"]) for u in payload["undercuts"]}
    assert pairs <= {("BBB", "AAA")}  # CCC is 28 s back


def test_session_is_memoised_for_a_replay(monkeypatch):
    calls = []

    def fake_load(year, gp, name, round_number=None):
        calls.append((year, gp, name, round_number))
        return FakeSession()

    monkeypatch.setattr(pit_window, "load_session", fake_load)
    a = pit_window.pit_window_replay(2024, "", "R", 14, 5)
    b = pit_window.pit_window_replay(2024, "", "R", 14, 6)
    assert len(calls) == 1 and a["lap"] == 5 and b["lap"] == 6
    assert (a["year"], a["round"], a["session"]) == (2024, 14, "R")


def test_neutralised_laps_stay_out_of_the_tyre_fit():
    cars = {"AAA": (0.0, [("MEDIUM", 1, 30)]), "BBB": (2.0, [("MEDIUM", 1, 30)])}
    neutral = range(1, 13)  # most of the known laps run behind the safety car
    status = {(c, lap): "4" for c in cars for lap in neutral}
    laps = make_laps(cars, laps=30, status=status)
    crawl = laps["LapNumber"] <= 12
    # 4% off the green pace: inside both 107% cuts, so only the neutralised-lap filter can drop them
    laps.loc[crawl, "LapTime"] = laps.loc[crawl, "LapTime"] * 1.04
    seconds = laps["LapTime"].dt.total_seconds()
    assert seconds[crawl].max() < 1.07 * seconds[~crawl].min()
    payload = pit_window.pit_window_payload(FakeSession(laps, total_laps=30), 20)
    medium = next(m for m in payload["model"] if m["compound"] == "MEDIUM")
    assert medium["fitted"] and medium["laps"] == 16  # only the 8 green laps of 2 cars count
    assert medium["deg_per_lap"] == pytest.approx(0.1, abs=0.02)
    assert medium["base"] == pytest.approx(90.0, abs=0.3)
    assert payload["sc_lap"] is False


def test_slow_laps_with_a_green_status_stay_out_of_an_early_fit():
    # FastF1 can tag a red-flag restart lap "1": lap 3 here is that, 10 to 40 s off the pace
    cars = {f"{c}{i}": (2.0 * n, [(c, 1, 8)])
            for n, (c, i) in enumerate((c, i) for c in ("SOFT", "MEDIUM", "HARD") for i in range(6))}
    laps = make_laps(cars, laps=40)
    third = laps["LapNumber"] == 3
    laps.loc[third, "LapTime"] = [pd.Timedelta(seconds=100 + 2 * n) for n in range(len(cars))]
    laps.loc[laps["LapNumber"] <= 2, ["LapTime", "IsAccurate"]] = [pd.NaT, False]
    results = pd.DataFrame({"Abbreviation": list(cars)})
    payload = pit_window.pit_window_payload(FakeSession(laps, total_laps=40, results=results), 3)
    for m in payload["model"]:
        assert m["deg_per_lap"] < 1.0
    bases = [m["base"] for m in payload["model"]]
    assert max(bases) - min(bases) < 1.0  # no compound is magically quicker than the rest
    assert all(u["gain"] < 10 for u in payload["undercuts"])


def test_a_fit_with_no_spread_of_tyre_ages_is_not_trusted():
    # every car on lap 3 has a 3-lap-old tyre: wear can't be read off that, however many laps there are
    cars = {f"{c}{i}": (2.0 * n, [(c, 1, 8)])
            for n, (c, i) in enumerate((c, i) for c in ("SOFT", "MEDIUM", "HARD") for i in range(6))}
    laps = make_laps(cars, laps=40)
    laps.loc[laps["LapNumber"] <= 2, ["LapTime", "IsAccurate"]] = [pd.NaT, False]
    laps.loc[laps["LapNumber"] == 3, "LapTime"] = [pd.Timedelta(seconds=90 + 0.7 * (n % 5)) for n in range(len(cars))]
    results = pd.DataFrame({"Abbreviation": list(cars)})
    payload = pit_window.pit_window_payload(FakeSession(laps, total_laps=40, results=results), 3)
    assert not any(m["fitted"] for m in payload["model"])
    assert [m["deg_per_lap"] for m in payload["model"]] == [0.25, 0.14, 0.07]


def test_all_neutralised_laps_fall_back_to_the_known_laps():
    status = {(c, lap): "4" for c in CARS for lap in range(1, 13)}
    payload = pit_window.pit_window_payload(FakeSession(make_laps(status=status), total_laps=40), 8)
    assert payload["sc_lap"] is True and len(payload["model"]) == 3
    assert "nan" not in repr(payload).lower()


def test_session_memo_is_bounded(monkeypatch):
    clock = {"now": 1000.0}
    monkeypatch.setattr(pit_window, "time", type("T", (), {"time": staticmethod(lambda: clock["now"])}))
    loads = []

    def fake_load(year, gp, name, round_number=None):
        loads.append(round_number)
        return FakeSession()

    monkeypatch.setattr(pit_window, "load_session", fake_load)
    for n in range(1, 6):
        clock["now"] += 1
        pit_window.pit_window_replay(2024, "", "R", n, 5)
    assert len(pit_window._sessions) == 3
    assert sorted(k[1] for k in pit_window._sessions) == [3, 4, 5]  # the oldest went first
    # expired entries are purged on the next insert
    clock["now"] += pit_window._CACHE_TTL_SECONDS + 1
    pit_window.pit_window_replay(2024, "", "R", 9, 5)
    assert [k[1] for k in pit_window._sessions] == [9]


# ---- the endpoint ----

BODY = {"year": 2024, "round": 14, "session": "R", "lap": 8}


def test_endpoint_returns_the_bare_payload(monkeypatch):
    seen = {}

    def fake(year, gp, session, round_number, lap):
        seen["args"] = (year, gp, session, round_number, lap)
        return {"drivers": [], "undercuts": []}

    monkeypatch.setattr(pit_window, "pit_window_replay", fake)
    response = client.post("/api/v1/telemetry/pit-window", json={**BODY, "session": "s"})
    assert response.status_code == 200
    assert seen["args"] == (2024, "", "S", 14, 8)
    assert response.json() == {"drivers": [], "undercuts": []}


def test_endpoint_rejects_qualifying():
    response = client.post("/api/v1/telemetry/pit-window", json={**BODY, "session": "Q"})
    assert response.status_code == 422
    assert "The pit window needs a race or a sprint." in response.text


def test_endpoint_needs_a_race_or_a_round():
    response = client.post("/api/v1/telemetry/pit-window", json={"year": 2024, "session": "R", "lap": 3})
    assert response.status_code == 422


def test_endpoint_bad_lap_is_a_422_with_the_message(monkeypatch):
    monkeypatch.setattr(pit_window, "load_session", lambda *a, **k: FakeSession())
    response = client.post("/api/v1/telemetry/pit-window", json={**BODY, "lap": 12})
    assert response.status_code == 422
    assert response.json()["detail"] == "Pick a lap from 1 to 11."


def test_endpoint_missing_data_is_a_404(monkeypatch):
    def boom(*a, **k):
        raise si.SessionDataError("nope")

    monkeypatch.setattr(pit_window, "pit_window_replay", boom)
    response = client.post("/api/v1/telemetry/pit-window", json=BODY)
    assert response.status_code == 404 and response.json()["detail"] == "nope"


def test_endpoint_failures_do_not_leak_internals(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("secret internals")

    monkeypatch.setattr(pit_window, "pit_window_replay", boom)
    response = client.post("/api/v1/telemetry/pit-window", json=BODY)
    assert response.status_code == 502
    assert "secret internals" not in response.text


def test_drivers_are_ordered_by_position_not_by_code():
    cars = {
        "CCC": (0.0, [("MEDIUM", 1, 12)]),
        "AAA": (2.0, [("MEDIUM", 1, 12)]),
        "BBB": (4.0, [("MEDIUM", 1, 12)]),
    }
    payload = pit_window.pit_window_payload(FakeSession(make_laps(cars)), 5)
    assert [d["code"] for d in payload["drivers"]] == ["CCC", "AAA", "BBB"]


def one_compound_sprint_laps():
    cars = {"AAA": (0.0, [("MEDIUM", 1, 20)]), "BBB": (2.0, [("MEDIUM", 1, 20)]),
            "CCC": (4.0, [("SOFT", 1, 8), ("MEDIUM", 9, 20)])}
    return make_laps(cars, laps=20)


def test_a_sprint_never_flags_the_two_compound_rule():
    session = FakeSession(one_compound_sprint_laps(), total_laps=20)
    race = pit_window.pit_window_payload(session, 19)
    assert driver(race, "AAA")["rule_breach"] is True  # one compound and one lap left, in a race
    sprint = pit_window.pit_window_payload(session, 19, sprint=True)
    for code in ("AAA", "BBB", "CCC"):
        d = driver(sprint, code)
        assert d["rule_breach"] is False and d["status"] == "stay out"
        assert d["best"]["stops"] == []
    # Mid-sprint a driver on one compound may simply stay out: no mandatory stop.
    mid = pit_window.pit_window_payload(session, 12, sprint=True)
    assert driver(mid, "AAA")["best"]["stops"] == []
    assert driver(pit_window.pit_window_payload(session, 12), "AAA")["best"]["stops"] != []
    # BBB, 2 s behind AAA and both only on MEDIUM, would undercut onto another compound in a race
    # but may take fresh MEDIUM (the quickest fresh tyre here) in a sprint.
    race_cut = next(u for u in pit_window.pit_window_payload(session, 12)["undercuts"] if u["chaser"] == "BBB")
    sprint_cut = next(u for u in mid["undercuts"] if u["chaser"] == "BBB")
    assert race_cut["compound"] != "MEDIUM" and sprint_cut["compound"] == "MEDIUM"


def test_the_replay_treats_session_s_as_a_sprint(monkeypatch):
    monkeypatch.setattr(pit_window, "load_session",
                        lambda *a, **k: FakeSession(one_compound_sprint_laps(), total_laps=20))
    sprint = pit_window.pit_window_replay(2024, "", "S", 6, 19)
    assert not any(d["rule_breach"] for d in sprint["drivers"])
    race = pit_window.pit_window_replay(2024, "", "R", 6, 19)
    assert driver(race, "AAA")["rule_breach"] is True


def test_pit_loss_is_the_default_until_three_stops_are_measured():
    # CARS stop on laps 5 (BBB), 6 (AAA) and 7 (CCC); a stop is measured once its out-lap is known.
    two = pit_window.pit_window_payload(FakeSession(total_laps=40), 7)
    assert two["pit_loss"] == 22.0
    three = pit_window.pit_window_payload(FakeSession(total_laps=40), 8)
    # in-lap and out-lap each carry 25 s over the pace in the fixture, so about 50 s
    assert three["pit_loss"] == pytest.approx(50.8, abs=0.5)


def test_the_bad_lap_wording_is_a_contract_with_the_page():
    # The page reads the last lap back out of this sentence: change it only with PitWindowPage.tsx.
    with pytest.raises(PitWindowInputError) as err:
        pit_window.pit_window_payload(FakeSession(total_laps=44), 44)
    assert str(err.value) == "Pick a lap from 1 to 43."


def test_concurrent_requests_load_a_session_once(monkeypatch):
    loads = []
    gate = threading.Event()

    def slow_load(year, gp, name, round_number=None):
        loads.append(round_number)
        gate.wait(2)
        return FakeSession()

    monkeypatch.setattr(pit_window, "load_session", slow_load)
    results, errors = [], []

    def call(n):
        try:
            results.append(pit_window._loaded(2024, "", "R", 14 + n % 2))
        except Exception as e:  # pragma: no cover - surfaced by the assert below
            errors.append(e)

    threads = [threading.Thread(target=call, args=(n,)) for n in range(8)]
    for t in threads:
        t.start()
    time.sleep(0.2)
    gate.set()
    for t in threads:
        t.join(5)
    assert not errors and len(results) == 8
    assert sorted(loads) == [14, 15]  # one load per key, however many callers raced for it
    assert len(pit_window._sessions) == 2


def _model(payload):
    return {m["compound"]: m for m in payload["model"]}


def test_a_compound_needs_two_drivers_and_ten_laps_to_count_as_fitted():
    # Every stint runs from lap 1 with no stop, so every known lap is a fit lap.
    def fitted_at(cars, lap):
        results = pd.DataFrame({"Abbreviation": list(cars)})
        payload = pit_window.pit_window_payload(FakeSession(make_laps(cars, laps=40), 40, results), lap)
        return _model(payload)

    two_cars = {"AAA": (0.0, [("MEDIUM", 1, 40)]), "BBB": (2.0, [("MEDIUM", 1, 40)])}
    assert fitted_at(two_cars, 4)["MEDIUM"]["fitted"] is False  # 8 laps
    five = fitted_at(two_cars, 5)["MEDIUM"]  # 10 laps, 2 drivers
    assert five["fitted"] is True and five["laps"] == 10
    lone = {"AAA": (0.0, [("MEDIUM", 1, 40)]), "BBB": (2.0, [("HARD", 1, 40)])}
    alone = fitted_at(lone, 12)["MEDIUM"]  # 12 laps but one driver
    assert alone["laps"] == 12 and alone["fitted"] is False
    assert alone["deg_per_lap"] == 0.14  # the fallback wear




def test_early_marks_a_plan_that_leans_on_an_unfitted_compound():
    cars = {
        "AAA": (0.0, [("MEDIUM", 1, 30)]),                    # only MEDIUM: must stop onto an unfitted tyre
        "BBB": (2.0, [("MEDIUM", 1, 30)]),
        "CCC": (4.0, [("HARD", 1, 6), ("MEDIUM", 7, 30)]),    # on fitted MEDIUM, both used: stays out
        "DDD": (6.0, [("MEDIUM", 1, 9), ("HARD", 10, 30)]),   # running on the unfitted HARD
    }
    results = pd.DataFrame({"Abbreviation": list(cars)})
    session = FakeSession(make_laps(cars, laps=30), 30, results)
    payload = pit_window.pit_window_payload(session, 12)
    by = _model(payload)
    assert by["MEDIUM"]["fitted"] and not by["HARD"]["fitted"] and not by["SOFT"]["fitted"]
    aaa, ccc, ddd = driver(payload, "AAA"), driver(payload, "CCC"), driver(payload, "DDD")
    assert aaa["best"]["stops"][0]["compound"] in ("SOFT", "HARD") and aaa["early"] is True
    assert ccc["best"]["stops"] == [] and ccc["early"] is False
    assert ddd["best"]["stops"] == [] and ddd["early"] is True
    # Nothing is fitted on lap 2, so every plan is an early estimate.
    assert all(d["early"] for d in pit_window.pit_window_payload(session, 2)["drivers"])


def test_early_is_false_without_a_plan_to_qualify():
    cars = {"AAA": (0.0, [("INTERMEDIATE", 1, 12)]), "BBB": (2.0, [("MEDIUM", 1, 12)])}
    laps = make_laps(cars)
    laps.loc[laps["Driver"] == "BBB", "Compound"] = None
    payload = pit_window.pit_window_payload(FakeSession(laps, 12, pd.DataFrame({"Abbreviation": list(cars)})), 2)
    assert [d["early"] for d in payload["drivers"]] == [False, False]


def test_the_tyre_model_says_when_its_pit_loss_was_measured():
    _, loss, measured = pit_window.tyre_model(make_laps())
    assert measured is True and loss > 40  # three stops, each 25 s slower in and out


def test_before_three_stops_the_given_default_pit_loss_stands_in():
    early = make_laps()
    early = early[early["LapNumber"] <= 4]
    assert pit_window.tyre_model(early, default_pit_loss=27.5)[1:] == (27.5, False)
    assert pit_window._tyre_model(early)[1] == pit_window.DEFAULT_PIT_LOSS_SECONDS
