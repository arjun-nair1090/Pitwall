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
"""
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
    FALLBACK_DEGRADATION_RATES,
    MIN_SAMPLES_FOR_FIT,
    compute_compound_stats,
    estimate_pit_loss_seconds,
)

_CACHE_TTL_SECONDS = 600
_sessions: Dict[Tuple, Tuple[float, Any]] = {}


class PitWindowInputError(ValueError):
    """A request that can't be answered whatever the data says: a 422."""


def clear_cache() -> None:
    _sessions.clear()


def _total_laps(session: Any, laps: pd.DataFrame) -> int:
    return fuel_distance(session, int(laps["LapNumber"].max()))


def _tyre_model(known: pd.DataFrame) -> Tuple[TyreModel, float]:
    """The tyre model fitted on the known laps, and the pit loss."""
    stats = compute_compound_stats(known)
    pit_loss = estimate_pit_loss_seconds(known, stats)
    fitted_bases = [s["base_pace"] for c, s in stats.items()
                    if c in DRY_COMPOUNDS and s["sample_size"] >= MIN_SAMPLES_FOR_FIT]
    compounds: Dict[str, Tuple[float, float, bool, int]] = {}
    for c in DRY_COMPOUNDS:
        s = stats.get(c)
        samples = int(s["sample_size"]) if s else 0
        if s and samples >= MIN_SAMPLES_FOR_FIT:
            compounds[c] = (float(s["base_pace"]), float(s["deg_rate"]), True, samples)
            continue
        deg = float(s["deg_rate"]) if s else FALLBACK_DEGRADATION_RATES[c]
        if fitted_bases:
            # Never faster than a compound we have measured.
            base = max(fitted_bases) + pit_strategy.UNFITTED_BASE_PENALTY_S
        elif s:
            base = float(s["base_pace"])
        else:
            base = pit_strategy.DEFAULT_BASE_S
        compounds[c] = (base, deg, False, samples)
    return TyreModel(compounds, float(pit_loss)), float(pit_loss)


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


def pit_window_payload(session: Any, lap: int) -> Dict[str, Any]:
    """The pit window of every driver at the end of `lap`, and the undercuts on, from a loaded session."""
    laps = session.laps
    total = _total_laps(session, laps)
    if isinstance(lap, bool) or not isinstance(lap, (int, np.integer)) or lap < 1 or lap > total - 1:
        raise PitWindowInputError(f"Pick a lap from 1 to {total - 1}.")
    lap = int(lap)
    remaining = total - lap
    known = laps[laps["LapNumber"] <= lap]

    model, pit_loss = _tyre_model(known)
    states = _states(known, lap)

    drivers: List[Dict[str, Any]] = []
    for s in states:
        drivers.append({
            "code": s.code, **driver_profile(session, s.code),
            "position": s.position, "compound": s.compound, "tyre_age": s.tyre_age,
            "used": sorted(s.used),
            "gap_ahead": None if s.gap_ahead is None else round(s.gap_ahead, 3),
            **pit_strategy.pit_window(s, model, remaining),
        })

    at = {s.position: s for s in states}
    undercuts = []
    for s in states:
        leader = at.get(s.position - 1)
        found = pit_strategy.undercut(s, leader, model, remaining) if leader is not None else None
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


def _loaded(year: int, gp: str, session_name: str, round_number: Optional[int]) -> Any:
    key = (year, round_number or gp, session_name)
    cached = _sessions.get(key)
    if cached and time.time() - cached[0] < _CACHE_TTL_SECONDS:
        return cached[1]
    session = load_session(year, gp, session_name, round_number)
    _sessions[key] = (time.time(), session)
    return session


def pit_window_replay(year: int, gp: str, session_name: str, round_number: Optional[int], lap: int) -> Dict[str, Any]:
    """Load (or reuse) the session and answer for one lap."""
    if session_name not in SESSIONS:
        raise PitWindowInputError("The pit window needs a race or a sprint.")
    session = _loaded(year, gp, session_name, round_number)
    payload = pit_window_payload(session, lap)
    event = getattr(session, "event", None)
    try:
        number = int(event["RoundNumber"])
    except Exception:
        number = round_number
    return {"year": year, "round": number if number is not None else round_number,
            "session": session_name, **payload}
