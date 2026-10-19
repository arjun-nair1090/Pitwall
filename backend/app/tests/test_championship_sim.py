"""Championship odds simulator: DataFrames in, payload out. No network."""
import time

import numpy as np
import pandas as pd
import pytest

from app.services import championship_sim as sim
from app.services.championship_sim import ChampionshipError, championship_payload

COLUMNS = ["round", "code", "name", "team", "position", "position_text", "points"]
RACE = sim.RACE_POINTS
SPRINT = [8, 7, 6, 5, 4, 3, 2, 1]


@pytest.fixture(autouse=True)
def _fixed_year(monkeypatch):
    monkeypatch.setattr(sim, "_current_year", lambda: 2026)


def _rows(rnd, order, table, teams, override):
    """Result rows of one event. A code starting with "-" retired: no position, no points."""
    out = []
    place = 0
    for code in order:
        retired = code.startswith("-")
        code = code.lstrip("-")
        if not retired:
            place += 1
        pts = table[place - 1] if not retired and place <= len(table) else 0.0
        pts = override.get((rnd, code), pts)
        out.append({
            "round": rnd, "code": code, "name": f"Driver {code}",
            "team": teams.get(code, f"{code} team"),
            "position": np.nan if retired else place,
            "position_text": "R" if retired else str(place),
            "points": float(pts),
        })
    return out


def season(rounds, total=None, sprint_rounds=(), sprint_results=None, teams=None, override=None):
    """races, sprints and schedule from compact finishing orders (one list of codes per round)."""
    teams, override = teams or {}, override or {}
    total = total or len(rounds)
    races = [r for i, o in enumerate(rounds, 1) for r in _rows(i, o, RACE, teams, override)]
    sprints = [r for i, o in (sprint_results or {}).items() for r in _rows(i, o, SPRINT, teams, override)]
    schedule = pd.DataFrame([
        {"round": i, "name": f"Race {i}", "date": f"2024-{(i - 1) % 12 + 1:02d}-15", "sprint": i in sprint_rounds}
        for i in range(1, total + 1)
    ])
    return pd.DataFrame(races, columns=COLUMNS), pd.DataFrame(sprints, columns=COLUMNS), schedule


def payload(year, rounds, after=None, **kw):
    races, sprints, schedule = season(rounds, **kw)
    return championship_payload(year, races, sprints, schedule, after)


def driver(p, code):
    return next(d for d in p["drivers"] if d["code"] == code)


def test_points_so_far_add_races_and_sprints():
    p = payload(2024, [["A", "B"], ["B", "A"], ["A", "B"]], after=2, total=3,
                sprint_rounds=(1,), sprint_results={1: ["B", "A"]})
    assert driver(p, "A")["points"] == 25 + 18 + 7
    assert driver(p, "B")["points"] == 18 + 25 + 8


def test_half_points_stay_fractional():
    p = payload(2021, [["A", "B"]], total=3, override={(1, "A"): 12.5})
    assert driver(p, "A")["points"] == 12.5


def test_default_cut_off_is_the_last_completed_round():
    p = payload(2024, [["A", "B"]] * 3, total=5)
    assert p["after_round"] == 3
    assert p["completed_rounds"] == 3
    assert p["total_rounds"] == 5
    assert [r["round"] for r in p["remaining"]] == [4, 5]


def test_a_round_not_yet_run_is_a_422():
    with pytest.raises(ChampionshipError) as e:
        payload(2024, [["A", "B"]] * 3, after=4, total=5)
    assert e.value.status == 422
    assert str(e.value) == "Round 4 of 2024 hasn't been run yet."


def test_round_zero_is_a_422():
    for bad in (0, -2):
        with pytest.raises(ChampionshipError) as e:
            payload(2024, [["A", "B"]], after=bad, total=3)
        assert e.value.status == 422
        assert str(e.value) == "Pick a round from 1."


def test_no_races_yet_is_a_404():
    empty = pd.DataFrame(columns=COLUMNS)
    _, _, schedule = season([["A"]], total=3)
    with pytest.raises(ChampionshipError) as e:
        championship_payload(2024, empty, empty, schedule, None)
    assert e.value.status == 404
    assert str(e.value) == "No races have been run in 2024 yet."


