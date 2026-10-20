"""Tests for the pit-window strategy core.

Every expected number is either worked by hand in a comment or comes from `brute`, a plain
lap-by-lap loop over every legal plan that shares no code with the module under test.
"""
import itertools
import math
import time

import pytest

from app.services import pit_strategy as ps
from app.services.pit_strategy import DriverState, Stop, TyreModel

DRY = ("SOFT", "MEDIUM", "HARD")


def fit(base, deg, fitted=True, laps=50):
    return (base, deg, fitted, laps)


def balance_model(pit_loss=20.0):
    # MEDIUM is 0.2 s a lap quicker than HARD when fresh; all three wear at 0.1 s per lap of age.
    return TyreModel(
        {"SOFT": fit(95.0, 0.1), "MEDIUM": fit(90.0, 0.1), "HARD": fit(90.2, 0.1)}, pit_loss
    )


def state(compound="HARD", age=10, used=None, lap=10, gap=None, neutralised=False, code="AAA", position=1):
    return DriverState(
        code=code, position=position, lap=lap, compound=compound, tyre_age=age,
        used=set(used if used is not None else {compound}), gap_ahead=gap, neutralised=neutralised,
    )


def brute(st, model, R, dry=True, neutralised_cheap=True):
    """Lowest (cost, stops) over every legal plan, simulated one lap at a time.

    Plans whose new stints are all MIN_STINT_LAPS long rank first; only when there are none does a
    one-stop with a shorter last stint count."""
    found = _brute(st, model, R, dry, ps.MIN_STINT_LAPS, (0, 1, 2))
    return found if found is not None else _brute(st, model, R, dry, 1, (1,))


def _brute(st, model, R, dry, min_stint, stop_counts):
    used_dry = {c for c in st.used | {st.compound} if c in DRY}

    def lap_time(c, age):
        base, deg, _, _ = model.compounds[c]
        return base + deg * age

    best = None
    for n_stops in stop_counts:
        for ks in itertools.combinations(range(1, R), n_stops):
            stints = [b - a for a, b in zip((0,) + ks, ks + (R,))]
            if any(length < min_stint for length in stints[1:]):
                continue
            for comps in itertools.product(DRY, repeat=n_stops):
                if dry and len(used_dry | set(comps)) < 2:
                    continue
                cost, age, comp, stop_iter = 0.0, st.tyre_age, st.compound, iter(zip(ks, comps))
                nxt = next(stop_iter, None)
                for j in range(1, R + 1):
                    age += 1
                    cost += lap_time(comp, age)
                    if nxt and nxt[0] == j:
                        cost += model.pit_loss * (
                            ps.SC_PIT_LOSS_FACTOR if (j == 1 and st.neutralised) else 1.0
                        )
                        comp, age = nxt[1], 0
                        nxt = next(stop_iter, None)
                key = (round(cost, 6), n_stops, ks)
                if best is None or key < best[0]:
                    best = (key, tuple(Stop(st.lap + k, c) for k, c in zip(ks, comps)))
    return best


def test_stint_cost_closed_form_matches_a_loop():
    base, deg, t0, m = 90.5, 0.07, 6, 17
    loop = sum(base + deg * (t0 + j) for j in range(1, m + 1))
    assert ps.stint_cost(base, deg, t0, m) == pytest.approx(loop)
    # by hand: 17*90.5 + 0.07*(17*6 + 17*18/2) = 1538.5 + 0.07*255 = 1556.35
    assert ps.stint_cost(base, deg, t0, m) == pytest.approx(1556.35)


def test_no_stop_is_best_when_tyres_barely_wear_and_two_compounds_used():
    model = TyreModel({"SOFT": fit(90, 0.001), "MEDIUM": fit(90, 0.001), "HARD": fit(91, 0.001)}, 20.0)
    st = state("HARD", age=5, used={"MEDIUM", "HARD"})
    plan = ps.best_plan(st, model, 20)
    # 20*91 + 0.001*(20*5 + 210) = 1820.31; any stop adds 20 s to save well under 1 s of wear.
    assert plan.stops == ()
    assert plan.cost == pytest.approx(1820.31)
    out = ps.pit_window(st, model, 20)
    assert out["status"] == "stay out" and out["window"] is None
    assert out["best"] == {"stops": [], "cost": 1820.3}
    assert out["rule_breach"] is False


