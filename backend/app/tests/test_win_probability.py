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
    without = sim([0.0, 15.0], R=30, sigma=1.0, sims=40000)[1]
    monkeypatch.setattr(wp, "SC_RATE", 0.012)
    with_sc = sim([0.0, 15.0], R=30, sigma=1.0, sims=40000)[1]
    assert with_sc > without + 0.005


def test_the_safety_car_effect_is_not_overcounted(monkeypatch):
    # Noise before the safety car is bunched with the field, so it can't all survive it: the
    # chaser's gain stays modest (about +0.014 here; an un-split model gives about three times that).
    monkeypatch.setattr(wp, "SC_RATE", 0.0)
    without = sim([0.0, 15.0], R=30, sigma=1.0, sims=40000)[1]
    monkeypatch.setattr(wp, "SC_RATE", 0.012)
    with_sc = sim([0.0, 15.0], R=30, sigma=1.0, sims=40000)[1]
    assert with_sc < without + 0.03


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

# Two more cars on mediums, so the medium has a fit by lap 6 and the field is projected from plans
# (with one car per compound nothing is fitted, and the field goes on one scale).
FITTED = {**CARS, "DDD": (60.0, [("MEDIUM", 1, 12)]), "EEE": (70.0, [("MEDIUM", 1, 12)])}


def test_projected_finish_uses_best_plan_cost_and_falls_back_to_recent_laps():
    laps = make_laps(FITTED)
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


def test_the_rest_of_a_stop_is_the_pit_loss_less_what_the_in_lap_already_lost():
    assert wp.remaining_stop(20.0, 94.0, 90.0) == pytest.approx(16.0)  # 4 s slow in: 16 s to pay, not 10
    assert wp.remaining_stop(20.0, 112.0, 90.0) == 0.0  # never negative
    assert wp.remaining_stop(20.0, float("nan"), 90.0) == pytest.approx(10.0)  # no lap time: half


def in_lap_laps(slow_in=4.0, slow_out=18.0, cars=None, laps=12):
    """Cars whose in-laps are `slow_in` s slow and out-laps `slow_out` s slow (4 + 18 = the 22 s default pit loss)."""
    data = make_laps(cars, laps=laps)
    for i, row in data.iterrows():
        seconds = row["LapTime"].total_seconds() - (25.0 if pd.notna(row["PitInTime"]) else 0.0)             - (25.0 if pd.notna(row["PitOutTime"]) else 0.0)
        seconds += slow_in if pd.notna(row["PitInTime"]) else 0.0
        seconds += slow_out if pd.notna(row["PitOutTime"]) else 0.0
        data.at[i, "LapTime"] = pd.Timedelta(seconds=seconds)
    # Lap-end times that carry the stops, as real ones do: the car's offset plus the laps it has run.
    for code, (offset, _) in (cars or CARS).items():
        mine = data["Driver"] == code
        ordered = data[mine].sort_values("LapNumber")
        data.loc[ordered.index, "Time"] = pd.to_timedelta(offset + ordered["LapTime"].dt.total_seconds().cumsum(), unit="s")
    return data


def test_in_lap_driver_is_treated_as_already_stopped():
    # AAA's lap 6 is an in-lap, 4 s slow; lap 7 is on HARD at age 1.
    laps = in_lap_laps(cars=FITTED)
    p = payload(FakeSession(laps), lap=6)
    model, pit_loss = pit_window._tyre_model(laps[laps["LapNumber"] <= 6])
    stopped = DriverState(code="AAA", position=1, lap=6, compound="HARD", tyre_age=0,
                          used={"MEDIUM", "HARD"}, gap_ahead=None, neutralised=False)
    m = np.median([90.0 + 0.1 * a for a in range(2, 6)])  # laps 2-5: the clean laps before the in-lap
    in_lap_loss = (90.0 + 0.1 * 6 + 4.0) - m
    c_a = pit_strategy.pit_window(stopped, model, 6)["best"]["cost"] + pit_loss - in_lap_loss
    plan = pit_window.pit_window_payload(FakeSession(laps), 6)
    cost = {d["code"]: d["best"]["cost"] for d in plan["drivers"] if d["best"]}
    t = {c: laps[(laps["Driver"] == c) & (laps["LapNumber"] == 6)]["Time"].iloc[0].total_seconds() for c in CARS}
    F = {"AAA": t["AAA"] + c_a, "BBB": t["BBB"] + cost["BBB"], "CCC": t["CCC"] + cost["CCC"]}
    for code in F:
        assert (rows(p)[code]["projected_gap"] - rows(p)["BBB"]["projected_gap"]
                == pytest.approx(F[code] - F["BBB"], abs=0.2))