def test_years_outside_the_coverage_are_a_422():
    for year in (2017, 2027):
        with pytest.raises(ChampionshipError) as e:
            payload(year, [["A", "B"]], total=3)
        assert e.value.status == 422
        assert str(e.value) == "Championship odds cover 2018 to 2026."


def test_max_remaining_counts_races_sprints_and_fastest_lap_years():
    assert sim._max_remaining(2024, 2, 1) == (60, 2 * 44 + 15)
    assert sim._max_remaining(2025, 2, 1) == (58, 2 * 43 + 15)
    assert sim._max_remaining(2021, 0, 1) == (3, 5)
    # and it reaches the payload: a leader's max_points is points plus that
    p = payload(2024, [["A", "B"]], total=3, sprint_rounds=(3,))
    assert driver(p, "A")["max_points"] == 25 + 60
    p = payload(2025, [["A", "B"]], total=3, sprint_rounds=(3,))
    assert driver(p, "A")["max_points"] == 25 + 58


def test_a_leader_out_of_reach_has_clinched():
    p = payload(2024, [["A", "B", "C"]] * 5, total=6, teams={"A": "X", "B": "X"})
    assert driver(p, "A")["status"] == "clinched"
    assert driver(p, "A")["title_probability"] == 1.0
    assert driver(p, "B")["title_probability"] == 0.0
    assert driver(p, "C")["title_probability"] == 0.0
    assert p["constructors"][0]["status"] == "clinched"


def test_a_driver_who_cannot_catch_the_leader_is_eliminated():
    p = payload(2024, [["A", "B", "C"]] * 5, total=6)
    assert driver(p, "C")["status"] == "eliminated"
    assert driver(p, "C")["title_probability"] == 0.0
    # B is on 90, A on 125 with 26 to come: 116 < 125
    assert driver(p, "B")["status"] == "eliminated"


def test_equal_on_max_with_countback_open_is_not_eliminated_or_clinched():
    # 2025: one race left is worth 25. A on 50 can reach 75, B on 25 can reach 50 = A's points.
    # One win each, so if B wins the last race B has more wins: countback is still open.
    p = payload(2025, [["A", "B"], ["B", "A"]], total=3,
                override={(1, "B"): 12.0, (2, "B"): 13.0, (2, "A"): 25.0})
    assert driver(p, "A")["points"] == 50 and driver(p, "B")["points"] == 25
    assert driver(p, "A")["wins"] == driver(p, "B")["wins"] == 1
    assert driver(p, "B")["status"] == "contender"
    assert driver(p, "A")["status"] == "contender"
    # one more point for A and B is out: 25 + 25 < 51
    p = payload(2025, [["A", "B"], ["A", "B"]], total=3,
                override={(1, "B"): 12.0, (2, "B"): 12.0})
    assert driver(p, "B")["status"] == "eliminated"


def test_equal_on_max_but_beaten_on_countback():
    # 2022 after round 17 in miniature: B can only draw level on points, and A has more wins than
    # B can reach, so B is out and A has clinched.
    p = payload(2025, [["A", "B"], ["A", "B"]], total=3,
                override={(1, "B"): 12.0, (2, "B"): 13.0})
    assert driver(p, "A")["points"] == 50 and driver(p, "B")["points"] == 25
    assert driver(p, "A")["wins"] == 2 and driver(p, "B")["wins"] == 0
    assert driver(p, "B")["status"] == "eliminated"
    assert driver(p, "A")["status"] == "clinched"
    # a third driver who can still pass A on points keeps it open for A
    p = payload(2025, [["A", "C", "B"], ["A", "C", "B"]], total=3,
                override={(1, "B"): 12.0, (2, "B"): 13.0, (1, "C"): 20.0, (2, "C"): 20.0})
    assert driver(p, "B")["status"] == "eliminated"
    assert driver(p, "C")["status"] == "contender"
    assert driver(p, "A")["status"] == "contender"


