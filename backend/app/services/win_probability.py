"""Win probability: each driver's chance of winning a finished race or sprint, lap by lap, from only
the laps run so far.

At the end of lap N the pit-window replay adapter gives every running car's state, the tyre model
and the pit loss. A car's projected finish is its lap-N race time plus the cost of its best
remaining plan (or, with no plan, its recent pace times the laps left). A Monte Carlo then adds
pace noise, retirements and one safety car and counts who finishes first.

The constants are fixed, roughly in line with modern F1, and are not tuned on the cached races:
- HAZARD: a car retires on any lap with this probability (about two of twenty cars in sixty laps).
- SC_RATE / SC_GAP_S: a safety car falls on any lap with this probability (half to one a race) and
  bunches the field to this many seconds per place. Only one is simulated, and a VSC is not told
  from a safety car.
- OFFSET_SD: the unknown true pace difference between cars, in seconds per lap.

The model predicts the first car across the line. A penalty or disqualification applied after the
flag (Spa 2024) is not known to it.
"""
import threading
import time
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

from app.services import corner_analysis, pit_strategy, pit_window
from app.services.pit_window import PitWindowInputError
from app.services.race_battles import SESSIONS
from app.services.session_info import driver_profile

N_SIMS = 4_000
HISTORY_SIMS = 1_500
HAZARD = 0.0015
SC_RATE = 0.012
SC_GAP_S = 0.8
OFFSET_SD = 0.08
SIGMA_LAP_FLOOR = 0.3
RECENT_LAPS = 5
WET_SHARE = 0.25

_CACHE_TTL_SECONDS = 600
_MAX_CACHED = 3
_odds: Dict[Tuple, Tuple[float, Dict[str, Any]]] = {}
# Requests run in worker threads: the memo is only touched under _lock, and _computing holds one
# lock per race being worked out so that concurrent requests for it wait for a single computation.
_lock = threading.Lock()
_computing: Dict[Tuple, threading.Lock] = {}


def clear_cache() -> None:
    with _lock:
        _odds.clear()


def project_finish(times: np.ndarray, costs: np.ndarray) -> np.ndarray:
    """Projected race time at the flag: the lap-end time now plus the remaining time."""
    return np.asarray(times, dtype=float) + np.asarray(costs, dtype=float)


def simulate_winner(F: np.ndarray, R: int, sigma_lap: float, rng: np.random.Generator,
                    sims: int) -> np.ndarray:
    """Each car's share of `sims` runs it wins, from projected finishes F (inf for a car that is out).

    R laps are left. A run is lost to nobody when every car in it retires, so shares sum to at most 1."""
    F = np.asarray(F, dtype=float)
    n = len(F)
    if n == 0:
        return np.zeros(0)
    live = np.isfinite(F)
    projected = np.broadcast_to(np.where(live, F, 0.0), (sims, n))
    retired = np.broadcast_to(~live, (sims, n))
    if R < 1:
        noisy = np.where(retired, np.inf, projected)
    else:
        retired = retired | (rng.random((sims, n)) < 1.0 - (1.0 - HAZARD) ** R)
        has_sc = rng.random(sims) < 1.0 - (1.0 - SC_RATE) ** R
        # The safety car falls on lap u of the R left (with none, u = R: the plain draw). The noise
        # is split there, sharing one offset draw z, so what happens before the safety car is
        # bunched with the field and only the laps after it are free to reorder it again.
        u = np.where(has_sc, rng.integers(1, R + 1, size=sims), R)
        frac = (u / R)[:, None]
        z = rng.standard_normal((sims, n))
        before = (sigma_lap * np.sqrt(u)[:, None] * rng.standard_normal((sims, n))
                  + OFFSET_SD * u[:, None] * z)
        after = (sigma_lap * np.sqrt(R - u)[:, None] * rng.standard_normal((sims, n))
                 + OFFSET_SD * (R - u)[:, None] * z)
        lead_F = np.where(retired, np.inf, projected).min(axis=1, keepdims=True)
        lead_F = np.where(np.isfinite(lead_F), lead_F, 0.0)
        gap = np.where(retired, 0.0, projected - lead_F)
        at_sc = np.where(retired, np.inf, gap * frac + before)  # the order when the safety car falls
        lead_P = at_sc.min(axis=1, keepdims=True)
        lead_P = np.where(np.isfinite(lead_P), lead_P, 0.0)
        g = np.where(retired, 0.0, at_sc - lead_P)
        rank = np.argsort(np.argsort(at_sc, axis=1), axis=1)
        g = np.where(has_sc[:, None], np.minimum(g, SC_GAP_S * rank), g)
        noisy = lead_F + lead_P + g + gap * (1.0 - frac) + after
        noisy = np.where(retired, np.inf, noisy)
    winner = noisy.argmin(axis=1)
    decided = ~retired.all(axis=1)
    return np.bincount(winner[decided], minlength=n) / sims


