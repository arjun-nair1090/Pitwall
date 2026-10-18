import numpy as np
import pandas as pd
import pytest

from app.services import race_battles
from app.services.session_info import SessionDataError


@pytest.fixture(autouse=True)
def _fresh_cache():
    race_battles.clear_cache()
    yield
    race_battles.clear_cache()


def make_laps(cars):
    """Laps from {code: [(lap, position, lap_end_seconds, pit_in, pit_out, track_status), ...]}.
    Trailing fields default: pit_in False, pit_out False, track_status "1"."""
    rows = []
    for code, entries in cars.items():
        for entry in entries:
            lap, position, seconds, *rest = entry
            pit_in, pit_out, status = (list(rest) + [False, False, "1"][len(rest):])[:3]
            rows.append({
                "Driver": code, "LapNumber": float(lap), "Position": float(position),
                "Time": pd.Timedelta(seconds=seconds),
                "PitInTime": pd.Timedelta(seconds=1) if pit_in else pd.NaT,
                "PitOutTime": pd.Timedelta(seconds=1) if pit_out else pd.NaT,
                "TrackStatus": status,
            })
    return pd.DataFrame(rows)


def duel(positions_a, gaps, *, flags=None, laps=None):
    """AAA and BBB over consecutive laps from lap 1. positions_a is AAA's place (1 or 2) per lap, gaps is
    the seconds AAA's lap-end time sits behind BBB's (negative when AAA is the one ahead)."""
    flags = flags or {}
    a, b = [], []
    for i, (pa, gap) in enumerate(zip(positions_a, gaps)):
        lap = i + 1
        base = 90.0 * lap
        extra_a = flags.get(("AAA", lap), ())
        extra_b = flags.get(("BBB", lap), ())
        a.append((lap, pa, base + gap, "in" in extra_a, "out" in extra_a, "4" if "sc" in extra_a else "1"))
        b.append((lap, 3 - pa, base, "in" in extra_b, "out" in extra_b, "4" if "sc" in extra_b else "1"))
    return make_laps({"AAA": a, "BBB": b})


def test_a_clean_pass_is_an_overtake():
    laps = duel([2, 2, 1], [1.0, 1.0, -3.0])
    assert race_battles.find_overtakes(laps) == [{"lap": 3, "driver": "AAA", "passed": "BBB", "position": 1}]


def test_one_car_passing_two_counts_twice():
    laps = make_laps({
        "AAA": [(1, 3, 100), (2, 3, 200), (3, 1, 300)],
        "BBB": [(1, 1, 100), (2, 1, 200), (3, 2, 300)],
        "CCC": [(1, 2, 100), (2, 2, 200), (3, 3, 300)],
    })
    assert race_battles.find_overtakes(laps) == [
        {"lap": 3, "driver": "AAA", "passed": "BBB", "position": 1},
        {"lap": 3, "driver": "AAA", "passed": "CCC", "position": 1},
    ]


def test_moving_up_while_a_rival_pits_is_not_an_overtake():
    positions, gaps = [2, 2, 1, 1], [1.0, 1.0, -3.0, -3.0]
    assert race_battles.find_overtakes(duel(positions, gaps, flags={("BBB", 3): ("in",)})) == []
    assert race_battles.find_overtakes(duel(positions, gaps, flags={("BBB", 3): ("out",)})) == []


@pytest.mark.parametrize("kind", ["in", "out"])
def test_the_passer_pitting_is_not_an_overtake(kind):
    laps = duel([2, 2, 1, 1], [1.0, 1.0, -3.0, -3.0], flags={("AAA", 3): (kind,)})
    assert race_battles.find_overtakes(laps) == []


@pytest.mark.parametrize("status", ["4", "5", "6", "7"])
def test_no_overtakes_under_a_safety_car(status):
    for who in ("AAA", "BBB"):
        laps = duel([2, 2, 1, 1], [1.0, 1.0, -3.0, -3.0])
        laps.loc[(laps["Driver"] == who) & (laps["LapNumber"] == 3.0), "TrackStatus"] = status
        assert race_battles.find_overtakes(laps) == []


