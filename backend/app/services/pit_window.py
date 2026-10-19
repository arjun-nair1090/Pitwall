"""Replay adapter for the pit window: any lap of a finished race or sprint, as the pit wall saw it.

The laps up to and including the chosen lap N are cut out of the session. Nothing later feeds the
tyre model, the driver states or the gaps, so the answer is what could have been known at the end of
lap N. The model is fitted on those laps by `strategy_simulator`, each driver's state is read off
their lap N row, and `pit_strategy` does the planning.

Choices made on FastF1's quirks:
- A driver with no lap N row (retired) is left out.
- A driver whose Position on lap N is missing (a pit-lane starter on lap 1) is left out: with no
  place there is no car ahead to gap to and nowhere to list them.
- TyreLife missing on lap N: the age is the number of laps the driver has run in that stint up to N.
  With no Stint either, the driver is left out.
- A missing or UNKNOWN compound is reported as "UNKNOWN"; the core gives that driver no plan.

The pit loss is the measured median only once at least MIN_MEASURED_STOPS stops are known; before
that one early stop (often for damage) would set every window, so the default stands in.
"""
import threading
import time
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

from app.services import pit_strategy
from app.services.pit_strategy import DRY_COMPOUNDS, DriverState, TyreModel
from app.services.race_battles import SESSIONS
from app.services.race_pace import fuel_distance
from app.services.session_info import driver_profile, load_session, neutralised_laps
from app.services.strategy_simulator import (
    DEFAULT_PIT_LOSS_SECONDS,
    FALLBACK_DEGRADATION_RATES,
    MIN_SAMPLES_FOR_FIT,
    _fit_laps,
    compute_compound_stats,
    estimate_pit_loss_seconds,
)

_CACHE_TTL_SECONDS = 600
MIN_DISTINCT_AGES = 3
# A compound counts as fitted only on this much evidence; one car's stint, or a handful of laps,
# is one car's pace, not the tyre's.
MIN_FIT_DRIVERS = 2
MIN_FIT_LAPS = 10
MIN_MEASURED_STOPS = 3
_MAX_CACHED_SESSIONS = 3
_sessions: Dict[Tuple, Tuple[float, Any]] = {}
# Requests run in worker threads: the memo is only touched under _lock, and _loading holds one lock
# per session being loaded so that concurrent requests for it wait for a single load.
_lock = threading.Lock()
_loading: Dict[Tuple, threading.Lock] = {}


class PitWindowInputError(ValueError):
    """A request that can't be answered whatever the data says: a 422."""


def clear_cache() -> None:
    with _lock:
        _sessions.clear()


class _Scheduled:
    """A session's scheduled distance as a whole number, for the shared race-pace rule."""

    def __init__(self, total_laps: Any) -> None:
        self.total_laps = total_laps


def _total_laps(session: Any, laps: pd.DataFrame) -> int:
    try:
        scheduled = getattr(session, "total_laps", None)
    except Exception:  # FastF1 raises before a load, not AttributeError
        scheduled = None
    # FastF1 can hand the distance back as a float (44.0); a whole one is the same number.
    if isinstance(scheduled, float) and np.isfinite(scheduled) and scheduled.is_integer():
        scheduled = int(scheduled)
    return fuel_distance(_Scheduled(scheduled), int(laps["LapNumber"].max()))


def _near_the_pace(laps: pd.DataFrame) -> pd.DataFrame:
    """Drop laps more than 7% off the quickest accurate lap so far.

    FastF1 can tag the slow laps after a stoppage with a green status, and early in a race they can
    be most of what is known, which also drags the fit's own median cut-off up with them."""
    seconds = laps["LapTime"].dt.total_seconds()
    usable = seconds[laps["IsAccurate"].fillna(False).astype(bool)] if "IsAccurate" in laps.columns else seconds
    if usable.dropna().empty:
        return laps
    return laps[~(seconds > usable.min() * 1.07)]


def _measured_stops(known: pd.DataFrame, stats: Dict[str, Dict[str, float]]) -> int:
    """How many stops `estimate_pit_loss_seconds` can measure: an in-lap with a known out-lap, both
    timed, both compounds with a base pace, and a positive loss. Its rules, counted."""
    count = 0
    for _, mine in known.groupby("Driver"):
        by_lap = mine.drop_duplicates("LapNumber").set_index("LapNumber")
        for _, in_lap in mine[mine["PitInTime"].notna()].iterrows():
            nxt = in_lap["LapNumber"] + 1
            if nxt not in by_lap.index:
                continue
            out_lap = by_lap.loc[nxt]
            if pd.isna(in_lap["LapTime"]) or pd.isna(out_lap["LapTime"]):
                continue
            in_base = stats.get(in_lap["Compound"], {}).get("base_pace")
            out_base = stats.get(out_lap["Compound"], {}).get("base_pace")
            if in_base is None or out_base is None:
                continue
            loss = (in_lap["LapTime"].total_seconds() - in_base) + (out_lap["LapTime"].total_seconds() - out_base)
            count += loss > 0
    return count


