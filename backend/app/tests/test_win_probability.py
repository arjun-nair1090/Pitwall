import threading
import time

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import pit_strategy, pit_window, win_probability as wp
from app.services import session_info as si
from app.services.pit_strategy import DriverState
from app.services.pit_window import PitWindowInputError

client = TestClient(app)

# code -> (offset seconds behind the leader's lap-end time, stints [(compound, first lap, last lap)])
CARS = {
    "AAA": (0.0, [("MEDIUM", 1, 6), ("HARD", 7, 12)]),
    "BBB": (2.0, [("SOFT", 1, 5), ("MEDIUM", 6, 12)]),
    "CCC": (30.0, [("HARD", 1, 7), ("MEDIUM", 8, 12)]),
}


def make_laps(cars=None, laps=12, status=None, last=None):
    """`last` maps a code to the last lap it runs (a retirement)."""
    cars = cars or CARS
    status = status or {}
    last = last or {}
    rows = []
    for position, (code, (offset, stints)) in enumerate(cars.items(), start=1):
        for number, (compound, first, end) in enumerate(stints, start=1):
            for lap in range(first, end + 1):
                if lap > last.get(code, 999):
                    continue
                age = lap - first + 1
                pit_in = lap == end and end < laps
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
    def __init__(self, laps=None, total_laps=None):
        self.laps = make_laps() if laps is None else laps
        if total_laps is not None:
            self.total_laps = total_laps
        self.results = pd.DataFrame({
            "Abbreviation": ["AAA", "BBB", "CCC"],
            "FullName": ["Ann A", "Bob B", "Cy C"],
            "TeamName": ["Red", "Blue", "Green"],
            "TeamColor": ["ff0000", "0000ff", "00ff00"],
        })


@pytest.fixture(autouse=True)
def _fresh():
    pit_window.clear_cache()
    wp.clear_cache()
    yield
    pit_window.clear_cache()
    wp.clear_cache()


def payload(session=None, lap=6, **kw):
    return wp.win_probability_payload(session or FakeSession(), lap, year=2024, round_number=1, **kw)


def rows(p):
    return {r["code"]: r for r in p["at"]["rows"]}


# ---- the Monte Carlo ----

def sim(F, R, sigma=0.5, seed=1, sims=8000):
    return wp.simulate_winner(np.asarray(F, float), R, sigma, np.random.default_rng(seed), sims)


def test_a_big_lead_late_is_near_certain():
    assert sim([0.0, 20.0], R=3)[0] > 0.98


def test_a_close_fight_is_near_even():
    p = sim([0.0, 0.0], R=30)
    assert 0.4 < p[0] < 0.6 and 0.4 < p[1] < 0.6


def test_more_laps_left_means_less_certainty():
    assert sim([0.0, 10.0], R=40)[0] < sim([0.0, 10.0], R=5)[0]


def test_safety_car_compression_helps_the_chaser(monkeypatch):
    monkeypatch.setattr(wp, "SC_RATE", 0.0)
    without = sim([0.0, 15.0], R=30, sims=20000)[1]
    monkeypatch.setattr(wp, "SC_RATE", 0.012)
    with_sc = sim([0.0, 15.0], R=30, sims=20000)[1]
    assert with_sc > without + 0.01


def test_a_driver_who_is_out_has_zero():
    p = sim([0.0, 1.0, np.inf], R=10)
    assert p[2] == 0.0 and p.sum() <= 1.0


def test_final_lap_is_decided():
    assert list(sim([5.0, 1.0, 9.0], R=0)) == [0.0, 1.0, 0.0]


def test_odds_sum_to_at_most_one_and_seeded_runs_repeat():
    a = sim([0.0, 3.0, 9.0], R=20, seed=7)
    b = sim([0.0, 3.0, 9.0], R=20, seed=7)
    assert np.array_equal(a, b)
    assert a.sum() <= 1.0 + 1e-12 and not np.isnan(a).any()


def test_project_finish_adds_the_cost():
    assert list(wp.project_finish(np.array([10.0, 20.0]), np.array([5.0, 1.5]))) == [15.0, 21.5]


# ---- the payload ----