# ---- reading a lap ----

def _seconds(value: Any) -> float:
    return float(value.total_seconds()) if pd.notna(value) else float("nan")


def _clean_by_driver(known: pd.DataFrame) -> Dict[str, pd.DataFrame]:
    clean = {str(code): corner_analysis.clean_laps(mine) for code, mine in known.groupby("Driver")}
    return {code: frame for code, frame in clean.items() if not frame.empty}  # an empty one has no columns


def _sigma_lap(clean: Dict[str, pd.DataFrame], model: pit_strategy.TyreModel) -> float:
    """Pooled spread of the clean laps around what the tyre model predicts for them.

    It deliberately includes the model's misfit (fuel burn, traffic, a fit that is still settling):
    that is real uncertainty in the forecast, and a detrended spread scored worse in the back-test."""
    residuals: List[np.ndarray] = []
    for frame in clean.values():
        frame = frame[frame["TyreLife"].notna() & frame["Compound"].notna()]
        for compound, part in frame.groupby(frame["Compound"].astype(str).str.upper()):
            base, deg = model.params(compound)
            residuals.append(part["LapTime"].dt.total_seconds().to_numpy()
                             - (base + deg * part["TyreLife"].astype(float).to_numpy()))
    pooled = np.concatenate(residuals) if residuals else np.zeros(0)
    if len(pooled) < 2:
        return SIGMA_LAP_FLOOR
    return max(float(np.std(pooled)), SIGMA_LAP_FLOOR)


def _recent_pace(clean: Dict[str, pd.DataFrame]) -> Dict[str, float]:
    """Each driver's median of their last RECENT_LAPS clean laps, in seconds."""
    pace = {}
    for code, frame in clean.items():
        if frame.empty:
            continue
        last = frame.sort_values("LapNumber").tail(RECENT_LAPS)
        pace[code] = float(np.median(last["LapTime"].dt.total_seconds()))
    return pace


def _race_times(known: pd.DataFrame, lap: int, codes: List[str], field_lap: float) -> Dict[str, float]:
    """Lap-end time in seconds of each driver on `lap`. A missing one is the driver's latest known
    time plus a field-median lap for each lap since; a driver with no time at all is left out."""
    out: Dict[str, float] = {}
    for code in codes:
        mine = known[(known["Driver"] == code) & known["Time"].notna()]
        if mine.empty:
            continue
        last = mine.sort_values("LapNumber").iloc[-1]
        out[code] = _seconds(last["Time"]) + (lap - float(last["LapNumber"])) * field_lap
    return out


def remaining_stop(pit_loss: float, in_lap_time: float, pace: float) -> float:
    """What a driver on their in-lap still has to lose to the stop: the pit loss less what the in-lap
    already cost against their normal pace (never below zero). With no lap time, half the loss."""
    if not np.isfinite(in_lap_time):
        return pit_loss / 2.0
    return max(0.0, pit_loss - (in_lap_time - pace))


def _stopped(state: pit_strategy.DriverState, laps: pd.DataFrame,
             lap: int) -> Optional[pit_strategy.DriverState]:
    """A driver on their in-lap is treated as already stopped: lap N + 1's compound at age 0. The
    rest of the stop is still to come (see `remaining_stop`). Without a lap N + 1, None."""
    ahead = laps[(laps["Driver"] == state.code) & (laps["LapNumber"] == lap + 1)]
    if ahead.empty:
        return None
    compound = ahead.iloc[0]["Compound"]
    name = str(compound).upper() if pd.notna(compound) else "UNKNOWN"
    used = set(state.used) | ({name} - {"UNKNOWN", "NAN", "NONE"})
    return pit_strategy.DriverState(code=state.code, position=state.position, lap=state.lap,
                                    compound=name, tyre_age=0, used=used,
                                    gap_ahead=state.gap_ahead, neutralised=state.neutralised)


def _group(compound: Any) -> Optional[str]:
    name = str(compound).upper() if pd.notna(compound) else ""
    if name in pit_strategy.WET_COMPOUNDS:
        return "wet"
    return "dry" if name in pit_strategy.DRY_COMPOUNDS else None


