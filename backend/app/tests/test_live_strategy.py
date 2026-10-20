import math

import pytest

from app.services import live_strategy as ls
from app.services.strategy_simulator import DEFAULT_PIT_LOSS_SECONDS

DRIVERS = [{"driver_number": n, "code": c} for n, c in ((3, "VER"), (16, "LEC"), (12, "ANT"), (1, "NOR"), (81, "PIA"))]


def row(position, gap, interval, compound="MEDIUM", age=10, lap=20, pit=False, retired=False):
    return {"position": position, "gap_to_leader": gap, "gap_to_next": interval, "compound": compound,
            "tyre_age": age, "lap_number": lap, "is_pit": pit, "retired": retired}


def laps(times, first=1, compound="MEDIUM", track="1", start_age=1, pit_in=(), pit_out=()):
    """History rows for consecutive laps with these lap times."""
    return [{"lap": first + i, "lap_time": t, "compound": compound, "tyre_age": start_age + i, "stint": 1,
             "pit_in": first + i in pit_in, "pit_out": first + i in pit_out, "track": track, "position": None}
            for i, t in enumerate(times)]


def snapshot(timing, history=None, current=21, total=62, track="1", used=None, session_type="Race", name="Race"):
    return {
        "session": {"session_type": session_type, "session_name": name},
        "timing": timing, "drivers": DRIVERS, "history": history or {},
        "lap_count": {"current": current, "total": total}, "track_status": track, "used": used or {},
    }


# --- Battles --------------------------------------------------------------------------------------

def test_a_chaser_lapping_faster_is_forecast_to_reach_drs_range():
    # LEC is 2.2 s behind VER and 0.4 s a lap quicker over their last five laps: within 1.0 s in 3 laps.
    history = {"3": laps([98.0, 98.1, 98.0, 98.2, 98.1], first=16), "16": laps([97.6, 97.7, 97.6, 97.8, 97.7], first=16)}
    out = ls.battles(snapshot({"3": row(1, 0.0, None), "16": row(2, 2.2, 2.2)}, history))
    assert out == [{"ahead": {"number": 3, "code": "VER"}, "behind": {"number": 16, "code": "LEC"}, "gap": 2.2,
                    "closing": 0.4, "laps_compared": 5, "in_drs": False, "laps_to_drs": 3}]


def test_cars_already_inside_a_second_are_battling_now_and_listed_first():
    history = {n: laps([98.0] * 5, first=16) for n in ("3", "16", "12")}
    history["12"] = laps([97.0] * 5, first=16)  # ANT a second a lap quicker than LEC, 2.5 s back
    timing = {"3": row(1, 0.0, None), "16": row(2, 0.7, 0.7), "12": row(3, 3.2, 2.5)}
    out = ls.battles(snapshot(timing, history))
    assert [(b["behind"]["code"], b["in_drs"], b["laps_to_drs"]) for b in out] == [("LEC", True, None), ("ANT", False, 2)]
    assert out[0]["closing"] == 0.0


def test_a_chaser_that_is_not_gaining_or_too_far_off_is_no_battle():
    history = {"3": laps([98.0] * 5, first=16), "16": laps([98.1] * 5, first=16), "12": laps([97.9] * 5, first=16)}
    # LEC is losing time; ANT gains only 0.2 s a lap on a 5 s gap: 20 laps away, beyond the forecast.
    timing = {"3": row(1, 0.0, None), "16": row(2, 2.0, 2.0), "12": row(3, 7.0, 5.0)}
    assert ls.battles(snapshot(timing, history)) == []


def test_a_battle_after_the_flag_is_not_forecast():
    history = {"3": laps([98.0] * 5, first=56), "16": laps([97.8] * 5, first=56)}
    # 0.2 s a lap on a 2.0 s gap is 5 laps, but only 2 are left.
    assert ls.battles(snapshot({"3": row(1, 0.0, None), "16": row(2, 2.0, 2.0)}, history, current=61)) == []


def test_pit_laps_and_safety_car_laps_are_left_out_of_the_pace():
    ahead = laps([98.0, 120.0, 118.0, 98.0, 98.0, 98.0], first=15, pit_in=(16,), pit_out=(17,))
    behind = laps([97.5, 97.5, 97.5, 110.0, 97.5, 97.5], first=15)
    behind[3]["track"] = "16"  # a lap under the VSC
    out = ls.battles(snapshot({"3": row(1, 0.0, None), "16": row(2, 1.5, 1.5)}, {"3": ahead, "16": behind}))
    # Common clean laps: 15, 19, 20 -> 0.5 s a lap; 0.5 s to find -> 1 lap.
    assert (out[0]["closing"], out[0]["laps_compared"], out[0]["laps_to_drs"]) == (0.5, 3, 1)


def test_too_few_clean_laps_gives_no_forecast():
    history = {"3": laps([98.0], first=20), "16": laps([97.0], first=20)}
    assert ls.battles(snapshot({"3": row(1, 0.0, None), "16": row(2, 2.0, 2.0)}, history)) == []


