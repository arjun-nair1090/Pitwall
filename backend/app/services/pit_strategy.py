"""Pit window: the best remaining plan, the window around it and undercut and overcut odds, at a given lap.

The model is deliberately small. A lap on compound c at tyre age t takes `base_c + deg_c * t`; fuel
burn is the same whatever the plan, so it cancels and is left out. A plan is zero, one or two more
stops; each stop costs the pit loss and starts a fresh stint at age 1. A stop "at lap N + k" is made
at the end of that lap, so the running tyres do k more laps.

Rules the search enforces:
- Dry race: the compounds already used plus the plan's must hold two distinct dry ones (SOFT, MEDIUM,
  HARD). Any other name (UNKNOWN, TEST_UNKNOWN, None) counts for nothing. A driver who has run
  INTERMEDIATE or WET is exempt, and a sprint has no such rule (and no mandatory stop) at all.
- Every new stint, the final one included, is at least MIN_STINT_LAPS. The stint already running is
  exempt, so a stop on the very next lap is always allowed. When no legal plan meets that (a driver
  who still needs a second compound with five laps or fewer left), a one-stop on any lap up to the
  second-last is allowed instead, so only a driver with a single lap left has no legal plan.
- A driver on INTERMEDIATE or WET is "wet" with no plan: the model has no crossover logic. A driver
  whose compound is unknown is "stay out" with no plan and is never paired for an undercut.
- Under a neutralised lap the stop at N + 1, and only that stop, costs SC_PIT_LOSS_FACTOR of the loss.

The best plan is the cheapest; ties go to fewer stops, then the earlier stop. The pit window is the
run of first-stop laps around the best one whose cheapest plan is within WINDOW_S of the best.

This module works on plain dataclasses so live timing can call it as well as a replay.
"""
from dataclasses import dataclass
from typing import Any, Dict, Optional, Set, Tuple

import numpy as np

DRY_COMPOUNDS = ("SOFT", "MEDIUM", "HARD")
WET_COMPOUNDS = frozenset({"INTERMEDIATE", "WET"})

# Shortest new stint, the final one included, unless no legal plan can meet it.
MIN_STINT_LAPS = 5
# A first-stop lap is in the window when its cheapest plan is this close to the best plan.
WINDOW_S = 2.0
# Share of the pit loss paid for a stop on the lap after a neutralised one.
SC_PIT_LOSS_FACTOR = 0.5
# Added to the slowest fitted base for a compound with no numbers, so it never looks magically fast.
UNFITTED_BASE_PENALTY_S = 0.3
# Used only when nothing at all is fitted; costs are then comparable but meaningless.
DEFAULT_BASE_S = 90.0
DEFAULT_DEG_S = 0.05

# An undercut is on when the chaser is this close behind.
UNDERCUT_RANGE_S = 3.0
LIKELY_MARGIN_S = 0.5
POSSIBLE_MARGIN_S = -0.5

_INF = float("inf")
# Costs are compared to nine places so that float noise can't break a tie the wrong way.
_TIE_DECIMALS = 9


@dataclass(frozen=True)
class Stop:
    lap: int
    compound: str


@dataclass(frozen=True)
class Plan:
    stops: Tuple[Stop, ...]
    cost: float


@dataclass
class DriverState:
    code: str
    position: int
    lap: int
    compound: Optional[str]
    tyre_age: int
    used: Set[str]
    gap_ahead: Optional[float]
    neutralised: bool


@dataclass
class TyreModel:
    """`compounds` maps a name to (base, deg per lap, fitted, laps of evidence)."""

    compounds: Dict[str, Tuple[float, float, bool, int]]
    pit_loss: float

    def params(self, compound: str) -> Tuple[float, float]:
        """(base, deg) for a compound, with the fallback for one the model has no numbers for."""
        if compound in self.compounds:
            return float(self.compounds[compound][0]), float(self.compounds[compound][1])
        fitted = [v for v in self.compounds.values() if v[2]]
        pool = fitted or list(self.compounds.values())
        if not pool:
            return DEFAULT_BASE_S + UNFITTED_BASE_PENALTY_S, DEFAULT_DEG_S
        base = max(float(v[0]) for v in pool) + UNFITTED_BASE_PENALTY_S
        return base, float(np.mean([float(v[1]) for v in pool]))

    def lap_time(self, compound: str, age: float) -> float:
        base, deg = self.params(compound)
        return base + deg * age


def stint_cost(base, deg, t0, m):
    """Time for m laps starting from tyre age t0 (works on numpy arrays):
    sum over j in 1..m of base + deg * (t0 + j) = m*base + deg*(m*t0 + m(m+1)/2)."""
    return m * base + deg * (m * t0 + m * (m + 1) / 2)