def test_two_cars_stopping_on_consecutive_laps_look_alike_on_their_in_laps():
    # Same pace, same stop; B is 2 s behind and stops a lap later. Whoever is on their in-lap is
    # charged the rest of the stop, so the gap between them barely moves from one in-lap to the next.
    cars = {"AAA": (0.0, [("MEDIUM", 1, 6), ("HARD", 7, 14)]),
            "BBB": (2.0, [("MEDIUM", 1, 7), ("HARD", 8, 14)])}
    laps = in_lap_laps(cars=cars, laps=14)
    swing = []
    for lap in (6, 7):
        r = rows(wp.win_probability_payload(FakeSession(laps), lap, year=2024, round_number=1))
        swing.append(r["BBB"]["projected_gap"] - r["AAA"]["projected_gap"])
    assert abs(swing[0] - swing[1]) < 1.5


INTER_STOP = {"AAA": (0.0, [("MEDIUM", 1, 6), ("INTERMEDIATE", 7, 12)]),
              "BBB": (2.0, [("SOFT", 1, 5), ("MEDIUM", 6, 12)]),
              "CCC": (30.0, [("HARD", 1, 7), ("MEDIUM", 8, 12)])}


def lap_end(laps, code, lap):
    return laps[(laps["Driver"] == code) & (laps["LapNumber"] == lap)]["Time"].iloc[0].total_seconds()


def test_an_in_lap_onto_intermediates_keeps_the_rest_of_its_stop():
    # AAA boxes on lap 6 for intermediates. However slow its in-lap, the stop is paid in full: a
    # slower in-lap costs race time now and leaves less of the stop still to come.
    found = {}
    for slow_in in (4.0, 14.0):
        laps = in_lap_laps(slow_in=slow_in, cars=INTER_STOP)
        found[slow_in] = rows(payload(FakeSession(laps), lap=6))
    gap = {k: r["AAA"]["projected_gap"] - r["CCC"]["projected_gap"] for k, r in found.items()}
    assert gap[14.0] == pytest.approx(gap[4.0], abs=0.05)


def test_an_in_lap_onto_intermediates_counts_toward_the_wet_field():
    # AAA, the leader, is on intermediates from its stop: the whole field goes on one scale, so the
    # dry cars are projected from their recent laps, not from plans.
    laps = in_lap_laps(cars=INTER_STOP)
    r = rows(payload(FakeSession(laps), lap=6))
    m_b = np.median([90.4 + 0.1 * a for a in (2, 3, 4)])  # laps 5 and 6 are BBB's in- and out-lap
    m_c = np.median([89.7 + 0.1 * a for a in range(2, 7)])
    expected = lap_end(laps, "CCC", 6) - lap_end(laps, "BBB", 6) + 6 * (m_c - m_b)
    assert r["CCC"]["projected_gap"] - r["BBB"]["projected_gap"] == pytest.approx(expected, abs=0.01)


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


FIELD6 = {f"D{k}": (3.0 * k, [("MEDIUM", 1, 12)]) for k in range(6)}


def six_car_laps(wet):
    """Six cars on one stint each, D<k> a little slower per lap the higher k; `wet` are on intermediates."""
    laps = make_laps(FIELD6)
    for k in range(6):
        mine = laps["Driver"] == f"D{k}"
        laps.loc[mine, "LapTime"] = laps.loc[mine, "LapTime"] + pd.Timedelta(seconds=0.2 * k)
    laps.loc[laps["Driver"].isin(wet), "Compound"] = "INTERMEDIATE"
    return FakeSession(laps)