def _pit_loss(known: pd.DataFrame, stats: Dict[str, Dict[str, float]]) -> float:
    if _measured_stops(known, stats) < MIN_MEASURED_STOPS:
        return DEFAULT_PIT_LOSS_SECONDS
    return estimate_pit_loss_seconds(known, stats)


def _tyre_model(known: pd.DataFrame) -> Tuple[TyreModel, float]:
    """The tyre model fitted on the known laps, and the pit loss."""
    # Laps behind a safety car or under a red flag say nothing about tyre wear, so they stay out of
    # the fit. The states and the pit-loss estimate still read every known lap.
    green = known[~neutralised_laps(known["TrackStatus"]).to_numpy()] if "TrackStatus" in known.columns else known
    fit = _near_the_pace(green) if not green.empty else known
    stats = compute_compound_stats(fit if not fit.empty else known)
    pit_loss = _pit_loss(known, stats)
    used_by_fit = _fit_laps(fit if not fit.empty else known)  # the laps the fit really reads

    def trusted(c: str) -> bool:
        s = stats.get(c)
        if not s or s["sample_size"] < max(MIN_SAMPLES_FOR_FIT, MIN_FIT_LAPS):
            return False
        mine = used_by_fit[used_by_fit["Compound"] == c]
        if mine["Driver"].nunique() < MIN_FIT_DRIVERS:
            return False
        return mine["TyreLife"].dropna().nunique() >= MIN_DISTINCT_AGES  # wear can't be read off one age

    fitted_bases = [stats[c]["base_pace"] for c in DRY_COMPOUNDS if c in stats and trusted(c)]
    seen_bases = [s["base_pace"] for c, s in stats.items() if c in DRY_COMPOUNDS]
    compounds: Dict[str, Tuple[float, float, bool, int]] = {}
    for c in DRY_COMPOUNDS:
        s = stats.get(c)
        samples = int(s["sample_size"]) if s else 0
        if trusted(c):
            compounds[c] = (float(s["base_pace"]), float(s["deg_rate"]), True, samples)
            continue
        deg = FALLBACK_DEGRADATION_RATES[c]
        if fitted_bases:
            # Never faster than a compound we have measured.
            base = max(fitted_bases) + pit_strategy.UNFITTED_BASE_PENALTY_S
        elif s:
            base = float(s["base_pace"])
        elif seen_bases:
            base = max(seen_bases) + pit_strategy.UNFITTED_BASE_PENALTY_S
        else:
            base = pit_strategy.DEFAULT_BASE_S
        compounds[c] = (base, deg, False, samples)
    return TyreModel(compounds, float(pit_loss)), float(pit_loss)


def _early(compound: str, window: Dict[str, Any], model: TyreModel) -> bool:
    """A dry driver's plan is an early estimate when the tyre they are on, or the one their best plan
    stops onto first, has no fit of its own and runs on fallback numbers."""
    if compound not in DRY_COMPOUNDS:
        return False

    def unfitted(c: str) -> bool:
        return not (c in model.compounds and model.compounds[c][2])

    stops = (window.get("best") or {}).get("stops") or []
    return unfitted(compound) or bool(stops and unfitted(stops[0]["compound"]))


def _finite(value: Any) -> bool:
    return value is not None and bool(pd.notna(value))


def _states(known: pd.DataFrame, lap: int) -> List[DriverState]:
    neutral = (neutralised_laps(known["TrackStatus"]) if "TrackStatus" in known.columns
               else pd.Series(False, index=known.index))
    known = known.assign(_neutral=neutral.to_numpy())
    rows = known[known["LapNumber"] == lap].drop_duplicates("Driver", keep="last")
    rows = rows[rows["Position"].notna()]
    by_position = {int(r["Position"]): r for _, r in rows.iterrows()}
    states: List[DriverState] = []
    for _, row in rows.iterrows():
        code = str(row["Driver"])
        mine = known[known["Driver"] == row["Driver"]]
        if _finite(row["TyreLife"]):
            age = int(row["TyreLife"])
        elif _finite(row.get("Stint")):
            age = int(((mine["Stint"] == row["Stint"]) & (mine["LapNumber"] <= lap)).sum())
        else:
            continue
        compound = str(row["Compound"]).upper() if _finite(row["Compound"]) else "UNKNOWN"
        used = {str(c).upper() for c in mine["Compound"].dropna().unique()} - {"UNKNOWN", "NAN", "NONE"}
        position = int(row["Position"])
        ahead = by_position.get(position - 1)
        gap: Optional[float] = None
        if ahead is not None and _finite(row["Time"]) and _finite(ahead["Time"]):
            seconds = (row["Time"] - ahead["Time"]).total_seconds()
            gap = seconds if np.isfinite(seconds) and seconds >= 0 else None
        states.append(DriverState(
            code=code, position=position, lap=lap, compound=compound, tyre_age=max(age, 0),
            used=used, gap_ahead=gap, neutralised=bool(row["_neutral"]),
        ))
    states.sort(key=lambda s: (s.position, s.code))
    return states