def test_no_stop_is_illegal_with_one_dry_compound_used():
    model = TyreModel({"SOFT": fit(90, 0.001), "MEDIUM": fit(90.5, 0.001), "HARD": fit(91, 0.001)}, 20.0)
    st = state("MEDIUM", age=3, used={"MEDIUM"})
    plan = ps.best_plan(st, model, 20)
    # The only way to a second compound is a stop; SOFT is 0.5 s a lap quicker, so stop at once.
    assert plan.stops == (Stop(11, "SOFT"),)
    assert plan.cost == pytest.approx(brute(st, model, 20)[0][0])
    assert ps.pit_window(st, model, 20)["status"] != "stay out"


def test_wet_running_waives_the_two_compound_rule():
    model = TyreModel({"SOFT": fit(90, 0.001), "MEDIUM": fit(90.5, 0.001), "HARD": fit(91, 0.001)}, 20.0)
    st = state("MEDIUM", age=3, used={"MEDIUM", "INTERMEDIATE"})
    assert ps.best_plan(st, model, 20, dry=False).stops == ()
    out = ps.pit_window(st, model, 20)
    # 20*90.5 + 0.001*(20*3 + 210) = 1810.27
    assert out["status"] == "stay out" and out["best"]["cost"] == 1810.3
    assert out["rule_breach"] is False
    # Without the wet laps the same driver must stop.
    assert ps.best_plan(state("MEDIUM", 3, {"MEDIUM"}), model, 20).stops != ()


def test_one_stop_lap_is_where_wear_balances_pit_loss():
    model = balance_model()
    st = state("HARD", age=10, used={"HARD", "MEDIUM"})
    R = 30
    plan = ps.best_plan(st, model, R)
    # Hand: stopping a lap later costs 0.2 + 0.1*(2k - 19) more, so k=8 -> 9 is -0.1 and 9 -> 10 is
    # +0.1: the optimum is k=9, stop lap 19, on fresh MEDIUM.
    # cost = 90.2*9 + 90*21 + 0.1*(9*10 + 45) + 0.1*(21*22/2) + 20 = 2758.4
    assert plan.stops == (Stop(19, "MEDIUM"),)
    assert plan.cost == pytest.approx(2758.4)
    (key, stops) = brute(st, model, R)
    assert stops == plan.stops and key[0] == pytest.approx(plan.cost, abs=1e-5)


def test_two_stop_beats_one_stop_when_wear_is_high():
    model = TyreModel(
        {"SOFT": fit(90.3, 0.3), "MEDIUM": fit(90.0, 0.3), "HARD": fit(90.1, 0.3)}, 10.0
    )
    st = state("MEDIUM", age=0, used={"MEDIUM"})
    plan = ps.best_plan(st, model, 40)
    # Hand: one stop can't do better than 20/20 laps, 0.3*(210+210) = 126 of wear + 10 pit; three
    # stints of about 13 wear 0.3*(91*2 + 105) = 86 + 20 pit = 106.
    assert len(plan.stops) == 2
    (key, stops) = brute(st, model, 40)
    assert [s.lap for s in plan.stops] == [s.lap for s in stops]
    assert plan.cost == pytest.approx(key[0], abs=1e-5)


def test_min_stint_laps_respected():
    # Old SOFT never wears and is 6 s a lap quicker, so unconstrained the stop would be on the
    # last lap. A new stint must be 5 laps, so it is lap N+15 of 20.
    model = TyreModel({"SOFT": fit(85, 0.0), "MEDIUM": fit(92, 0.0), "HARD": fit(91, 0.0)}, 20.0)
    st = state("SOFT", age=0, used={"SOFT"})
    plan = ps.best_plan(st, model, 20)
    # 15*85 + 5*91 + 20 = 1750
    assert plan.stops == (Stop(25, "HARD"),)
    assert plan.cost == pytest.approx(1750.0)