def test_driving_past_a_car_that_crashed_is_not_an_overtake():
    assert race_battles.find_overtakes(duel([2, 2, 1], [6.0, 6.0, -3.0])) == []


def test_a_pass_needs_the_passer_within_two_and_a_half_seconds():
    assert len(race_battles.find_overtakes(duel([2, 2, 1], [2.4, 2.4, -3.0]))) == 1
    assert race_battles.find_overtakes(duel([2, 2, 1], [2.6, 2.6, -3.0])) == []


def test_driving_past_a_car_in_trouble_is_not_an_overtake():
    # Close at the start of the lap, but the passed car loses six seconds in it: it slowed, it wasn't passed.
    assert race_battles.find_overtakes(duel([2, 2, 1], [1.0, 1.0, -6.0])) == []


def test_a_pass_needs_the_passed_car_within_four_seconds_at_the_end_of_the_lap():
    assert len(race_battles.find_overtakes(duel([2, 2, 1], [1.0, 1.0, -3.9]))) == 1
    assert race_battles.find_overtakes(duel([2, 2, 1], [1.0, 1.0, -4.1])) == []


def test_a_pass_with_no_lap_end_time_for_the_passed_car_is_not_an_overtake():
    laps = duel([2, 2, 1], [1.0, 1.0, -3.0])
    laps.loc[(laps["Driver"] == "BBB") & (laps["LapNumber"] == 3.0), "Time"] = pd.NaT
    assert race_battles.find_overtakes(laps) == []


def test_a_pass_with_no_gap_is_not_an_overtake():
    laps = duel([2, 2, 1], [1.0, 1.0, -3.0])
    laps.loc[(laps["Driver"] == "BBB") & (laps["LapNumber"] == 2.0), "Time"] = pd.NaT
    assert race_battles.find_overtakes(laps) == []


def test_lap_one_is_not_an_overtake():
    laps = make_laps({
        "AAA": [(1, 1, 100), (2, 1, 200)],
        "BBB": [(1, 2, 101), (2, 2, 201)],
    })
    assert race_battles.find_overtakes(laps) == []


def test_a_retired_car_is_not_passed_after_it_stops():
    laps = make_laps({
        "AAA": [(1, 2, 100), (2, 2, 200), (3, 2, 300), (4, 1, 400)],
        "BBB": [(1, 1, 99), (2, 1, 199), (3, 1, 299)],
    })
    assert race_battles.find_overtakes(laps) == []


def test_a_battle_is_three_or_more_laps_within_a_second():
    laps = duel([2] * 6, [9.0, 0.6, 0.6, 0.6, 0.6, 2.5])
    assert race_battles.find_battles(laps) == [{
        "chaser": "AAA", "leader": "BBB", "start_lap": 2, "end_lap": 5, "laps": 4,
        "min_gap": 0.6, "outcome": "dropped", "outcome_lap": None,
    }]


def test_two_laps_close_is_not_a_battle():
    assert race_battles.find_battles(duel([2] * 5, [9.0, 0.6, 0.6, 2.5, 2.5])) == []


def test_a_battle_that_ends_in_a_pass():
    battles = race_battles.find_battles(duel([2, 2, 2, 2, 1], [9.0, 0.8, 0.5, 0.4, -2.0]))
    assert len(battles) == 1
    assert (battles[0]["start_lap"], battles[0]["end_lap"]) == (2, 4)
    assert (battles[0]["outcome"], battles[0]["outcome_lap"]) == ("passed", 5)
    assert battles[0]["min_gap"] == pytest.approx(0.4)


def test_a_battle_that_ends_with_the_leader_in_trouble_is_not_a_pass():
    battle = race_battles.find_battles(duel([2, 2, 2, 2, 1], [9.0, 0.8, 0.5, 0.4, -6.0]))[0]
    assert (battle["end_lap"], battle["outcome"], battle["outcome_lap"]) == (4, "dropped", None)


def test_a_battle_that_ends_in_the_pits():
    laps = duel([2] * 6, [9.0, 0.8, 0.5, 0.4, 3.0, 3.0], flags={("BBB", 5): ("in",)})
    battle = race_battles.find_battles(laps)[0]
    assert (battle["end_lap"], battle["outcome"], battle["outcome_lap"]) == (4, "pits", 5)