def test_constructors_level_on_max_stay_open():
    # 2025, one race left (43 for a team): T2 on 7 can only draw level with T1 on 50, and has no
    # wins, but constructor ties are split, so neither is decided
    teams = {"A": "T1", "C": "T1", "B": "T2"}
    p = payload(2025, [["A", "B", "-C"], ["A", "B", "-C"]], total=3, teams=teams,
                override={(1, "B"): 3.0, (2, "B"): 4.0})
    by = {c["team"]: c for c in p["constructors"]}
    assert by["T1"]["points"] == 50 and by["T2"]["points"] == 7
    assert by["T2"]["status"] == "contender"
    assert by["T1"]["status"] == "contender"


def test_points_available_is_one_racing_drivers_max_remaining():
    p = payload(2024, [["A", "B"]] * 2, total=5, sprint_rounds=(4,))
    assert p["points_available"] == 3 * 26 + 8
    p = payload(2024, [["A", "B"]] * 3, total=3)
    assert p["points_available"] == 0


def test_points_available_does_not_depend_on_the_leader_racing():
    # 2020 after round 16 in shape: the leader missed the cut-off round, so their max is their points
    p = payload(2020, [["A", "B", "C"]] * 4 + [["C", "B"]], total=7)
    assert p["drivers"][0]["code"] == "A"
    assert p["drivers"][0]["status"] == "not racing"
    assert p["drivers"][0]["max_points"] == p["drivers"][0]["points"]
    assert p["points_available"] == 2 * 26


def test_a_driver_missing_from_the_cut_off_round_is_not_racing():
    p = payload(2024, [["A", "B", "C"], ["A", "B", "C"], ["A", "B"]], total=5)
    c = driver(p, "C")
    assert c["points"] == 30
    assert c["status"] == "not racing"
    assert c["title_probability"] == 0.0
    assert c["max_points"] == c["points"]
    assert c["expected_points"] == c["points"]
    assert c["points_p10"] == c["points_p90"] == c["points"]
    assert driver(p, "A")["max_points"] > driver(p, "A")["points"]


def test_a_dominant_driver_is_the_favourite():
    p = payload(2024, [["A", "B", "C", "D"]] * 10, total=15)
    assert driver(p, "A")["title_probability"] > 0.9


def test_odds_sum_to_one():
    rounds = [["A", "B", "-C", "D", "E"], ["B", "A", "C", "D", "E"], ["C", "-A", "B", "E", "D"],
              ["A", "C", "B", "D", "-E"]]
    p = payload(2024, rounds, total=8, sprint_rounds=(6,), teams={"A": "X", "B": "X", "C": "Y", "D": "Y"})
    assert sum(d["title_probability"] for d in p["drivers"]) == pytest.approx(1.0, abs=1e-3)
    assert sum(c["title_probability"] for c in p["constructors"]) == pytest.approx(1.0, abs=1e-3)
    # unrounded, via the model itself
    races, sprints, schedule = season(rounds, total=8, sprint_rounds=(6,))
    m = sim._model(2024, races, sprints, schedule, 4, 2000)
    assert m["driver_odds"].sum() == pytest.approx(1.0, abs=1e-9)
    assert m["team_odds"].sum() == pytest.approx(1.0, abs=1e-9)


def test_same_request_same_odds():
    rounds = [["A", "B", "C"], ["B", "C", "A"], ["C", "A", "B"]]
    assert payload(2024, rounds, total=6) == payload(2024, rounds, total=6)


def test_a_tie_on_points_goes_to_more_wins():
    # level on 68, A has two wins to B's one
    p = payload(2024, [["A", "B"], ["A", "B"], ["B", "A"]], override={(1, "B"): 25.0})
    assert driver(p, "A")["points"] == driver(p, "B")["points"] == 68
    assert driver(p, "A")["title_probability"] == 1.0
    assert driver(p, "B")["title_probability"] == 0.0


def test_a_tie_on_wins_goes_to_more_seconds():
    # level on points, one win each, A has the second place B lacks
    p = payload(2024, [["A", "B", "C"], ["B", "C", "A"]], override={(2, "A"): 18.0})
    a, b = driver(p, "A"), driver(p, "B")
    assert a["points"] == b["points"] == 43
    assert a["wins"] == b["wins"] == 1
    # A: P1 and P3, B: P2 and P1 -> B has the second
    assert b["title_probability"] == 1.0 and a["title_probability"] == 0.0