def test_min_stint_applies_to_every_new_stint_but_not_the_running_one():
    model = balance_model()
    # Running stint is allowed to be a single lap: age 60 forces an immediate stop.
    plan = ps.best_plan(state("HARD", age=60, used={"HARD", "MEDIUM"}), model, 30)
    assert plan.stops[0].lap == 11
    for age, used in [(0, {"HARD"}), (10, {"HARD", "MEDIUM"}), (40, {"HARD"})]:
        p = ps.best_plan(state("HARD", age, used), model, 30)
        laps = [10] + [s.lap for s in p.stops] + [40]
        assert all(b - a >= ps.MIN_STINT_LAPS for a, b in zip(laps[1:], laps[2:]))
    # With 5 laps left and one compound used no plan meets the minimum, so a one-stop with a short
    # last stint is allowed rather than no plan at all. Old HARD at age 40 wears hard, so at once.
    late = ps.best_plan(state("HARD", 40, {"HARD"}, lap=50), model, 5)
    assert late.stops == (Stop(51, "MEDIUM"),)
    # A driver who wants the stop late can make it on the second-last lap.
    flat = TyreModel({"SOFT": fit(95, 0.0), "MEDIUM": fit(90.5, 0.0), "HARD": fit(90, 0.0)}, 20.0)
    assert ps.best_plan(state("HARD", 3, {"HARD"}, lap=50), flat, 5).stops == (Stop(54, "MEDIUM"),)


def test_window_is_contiguous_and_within_two_seconds():
    model = balance_model()
    st = state("HARD", age=10, used={"HARD", "MEDIUM"})
    out = ps.pit_window(st, model, 30)
    # Hand, relative to the optimum f(9): f(8)=+0.1 f(7)=+0.4 f(6)=+0.9 f(5)=+1.6 f(4)=+2.5, and
    # f(10)=+0.1 f(11)=+0.4 f(12)=+0.9 f(13)=+1.6 f(14)=+2.5. So 5..13 -> laps 15..23.
    assert out["window"] == {"open": 15, "close": 23}
    assert out["best"]["stops"] == [{"lap": 19, "compound": "MEDIUM"}]
    assert out["best"]["cost"] == 2758.4


def test_status_box_now_window_open_window_opens_stay_out():
    model = balance_model()
    # Tyres so old that any stop beats staying out and the earliest is best.
    box = ps.pit_window(state("HARD", age=40, used={"HARD"}), model, 30)
    assert box["status"] == "box now" and box["best"]["stops"][0]["lap"] == 11
    assert box["window"]["open"] == 11
    # Hand: stopping a lap later costs 0.1*(2k + a - 29) + 0.2; at a=24 that is -0.1 for k=1 and
    # +0.1 for k=2, so the best stop is k=2 (lap 12) and k=1 is only 0.1 s worse. A 40 s pit loss
    # keeps a second stop from paying (it saves about 20 s of wear).
    op = ps.pit_window(state("HARD", age=24, used={"HARD", "MEDIUM"}), balance_model(40.0), 30)
    assert op["best"]["stops"][0]["lap"] == 12
    assert op["window"]["open"] == 11
    assert op["status"] == "window open"
    # The window starts later than the next lap.
    later = ps.pit_window(state("HARD", age=10, used={"HARD", "MEDIUM"}), model, 30)
    assert later["status"] == "window opens"
    quiet = TyreModel({"SOFT": fit(90, 0.001), "MEDIUM": fit(90, 0.001), "HARD": fit(91, 0.001)}, 20.0)
    assert ps.pit_window(state("HARD", 5, {"MEDIUM", "HARD"}), quiet, 20)["status"] == "stay out"