def _stint_pace(clean: Dict[str, pd.DataFrame], on_lap: pd.DataFrame) -> Dict[str, Tuple[float, Optional[str]]]:
    """Each driver's pace for the one-scale projection, and the tyre group it was set on: the median
    of their clean laps in the stint they are on at lap N, or their last RECENT_LAPS clean laps when
    that stint has fewer than two."""
    out: Dict[str, Tuple[float, Optional[str]]] = {}
    for code, frame in clean.items():
        frame = frame.sort_values("LapNumber")
        stint = on_lap.loc[code, "Stint"] if code in on_lap.index and "Stint" in frame.columns else None
        mine = frame[frame["Stint"] == stint] if stint is not None and pd.notna(stint) else frame.iloc[0:0]
        if len(mine) < 2:
            mine = frame.tail(RECENT_LAPS)
        seconds = mine["LapTime"].dt.total_seconds()
        groups = mine["Compound"].map(_group).dropna()
        out[code] = (float(np.median(seconds)), groups.mode().iloc[-1] if len(groups) else None)
    return out


def _one_scale_costs(planned: List[Tuple[Any, Any, Optional[float]]], paces: Dict[str, Tuple[float, Optional[str]]],
                     field_pace: float, remaining: int, pit_loss: float) -> List[float]:
    """The one-scale projection: each driver's pace times the laps left (the field's pace for a
    driver with none), plus the rest of any stop they are making.

    When the dry-tyre and the wet-tyre groups lap at different medians, a driver keeps their pace
    against the group it was set in, and a driver on the slower group's tyres runs at the faster
    group's pace after one more stop, if that stop pays for itself over the laps left (a sliver of
    difference between the groups doesn't send a whole group in)."""
    pace = {s.code: paces.get(s.code, (field_pace, None)) for s, _, _ in planned}
    medians: Dict[str, float] = {}
    for group in ("dry", "wet"):
        values = [m for m, g in pace.values() if g == group]
        if values:
            medians[group] = float(np.median(values))
    fast = None
    if len(medians) == 2 and medians["dry"] != medians["wet"]:
        fast = min(medians, key=medians.get)
    costs = []
    for s, plan_state, extra in planned:
        m, measured = pace[s.code]
        cost = remaining * m
        if fast is not None:
            now = _group(plan_state.compound) or measured or fast
            relative = m - medians[measured or now]
            cost = remaining * (relative + medians[fast])
            if now != fast:
                cost = min(remaining * (relative + medians[now]), cost + pit_loss)
        costs.append(cost + (extra or 0.0))
    return costs


class _Plain:
    """A session's laps as a plain frame: FastF1's Laps subclass makes every filter several times
    slower, and a lap-by-lap replay does thousands of them."""

    def __init__(self, session: Any) -> None:
        self.laps = pd.DataFrame(session.laps)
        self.results = getattr(session, "results", None)
        try:
            self.total_laps = session.total_laps
        except Exception:  # FastF1 raises before a load, and `_total_laps` reads it the same way
            pass