@pytest.mark.parametrize("flags", [
    {("BBB", 5): ("in",)}, {("AAA", 5): ("out",)}, {("AAA", 5): ("in",)}, {("BBB", 5): ("out",)},
])
def test_a_pit_lap_ends_a_battle_even_with_the_gap_still_closed(flags):
    laps = duel([2] * 6, [9.0, 0.8, 0.5, 0.4, 0.3, 3.0], flags=flags)
    battle = race_battles.find_battles(laps)[0]
    assert (battle["end_lap"], battle["outcome"], battle["outcome_lap"]) == (4, "pits", 5)


def test_a_new_car_ahead_splits_the_run():
    laps = make_laps({
        "AAA": [(i, 3, 90 * i + 0.5) for i in range(1, 4)] + [(i, 2, 90 * i + 0.5) for i in range(4, 7)],
        "BBB": [(i, 2, 90 * i) for i in range(1, 4)] + [(i, 3, 90 * i + 50) for i in range(4, 7)],
        "CCC": [(i, 1, 90 * i - 0.1) for i in range(1, 4)] + [(i, 1, 90 * i - 0.2) for i in range(4, 7)],
    })
    chasing = [(b["leader"], b["start_lap"], b["end_lap"]) for b in race_battles.find_battles(laps) if b["chaser"] == "AAA"]
    assert chasing == [("BBB", 1, 3), ("CCC", 4, 6)]


def test_exactly_one_second_is_not_a_battle_lap():
    assert race_battles.find_battles(duel([2] * 6, [9.0, 1.0, 1.0, 1.0, 1.0, 1.0])) == []


def test_a_negative_gap_is_not_a_battle_lap():
    assert race_battles.find_battles(duel([2] * 6, [9.0, -0.5, -0.5, -0.5, -0.5, -0.5])) == []


def test_a_car_coming_between_is_dropped():
    laps = make_laps({
        "AAA": [(i, 2, 90 * i + 0.5) for i in range(1, 4)] + [(i, 3, 90 * i + 1.5) for i in range(4, 6)],
        "BBB": [(i, 1, 90 * i) for i in range(1, 6)],
        "CCC": [(i, 3, 90 * i + 40) for i in range(1, 4)] + [(i, 2, 90 * i + 1.0) for i in range(4, 6)],
    })
    battle = [b for b in race_battles.find_battles(laps) if b["chaser"] == "AAA"][0]
    assert (battle["end_lap"], battle["outcome"], battle["outcome_lap"]) == (3, "dropped", None)


def test_the_flag_outranks_the_pits():
    # The chaser's data ends on lap 4 while the leader pits in on lap 5 and runs on to lap 6: the battle ran to
    # the chaser's last lap, so it is a flag, not a pit stop.
    laps = make_laps({
        "AAA": [(i, 2, 90 * i + 0.5) for i in range(1, 5)],
        "BBB": [(i, 1, 90 * i) for i in range(1, 5)] + [(5, 1, 450, True)] + [(6, 1, 540)],
    })
    battle = race_battles.find_battles(laps)[0]
    assert (battle["end_lap"], battle["outcome"], battle["outcome_lap"]) == (4, "flag", 4)
    # With the chaser still running, the same pit-in is what ended it.
    laps = duel([2] * 5, [9.0, 0.8, 0.5, 0.4, 0.3], flags={("BBB", 5): ("in",)})
    battle = race_battles.find_battles(laps)[0]
    assert (battle["end_lap"], battle["outcome"]) == (4, "pits")


def test_a_battle_to_the_flag():
    battle = race_battles.find_battles(duel([2] * 5, [9.0, 0.8, 0.5, 0.4, 0.3]))[0]
    assert (battle["end_lap"], battle["outcome"], battle["outcome_lap"]) == (5, "flag", 5)