def test_safety_car_halves_the_pit_loss_for_next_lap_only():
    # A 40 s pit loss keeps a second stop from paying (it saves about 21 s of wear).
    model = balance_model(40.0)
    used = {"HARD", "MEDIUM"}
    base = ps.pit_window(state("HARD", 10, used), model, 30)
    assert base["cheap_stop"] is False
    assert base["best"]["stops"] == [{"lap": 19, "compound": "MEDIUM"}]
    assert base["best"]["cost"] == 2778.4  # 2758.4 with a 20 s loss, plus the extra 20 s
    sc = ps.pit_window(state("HARD", 10, used, neutralised=True), model, 30)
    # Hand: f(1) is 6.4 above f(9), the optimum; halving the 40 s loss takes 20 off, so the stop at
    # lap 11 costs 91.3 + 20 + 90*29 + 0.1*435 = 2764.8, which is 13.6 below f(9). A stop at k=2
    # pays in full: 4.9 above f(9), so 18.5 above the best and well outside the window.
    assert sc["cheap_stop"] is True
    assert sc["best"] == {"stops": [{"lap": 11, "compound": "MEDIUM"}], "cost": 2764.8}
    assert sc["window"] == {"open": 11, "close": 11}
    assert sc["status"] == "box now"
    # The brute loop agrees, including that later stops pay in full.
    st = state("HARD", 10, used, neutralised=True)
    assert ps.best_plan(st, model, 30).cost == pytest.approx(brute(st, model, 30)[0][0], abs=1e-5)


def test_last_lap_has_no_stop_and_flags_a_rule_breach():
    model = balance_model()
    out = ps.pit_window(state("MEDIUM", 30, {"MEDIUM"}, lap=59), model, 1)
    assert out["status"] == "stay out" and out["best"] is None and out["window"] is None
    assert out["rule_breach"] is True
    # From R = 2 a stop is possible, even with a last stint shorter than MIN_STINT_LAPS.
    for R in (2, 5, 6):
        out = ps.pit_window(state("MEDIUM", 30, {"MEDIUM"}), model, R)
        assert out["rule_breach"] is False and out["best"]["stops"][0]["lap"] == 11
    # With a legal no-stop plan the last lap is simply "stay out".
    fine = ps.pit_window(state("MEDIUM", 30, {"MEDIUM", "HARD"}, lap=59), model, 1)
    assert fine["status"] == "stay out" and fine["rule_breach"] is False
    # 90.0 + 0.1*31
    assert fine["best"] == {"stops": [], "cost": 93.1}


def test_wet_driver_has_status_wet_and_no_plan():
    model = balance_model()
    for c in ("INTERMEDIATE", "WET"):
        out = ps.pit_window(state(c, 5, {c}, neutralised=True), model, 30)
        assert out == {"status": "wet", "best": None, "window": None,
                       "cheap_stop": False, "rule_breach": False}
    assert ps.best_plan(state("INTERMEDIATE", 5), model, 30) is None


@pytest.mark.parametrize("compound", ["UNKNOWN", "TEST_UNKNOWN", None])
def test_unknown_compound_stays_out_with_no_plan(compound):
    out = ps.pit_window(state(compound, 5, {compound} if compound else set()), balance_model(), 30)
    assert out["status"] == "stay out" and out["best"] is None and out["window"] is None
    assert out["rule_breach"] is False and out["cheap_stop"] is False


def test_unknown_compounds_do_not_count_towards_the_two_compound_rule():
    model = balance_model()
    # MEDIUM plus an UNKNOWN stint is still one dry compound, so the driver must stop.
    st = state("MEDIUM", 5, {"MEDIUM", "UNKNOWN"})
    assert ps.best_plan(st, model, 30).stops != ()


def test_unfitted_compound_is_never_faster_than_the_slowest_fitted_plus_penalty():
    model = TyreModel({"MEDIUM": fit(90.0, 0.1), "HARD": fit(91.0, 0.05)}, 20.0)
    base, deg = model.params("SOFT")
    # slowest fitted base 91.0 + 0.3; wear is the mean fitted wear, (0.1 + 0.05) / 2
    assert base == pytest.approx(91.3) and deg == pytest.approx(0.075)
    assert base >= max(v[0] for v in model.compounds.values())
    st = state("MEDIUM", 5, {"MEDIUM"})
    assert all(s.compound != "SOFT" for s in ps.best_plan(st, model, 30).stops)
    # An unfitted compound that has numbers keeps them.
    kept = TyreModel({"MEDIUM": fit(90.0, 0.1), "SOFT": fit(89.0, 0.2, fitted=False, laps=1)}, 20.0)
    assert kept.params("SOFT") == (89.0, 0.2)