def projected_gaps(p):
    return {r["code"]: r["projected_gap"] for r in p["at"]["rows"]}


def recent_pace_gaps():
    """Projected gaps if every car were projected as its recent pace times the 8 laps left."""
    F = {f"D{k}": 360.0 + 3.0 * k + 8 * (90.3 + 0.2 * k) for k in range(6)}
    return {c: f - min(F.values()) for c, f in F.items()}


def test_a_wet_leader_switches_the_field_even_when_few_cars_are_wet():
    p = payload(six_car_laps(["D0"]), lap=4)  # 1 of 6 wet: under a quarter, but it leads
    for code, gap in recent_pace_gaps().items():
        assert projected_gaps(p)[code] == pytest.approx(gap, abs=0.01)


def test_a_quarter_of_the_field_on_wets_switches_it_even_with_a_dry_leader():
    p = payload(six_car_laps(["D4", "D5"]), lap=4)  # 2 of 6 wet, the leader dry
    for code, gap in recent_pace_gaps().items():
        assert projected_gaps(p)[code] == pytest.approx(gap, abs=0.01)


def slowed(laps, code, first, last, seconds):
    mine = (laps["Driver"] == code) & laps["LapNumber"].between(first, last)
    laps.loc[mine, "LapTime"] = laps.loc[mine, "LapTime"] + pd.Timedelta(seconds=seconds)
    return laps


def test_on_one_scale_a_drivers_pace_comes_from_the_current_stint():
    # All on wet tyres. BBB's first stint was 3 s a lap slower; at lap 7 its current stint has two
    # clean laps (6 and 7), so only they count. CCC's current stint has one (lap 7), too few, so its
    # last five clean laps stand in.
    cars = {"AAA": (0.0, [("INTERMEDIATE", 1, 12)]),
            "BBB": (2.0, [("WET", 1, 4), ("INTERMEDIATE", 5, 12)]),
            "CCC": (4.0, [("INTERMEDIATE", 1, 5), ("WET", 6, 12)])}
    laps = slowed(make_laps(cars), "BBB", 1, 4, 3.0)
    r = rows(payload(FakeSession(laps), lap=7))
    m = {"AAA": np.median([90.0 + 0.1 * a for a in range(2, 8)]),
         "BBB": np.median([90.2, 90.3]),
         "CCC": np.median([90.2, 90.3, 90.4, 90.2])}  # laps 2-4 and 7
    F = {c: 90.0 * 7 + cars[c][0] + 5 * m[c] for c in cars}
    for c in cars:
        assert r[c]["projected_gap"] == pytest.approx(F[c] - min(F.values()), abs=0.01)


def test_the_slower_tyre_group_is_projected_at_the_faster_groups_pace_plus_a_stop():
    # It is raining: the two cars on intermediates lap 4-5 s quicker than the two on slicks. The slick
    # cars keep their pace against each other, but run at the intermediate pace after a stop.
    cars = {"AAA": (0.0, [("INTERMEDIATE", 1, 12)]),
            "BBB": (3.0, [("INTERMEDIATE", 1, 12)]),
            "CCC": (6.0, [("SOFT", 1, 12)]),
            "DDD": (9.0, [("MEDIUM", 1, 12)])}
    laps = slowed(slowed(make_laps(cars), "CCC", 1, 12, 4.0), "DDD", 1, 12, 5.0)
    r = rows(payload(FakeSession(laps), lap=6))
    pit_loss = pit_window._tyre_model(laps[laps["LapNumber"] <= 6])[1]
    m = {"AAA": 90.4, "BBB": 90.4, "CCC": 94.8, "DDD": 95.4}
    wet, dry = 90.4, np.median([94.8, 95.4])
    assert 6 * (dry - wet) > pit_loss  # the stop pays
    F = {c: 90.0 * 6 + cars[c][0] + 6 * m[c] for c in ("AAA", "BBB")}
    F.update({c: 90.0 * 6 + cars[c][0] + 6 * (m[c] - dry + wet) + pit_loss for c in ("CCC", "DDD")})
    for c in cars:
        assert r[c]["projected_gap"] == pytest.approx(F[c] - min(F.values()), abs=0.01)