def test_an_unbreakable_tie_is_shared():
    p = payload(2024, [["A", "B"], ["B", "A"]])
    assert driver(p, "A")["title_probability"] == 0.5
    assert driver(p, "B")["title_probability"] == 0.5


def test_season_over_has_no_remaining_and_crowns_the_leader():
    p = payload(2024, [["A", "B", "C"]] * 3, total=3)
    assert p["remaining"] == []
    assert driver(p, "A")["status"] == "clinched"
    assert driver(p, "A")["title_probability"] == 1.0
    assert driver(p, "B")["title_probability"] == 0.0
    assert driver(p, "A")["max_points"] == driver(p, "A")["points"]


def test_history_has_one_entry_per_round_up_to_the_cut_off():
    rounds = [["A", "B", "C", "D"]] * 3 + [["D", "C", "B", "A"]]
    p = payload(2024, rounds, after=3, total=4)
    assert [h["round"] for h in p["history"]] == [1, 2, 3]
    assert [h["name"] for h in p["history"]] == ["Race 1", "Race 2", "Race 3"]
    last = p["history"][2]["odds"]
    # D is on 36 after three rounds with 25 to come: out of reach of A on 75, so dropped
    assert "D" not in last and "A" in last
    for h in p["history"]:
        assert all(v > 0 for v in h["odds"].values())


def test_retirements_score_nothing_and_raise_the_retirement_rate():
    rounds = [["A", "B"], ["A", "-B"], ["A", "-B"], ["A", "-B"]]
    races, _, _ = season(rounds)
    p = sim._retirement_chances(races, ["A", "B"])
    assert p[1] > p[0]
    # the field rate is 3/8, so the clean driver is pulled up from 0 and the bad one down from 1
    assert 0 < p[0] < 3 / 8 < p[1] < 1
    # by twelve pseudo-starts at that rate
    assert p[0] == pytest.approx((0 + 12 * 3 / 8) / (4 + 12))
    assert p[1] == pytest.approx((3 + 12 * 3 / 8) / (4 + 12))
    # a retired car scores nothing, and a clean one beats an equal car that retires
    rng = np.random.default_rng(1)
    tables = np.array([RACE[:2]], dtype=float)
    pts, wins, _ = sim._simulate(rng, 2000, np.array([5.0, 5.0]), 2.0, np.array([1.0, 1.0]), tables,
                                 np.array([True]))
    assert pts.sum() == 0 and wins.sum() == 0
    pts, _, _ = sim._simulate(rng, 4000, np.array([5.0, 5.0]), 2.0, np.array([0.8, 0.0]), tables,
                              np.array([True]))
    assert pts[:, 1].mean() > pts[:, 0].mean()


def test_constructor_points_sum_their_drivers():
    p = payload(2024, [["A", "C", "B"], ["B", "A", "C"]], total=4, teams={"A": "T1", "B": "T1", "C": "T2"})
    by = {c["team"]: c for c in p["constructors"]}
    assert by["T1"]["points"] == (25 + 15) + (25 + 18)
    assert by["T2"]["points"] == 18 + 15
    assert [c["team"] for c in p["constructors"]] == ["T1", "T2"]


def test_constructor_max_remaining_counts_two_cars():
    assert sim._max_remaining(2024, 1, 1)[1] == 44 + 15
    assert sim._max_remaining(2025, 1, 0)[1] == 43
    # 2024: T2 on 33 cannot reach T1's 83 with 59 to come
    p = payload(2024, [["A", "C", "B"], ["B", "A", "C"]], total=4, teams={"A": "T1", "B": "T1", "C": "T2"})
    assert p["constructors"][1]["status"] == "contender"
    p = payload(2025, [["A", "B", "C"]] * 3, total=4, teams={"A": "T1", "B": "T1", "C": "T2"})
    assert p["constructors"][1]["status"] == "eliminated"


def test_rounds_lists_every_completed_round():
    p = payload(2024, [["A", "B"]] * 4, after=2, total=6)
    assert p["rounds"] == [{"round": i, "name": f"Race {i}"} for i in range(1, 5)]
    assert p["after_round"] == 2