def test_undercut_gain_and_verdicts():
    model = balance_model()
    chaser_kw = dict(compound="HARD", age=40, used={"HARD"}, lap=10, code="CHA", position=2)
    leader = state("HARD", age=20, used={"HARD"}, code="LDR", position=1)

    def uc(gap):
        return ps.undercut(state(gap=gap, **chaser_kw), leader, model, 30)

    # Chaser's best plan boxes onto MEDIUM (90.0 + 0.1*1 on its first lap = 90.1). The leader's last
    # old lap is at age 22: 90.2 + 0.1*22 = 92.4. gain = 92.4 - 90.1 = 2.3.
    likely = uc(1.8)  # margin 0.5
    assert likely["gain"] == 2.3 and likely["margin"] == 0.5 and likely["verdict"] == "likely"
    assert likely["compound"] == "MEDIUM"
    assert (likely["chaser"], likely["leader"], likely["gap"]) == ("CHA", "LDR", 1.8)
    assert uc(1.0)["margin"] == 1.3 and uc(1.0)["verdict"] == "likely"
    assert uc(2.3)["margin"] == 0.0 and uc(2.3)["verdict"] == "possible"
    assert uc(2.8)["margin"] == -0.5 and uc(2.8)["verdict"] == "possible"  # edge of "possible"
    assert uc(2.9)["margin"] == -0.6 and uc(2.9)["verdict"] == "unlikely"


def test_no_undercut_beyond_three_seconds_or_for_wet_cars():
    model = balance_model()
    leader = state("HARD", age=20, used={"HARD"}, code="LDR", position=1)

    def chaser(**kw):
        args = dict(compound="HARD", age=40, used={"HARD"}, code="CHA", position=2, gap=1.0)
        args.update(kw)
        return state(**args)

    assert ps.undercut(chaser(gap=3.0), leader, model, 30) is not None
    assert ps.undercut(chaser(gap=3.1), leader, model, 30) is None
    assert ps.undercut(chaser(gap=None), leader, model, 30) is None
    assert ps.undercut(chaser(compound="INTERMEDIATE", used={"INTERMEDIATE"}), leader, model, 30) is None
    wet_leader = state("INTERMEDIATE", age=5, used={"INTERMEDIATE"}, code="LDR")
    assert ps.undercut(chaser(), wet_leader, model, 30) is None
    unknown = state("UNKNOWN", age=5, used={"UNKNOWN"}, code="LDR")
    assert ps.undercut(chaser(), unknown, model, 30) is None
    assert ps.undercut(chaser(compound="UNKNOWN", used={"UNKNOWN"}), leader, model, 30) is None
    # lap 1 on either car
    assert ps.undercut(chaser(lap=1), leader, model, 30) is None
    assert ps.undercut(chaser(), state("HARD", 1, {"HARD"}, lap=1), model, 30) is None
    # too few laps left for the leader's own new stint (R = 5)
    assert ps.undercut(chaser(), leader, model, 5) is None


def test_undercut_uses_the_chasers_best_plan_compound():
    # Make HARD the quickest fresh tyre: the chaser's best plan, and so the undercut, goes onto it.
    model = TyreModel({"SOFT": fit(95, 0.1), "MEDIUM": fit(91, 0.1), "HARD": fit(90, 0.1)}, 20.0)
    chaser = state("MEDIUM", 40, {"MEDIUM"}, code="CHA", position=2, gap=1.0)
    leader = state("MEDIUM", 20, {"MEDIUM"}, code="LDR")
    out = ps.undercut(chaser, leader, model, 30)
    # leader lap at age 22 on MEDIUM = 91 + 2.2 = 93.2; fresh HARD lap 1 = 90.1; gain 3.1
    assert out["compound"] == "HARD" and out["gain"] == 3.1