def test_a_battle_ends_in_a_flag_when_the_leader_retires():
    laps = make_laps({
        "AAA": [(i, 2, 90 * i + 0.5) for i in range(1, 8)],
        "BBB": [(i, 1, 90 * i) for i in range(1, 6)],
    })
    battle = race_battles.find_battles(laps)[0]
    assert (battle["start_lap"], battle["end_lap"]) == (1, 5)
    assert (battle["outcome"], battle["outcome_lap"]) == ("flag", 5)


def test_a_safety_car_breaks_a_battle():
    laps = duel([2] * 9, [9.0, 0.8, 0.5, 0.4, 0.3, 0.8, 0.5, 0.4, 3.0],
                flags={("AAA", 5): ("sc",), ("BBB", 5): ("sc",)})
    battles = race_battles.find_battles(laps)
    assert [(b["start_lap"], b["end_lap"]) for b in battles] == [(2, 4), (6, 8)]
    assert (battles[0]["outcome"], battles[0]["outcome_lap"]) == ("neutralised", 5)
    assert battles[1]["outcome"] == "dropped"


def test_the_leader_never_battles():
    laps = duel([1] * 6, [-0.5] * 6)
    assert all(b["chaser"] != "AAA" for b in race_battles.find_battles(laps))
    assert [b["chaser"] for b in race_battles.find_battles(laps)] == ["BBB"]


class FakeSession:
    def __init__(self, laps, results):
        self.laps = laps
        self.results = results


def fake_session():
    laps = make_laps({
        "AAA": [(1, 3, 100), (2, 3, 200), (3, 1, 300), (4, 1, 400)],
        "BBB": [(1, 1, 99), (2, 1, 199), (3, 2, 299), (4, 2, 399)],
        "CCC": [(1, 2, 101), (2, 2, 201), (3, 3, 301)],
        "DDD": [(1, 4, 120), (2, 4, 220), (3, 4, 320), (4, 3, 420)],
    })
    results = pd.DataFrame({
        "Abbreviation": ["AAA", "BBB", "CCC", "DDD"],
        "GridPosition": [5.0, 1.0, 0.0, 4.0],
        # FastF1 numbers every car, retirements and disqualifications included; ClassifiedPosition says
        # which: CCC retired after lap 3 and DDD was disqualified.
        "Position": [1.0, 2.0, 4.0, 3.0],
        "ClassifiedPosition": ["1", "2", "R", "D"],
        "FullName": ["A A", "B B", "C C", "D D"],
        "TeamName": ["Alpha", "Beta", "Gamma", "Delta"],
        "TeamColor": ["112233", "445566", "778899", "AABBCC"],
    })
    return FakeSession(laps, results)


def test_payload_drivers_have_a_position_per_lap_and_start_gains(monkeypatch):
    monkeypatch.setattr(race_battles, "load_session", lambda *a, **k: fake_session())
    payload = race_battles.race_battles_payload(2024, "Test", "R")
    assert payload["total_laps"] == 4
    by_code = {d["code"]: d for d in payload["drivers"]}
    assert by_code["CCC"]["positions"] == [2, 2, 3, None]
    assert by_code["AAA"]["positions"] == [3, 3, 1, 1]
    assert by_code["AAA"]["start_gain"] == 5 - 3
    assert by_code["CCC"]["grid"] is None and by_code["CCC"]["start_gain"] is None
    assert [d["code"] for d in payload["drivers"]] == ["AAA", "BBB", "DDD", "CCC"]
    assert by_code["AAA"]["name"] == "A A" and by_code["AAA"]["team"] == "Alpha"
    assert by_code["AAA"]["color"].startswith("#")
    assert by_code["AAA"]["finish"] == 1 and by_code["CCC"]["finish"] is None
    for code, driver in by_code.items():
        assert driver["made"] == sum(1 for o in payload["overtakes"] if o["driver"] == code)
        assert driver["lost"] == sum(1 for o in payload["overtakes"] if o["passed"] == code)
    assert {"lap": 3, "driver": "AAA", "passed": "BBB", "position": 1} in payload["overtakes"]
    assert by_code["AAA"]["made"] == 2  # BBB and CCC on lap 3
    assert by_code["BBB"]["lost"] == 1