def test_empty_sprints_mean_no_sprints():
    races, _, schedule = season([["A", "B"]] * 2, total=3)
    p = championship_payload(2024, races, pd.DataFrame(), schedule, None)
    assert driver(p, "A")["points"] == 50


def test_payload_rounding():
    p = payload(2024, [["A", "B", "C"], ["B", "A", "C"]], total=6, override={(1, "A"): 12.3456})
    for d in p["drivers"]:
        for key in ("title_probability",):
            assert d[key] == round(d[key], 4)
        for key in ("points", "expected_points", "points_p10", "points_p90", "max_points"):
            assert d[key] == round(d[key], 1)
    assert driver(p, "A")["points"] == 30.3
    for c in p["constructors"]:
        assert c["title_probability"] == round(c["title_probability"], 4)
    for h in p["history"]:
        assert all(v == round(v, 4) for v in h["odds"].values())
    assert p["simulations"] == sim.N_SIMS
    assert p["remaining"][0] == {"round": 3, "name": "Race 3", "date": "2024-03-15", "sprint": False}


def test_a_24_round_season_is_fast():
    codes = [f"D{i:02d}" for i in range(20)]
    rng = np.random.default_rng(7)
    rounds = [list(rng.permutation(codes)) for _ in range(17)]
    races, sprints, schedule = season(rounds, total=24, sprint_rounds=(5, 11, 19, 22),
                                      teams={c: f"T{i // 2}" for i, c in enumerate(codes)})
    start = time.perf_counter()
    p = championship_payload(2024, races, sprints, schedule, 17)
    elapsed = time.perf_counter() - start
    print(f"24-round season, after round 17: {elapsed:.2f}s")
    assert len(p["history"]) == 17
    assert elapsed < 5.0


def _classified_rows(finishes, retired=()):
    """Race rows for _form: finishes is {code: [position per round]}; retired is {(code, round)}."""
    rows = []
    for code, positions in finishes.items():
        for rnd, pos in enumerate(positions, 1):
            dnf = (code, rnd) in retired
            rows.append({"round": rnd, "code": code, "name": code, "team": code,
                         "position": np.nan if dnf else pos, "position_text": "R" if dnf else str(pos),
                         "points": 0.0})
    return pd.DataFrame(rows, columns=COLUMNS)


def test_form_weights_recent_finishes_more():
    # 12 rounds: A was 1st for six then 2nd for six; B the reverse. Same field of 2.
    a = [1] * 6 + [2] * 6
    b = [2] * 6 + [1] * 6
    races = _classified_rows({"A": a, "B": b})
    mu, _, _ = sim._form(races, ["A", "B"], 12)
    w = 0.5 ** ((12 - np.arange(1, 13)) / sim.HALF_LIFE)
    expect_a = ((w * np.array(a)).sum() + 1.5) / (w.sum() + 1)
    assert mu[0] == pytest.approx(expect_a)
    # equal results in total, but B's good half is the recent one
    assert mu[1] < mu[0]


def test_form_skips_retirements_and_adds_the_prior():
    races = _classified_rows({"A": [3, 3, 3], "B": [1, 1, 1], "C": [2, 2, 2]}, retired={("A", 3)})
    mu, _, _ = sim._form(races, ["A", "B", "C"], 3)
    w = np.array([0.5 ** (2 / 6), 0.5 ** (1 / 6)])
    assert mu[0] == pytest.approx((w * 3).sum() / (w.sum() + 1) + 2.0 / (w.sum() + 1))
    # no finish at all: the field midpoint, (n + 1) / 2
    races = _classified_rows({"A": [1, 1], "B": [2, 2], "C": [3, 3], "D": [4, 4]},
                             retired={("D", 1), ("D", 2)})
    mu, _, _ = sim._form(races, ["A", "B", "C", "D"], 2)
    assert mu[3] == pytest.approx(2.5)


def test_form_noise_is_floored_and_rises_with_spread():
    # everyone finishes where their form says, nearly: deviations are well under 2
    tight = _classified_rows({"A": [1] * 4, "B": [2] * 4})
    assert sim._form(tight, ["A", "B"], 4)[1] == 2.0
    # a field that reshuffles every round deviates far more than 2 from its form
    codes = list("ABCDEFGHIJ")
    rng = np.random.default_rng(3)
    wide = _classified_rows({c: [1, 10, 1, 10] if i % 2 == 0 else [10, 1, 10, 1] for i, c in enumerate(codes)})
    assert sim._form(wide, codes, 4)[1] > 3.0