def test_all_twenty_drivers_at_monaco_distance_are_fast():
    model = balance_model()
    drivers = [
        state(c, age=a, used=u, code=f"D{i:02d}", position=i + 1, lap=1)
        for i, (c, a, u) in enumerate(
            [("HARD", 0, {"HARD"}), ("MEDIUM", 0, {"MEDIUM"}), ("SOFT", 0, {"SOFT"}), ("HARD", 0, {"HARD", "SOFT"})] * 5
        )
    ]
    t0 = time.perf_counter()
    results = [ps.pit_window(d, model, 78) for d in drivers]
    elapsed = time.perf_counter() - t0
    assert elapsed < 0.5, elapsed
    assert all(math.isfinite(r["best"]["cost"]) for r in results)
    print(f"R=78, 20 drivers: {elapsed:.3f}s")


def first_stop_costs(st, model, R):
    """Cheapest legal plan per first-stop offset k, by the same lap-by-lap loop as `brute`."""
    out = {}
    used_dry = {c for c in st.used | {st.compound} if c in DRY}
    for n_stops in (1, 2):
        for ks in itertools.combinations(range(1, R), n_stops):
            stints = [b - a for a, b in zip((0,) + ks, ks + (R,))]
            if any(length < ps.MIN_STINT_LAPS for length in stints[1:]):
                continue
            for comps in itertools.product(DRY, repeat=n_stops):
                if len(used_dry | set(comps)) < 2:
                    continue
                cost, age, comp, nxt = 0.0, st.tyre_age, st.compound, 0
                for j in range(1, R + 1):
                    age += 1
                    base, deg, _, _ = model.compounds[comp]
                    cost += base + deg * age
                    if nxt < n_stops and ks[nxt] == j:
                        cost += model.pit_loss * (
                            ps.SC_PIT_LOSS_FACTOR if (j == 1 and st.neutralised) else 1.0)
                        comp, age, nxt = comps[nxt], 0, nxt + 1
                out[ks[0]] = min(out.get(ks[0], math.inf), cost)
    return out


def test_a_tie_goes_to_fewer_stops_then_the_earlier_stop():
    # Old MEDIUM never wears; SOFT is 0.3 s quicker but wears 0.1 s a lap; stops are free; HARD is slow.
    # One stop at k=10 puts 5 laps on SOFT: 5*89.7 + 0.1*15 = 450, plus 10*90 = 900 -> 1350.
    # Two stops at k=5 and k=10 put 5+5 laps on SOFT: 5*90 + 2*450 = 1350. An exact tie, and the
    # two-stop's first stop is earlier, so only the fewer-stops rule picks the one-stop.
    model = TyreModel({"SOFT": fit(89.7, 0.1), "MEDIUM": fit(90, 0.0), "HARD": fit(95, 0.1)}, 0.0)
    st = state("MEDIUM", age=1, used={"MEDIUM"}, lap=10)
    plan = ps.best_plan(st, model, 15)
    assert plan.cost == pytest.approx(1350.0)
    assert plan.stops == (Stop(20, "SOFT"),)
    assert ps.pit_window(st, model, 15)["best"] == {"stops": [{"lap": 20, "compound": "SOFT"}],
                                                    "cost": 1350.0}
    # The two-stop really does tie it (so the test could fail): same cost by the loop.
    two = brute(st, model, 15)
    assert two[0][0] == pytest.approx(1350.0, abs=1e-6)
    # With free stops and flat compounds, no-stop wins when legal, else the earliest one-stop.
    flat = TyreModel({"SOFT": fit(90, 0.0), "MEDIUM": fit(90, 0.0), "HARD": fit(90, 0.0)}, 0.0)
    assert ps.best_plan(state("MEDIUM", 1, {"MEDIUM", "HARD"}, lap=10), flat, 15).stops == ()
    assert ps.best_plan(state("MEDIUM", 1, {"MEDIUM"}, lap=10), flat, 15).stops == (Stop(11, "SOFT"),)


def test_an_integer_pit_loss_does_not_truncate_the_safety_car_half():
    model = TyreModel({"SOFT": fit(95, 0.1), "MEDIUM": fit(90, 0.1), "HARD": fit(90.2, 0.1)}, 25)
    st = state("HARD", 10, {"HARD", "MEDIUM"}, neutralised=True)
    float_model = TyreModel(dict(model.compounds), 25.0)
    assert ps.best_plan(st, model, 30).cost == ps.best_plan(st, float_model, 30).cost
    # Hand: stop at lap 11 pays 12.5, not 12.
    assert ps.best_plan(st, model, 30).stops[0].lap == 11
    assert ps.best_plan(st, model, 30).cost == pytest.approx(brute(st, float_model, 30)[0][0], abs=1e-5)