def test_cars_in_the_pits_or_retired_are_not_in_battles():
    history = {n: laps([98.0] * 5, first=16) for n in ("3", "16", "12")}
    timing = {"3": row(1, 0.0, None), "16": row(2, 0.5, 0.5, pit=True), "12": row(3, 0.9, 0.4, retired=True)}
    assert ls.battles(snapshot(timing, history)) == []


def test_no_battles_are_forecast_behind_a_safety_car():
    history = {"3": laps([98.0] * 5, first=16), "16": laps([97.0] * 5, first=16)}
    assert ls.battles(snapshot({"3": row(1, 0.0, None), "16": row(2, 0.6, 0.6)}, history, track="4")) == []


# --- Pit stops ------------------------------------------------------------------------------------

FIELD = {"3": row(1, 0.0, None), "16": row(2, 4.0, 4.0), "12": row(3, 21.0, 17.0), "1": row(4, 30.0, 9.0),
         "81": row(5, "1L", 10.0)}


def test_where_each_car_would_rejoin_from_a_stop_now():
    stops = {s["code"]: s for s in ls.pit_stops(snapshot(FIELD), pit_loss=22.0)}
    # VER: 0 + 22 = 22.0 -> behind ANT (21.0) by 1.0, ahead of NOR (30.0) by 8.0, third.
    assert stops["VER"]["rejoin_position"] == 3 and stops["VER"]["positions_lost"] == 2
    assert stops["VER"]["ahead"] == {"code": "ANT", "gap": 1.0} and stops["VER"]["behind"] == {"code": "NOR", "gap": 8.0}
    assert stops["VER"]["traffic"] is True  # rejoins within 1.5 s of a car
    # NOR: last on the lead lap, rejoins last: nobody ahead to catch from behind.
    assert stops["NOR"]["rejoin_position"] == 4 and stops["NOR"]["positions_lost"] == 0
    assert stops["NOR"]["behind"] is None and stops["NOR"]["ahead"] == {"code": "ANT", "gap": 31.0}
    assert "PIA" not in stops  # a lapped car has no gap to rejoin from


def test_a_free_stop_loses_no_place():
    field = {"3": row(1, 0.0, None), "16": row(2, 25.0, 25.0)}
    stops = {s["code"]: s for s in ls.pit_stops(snapshot(field), pit_loss=22.0)}
    assert stops["VER"]["positions_lost"] == 0 and stops["VER"]["behind"] == {"code": "LEC", "gap": 3.0}
    assert stops["VER"]["traffic"] is False


def test_cars_staying_out_on_worn_tyres_lose_the_out_lap_to_the_fresh_set():
    model = ls.pit_strategy.TyreModel(compounds={"MEDIUM": (90.0, 0.1, True, 30)}, pit_loss=22.0)
    field = {"3": row(1, 0.0, None, age=30), "16": row(2, 21.0, 21.0, age=30), "12": row(3, 24.0, 3.0, age=5)}
    stops = {s["code"]: s for s in ls.pit_stops(snapshot(field), pit_loss=22.0, model=model)}
    # VER's fresh out-lap is 90.1; LEC's 32-lap-old lap is 93.2, so LEC at 21.0 ends the out-lap 24.1 down.
    assert stops["VER"]["rejoin_position"] == 1 and stops["VER"]["positions_lost"] == 0
    assert stops["VER"]["ahead"] is None and stops["VER"]["behind"] == {"code": "LEC", "gap": 2.1}
    # Without a model there is no wear to count, and LEC stays ahead.
    assert {s["code"]: s for s in ls.pit_stops(snapshot(field), pit_loss=22.0)}["VER"]["rejoin_position"] == 2


def test_an_early_stop_estimate_is_flagged():
    timing = {"3": row(1, 0.0, None, compound="MEDIUM", age=4, lap=5), "16": row(2, 1.2, 1.2, compound="MEDIUM", age=4, lap=5)}
    history = {"3": laps([98.0] * 4, first=1), "16": laps([98.1] * 4, first=1)}
    out = ls.race_strategy(snapshot(timing, history, current=5, total=62, used={"3": ["MEDIUM"], "16": ["MEDIUM"]}))
    assert all(s["early"] is True for s in out["pit_stops"])


def test_a_car_already_in_the_pits_has_no_rejoin_forecast():
    field = dict(FIELD, **{"16": row(2, 4.0, 4.0, pit=True)})
    assert "LEC" not in {s["code"] for s in ls.pit_stops(snapshot(field), pit_loss=22.0)}


# --- The whole payload ----------------------------------------------------------------------------

def test_the_payload_has_the_lap_the_pit_loss_and_its_source():
    out = ls.race_strategy(snapshot(FIELD, current=21, total=62))
    assert out["applicable"] is True and (out["lap"], out["total_laps"], out["laps_remaining"]) == (21, 62, 42)
    assert out["pit_loss"] == DEFAULT_PIT_LOSS_SECONDS and out["pit_loss_source"] == "default"
    assert out["neutralised"] is False