def test_event_tables_follow_the_year_and_sprint_flag():
    schedule = pd.DataFrame([
        {"round": 1, "name": "x", "date": "d", "sprint": True},
        {"round": 2, "name": "y", "date": "d", "sprint": False},
    ])
    t, is_race = sim._event_tables(2021, schedule, 0, 5)
    assert t.tolist() == [[3, 2, 1, 0, 0], [25, 18, 15, 12, 10], [25, 18, 15, 12, 10]]
    assert is_race.tolist() == [False, True, True]
    t, _ = sim._event_tables(2024, schedule, 0, 10)
    assert t[0].tolist() == [8, 7, 6, 5, 4, 3, 2, 1, 0, 0]
    # before 2021 a sprint flag is ignored
    t, is_race = sim._event_tables(2020, schedule, 0, 5)
    assert t.shape[0] == 2 and is_race.all()


def test_a_sprint_scores_its_own_table_and_never_counts_as_a_win():
    tables = np.array([[8, 7, 6, 5, 4, 3, 2, 1, 0, 0]], dtype=float)
    pts, wins, seconds = sim._simulate(np.random.default_rng(2), 3000, np.arange(10.0), 2.0,
                                       np.zeros(10), tables, np.array([False]))
    assert wins.sum() == 0 and seconds.sum() == 0
    assert pts.max() == 8 and pts.sum() == 3000 * 36


def test_a_one_car_field_simulates():
    pts, wins, seconds = sim._simulate(np.random.default_rng(2), 100, np.array([1.0]), 2.0,
                                       np.array([0.0]), np.array([[25.0]]), np.array([True]))
    assert pts.sum() == 2500 and wins.sum() == 100 and seconds.sum() == 0


def test_simulated_wins_and_seconds_break_a_points_tie():
    points = np.array([[100.0, 100.0, 100.0]])
    wins = np.array([[2.0, 3.0, 3.0]])
    seconds = np.array([[9.0, 0.0, 1.0]])
    key = sim._countback_key(points, wins, seconds)
    assert sim._title_share(key).tolist() == [0.0, 0.0, 1.0]
    # more points beats any number of wins
    assert sim._countback_key(np.array([101.0]), np.array([0.0]), np.array([0.0])) >         sim._countback_key(np.array([100.0]), np.array([24.0]), np.array([24.0]))


def test_history_is_the_model_as_it_stood_after_each_round():
    # A wins rounds 1 and 2, B wins round 3 of a six-round season
    rounds = [["A", "B", "C"], ["A", "C", "B"], ["B", "A", "C"]]
    races, sprints, schedule = season(rounds, total=6)
    p = championship_payload(2024, races, sprints, schedule, 3)
    for r in (1, 2, 3):
        m = sim._model(2024, races, sprints, schedule, r, sim.HISTORY_SIMS)
        expected = {c: round(float(o), 4) for c, o in zip(m["drivers"].index, m["driver_odds"])}
        expected = {c: o for c, o in expected.items() if o > 0}
        assert p["history"][r - 1]["odds"] == expected
    # B has the lead only after round 3, A after round 2
    assert p["history"][1]["odds"]["A"] > p["history"][1]["odds"]["B"]
    assert p["history"][2]["odds"]["B"] > p["history"][1]["odds"]["B"]


def test_the_model_counts_simulated_wins_and_seconds_in_the_countback(monkeypatch):
    # level on points, wins and seconds so far; the simulated events then hand out the tie-break
    races, sprints, schedule = season([["A", "B"], ["B", "A"]], total=3)

    def fake(wins, seconds):
        def simulate(rng, sims, mu, sigma, p, tables, is_race):
            zeros = np.zeros((sims, 2))
            return zeros, np.tile(wins, (sims, 1)), np.tile(seconds, (sims, 1))
        return simulate

    monkeypatch.setattr(sim, "_simulate", fake([1.0, 0.0], [0.0, 5.0]))
    m = sim._model(2024, races, sprints, schedule, 2, 50)
    assert m["driver_odds"].tolist() == [1.0, 0.0]
    monkeypatch.setattr(sim, "_simulate", fake([0.0, 0.0], [0.0, 1.0]))
    m = sim._model(2024, races, sprints, schedule, 2, 50)
    assert m["driver_odds"].tolist() == [0.0, 1.0]