def test_window_does_not_jump_a_gap_to_a_cheap_safety_car_stop():
    # R = 10 allows no two-stop. Old HARD never wears, fresh MEDIUM wears 0.1 s a lap at equal base,
    # so the later the stop the better: stop k costs 0.1*(10-k)(11-k)/2 of wear, which is
    # k=5: 1.5, k=4: 2.1, k=3: 2.8, k=2: 3.6, k=1: 4.5. With a 4 s loss halved to 2 on the next
    # lap, k=1 costs 2.5: 1.0 above the best (k=5), inside 2 s, while k=2 is 2.1 above. The window
    # is k=3..5; it must not reach back across k=2 to k=1.
    model = TyreModel({"SOFT": fit(99, 0.1), "MEDIUM": fit(90, 0.1), "HARD": fit(90, 0.0)}, 4.0)
    st = state("HARD", 10, {"HARD"}, neutralised=True)
    costs = first_stop_costs(st, model, 10)
    best = min(costs.values())
    assert costs[5] == pytest.approx(best) and best == pytest.approx(905.5)
    assert costs[1] - best == pytest.approx(1.0) and costs[2] - best == pytest.approx(2.1)
    out = ps.pit_window(st, model, 10)
    assert out["best"] == {"stops": [{"lap": 15, "compound": "MEDIUM"}], "cost": 905.5}
    assert out["window"] == {"open": 13, "close": 15}
    assert out["status"] == "window opens"
    assert out["cheap_stop"] is True


def test_a_sprint_waives_the_two_compound_rule():
    model = TyreModel({"SOFT": fit(90, 0.001), "MEDIUM": fit(90.5, 0.001), "HARD": fit(91, 0.001)}, 20.0)
    st = state("MEDIUM", age=3, used={"MEDIUM"})
    # In a race this driver must stop (see test_no_stop_is_illegal_with_one_dry_compound_used).
    assert ps.pit_window(st, model, 20)["status"] != "stay out"
    out = ps.pit_window(st, model, 20, sprint=True)
    # 20*90.5 + 0.001*(20*3 + 210) = 1810.27
    assert out["status"] == "stay out" and out["best"] == {"stops": [], "cost": 1810.3}
    assert out["window"] is None and out["rule_breach"] is False
    assert brute(st, model, 20, dry=False)[1] == ()
    # On the last lap a race flags the missing compound; a sprint never does.
    last = state("MEDIUM", 30, {"MEDIUM"}, lap=19)
    assert ps.pit_window(last, model, 1)["rule_breach"] is True
    sprint_last = ps.pit_window(last, model, 1, sprint=True)
    assert sprint_last["rule_breach"] is False and sprint_last["best"]["stops"] == []
    # A sprint stop may go back onto the same compound: worn MEDIUM wants fresh MEDIUM.
    worn = TyreModel({"SOFT": fit(95, 0.3), "MEDIUM": fit(90, 0.3), "HARD": fit(91, 0.3)}, 20.0)
    plan = ps.pit_window(state("MEDIUM", 40, {"MEDIUM"}), worn, 20, sprint=True)["best"]
    assert plan["stops"][0]["compound"] == "MEDIUM"


def test_a_sprint_undercut_may_stay_on_the_same_compound():
    # MEDIUM is the quickest fresh tyre. In a race both cars have only run MEDIUM, so the undercut
    # has to go onto HARD; in a sprint it is fresh MEDIUM.
    model = TyreModel({"SOFT": fit(95, 0.1), "MEDIUM": fit(90, 0.1), "HARD": fit(91, 0.1)}, 20.0)
    chaser = state("MEDIUM", 40, {"MEDIUM"}, code="CHA", position=2, gap=1.0)
    leader = state("MEDIUM", 20, {"MEDIUM"}, code="LDR")
    race = ps.undercut(chaser, leader, model, 30)
    sprint = ps.undercut(chaser, leader, model, 30, sprint=True)
    assert race["compound"] == "HARD"
    # leader lap at age 22 on MEDIUM = 92.2; fresh MEDIUM lap 1 = 90.1; gain 2.1
    assert sprint["compound"] == "MEDIUM" and sprint["gain"] == 2.1