def test_projected_finish_uses_best_plan_cost_and_falls_back_to_recent_laps():
    laps = make_laps()
    laps.loc[laps["Driver"] == "CCC", "Compound"] = "UNKNOWN"  # no plan for CCC
    p = payload(FakeSession(laps), lap=6)
    r = rows(p)
    plan = pit_window.pit_window_payload(FakeSession(laps), 6)
    cost = {d["code"]: d["best"]["cost"] for d in plan["drivers"] if d["best"]}
    t = {c: 90.0 * 6 + off for c, (off, _) in CARS.items()}
    # AAA is on its in-lap at 6; its cost is checked by the in-lap test, so look at BBB and CCC here.
    F_b = t["BBB"] + cost["BBB"]
    # CCC: 6 laps left at the median of its last five clean laps (laps 2-6, on HARD).
    m = np.median([90.0 + 0.1 * a - 0.3 for a in range(2, 7)])
    F_c = t["CCC"] + 6 * m
    assert r["CCC"]["projected_gap"] - r["BBB"]["projected_gap"] == pytest.approx(F_c - F_b, abs=0.2)


def test_in_lap_driver_is_treated_as_already_stopped():
    # AAA's lap 6 is an in-lap; lap 7 is on HARD at age 1.
    p = payload(FakeSession(), lap=6)
    laps = FakeSession().laps
    model, pit_loss = pit_window._tyre_model(laps[laps["LapNumber"] <= 6])
    stopped = DriverState(code="AAA", position=1, lap=6, compound="HARD", tyre_age=0,
                          used={"MEDIUM", "HARD"}, gap_ahead=None, neutralised=False)
    c_a = pit_strategy.pit_window(stopped, model, 6)["best"]["cost"] + pit_loss / 2
    plan = pit_window.pit_window_payload(FakeSession(), 6)
    cost = {d["code"]: d["best"]["cost"] for d in plan["drivers"] if d["best"]}
    F = {"AAA": 540.0 + c_a, "BBB": 542.0 + cost["BBB"], "CCC": 570.0 + cost["CCC"]}
    low = min(F.values())
    for code in F:
        assert rows(p)[code]["projected_gap"] == pytest.approx(F[code] - low, abs=0.2)


def test_an_in_lap_with_no_next_lap_uses_the_state_as_is():
    laps = make_laps()
    laps = laps[~((laps["Driver"] == "AAA") & (laps["LapNumber"] > 6))]
    p = payload(FakeSession(laps), lap=6)
    assert all(v == v for r in p["at"]["rows"] for v in (r["projected_gap"], r["probability"]))


def test_wet_leader_projects_the_whole_field_from_recent_laps():
    laps = make_laps()
    laps.loc[(laps["Driver"] == "AAA") & (laps["LapNumber"] <= 4), "Compound"] = "INTERMEDIATE"
    p = payload(FakeSession(laps), lap=4)
    r = rows(p)
    m = {"AAA": np.median([90.0 + 0.1 * a for a in (2, 3, 4)]),
         "BBB": np.median([90.0 + 0.4 + 0.1 * a for a in (2, 3, 4)]),
         "CCC": np.median([90.0 + 0.1 * a - 0.3 for a in (2, 3, 4)])}
    F = {c: 90.0 * 4 + CARS[c][0] + 8 * m[c] for c in CARS}
    low = min(F.values())
    for c in CARS:
        assert r[c]["projected_gap"] == pytest.approx(F[c] - low, abs=0.01)


def test_rows_carry_gap_status_rule_breach_and_window_open():
    p = payload(lap=4)
    assert [r["code"] for r in p["at"]["rows"]] == ["AAA", "BBB", "CCC"]
    first = p["at"]["rows"][0]
    assert first["gap"] == 0.0 and first["position"] == 1
    assert set(first) >= {"code", "position", "gap", "projected_gap", "probability", "status",
                          "rule_breach", "window_open"}
    assert rows(p)["CCC"]["gap"] == pytest.approx(30.0)
    assert isinstance(first["rule_breach"], bool)
    assert first["window_open"] is None or isinstance(first["window_open"], int)