def test_racing_point_loses_15_points_from_2020_round_3():
    rounds = [["A", "B", "C"]] * 4
    teams = {"A": "Racing Point", "B": "Racing Point", "C": "McLaren"}
    p = payload(2020, rounds, after=2, total=6, teams=teams)
    by = {c["team"]: c for c in p["constructors"]}
    assert by["Racing Point"]["points"] == 2 * (25 + 18)
    p = payload(2020, rounds, after=3, total=6, teams=teams)
    by = {c["team"]: c for c in p["constructors"]}
    assert by["Racing Point"]["points"] == 3 * (25 + 18) - 15
    assert by["McLaren"]["points"] == 3 * 15
    # drivers keep their points: the deduction was the team's
    assert driver(p, "A")["points"] == 75


def test_the_deduction_only_reaches_its_own_season():
    teams = {"A": "Racing Point", "B": "Racing Point", "C": "McLaren"}
    p = payload(2021, [["A", "B", "C"]] * 4, after=3, total=6, teams=teams)
    by = {c["team"]: c for c in p["constructors"]}
    assert by["Racing Point"]["points"] == 3 * (25 + 18)


def test_the_deduction_feeds_the_constructor_status():
    # 2020, one race left (44 for a team). Racing Point's 129 would be out of McLaren's reach of
    # 81 + 44 = 125, but after the deduction it is on 114, so neither has clinched.
    teams = {"A": "Racing Point", "B": "Racing Point", "C": "McLaren", "D": "McLaren"}
    p = payload(2020, [["A", "B", "C", "D"]] * 3, total=4, teams=teams)
    by = {c["team"]: c for c in p["constructors"]}
    assert by["Racing Point"]["points"] == 114
    assert by["McLaren"]["points"] == 81
    assert by["Racing Point"]["status"] == "contender"
    assert by["McLaren"]["status"] == "contender"
    p = payload(2021, [["A", "B", "C", "D"]] * 3, total=4, teams=teams)
    assert {c["team"]: c for c in p["constructors"]}["Racing Point"]["status"] == "clinched"


def test_form_mass_sums_the_weights_of_classified_finishes():
    races = _classified_rows({"A": [3, 3, 3], "B": [1, 1, 1], "C": [2, 2, 2]}, retired={("A", 3)})
    _, _, mass = sim._form(races, ["A", "B", "C"], 3)
    w = 0.5 ** (np.array([2, 1, 0]) / sim.HALF_LIFE)
    assert mass.tolist() == pytest.approx([w[:2].sum(), w.sum(), w.sum()])


def test_each_simulation_shifts_every_drivers_form_once(monkeypatch):
    # A has three finishes, B none: B's form is the prior alone and moves the most
    races, sprints, schedule = season([["A", "-B"], ["A", "-B"], ["A", "-B"]], total=5)
    mu, sigma, mass = sim._form(races, ["A", "B"], 3)
    seen = {}

    def simulate(rng, sims, form, sigma_, p, tables, is_race):
        seen["form"] = form
        zeros = np.zeros((sims, 2))
        return zeros, zeros, zeros

    monkeypatch.setattr(sim, "_simulate", simulate)
    sim._model(2024, races, sprints, schedule, 3, 20_000)
    form = seen["form"]
    assert form.shape == (20_000, 2)
    assert form.mean(axis=0) == pytest.approx(mu, abs=0.05)
    assert form.std(axis=0) == pytest.approx(sigma / np.sqrt(mass + sim.PRIOR_WEIGHT), rel=0.03)
    assert form.std(axis=0)[1] == pytest.approx(sigma, rel=0.03)
    # the same request draws the same offsets
    sim._model(2024, races, sprints, schedule, 3, 20_000)
    assert np.array_equal(seen["form"], form)
