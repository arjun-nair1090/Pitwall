import warnings

import numpy as np
import pandas as pd
import pytest

from app.services import race_pace
from app.services.session_info import SessionDataError


@pytest.fixture(autouse=True)
def _fresh_cache():
    race_pace.clear_cache()
    yield
    race_pace.clear_cache()


def make_laps(driver, first_lap, last_lap, *, stint=1, compound="MEDIUM", base=100.0, slope=0.1,
              spl=0.075, total=44, first_life=None, tyre_life=None, pit_in=()):
    """A stint of laps whose corrected time is base + slope * tyre life."""
    rows = []
    for lap in range(first_lap, last_lap + 1):
        life = tyre_life if tyre_life is not None else (first_life or 1) + lap - first_lap
        raw = base + slope * life + spl * (total - lap)
        rows.append({
            "Driver": driver, "LapNumber": float(lap), "LapTime": pd.Timedelta(seconds=raw),
            "Stint": float(stint), "Compound": compound, "TyreLife": float(life),
            "PitInTime": pd.Timedelta(seconds=1) if lap in pit_in else pd.NaT,
            "PitOutTime": pd.NaT, "TrackStatus": "1", "Deleted": False,
        })
    return pd.DataFrame(rows)


def test_fuel_model_for_a_2024_race():
    fuel = race_pace.fuel_model(2024, "R", 44)
    assert fuel["kg_per_lap"] == pytest.approx(2.5)
    assert fuel["seconds_per_lap"] == pytest.approx(0.075)


def test_fuel_model_uses_105_kg_before_2019():
    assert race_pace.fuel_model(2018, "R", 50)["start_kg"] == 105.0


def test_a_sprint_burns_at_the_race_rate():
    fuel = race_pace.fuel_model(2024, "S", 15)
    assert fuel["seconds_per_lap"] == pytest.approx(0.03 * 110 / (15 * 3.05))


def test_corrected_time_leaves_the_last_lap_alone():
    laps = pd.DataFrame({
        "LapNumber": [44.0, 4.0],
        "LapTime": [pd.Timedelta(seconds=100.0), pd.Timedelta(seconds=100.0)],
    })
    corrected = race_pace.corrected_times(laps, 0.075, 44)
    assert corrected.iloc[0] == pytest.approx(100.0)
    assert corrected.iloc[1] == pytest.approx(100.0 - 0.075 * 40)


def summarise(laps, total=44):
    from app.services.corner_analysis import clean_laps
    return race_pace.stint_summary(laps, clean_laps(laps), 0.075, total)


def test_stint_degradation_is_the_slope_against_tyre_life():
    stints = summarise(make_laps("HAM", 2, 11, first_life=2))
    assert len(stints) == 1
    assert stints[0]["deg_per_lap"] == pytest.approx(0.1)
    assert stints[0]["fit"]["from"]["lap"] == 2
    assert stints[0]["fit"]["to"]["lap"] == 11
    assert stints[0]["fit"]["to"]["time"] - stints[0]["fit"]["from"]["time"] == pytest.approx(0.9)


def test_a_short_stint_has_no_slope():
    stint = summarise(make_laps("HAM", 2, 5))[0]
    assert stint["deg_per_lap"] is None
    assert stint["fit"] is None
    assert len(stint["laps"]) == 4


def test_constant_tyre_life_has_no_slope():
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        stint = summarise(make_laps("HAM", 2, 7, tyre_life=5))[0]
    assert stint["deg_per_lap"] is None
    assert stint["fit"] is None


def test_stint_bounds_include_pit_laps():
    stint = summarise(make_laps("HAM", 2, 12, pit_in=(12,)))[0]
    assert stint["start_lap"] == 2
    assert stint["end_lap"] == 12
    assert all(lap["lap"] != 12 for lap in stint["laps"])


def test_stints_are_sorted_and_python_typed():
    laps = pd.concat([make_laps("HAM", 12, 22, stint=2, compound="HARD"), make_laps("HAM", 2, 11)])
    stints = summarise(laps)
    assert [s["stint"] for s in stints] == [1, 2]
    assert [s["compound"] for s in stints] == ["MEDIUM", "HARD"]
    first = stints[0]["laps"][0]
    assert type(first["lap"]) is int and type(first["tyre_life"]) is int and type(first["time"]) is float


def test_pooled_compound_slope_ignores_driver_pace_offsets():
    young = pd.DataFrame({"TyreLife": np.arange(2, 9.0)})
    young["Corrected"] = 100.0 + 0.1 * young["TyreLife"]
    old = pd.DataFrame({"TyreLife": np.arange(10, 17.0)})
    old["Corrected"] = 101.0 + 0.1 * old["TyreLife"]
    out = race_pace.compound_degradation({"MEDIUM": [young, old]})
    assert len(out) == 1
    assert out[0]["deg_per_lap"] == pytest.approx(0.1)
    assert out[0]["stints"] == 2 and out[0]["laps"] == 14
    both = pd.concat([young, old])
    naive = np.polyfit(both["TyreLife"], both["Corrected"], 1)[0]
    assert abs(naive - 0.1) > 0.05
    assert out[0]["curve"] == []  # no tyre life has three laps