def test_late_one_stops_match_the_brute_loop():
    model = TyreModel({"SOFT": fit(91, 0.2), "MEDIUM": fit(90.4, 0.1), "HARD": fit(90, 0.05)}, 20.0)
    for R in range(1, 9):
        for comp, age in (("HARD", 30), ("MEDIUM", 2), ("SOFT", 15)):
            st = state(comp, age, {comp}, lap=40)
            want = brute(st, model, R)
            got = ps.best_plan(st, model, R)
            if want is None:
                assert R == 1 and got is None
                continue
            assert got.stops == want[1] and got.cost == pytest.approx(want[0][0], abs=1e-5)


def overcut_model():
    # MEDIUM barely wears and HARD is 1.5 s slower when fresh: a worn MEDIUM stays quicker than a new HARD.
    return TyreModel({"SOFT": fit(95.0, 0.1), "MEDIUM": fit(90.0, 0.02), "HARD": fit(91.5, 0.02)}, 20.0)


def test_overcut_gain_and_verdicts():
    model = overcut_model()
    leader = state("MEDIUM", age=30, used={"MEDIUM"}, code="LDR", position=1)

    def oc(gap):
        return ps.overcut(state("MEDIUM", age=10, used={"MEDIUM"}, code="CHA", position=2, gap=gap), leader, model, 30)

    # The leader must stop for a second compound, onto HARD (SOFT is far slower): its first fresh lap is
    # 91.5 + 0.02*1 = 91.52. The chaser's last lap on its MEDIUM, at age 12: 90.0 + 0.02*12 = 90.24.
    # gain = 91.52 - 90.24 = 1.28.
    likely = oc(0.7)
    assert likely["gain"] == 1.28 and likely["margin"] == 0.58 and likely["verdict"] == "likely"
    assert (likely["chaser"], likely["leader"], likely["gap"], likely["compound"]) == ("CHA", "LDR", 0.7, "HARD")
    assert oc(1.0)["verdict"] == "possible" and oc(1.0)["margin"] == 0.28
    assert oc(1.8)["verdict"] == "unlikely" and oc(1.8)["margin"] == -0.52


def test_an_overcut_rarely_works_against_a_fresh_tyre_that_is_quicker():
    # balance_model: everything wears 0.1 s a lap and MEDIUM is the quickest fresh tyre.
    model = balance_model()
    leader = state("HARD", age=20, used={"HARD"}, code="LDR", position=1)
    out = ps.overcut(state("HARD", age=40, used={"HARD"}, code="CHA", position=2, gap=1.0), leader, model, 30)
    # leader's first fresh MEDIUM lap 90.1; chaser's HARD at age 42: 90.2 + 4.2 = 94.4; gain -4.3
    assert out["gain"] == -4.3 and out["verdict"] == "unlikely"


def test_no_overcut_beyond_three_seconds_on_lap_one_wet_or_too_late():
    model = overcut_model()
    leader = state("MEDIUM", age=30, used={"MEDIUM"}, code="LDR", position=1)

    def chaser(**kw):
        args = dict(compound="MEDIUM", age=10, used={"MEDIUM"}, code="CHA", position=2, gap=1.0)
        args.update(kw)
        return state(**args)

    assert ps.overcut(chaser(gap=3.0), leader, model, 30) is not None
    assert ps.overcut(chaser(gap=3.1), leader, model, 30) is None
    assert ps.overcut(chaser(gap=None), leader, model, 30) is None
    assert ps.overcut(chaser(compound="WET", used={"WET"}), leader, model, 30) is None
    assert ps.overcut(chaser(), state("INTERMEDIATE", 5, {"INTERMEDIATE"}, code="LDR"), model, 30) is None
    assert ps.overcut(chaser(lap=1), leader, model, 30) is None
    assert ps.overcut(chaser(), leader, model, 5) is None