def test_payload_shape_and_defaults():
    p = payload(lap=None)
    assert (p["year"], p["round"], p["session"], p["sims"]) == (2024, 1, "R", wp.N_SIMS)
    assert p["total_laps"] == 12 and p["at"]["lap"] == 6
    assert [x["lap"] for x in p["laps"]] == list(range(1, 13))
    assert [d["code"] for d in p["drivers"]] == ["AAA", "BBB", "CCC"]
    assert p["drivers"][0]["name"] == "Ann A" and p["drivers"][0]["color"]
    for entry in p["laps"]:
        assert all(v > 0 and v == round(v, 4) for v in entry["odds"].values())
        assert sum(entry["odds"].values()) <= 1.0 + 1e-3  # 4 dp rounding


def test_lap_one_has_no_nan_and_odds_sum_to_at_most_one():
    p = payload(lap=1)
    odds = p["laps"][0]["odds"]
    assert odds and sum(odds.values()) <= 1.0 + 1e-3  # 4 dp rounding
    for r in p["at"]["rows"]:
        assert all(v == v for v in (r["gap"], r["projected_gap"], r["probability"]))


def test_final_lap_leader_has_everything():
    p = payload(lap=12)
    assert p["laps"][-1]["odds"] == {"AAA": 1.0}
    assert rows(p)["AAA"]["probability"] == 1.0


def test_a_retired_driver_drops_out_from_the_lap_after_they_stop():
    laps = make_laps(last={"BBB": 8})
    p = payload(FakeSession(laps), lap=6)
    by_lap = {x["lap"]: x["odds"] for x in p["laps"]}
    assert all("BBB" not in by_lap[n] for n in range(9, 13))
    assert "BBB" not in rows(payload(FakeSession(laps), lap=10))
    assert [d["code"] for d in p["drivers"]] == ["AAA", "BBB", "CCC"]  # still listed: they started


def test_only_known_laps_feed_lap_n():
    base = payload(lap=4)
    laps = make_laps()
    later = laps["LapNumber"] > 4
    laps.loc[later, "Time"] = laps.loc[later, "Time"] + pd.Timedelta(seconds=40)
    laps.loc[later, "LapTime"] = laps.loc[later, "LapTime"] + pd.Timedelta(seconds=3)
    laps.loc[later, "Compound"] = "SOFT"
    changed = payload(FakeSession(laps), lap=4)
    assert changed["at"] == base["at"]
    assert changed["laps"][:4] == base["laps"][:4]


def test_sc_laps_from_the_leader():
    p = payload(FakeSession(make_laps(status={("AAA", 5): "4", ("CCC", 8): "4"})))
    assert p["sc_laps"] == [5]


def test_missing_lap_end_time_does_not_crash_or_make_nan():
    laps = make_laps()
    laps.loc[(laps["Driver"] == "BBB") & (laps["LapNumber"] == 6), "Time"] = pd.NaT
    p = payload(FakeSession(laps), lap=6)
    for r in p["at"]["rows"]:
        assert r["gap"] == r["gap"] and r["projected_gap"] == r["projected_gap"]
    assert all(v == v for e in p["laps"] for v in e["odds"].values())


def test_lap_out_of_range_is_a_422():
    for bad in (0, 13, -2):
        with pytest.raises(PitWindowInputError, match="Pick a lap from 1 to 12."):
            payload(lap=bad)
    payload(lap=12)


def test_odds_are_repeatable():
    assert payload(lap=5) == payload(lap=5)


# ---- the replay, memo and endpoint ----

def test_qualifying_is_a_422_in_the_service():
    with pytest.raises(PitWindowInputError, match="Win probability needs a race or a sprint."):
        wp.win_probability_replay(2024, "", "Q", 1, 5)


def test_a_lap_only_change_reuses_the_odds(monkeypatch):
    monkeypatch.setattr(pit_window, "load_session", lambda *a, **k: FakeSession())
    calls = {"history": 0}
    real = wp.odds_history

    def counting(*a, **k):
        calls["history"] += 1
        return real(*a, **k)

    monkeypatch.setattr(wp, "odds_history", counting)
    a = wp.win_probability_replay(2024, "", "R", 1, 3)
    b = wp.win_probability_replay(2024, "", "R", 1, 9)
    assert calls["history"] == 1
    assert a["laps"] == b["laps"] and a["at"]["lap"] == 3 and b["at"]["lap"] == 9
    assert a["round"] == 1 and a["session"] == "R"