def lap_state(session: Any, lap: int) -> Tuple[List[DriverState], TyreModel, float, int]:
    """(driver states, tyre model, pit loss, scheduled laps) as known at the end of `lap`.

    Only laps up to and including `lap` feed any of it. The lap isn't range-checked here: callers
    that need the last lap of the race (the win probability) use it too."""
    laps = session.laps
    total = _total_laps(session, laps)
    known = laps[laps["LapNumber"] <= lap]
    model, pit_loss = _tyre_model(known)
    return _states(known, int(lap)), model, pit_loss, total


def pit_window_payload(session: Any, lap: int, sprint: bool = False) -> Dict[str, Any]:
    """The pit window of every driver at the end of `lap`, and the undercuts on, from a loaded session.
    `sprint` waives the two-compound rule: a sprint has no mandatory stop."""
    laps = session.laps
    total = _total_laps(session, laps)
    if isinstance(lap, bool) or not isinstance(lap, (int, np.integer)) or lap < 1 or lap > total - 1:
        # The page reads the last lap back out of this sentence, so the wording is a contract.
        raise PitWindowInputError(f"Pick a lap from 1 to {total - 1}.")
    lap = int(lap)
    remaining = total - lap
    states, model, pit_loss, _ = lap_state(session, lap)

    drivers: List[Dict[str, Any]] = []
    for s in states:
        window = pit_strategy.pit_window(s, model, remaining, sprint=sprint)
        drivers.append({
            "code": s.code, **driver_profile(session, s.code),
            "position": s.position, "compound": s.compound, "tyre_age": s.tyre_age,
            "used": sorted(s.used),
            "gap_ahead": None if s.gap_ahead is None else round(s.gap_ahead, 3),
            **window, "early": _early(s.compound, window, model),
        })

    at = {s.position: s for s in states}
    undercuts = []
    for s in states:
        leader = at.get(s.position - 1)
        found = pit_strategy.undercut(s, leader, model, remaining, sprint=sprint) if leader is not None else None
        if found:
            undercuts.append(found)
    undercuts.sort(key=lambda u: (-u["margin"], u["chaser"]))

    return {
        "lap": lap, "total_laps": total, "laps_remaining": remaining,
        "pit_loss": round(pit_loss, 3),
        "sc_lap": bool(states and states[0].neutralised),
        "model": [{"compound": c, "base": round(base, 3), "deg_per_lap": round(deg, 3),
                   "fitted": bool(fitted), "laps": int(n)}
                  for c, (base, deg, fitted, n) in ((c, model.compounds[c]) for c in DRY_COMPOUNDS)],
        "drivers": drivers, "undercuts": undercuts,
    }


def _fresh(key: Tuple) -> Any:
    """The memoised session for `key` if it hasn't expired, else None. Call under _lock."""
    cached = _sessions.get(key)
    if cached and time.time() - cached[0] < _CACHE_TTL_SECONDS:
        return cached[1]
    return None


def _loaded(year: int, gp: str, session_name: str, round_number: Optional[int]) -> Any:
    key = (year, round_number or gp, session_name)
    with _lock:
        session = _fresh(key)
        if session is not None:
            return session
        key_lock = _loading.setdefault(key, threading.Lock())
    with key_lock:
        with _lock:
            session = _fresh(key)  # loaded by another request while this one waited
            if session is not None:
                return session
        try:
            session = load_session(year, gp, session_name, round_number)
        except BaseException:
            with _lock:
                _loading.pop(key, None)
            raise
        with _lock:
            _loading.pop(key, None)  # with the insert, so no request sees neither
            now = time.time()
            for stale in [k for k, (at, _) in _sessions.items() if now - at >= _CACHE_TTL_SECONDS]:
                del _sessions[stale]
            _sessions.pop(key, None)
            _sessions[key] = (now, session)
            while len(_sessions) > _MAX_CACHED_SESSIONS:
                del _sessions[min(_sessions, key=lambda k: _sessions[k][0])]
    return session


def pit_window_replay(year: int, gp: str, session_name: str, round_number: Optional[int], lap: int) -> Dict[str, Any]:
    """Load (or reuse) the session and answer for one lap."""
    if session_name not in SESSIONS:
        raise PitWindowInputError("The pit window needs a race or a sprint.")
    session = _loaded(year, gp, session_name, round_number)
    payload = pit_window_payload(session, lap, sprint=session_name == "S")
    event = getattr(session, "event", None)
    try:
        number = int(event["RoundNumber"])
    except Exception:
        number = round_number
    return {"year": year, "round": number if number is not None else round_number,
            "session": session_name, **payload}