def test_curve_is_the_median_loss_per_tyre_life():
    def stint(offset, extra):
        frame = pd.DataFrame({"TyreLife": np.arange(1, 7.0)})
        frame["Corrected"] = 100.0 + offset + 0.1 * frame["TyreLife"] + extra
        return frame
    # the middle stint has a bad lap at tyre life 3; the median shrugs it off
    bad = stint(0.5, 0.0)
    bad.loc[bad["TyreLife"] == 3, "Corrected"] += 5.0
    out = race_pace.compound_degradation({"SOFT": [stint(0.0, 0.0), bad, stint(1.0, 0.0)]})
    curve = {point["tyre_life"]: point for point in out[0]["curve"]}
    assert sorted(curve) == [1, 2, 3, 4, 5, 6]
    assert all(point["laps"] == 3 for point in curve.values())
    assert curve[1]["loss"] < curve[6]["loss"]
    # a mean would put the bad lap about 1.7 s above its neighbours
    assert abs(curve[3]["loss"] - (curve[2]["loss"] + curve[4]["loss"]) / 2) < 0.3
    assert [p["tyre_life"] for p in out[0]["curve"]] == sorted(curve)


def test_compounds_come_in_tyre_order():
    def stint(offset):
        frame = pd.DataFrame({"TyreLife": np.arange(1, 8.0)})
        frame["Corrected"] = 100.0 + 0.1 * frame["TyreLife"] + offset
        return frame
    out = race_pace.compound_degradation({
        "HARD": [stint(0)], "SOFT": [stint(0)], "INTERMEDIATE": [stint(0)], "ZZZ": [stint(0)], "WET": [stint(0)],
    })
    assert [c["compound"] for c in out] == ["SOFT", "HARD", "INTERMEDIATE", "WET", "ZZZ"]


def patch_session(monkeypatch, laps, counter=None):
    class FakeSession:
        pass
    session = FakeSession()
    session.laps = laps

    def load(*args, **kwargs):
        if counter is not None:
            counter.append(args)
        return session

    monkeypatch.setattr(race_pace, "load_session", load)
    monkeypatch.setattr(race_pace, "driver_profile",
                        lambda s, code: {"name": f"Name {code}", "team": "T", "color": "#112233"})


def field():
    return pd.concat([
        make_laps("AAA", 2, 20, base=101.0),
        make_laps("BBB", 2, 20, base=100.0),
        make_laps("CCC", 2, 4, base=90.0),
        make_laps("AAA", 44, 44, stint=2, base=101.0, first_life=1),
        make_laps("BBB", 44, 44, stint=2, base=100.0, first_life=1),
    ], ignore_index=True)


def test_drivers_are_ranked_by_median_corrected_pace(monkeypatch):
    patch_session(monkeypatch, field())
    payload = race_pace.race_pace_payload(2024, "Spa", "R", 13)
    codes = [d["code"] for d in payload["drivers"]]
    assert codes == ["BBB", "AAA", "CCC"]
    assert payload["drivers"][0]["gap"] == 0.0
    assert payload["drivers"][1]["gap"] == pytest.approx(1.0)
    assert payload["drivers"][2]["pace"] is None and payload["drivers"][2]["gap"] is None
    assert payload["fuel"]["total_laps"] == 44
    assert payload["compounds"][0]["compound"] == "MEDIUM"


def test_no_driver_with_enough_laps_is_a_session_data_error(monkeypatch):
    patch_session(monkeypatch, make_laps("AAA", 2, 4))
    with pytest.raises(SessionDataError):
        race_pace.race_pace_payload(2024, "Spa", "R", 13)


def test_only_races_and_sprints_are_analysed(monkeypatch):
    patch_session(monkeypatch, field())
    with pytest.raises(SessionDataError, match="race or a sprint"):
        race_pace.race_pace_payload(2024, "Spa", "Q", 13)


def test_the_payload_is_memoised(monkeypatch):
    calls = []
    patch_session(monkeypatch, field(), calls)
    first = race_pace.race_pace_payload(2024, "Spa", "R", 13)
    second = race_pace.race_pace_payload(2024, "Spa", "R", 13)
    assert first is second
    assert len(calls) == 1


def test_a_sprint_payload_uses_the_sprint_rate(monkeypatch):
    patch_session(monkeypatch, field())
    payload = race_pace.race_pace_payload(2024, "Spa", "S", 13)
    assert payload["fuel"]["seconds_per_lap"] == pytest.approx(0.03 * 110 / (44 * 3.05))


def test_a_repeated_index_does_not_misalign_the_laps(monkeypatch):
    laps = pd.concat([make_laps("AAA", 2, 20, base=101.0, total=20, spl=0.165), make_laps("BBB", 2, 20, base=100.0, total=20, spl=0.165)])
    assert laps.index.is_unique is False
    patch_session(monkeypatch, laps)
    payload = race_pace.race_pace_payload(2024, "Spa", "R", 13)
    assert payload["compounds"][0]["stints"] == 2
    assert payload["compounds"][0]["deg_per_lap"] == pytest.approx(0.1)