def test_a_lap_with_no_fitted_dry_compound_puts_the_field_on_one_scale():
    # Lap 1: no clean laps and no fit, so every car runs at the field's pace and the projection
    # keeps the order on the road, whatever tyre a car started on.
    for r in payload(lap=1)["at"]["rows"]:
        assert r["projected_gap"] == pytest.approx(r["gap"], abs=0.01)


def test_a_slower_tyre_group_stays_out_when_a_stop_would_not_pay():
    # The slick cars are only 0.5 s a lap slower with six laps left: 3 s, less than a stop. They
    # are projected at their own pace, with no stop.
    cars = {"AAA": (0.0, [("INTERMEDIATE", 1, 12)]),
            "BBB": (3.0, [("INTERMEDIATE", 1, 12)]),
            "CCC": (6.0, [("SOFT", 1, 12)]),
            "DDD": (9.0, [("MEDIUM", 1, 12)])}
    laps = slowed(make_laps(cars), "DDD", 1, 12, 0.9)  # CCC's soft is 0.4 s slower; DDD 0.9 s
    r = rows(payload(FakeSession(laps), lap=6))
    m = {"AAA": 90.4, "BBB": 90.4, "CCC": 90.8, "DDD": 91.3}
    F = {c: 90.0 * 6 + cars[c][0] + 6 * m[c] for c in cars}
    for c in cars:
        assert r[c]["projected_gap"] == pytest.approx(F[c] - min(F.values()), abs=0.01)


def test_with_no_fitted_dry_compound_the_known_laps_do_not_separate_the_field():
    # Lap 3: each compound has one car, so nothing is fitted. The two clean laps each car has run
    # are too few to project 9 laps from, so the projection keeps the order on the road.
    for r in payload(lap=3)["at"]["rows"]:
        assert r["projected_gap"] == pytest.approx(r["gap"], abs=0.01)


def test_the_final_lap_goes_to_the_road_leader_even_without_a_lap_end_time():
    laps = make_laps()
    final = laps["LapNumber"] == 12
    laps.loc[final & (laps["Driver"] == "BBB"), ["Position", "Time"]] = [1.0, pd.NaT]
    laps.loc[final & (laps["Driver"] == "AAA"), "Position"] = 2.0
    p = payload(FakeSession(laps), lap=12)
    assert p["laps"][-1]["odds"] == {"BBB": 1.0}
    assert rows(p)["BBB"]["probability"] == 1.0


def test_one_wet_car_in_six_with_a_dry_leader_does_not_switch_the_field():
    p = payload(six_car_laps(["D5"]), lap=4)
    # The dry cars share one plan cost, so they differ by their gap on the road (6 s), not by the
    # 6 s plus eight laps of the 0.4 s per lap a recent-pace projection would add.
    g = projected_gaps(p)
    assert g["D3"] - g["D1"] == pytest.approx(6.0, abs=0.01)


def test_the_chart_agrees_with_the_table_on_the_selected_lap_and_the_memo_is_left_alone(monkeypatch):
    monkeypatch.setattr(pit_window, "load_session", lambda *a, **k: FakeSession())
    p = wp.win_probability_replay(2024, "", "R", 1, 7)
    point = next(e for e in p["laps"] if e["lap"] == 7)["odds"]
    assert point == {r["code"]: r["probability"] for r in p["at"]["rows"] if r["probability"] > 0}
    memo = next(iter(wp._odds.values()))[1]["laps"]
    assert memo[6]["odds"] != point or memo[6] is not p["laps"][6]
    assert memo[6] is not p["laps"][6]


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
    assert [e for e in a["laps"] if e["lap"] not in (3, 9)] == [e for e in b["laps"] if e["lap"] not in (3, 9)]
    assert a["at"]["lap"] == 3 and b["at"]["lap"] == 9
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