def test_last_years_pit_loss_stands_in_until_this_race_measures_its_own():
    out = ls.race_strategy(snapshot(FIELD), prior_pit_loss=27.4)
    assert (out["pit_loss"], out["pit_loss_source"]) == (27.4, "last_year")
    stops = {s["code"]: s for s in out["pit_stops"]}
    # VER would rejoin 27.4 s down: 6.4 s behind ANT (21.0) and 2.6 s ahead of NOR (30.0).
    assert stops["VER"]["ahead"] == {"code": "ANT", "gap": 6.4} and stops["VER"]["behind"] == {"code": "NOR", "gap": 2.6}


def test_a_stop_behind_the_safety_car_costs_half():
    out = ls.race_strategy(snapshot(FIELD, track="4"), prior_pit_loss=22.0)
    assert out["neutralised"] is True and out["battles"] == []
    assert {s["code"]: s for s in out["pit_stops"]}["VER"]["rejoin_position"] == 2  # 11 s: behind LEC only


def test_close_pairs_get_undercut_and_overcut_odds():
    timing = {"3": row(1, 0.0, None, compound="MEDIUM", age=25), "16": row(2, 1.2, 1.2, compound="MEDIUM", age=24)}
    history = {"3": laps([98.0] * 20, first=1), "16": laps([98.1] * 20, first=1)}
    out = ls.race_strategy(snapshot(timing, history, current=21, total=62, used={"3": ["MEDIUM"], "16": ["MEDIUM"]}))
    duel = out["pit_duels"][0]
    assert (duel["chaser"], duel["leader"], duel["gap"]) == ({"number": 16, "code": "LEC"}, {"number": 3, "code": "VER"}, 1.2)
    assert duel["undercut"]["verdict"] in ("likely", "possible", "unlikely")
    assert duel["overcut"]["verdict"] in ("likely", "possible", "unlikely")
    assert set(duel["undercut"]) == {"gain", "margin", "verdict", "compound"}
    stops = {s["code"]: s for s in out["pit_stops"]}
    assert stops["LEC"]["status"] in ("box now", "window open", "window opens", "stay out")


def test_qualifying_and_practice_have_no_race_forecasts():
    out = ls.race_strategy(snapshot(FIELD, session_type="Qualifying", name="Qualifying"))
    assert out == {"applicable": False, "session_name": "Qualifying"}


def test_the_lap_table_is_in_the_shape_the_tyre_model_reads():
    frame = ls.laps_frame({"3": laps([None, 98.0, 120.0], pit_in=(3,))}, {"3": "VER"})
    assert list(frame["Driver"]) == ["VER"] * 3
    assert frame["LapTime"].isna().tolist() == [True, False, False]
    assert frame["PitInTime"].notna().tolist() == [False, False, True]
    assert frame["IsAccurate"].tolist() == [False, True, False]  # lap 1 and the in-lap aren't representative
    assert math.isclose(frame["LapTime"].iloc[1].total_seconds(), 98.0)


# --- Last year's pit loss -------------------------------------------------------------------------

@pytest.fixture
def fresh_prior(monkeypatch):
    monkeypatch.setattr(ls, "_prior", {})
    monkeypatch.setattr(ls, "_prior_loading", set())


def test_last_years_pit_loss_is_measured_from_that_race(fresh_prior, monkeypatch):
    from types import SimpleNamespace
    from app.services import pit_window

    asked = []
    monkeypatch.setattr(pit_window, "_loaded", lambda year, gp, s, r: asked.append((year, gp, s)) or SimpleNamespace(laps="laps"))
    monkeypatch.setattr(pit_window, "tyre_model", lambda laps: (None, 27.4321, True))
    assert ls.prior_pit_loss(2026, "Austin", background=False) == 27.432
    assert asked == [(2025, "Austin", "R")]
    assert ls.prior_pit_loss(2026, "Austin") == 27.432  # remembered
    assert len(asked) == 1


def test_an_unmeasured_or_missing_race_gives_no_prior(fresh_prior, monkeypatch):
    from app.services import pit_window

    monkeypatch.setattr(pit_window, "_loaded", lambda *a: (_ for _ in ()).throw(ValueError("no such race")))
    assert ls.prior_pit_loss(2026, "Madrid", background=False) is None
    assert ls.prior_pit_loss(None, "Austin") is None


def test_the_prior_loads_in_the_background(fresh_prior, monkeypatch):
    import threading
    release = threading.Event()
    monkeypatch.setattr(ls, "_load_prior", lambda year, location: release.wait(5) and 25.0)
    assert ls.prior_pit_loss(2026, "Austin") is None  # still loading: the default stands in
    assert ls.prior_pit_loss(2026, "Austin") is None
    release.set()
    for t in [t for t in threading.enumerate() if t.name.startswith("prior-pit-loss")]:
        t.join(5)
    assert ls.prior_pit_loss(2026, "Austin") == 25.0