def _evaluate(session: Any, lap: int, sims: int, seed: int, sprint: bool, detail: bool) -> Dict[str, Any]:
    """Everything the model knows at the end of `lap`, from the laps up to it."""
    laps = session.laps
    states, model, pit_loss, total = pit_window.lap_state(session, lap)
    remaining = total - lap
    known = laps[laps["LapNumber"] <= lap]
    on_lap = known[known["LapNumber"] == lap].drop_duplicates("Driver", keep="last").set_index("Driver")

    clean = _clean_by_driver(pit_window._near_the_pace(known))  # the model's own cut: no stoppage laps
    sigma = _sigma_lap(clean, model)
    pace = _recent_pace(clean)
    timed = known["LapTime"].dropna().dt.total_seconds()
    field_pace = float(np.median(list(pace.values()))) if pace else (
        float(timed.median()) if len(timed) else pit_strategy.DEFAULT_BASE_S)
    times = _race_times(known, lap, [s.code for s in states], field_pace)
    states = [s for s in states if s.code in times]
    out: Dict[str, Any] = {"states": states, "sigma": sigma, "remaining": remaining,
                           "total": total, "probs": np.zeros(0)}
    if not states:
        return out

    planned: List[Tuple[pit_strategy.DriverState, pit_strategy.DriverState, Optional[float]]] = []
    for s in states:
        plan_state, in_lap = s, None
        if pd.notna(on_lap.loc[s.code, "PitInTime"]):
            stopped = _stopped(s, laps, lap)
            if stopped is not None:
                plan_state, in_lap = stopped, _seconds(on_lap.loc[s.code, "LapTime"])
        planned.append((s, plan_state, in_lap))
    # The field goes on one scale when the road leader or a quarter of it is on wet tyres, counting
    # an in-lap car on the tyre it is stopping for. With no dry compound fitted yet (lap 1, or just
    # after a restart) it goes on one scale at one pace, the order on the road: the few laps known
    # can't yet tell the drivers apart, and a plan would run on the fit's fallback numbers.
    wet = sum(ps.compound in pit_strategy.WET_COMPOUNDS for _, ps, _ in planned)
    wet_field = planned[0][1].compound in pit_strategy.WET_COMPOUNDS or wet >= WET_SHARE * len(states)
    fitted = any(model.compounds.get(c, (0.0, 0.0, False))[2] for c in pit_strategy.DRY_COMPOUNDS)
    one_scale = wet_field or not fitted
    paces = _stint_pace(clean, on_lap) if wet_field and remaining else {}
    mine = {c: v[0] for c, v in paces.items()} if one_scale else pace
    stops = [(s, ps, None if in_lap is None else
              remaining_stop(pit_loss, in_lap, mine.get(s.code, field_pace)))
             for s, ps, in_lap in planned]

    costs: List[float] = []
    if remaining == 0:
        costs = [0.0] * len(stops)
    elif one_scale:
        costs = _one_scale_costs(stops, paces, field_pace, remaining, pit_loss)
    else:
        for s, plan_state, extra in stops:
            plan = pit_strategy.pit_window(plan_state, model, remaining, sprint=sprint)
            if plan["best"] is not None:
                costs.append(plan["best"]["cost"] + (extra or 0.0))
            else:
                costs.append(remaining * pace.get(s.code, field_pace) + (extra or 0.0))
    shown = []
    if detail:
        shown = [_status(s, model, remaining, sprint) if remaining else
                 {"status": "stay out", "rule_breach": False, "window_open": None} for s in states]

    t = np.array([times[s.code] for s in states])
    F = project_finish(t, np.array(costs))
    if remaining == 0:
        # The race is decided: the winner is the leader on the road, not the earliest lap-end time
        # (a car's final Time can be missing and is then extrapolated).
        probs = np.zeros(len(states))
        probs[0] = 1.0
    else:
        probs = simulate_winner(F, remaining, sigma, np.random.default_rng(seed), sims)
    out.update(times=t, F=F, probs=probs, shown=shown)
    return out


def _status(state: pit_strategy.DriverState, model: pit_strategy.TyreModel,
            remaining: int, sprint: bool) -> Dict[str, Any]:
    plan = pit_strategy.pit_window(state, model, remaining, sprint=sprint)
    return {"status": plan["status"], "rule_breach": bool(plan["rule_breach"]),
            "window_open": plan["window"]["open"] if plan["window"] else None}


def _seed(year: int, round_number: int, lap: int) -> int:
    return int(year) * 100_000 + int(round_number) * 1_000 + int(lap)


def _odds_of(codes: List[str], probs: np.ndarray) -> Dict[str, float]:
    rounded = {c: round(float(p), 4) for c, p in zip(codes, probs)}
    return {c: p for c, p in rounded.items() if p > 0}


def _started(laps: pd.DataFrame) -> List[str]:
    """Every driver who started, in lap-1 order (pit-lane starters, with no place, last)."""
    first = laps[laps["LapNumber"] == 1].drop_duplicates("Driver")
    first = first.assign(_p=first["Position"].fillna(99.0)).sort_values(["_p", "Driver"])
    order = [str(c) for c in first["Driver"]]
    return order + sorted(str(c) for c in laps["Driver"].dropna().unique() if str(c) not in order)


def odds_history(session: Any, year: int, round_number: int, sprint: bool = False) -> Dict[str, Any]:
    """The win odds at the end of every lap, the laps run under a neutralisation, and the field."""
    laps = session.laps
    total = pit_window._total_laps(session, laps)
    plain = _Plain(session)
    history: List[Dict[str, Any]] = []
    sc_laps: List[int] = []
    for lap in range(1, total + 1):
        seen = _evaluate(plain, lap, HISTORY_SIMS, _seed(year, round_number, lap), sprint, detail=False)
        codes = [s.code for s in seen["states"]]
        history.append({"lap": lap, "odds": _odds_of(codes, seen["probs"])})
        if seen["states"] and seen["states"][0].neutralised:
            sc_laps.append(lap)
    drivers = [{"code": code, **driver_profile(session, code)} for code in _started(laps)]
    return {"total_laps": total, "sc_laps": sc_laps, "laps": history, "drivers": drivers}