def test_the_odds_memo_is_bounded_and_expires(monkeypatch):
    monkeypatch.setattr(pit_window, "load_session", lambda *a, **k: FakeSession())
    for r in range(1, wp._MAX_CACHED + 3):
        wp.win_probability_replay(2024, "", "R", r, 3)
    assert len(wp._odds) <= wp._MAX_CACHED
    now = time.time()
    monkeypatch.setattr(wp.time, "time", lambda: now + wp._CACHE_TTL_SECONDS + 1)
    calls = {"n": 0}
    real = wp.odds_history

    def counting(*a, **k):
        calls["n"] += 1
        return real(*a, **k)

    monkeypatch.setattr(wp, "odds_history", counting)
    wp.win_probability_replay(2024, "", "R", wp._MAX_CACHED + 2, 3)
    assert calls["n"] == 1


def test_concurrent_requests_compute_the_odds_once(monkeypatch):
    monkeypatch.setattr(pit_window, "load_session", lambda *a, **k: FakeSession())
    calls = {"n": 0}
    real = wp.odds_history

    def slow(*a, **k):
        calls["n"] += 1
        time.sleep(0.3)
        return real(*a, **k)

    monkeypatch.setattr(wp, "odds_history", slow)
    out = []
    threads = [threading.Thread(target=lambda: out.append(wp.win_probability_replay(2024, "", "R", 1, 4)))
               for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert calls["n"] == 1 and len(out) == 4


BODY = {"year": 2024, "round": 14, "session": "R", "lap": 8}


def test_endpoint_returns_the_bare_payload(monkeypatch):
    seen = {}

    def fake(year, gp, session, round_number, lap):
        seen["args"] = (year, gp, session, round_number, lap)
        return {"laps": [], "at": {"lap": 8, "rows": []}}

    monkeypatch.setattr(wp, "win_probability_replay", fake)
    response = client.post("/api/v1/telemetry/win-probability", json={**BODY, "session": "s"})
    assert response.status_code == 200
    assert seen["args"] == (2024, "", "S", 14, 8)
    assert response.json() == {"laps": [], "at": {"lap": 8, "rows": []}}


def test_endpoint_lap_is_optional(monkeypatch):
    seen = {}

    def fake(*args):
        seen["args"] = args
        return {}

    monkeypatch.setattr(wp, "win_probability_replay", fake)
    body = {k: v for k, v in BODY.items() if k != "lap"}
    assert client.post("/api/v1/telemetry/win-probability", json=body).status_code == 200
    assert seen["args"][-1] is None


def test_endpoint_rejects_qualifying():
    response = client.post("/api/v1/telemetry/win-probability", json={**BODY, "session": "Q"})
    assert response.status_code == 422
    assert "Win probability needs a race or a sprint." in response.text


def test_endpoint_needs_a_race_or_a_round():
    response = client.post("/api/v1/telemetry/win-probability", json={"year": 2024, "session": "R"})
    assert response.status_code == 422


def test_endpoint_bad_lap_is_a_422_with_the_message(monkeypatch):
    monkeypatch.setattr(pit_window, "load_session", lambda *a, **k: FakeSession())
    response = client.post("/api/v1/telemetry/win-probability", json={**BODY, "lap": 13})
    assert response.status_code == 422
    assert response.json()["detail"] == "Pick a lap from 1 to 12."


def test_endpoint_runs_end_to_end_on_a_session(monkeypatch):
    monkeypatch.setattr(pit_window, "load_session", lambda *a, **k: FakeSession())
    response = client.post("/api/v1/telemetry/win-probability", json=BODY)
    assert response.status_code == 200
    body = response.json()
    assert body["total_laps"] == 12 and body["at"]["lap"] == 8 and body["round"] == 14


def test_endpoint_missing_data_is_a_404(monkeypatch):
    def boom(*a, **k):
        raise si.SessionDataError("nope")

    monkeypatch.setattr(wp, "win_probability_replay", boom)
    response = client.post("/api/v1/telemetry/win-probability", json=BODY)
    assert response.status_code == 404 and response.json()["detail"] == "nope"


def test_endpoint_failures_do_not_leak_internals(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("secret internals")

    monkeypatch.setattr(wp, "win_probability_replay", boom)
    response = client.post("/api/v1/telemetry/win-probability", json=BODY)
    assert response.status_code == 502
    assert "secret internals" not in response.text