def _dry_used(state: DriverState) -> Set[str]:
    return {c for c in set(state.used) | {state.compound} if c in DRY_COMPOUNDS}


def _legal(used_dry: Set[str], new: Tuple[str, ...], dry: bool) -> bool:
    return (not dry) or len(used_dry | set(new)) >= 2


def _tidy(x):
    return np.round(x, _TIE_DECIMALS)


class _Solution:
    """Every plan's cost, kept per first-stop lap so the best plan and the window share one pass."""

    def __init__(self, lap: int, nostop: float, one: np.ndarray, one_arg: np.ndarray,
                 two: np.ndarray, two_arg: np.ndarray, k2: np.ndarray, R: int):
        self.lap, self.nostop, self.R = lap, nostop, R
        self.one, self.one_arg, self.two, self.two_arg, self.k2 = one, one_arg, two, two_arg, k2
        # Index k is the first stop at lap N + k; one-stop wins a tie with a two-stop.
        self.first = np.full(R + 1, _INF)
        self.use_two = np.zeros(R + 1, dtype=bool)
        self.first[: len(one)] = one
        n = len(two)
        if n > 1:
            better = two[1:] < self.first[1:n]
            self.first[1:n] = np.where(better, two[1:], self.first[1:n])
            self.use_two[1:n] = better

    def _one_plan(self, k: int) -> Plan:
        comp = DRY_COMPOUNDS[int(self.one_arg[k])]
        return Plan((Stop(self.lap + k, comp),), float(self.one[k]))

    def _two_plan(self, k: int) -> Plan:
        a = int(self.two_arg[k])
        k2 = int(self.k2[a // 9])
        c1, c2 = divmod(a % 9, 3)
        return Plan((Stop(self.lap + k, DRY_COMPOUNDS[c1]), Stop(self.lap + k2, DRY_COMPOUNDS[c2])),
                    float(self.two[k]))

    def best(self) -> Optional[Tuple[Optional[int], Optional[Plan]]]:
        """(first-stop offset or None for no stop, plan), or None when no plan is legal.

        Ties go to fewer stops, then the earlier stop: the groups are compared with a strict `<`, and
        within a group argmin takes the earliest lap."""
        best: Optional[Tuple[Optional[int], Plan]] = None
        if np.isfinite(self.nostop):
            best = (None, Plan((), float(self.nostop)))
        for costs, make in ((self.one, self._one_plan), (self.two, self._two_plan)):
            if len(costs) < 2 or not np.isfinite(costs[1:]).any():
                continue
            k = int(np.argmin(costs[1:])) + 1
            if best is None or costs[k] < best[1].cost:
                best = (k, make(k))
        return best

    def best_one_stop(self) -> Optional[Plan]:
        if len(self.one) < 2 or not np.isfinite(self.one[1:]).any():
            return None
        return self._one_plan(int(np.argmin(self.one[1:])) + 1)


def _one_stops(base0, deg0, age, used, model, R, dry, pit, pit_first, max_k):
    """(cost, compound index) of the cheapest one-stop per first-stop offset k in 1..max_k; index 0
    is unused."""
    one, one_arg = np.full(1, _INF), np.zeros(1, dtype=int)
    if max_k < 1:
        return one, one_arg
    k = np.arange(1, max_k + 1)
    old = stint_cost(base0, deg0, age, k)
    pit_k = np.full(k.shape, pit)
    pit_k[0] = pit_first
    grid = np.full((len(DRY_COMPOUNDS), len(k)), _INF)
    for i, c in enumerate(DRY_COMPOUNDS):
        if _legal(used, (c,), dry):
            b, d = model.params(c)
            grid[i] = old + pit_k + stint_cost(b, d, 0, R - k)
    grid = _tidy(grid)
    return np.concatenate([[_INF], grid.min(axis=0)]), np.concatenate([[0], grid.argmin(axis=0)])


def _solve(state: DriverState, model: TyreModel, R: int, dry: bool) -> _Solution:
    base0, deg0 = model.params(state.compound)
    age = state.tyre_age
    used = _dry_used(state)
    pit = float(model.pit_loss)
    pit_first = pit * SC_PIT_LOSS_FACTOR if state.neutralised else pit

    nostop = _INF
    if R >= 1 and _legal(used, (), dry):
        nostop = float(_tidy(stint_cost(base0, deg0, age, R)))

    empty = np.zeros(1)
    two, two_arg, k2s = empty, empty, empty
    one, one_arg = _one_stops(base0, deg0, age, used, model, R, dry, pit, pit_first, R - MIN_STINT_LAPS)
    if not np.isfinite(nostop) and not np.isfinite(one[1:]).any():
        # No legal plan meets the minimum stint (a two-stop needs even more laps), so a one-stop
        # with a shorter last stint stands in rather than leaving the driver with no plan.
        one, one_arg = _one_stops(base0, deg0, age, used, model, R, dry, pit, pit_first, R - 1)

    if R >= 2 * MIN_STINT_LAPS + 1:
        k1 = np.arange(1, R - 2 * MIN_STINT_LAPS + 1)
        k2s = np.arange(MIN_STINT_LAPS + 1, R - MIN_STINT_LAPS + 1)
        K1, K2 = k1[:, None], k2s[None, :]
        valid = (K2 - K1) >= MIN_STINT_LAPS
        old = stint_cost(base0, deg0, age, K1)
        pit_a = np.where(K1 == 1, pit_first, pit)
        n = len(DRY_COMPOUNDS)
        cost = np.full((len(k1), len(k2s), n * n), _INF)
        for i, c1 in enumerate(DRY_COMPOUNDS):
            b1, d1 = model.params(c1)
            for j, c2 in enumerate(DRY_COMPOUNDS):
                if not _legal(used, (c1, c2), dry):
                    continue
                b2, d2 = model.params(c2)
                total = (old + pit_a + stint_cost(b1, d1, 0, K2 - K1) + pit
                         + stint_cost(b2, d2, 0, R - K2))
                cost[:, :, i * n + j] = np.where(valid, total, _INF)
        # Flatten with the later stop outermost in the compound pair, so a tie takes the earlier k2.
        flat = _tidy(cost).reshape(len(k1), -1)
        # Index k is the first stop at lap N + k, as for `one`; index 0 is unused.
        two_arg = np.concatenate([[0], flat.argmin(axis=1)])
        two = np.concatenate([[_INF], flat.min(axis=1)])
    return _Solution(state.lap, nostop, one, one_arg, two, two_arg, k2s, R)


def best_plan(state: DriverState, model: TyreModel, laps_remaining: int, dry: bool = True) -> Optional[Plan]:
    """The cheapest legal plan, or None when the driver isn't on a dry compound or none is legal.
    `dry=False` waives the two-compound rule (a race that has had wet running)."""
    if state.compound not in DRY_COMPOUNDS or laps_remaining < 1:
        return None
    found = _solve(state, model, laps_remaining, dry).best()
    return None if found is None else found[1]


def _window(sol: _Solution, k_best: int) -> Tuple[int, int]:
    limit = sol.first[k_best] + WINDOW_S + 10 ** -_TIE_DECIMALS
    lo = hi = k_best
    while lo > 1 and sol.first[lo - 1] <= limit:
        lo -= 1
    while hi < sol.R - 1 and sol.first[hi + 1] <= limit:
        hi += 1
    return lo, hi


def _plan_dict(plan: Plan) -> Dict[str, Any]:
    return {"stops": [{"lap": s.lap, "compound": s.compound} for s in plan.stops],
            "cost": round(plan.cost, 1)}


def pit_window(state: DriverState, model: TyreModel, laps_remaining: int,
               sprint: bool = False) -> Dict[str, Any]:
    """{status, best, window, cheap_stop, rule_breach} for one driver. See the module docstring.

    `sprint` waives the two-compound rule, so staying out is always legal and `rule_breach` is
    never true. `cheap_stop` is true only on a neutralised lap with a feasible stop at N + 1; it is
    false when that stop isn't possible (R < 2, or a legal plan that needs a longer last stint),
    even on a neutralised lap.

    Status: "box now" when the best plan stops next lap; "window open" when next lap is inside the
    window but the best stop is later; "window opens" when the window starts after next lap;
    "stay out" when the best plan has no stop (or none is legal, or the compound is unknown); "wet".
    """
    out: Dict[str, Any] = {"status": "stay out", "best": None, "window": None,
                           "cheap_stop": False, "rule_breach": False}
    if state.compound in WET_COMPOUNDS:
        out["status"] = "wet"
        return out
    if state.compound not in DRY_COMPOUNDS:
        return out
    R = laps_remaining
    dry = not sprint and not (set(state.used) & WET_COMPOUNDS)
    sol = _solve(state, model, R, dry)
    out["cheap_stop"] = bool(state.neutralised and R >= 2 and np.isfinite(sol.first[1]))
    found = sol.best()
    if found is None:
        out["rule_breach"] = not sprint
        return out
    k_best, plan = found
    out["best"] = _plan_dict(plan)
    if k_best is None:
        return out
    lo, hi = _window(sol, k_best)
    out["window"] = {"open": state.lap + lo, "close": state.lap + hi}
    if k_best == 1:
        out["status"] = "box now"
    elif lo == 1:
        out["status"] = "window open"
    else:
        out["status"] = "window opens"
    return out


def _verdict(margin: float) -> str:
    if margin >= LIKELY_MARGIN_S:
        return "likely"
    return "possible" if margin >= POSSIBLE_MARGIN_S else "unlikely"


def undercut(chaser: DriverState, leader: DriverState, model: TyreModel,
             laps_remaining: int, sprint: bool = False) -> Optional[Dict[str, Any]]:
    """Would the chaser jump the car ahead by stopping first?

    The chaser stops at the end of lap N + 1 and the leader at the end of N + 2, both onto the
    chaser's best fresh compound. Pit losses cancel, so the gain is the leader's last old-tyre lap
    (age a_L + 2) against the chaser's first fresh lap; the margin is that less the gap. Traffic and
    out-lap warm-up are not modelled. When the chaser's best plan is to stay out, its cheapest
    one-stop plan stands in for it. `sprint` waives the two-compound rule for both cars.
    """
    gap = chaser.gap_ahead
    if gap is None or gap > UNDERCUT_RANGE_S:
        return None
    if chaser.compound not in DRY_COMPOUNDS or leader.compound not in DRY_COMPOUNDS:
        return None
    if chaser.lap == 1 or leader.lap == 1:
        return None
    R = laps_remaining
    chaser_dry = not sprint and not (set(chaser.used) & WET_COMPOUNDS)
    leader_dry = not sprint and not (set(leader.used) & WET_COMPOUNDS)
    sol = _solve(chaser, model, R, chaser_dry)
    if sol.best_one_stop() is None:
        return None
    found = sol.best()
    plan = found[1] if found and found[1].stops else sol.best_one_stop()
    fresh = plan.stops[0].compound
    # The leader stops a lap later, so needs its own final stint of MIN_STINT_LAPS and a legal pair.
    if R - 2 < MIN_STINT_LAPS or not _legal(_dry_used(leader), (fresh,), leader_dry):
        return None
    gain = model.lap_time(leader.compound, leader.tyre_age + 2) - model.lap_time(fresh, 1)
    margin = round(gain - gap, 3)
    return {"chaser": chaser.code, "leader": leader.code, "gap": round(gap, 3),
            "gain": round(gain, 3), "margin": margin, "verdict": _verdict(margin), "compound": fresh}


def overcut(chaser: DriverState, leader: DriverState, model: TyreModel,
            laps_remaining: int, sprint: bool = False) -> Optional[Dict[str, Any]]:
    """Would the chaser jump the car ahead by staying out when it stops first?

    The mirror of `undercut`: the leader stops at the end of lap N + 1 and the chaser at the end of
    N + 2, both onto the leader's best fresh compound. Pit losses cancel, so the gain is the leader's
    first fresh lap against the chaser's last old-tyre lap (age a_C + 2); the margin is that less the
    gap. It pays when a worn tyre is still quicker than a new one, such as a slow-to-come-in hard.
    Out-lap warm-up, which makes many real overcuts work, is not modelled, so this errs against them.
    When the leader's best plan is to stay out, its cheapest one-stop plan stands in for it.
    """
    gap = chaser.gap_ahead
    if gap is None or gap > UNDERCUT_RANGE_S:
        return None
    if chaser.compound not in DRY_COMPOUNDS or leader.compound not in DRY_COMPOUNDS:
        return None
    if chaser.lap == 1 or leader.lap == 1:
        return None
    R = laps_remaining
    chaser_dry = not sprint and not (set(chaser.used) & WET_COMPOUNDS)
    leader_dry = not sprint and not (set(leader.used) & WET_COMPOUNDS)
    sol = _solve(leader, model, R, leader_dry)
    if sol.best_one_stop() is None:
        return None
    found = sol.best()
    plan = found[1] if found and found[1].stops else sol.best_one_stop()
    fresh = plan.stops[0].compound
    # The chaser stops a lap later, so needs its own final stint of MIN_STINT_LAPS and a legal pair.
    if R - 2 < MIN_STINT_LAPS or not _legal(_dry_used(chaser), (fresh,), chaser_dry):
        return None
    gain = model.lap_time(fresh, 1) - model.lap_time(chaser.compound, chaser.tyre_age + 2)
    margin = round(gain - gap, 3)
    return {"chaser": chaser.code, "leader": leader.code, "gap": round(gap, 3),
            "gain": round(gain, 3), "margin": margin, "verdict": _verdict(margin), "compound": fresh}