def test_a_retirement_and_a_disqualification_have_no_finishing_place(monkeypatch):
    monkeypatch.setattr(race_battles, "load_session", lambda *a, **k: fake_session())
    by_code = {d["code"]: d for d in race_battles.race_battles_payload(2024, "Test", "R")["drivers"]}
    assert (by_code["AAA"]["finish"], by_code["AAA"]["finish_note"]) == (1, None)
    assert (by_code["BBB"]["finish"], by_code["BBB"]["finish_note"]) == (2, None)
    assert (by_code["CCC"]["finish"], by_code["CCC"]["finish_note"]) == (None, "DNF")
    assert (by_code["DDD"]["finish"], by_code["DDD"]["finish_note"]) == (None, "DSQ")


@pytest.mark.parametrize("classified, expected", [
    ("1", (1, None)), ("12", (12, None)),
    ("D", (None, "DSQ")), ("E", (None, "DSQ")),
    ("R", (None, "DNF")), ("N", (None, "DNF")), ("W", (None, "DNF")), ("F", (None, "DNF")),
    ("", (None, None)), (np.nan, (None, None)), (None, (None, None)),
])
def test_classified_position_reads_as_a_finish_or_a_note(classified, expected):
    assert race_battles._classified(classified) == expected


@pytest.mark.parametrize("status", ["Disqualified", "disqualified", "Excluded"])
def test_a_disqualification_has_no_finish_even_when_fastf1_ranks_him(monkeypatch, status):
    # Spa 2024: RUS has ClassifiedPosition "20" but Status "Disqualified".
    session = fake_session()
    session.results["ClassifiedPosition"] = ["1", "2", "R", "3"]
    session.results["Status"] = ["Finished", "Finished", "Retired", status]
    monkeypatch.setattr(race_battles, "load_session", lambda *a, **k: session)
    drivers = race_battles.race_battles_payload(2024, "Test", "R")["drivers"]
    by_code = {d["code"]: d for d in drivers}
    assert (by_code["DDD"]["finish"], by_code["DDD"]["finish_note"]) == (None, "DSQ")
    assert (by_code["AAA"]["finish"], by_code["AAA"]["finish_note"]) == (1, None)
    assert [d["code"] for d in drivers] == ["AAA", "BBB", "DDD", "CCC"]


def test_a_dnf_with_no_position_and_no_classification_sorts_last(monkeypatch):
    session = fake_session()
    session.results = session.results.drop(columns="ClassifiedPosition")
    session.results.loc[session.results["Abbreviation"] == "CCC", "Position"] = np.nan
    monkeypatch.setattr(race_battles, "load_session", lambda *a, **k: session)
    drivers = race_battles.race_battles_payload(2024, "Test", "R")["drivers"]
    assert [d["code"] for d in drivers] == ["AAA", "BBB", "DDD", "CCC"]
    assert (drivers[-1]["finish"], drivers[-1]["finish_note"]) == (None, None)


def test_qualifying_is_refused(monkeypatch):
    monkeypatch.setattr(race_battles, "load_session", lambda *a, **k: pytest.fail("should not load"))
    with pytest.raises(SessionDataError, match="Overtakes need a race or a sprint."):
        race_battles.race_battles_payload(2024, "Test", "Q")


def test_the_payload_is_memoised(monkeypatch):
    calls = []

    def load(*args, **kwargs):
        calls.append(args)
        return fake_session()

    monkeypatch.setattr(race_battles, "load_session", load)
    first = race_battles.race_battles_payload(2024, "Test", "R")
    second = race_battles.race_battles_payload(2024, "Test", "R")
    assert first is second and len(calls) == 1


def walk(value):
    if isinstance(value, dict):
        for key, item in value.items():
            assert type(key) is str
            yield from walk(item)
    elif isinstance(value, list):
        for item in value:
            yield from walk(item)
    else:
        yield value


def test_payload_numbers_are_plain_python(monkeypatch):
    monkeypatch.setattr(race_battles, "load_session", lambda *a, **k: fake_session())
    for leaf in walk(race_battles.race_battles_payload(2024, "Test", "R")):
        assert leaf is None or type(leaf) in (int, float, str, bool), (leaf, type(leaf))