def _at(session: Any, lap: int, year: int, round_number: int, sprint: bool) -> Dict[str, Any]:
    seen = _evaluate(_Plain(session), lap, N_SIMS, _seed(year, round_number, lap), sprint, detail=True)
    states = seen["states"]
    rows = []
    if states:
        lead = float(seen["times"].min())
        low = float(seen["F"].min())
        for i, s in enumerate(states):
            rows.append({
                "code": s.code, "position": s.position,
                "gap": round(float(seen["times"][i]) - lead, 3),
                "projected_gap": round(float(seen["F"][i]) - low, 3),
                "probability": round(float(seen["probs"][i]), 4),
                **seen["shown"][i],
            })
    return {"lap": lap, "rows": rows}


def _agreeing(laps: List[Dict[str, Any]], at: Dict[str, Any]) -> List[Dict[str, Any]]:
    """A copy of the lap series whose point for the selected lap is the detail's own probabilities,
    so the chart and the table agree on it. The memoised series is left as it was."""
    odds = {r["code"]: r["probability"] for r in at["rows"] if r["probability"] > 0}
    return [{"lap": e["lap"], "odds": odds} if e["lap"] == at["lap"] else e for e in laps]


def _check_lap(lap: Optional[int], total: int) -> int:
    if lap is None:
        return total // 2
    if isinstance(lap, bool) or not isinstance(lap, (int, np.integer)) or lap < 1 or lap > total:
        raise PitWindowInputError(f"Pick a lap from 1 to {total}.")
    return int(lap)


def win_probability_payload(session: Any, lap: Optional[int], year: int = 0, round_number: int = 0,
                            session_name: str = "R", history: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """The win odds of every lap and the detail at `lap` (default: half distance), from a loaded
    session. `history` is a precomputed `odds_history`, so a change of lap recomputes only `at`."""
    sprint = session_name == "S"
    total = pit_window._total_laps(session, session.laps)
    lap = _check_lap(lap, total)
    if history is None:
        history = odds_history(session, year, round_number, sprint)
    at = _at(session, lap, year, round_number, sprint)
    return {"year": year, "round": round_number, "session": session_name, "total_laps": total,
            "sims": N_SIMS, "sc_laps": history["sc_laps"], "laps": _agreeing(history["laps"], at),
            "drivers": history["drivers"], "at": at}


def _fresh(key: Tuple) -> Optional[Dict[str, Any]]:
    """The memoised odds for `key` if they haven't expired, else None. Call under _lock."""
    cached = _odds.get(key)
    if cached and time.time() - cached[0] < _CACHE_TTL_SECONDS:
        return cached[1]
    return None


def _history_for(key: Tuple, session: Any, year: int, round_number: int, sprint: bool) -> Dict[str, Any]:
    with _lock:
        found = _fresh(key)
        if found is not None:
            return found
        key_lock = _computing.setdefault(key, threading.Lock())
    with key_lock:
        with _lock:
            found = _fresh(key)  # worked out by another request while this one waited
            if found is not None:
                return found
        try:
            history = odds_history(session, year, round_number, sprint)
        except BaseException:
            with _lock:
                _computing.pop(key, None)
            raise
        with _lock:
            _computing.pop(key, None)  # with the insert, so no request sees neither
            now = time.time()
            for stale in [k for k, (at, _) in _odds.items() if now - at >= _CACHE_TTL_SECONDS]:
                del _odds[stale]
            _odds.pop(key, None)
            _odds[key] = (now, history)
            while len(_odds) > _MAX_CACHED:
                del _odds[min(_odds, key=lambda k: _odds[k][0])]
    return history


def win_probability_replay(year: int, gp: str, session_name: str, round_number: Optional[int],
                           lap: Optional[int]) -> Dict[str, Any]:
    """Load (or reuse) the session and answer: the odds of every lap come from the memo."""
    if session_name not in SESSIONS:
        raise PitWindowInputError("Win probability needs a race or a sprint.")
    session = pit_window._loaded(year, gp, session_name, round_number)
    event = getattr(session, "event", None)
    try:
        number = int(event["RoundNumber"])
    except Exception:
        number = round_number
    number = number if number is not None else (round_number or 0)
    total = pit_window._total_laps(session, session.laps)
    lap = _check_lap(lap, total)  # a bad lap is refused before the laps are worked out
    key = (year, round_number or gp, session_name)
    sprint = session_name == "S"
    history = _history_for(key, session, year, number, sprint)
    at = _at(session, lap, year, number, sprint)
    return {"year": year, "round": number, "session": session_name, "total_laps": total,
            "sims": N_SIMS, "sc_laps": history["sc_laps"], "laps": _agreeing(history["laps"], at),
            "drivers": history["drivers"], "at": at}
