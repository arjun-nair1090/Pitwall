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
    payload = pit_window.pit_window_payload(FakeSession(), 8)
    assert driver(payload, "AAA")["gap_ahead"] is None
    assert driver(payload, "BBB")["gap_ahead"] == 2.0
    assert driver(payload, "CCC")["gap_ahead"] == 28.0


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
