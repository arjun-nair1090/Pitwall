"""Fuel-corrected race pace and tyre degradation from a race or sprint's lap times.

A car gets quicker as it burns fuel, which hides tyre wear. The correction is a stated model, not
a fit: 0.03 s per kg, 110 kg at the start (105 kg before 2019), burned evenly over the scheduled
distance. Every lap is restated as if run on the last lap's fuel load. Pace is the median corrected time
over a driver's clean laps; degradation is the slope of corrected time against tyre life.
"""
import numbers
import time
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

from app.services.corner_analysis import clean_laps
from app.services.session_info import SessionDataError, driver_profile, load_session

# Lap time lost per kilogram of fuel carried.
SECONDS_PER_KG = 0.03
# Fuel at the start: the FIA limit was 105 kg until 2019, then 110 kg.
FUEL_START_KG = 110.0
FUEL_START_KG_BEFORE_2019 = 105.0
# A sprint (100 km) burns at the same per-lap rate as a race (305 km), so its fuel is spread over
# 3.05 times as many laps as it runs.
DISTANCE_FACTOR = {"R": 1.0, "S": 3.05}

# Fewest clean laps for a slope or a pace to mean anything.
MIN_STINT_LAPS = 5
MIN_PACE_LAPS = 5
# A driver is ranked only with at least this share of the field's typical clean-lap count: someone
# who retired early ran light on fresh tyres and would otherwise look quickest.
MIN_PACE_SHARE = 0.5
# Fewest laps at one tyre life before the compound curve plots it.
MIN_CURVE_LAPS = 3

COMPOUND_ORDER = ["SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET"]

_CACHE_TTL_SECONDS = 600
_cache: Dict[Tuple, Tuple[float, Dict[str, Any]]] = {}


def clear_cache() -> None:
    _cache.clear()


def fuel_model(year: int, session_name: str, total_laps: int) -> Dict[str, float]:
    """The fuel assumptions behind the correction, in the payload's `fuel` shape."""
    start_kg = FUEL_START_KG if year >= 2019 else FUEL_START_KG_BEFORE_2019
    kg_per_lap = start_kg / (total_laps * DISTANCE_FACTOR[session_name])
    return {
        "start_kg": float(start_kg),
        "kg_per_lap": float(kg_per_lap),
        "seconds_per_kg": SECONDS_PER_KG,
        "seconds_per_lap": float(SECONDS_PER_KG * kg_per_lap),
        "total_laps": int(total_laps),
    }


def fuel_distance(session: Any, laps_run: int) -> int:
    """Laps the start fuel is spread over: the scheduled distance, so a race stopped early isn't
    corrected as if the cars had fuelled for the laps they got through, or else the laps run."""
    try:
        scheduled = getattr(session, "total_laps", None)
    except Exception:  # FastF1 raises DataNotLoadedError, not AttributeError, before a load
        scheduled = None
    if isinstance(scheduled, numbers.Integral) and not isinstance(scheduled, bool) and scheduled >= max(laps_run, 1):
        return int(scheduled)
    return laps_run


def corrected_times(laps: pd.DataFrame, seconds_per_lap: float, total_laps: int) -> pd.Series:
    """Lap times in seconds as if every lap were run on the last lap's fuel load."""
    seconds = laps["LapTime"].dt.total_seconds()
    return seconds - seconds_per_lap * (total_laps - laps["LapNumber"])


def _slope(life: np.ndarray, time_: np.ndarray) -> Optional[Tuple[float, float]]:
    """Least-squares (slope, intercept), or None when the data can't pin a line down."""
    if len(life) < MIN_STINT_LAPS or len(np.unique(life)) < 2:
        return None
    slope, intercept = np.polyfit(life, time_, 1)
    return float(slope), float(intercept)


def stint_summary(
    driver_laps: pd.DataFrame, clean: pd.DataFrame, seconds_per_lap: float, total_laps: int
) -> List[Dict[str, Any]]:
    """One entry per stint of a driver's race, with its clean laps and its degradation slope."""
    stints: List[Dict[str, Any]] = []
    staged = driver_laps[driver_laps["Stint"].notna()]
    for number, rows in staged.groupby("Stint"):
        compounds = rows["Compound"].dropna()
        compound = str(compounds.iloc[0]) if len(compounds) else "UNKNOWN"
        good = clean[clean["Stint"] == number]
        corrected = corrected_times(good, seconds_per_lap, total_laps)
        laps = [
            {
                "lap": int(lap),
                "time": float(raw.total_seconds()),
                "corrected": float(fixed),
                "tyre_life": int(life) if pd.notna(life) else None,
            }
            for lap, raw, fixed, life in zip(good["LapNumber"], good["LapTime"], corrected, good["TyreLife"])
        ]
        deg: Optional[float] = None
        fit: Optional[Dict[str, Any]] = None
        aged = pd.DataFrame({"life": good["TyreLife"], "lap": good["LapNumber"], "y": corrected}).dropna()
        line = _slope(aged["life"].to_numpy(dtype=float), aged["y"].to_numpy(dtype=float))
        if line is not None:
            deg, intercept = line
            first, last = aged.iloc[int(aged["lap"].to_numpy().argmin())], aged.iloc[int(aged["lap"].to_numpy().argmax())]
            fit = {
                "from": {"lap": int(first["lap"]), "time": float(intercept + deg * first["life"])},
                "to": {"lap": int(last["lap"]), "time": float(intercept + deg * last["life"])},
            }
        stints.append({
            "stint": int(number),
            "compound": compound,
            "start_lap": int(rows["LapNumber"].min()),
            "end_lap": int(rows["LapNumber"].max()),
            "deg_per_lap": deg,
            "fit": fit,
            "laps": laps,
        })
    stints.sort(key=lambda s: s["stint"])
    return stints


def _compound_rank(compound: str) -> Tuple[int, str]:
    if compound in COMPOUND_ORDER:
        return COMPOUND_ORDER.index(compound), ""
    return len(COMPOUND_ORDER), compound


def compound_degradation(stints_by_compound: Dict[str, List[pd.DataFrame]]) -> List[Dict[str, Any]]:
    """Per compound across the field: the typical stint's wear, the median of the stints' own slopes,
    and the median time lost at each tyre life against each stint's own fresh-tyre intercept, so a
    quicker driver or a heavier car doesn't tilt either."""
    out: List[Dict[str, Any]] = []
    for compound in sorted(stints_by_compound, key=_compound_rank):
        slopes: List[float] = []
        laps = 0
        losses: Dict[int, List[float]] = {}
        for stint in stints_by_compound[compound]:
            x, y = stint["TyreLife"].to_numpy(dtype=float), stint["Corrected"].to_numpy(dtype=float)
            line = _slope(x, y)
            if line is None:
                continue
            slope, intercept = line
            slopes.append(slope)
            laps += len(x)
            for life, seconds in zip(x, y):
                losses.setdefault(int(life), []).append(float(seconds - intercept))
        if not slopes:
            continue
        out.append({
            "compound": compound,
            "deg_per_lap": float(np.median(slopes)),
            "stints": len(slopes),
            "laps": int(laps),
            "curve": [
                {"tyre_life": life, "loss": float(np.median(values)), "laps": len(values)}
                for life, values in sorted(losses.items())
                if len(values) >= MIN_CURVE_LAPS
            ],
        })
    return out


def race_pace_payload(year: int, gp: str, session_name: str, round_number: Optional[int] = None) -> Dict[str, Any]:
    """Every driver's fuel-corrected pace and stints, plus the field's degradation per compound."""
    if session_name not in DISTANCE_FACTOR:
        raise SessionDataError("Race pace needs a race or a sprint.")
    key = (year, round_number or gp, session_name)
    cached = _cache.get(key)
    if cached and time.time() - cached[0] < _CACHE_TTL_SECONDS:
        return cached[1]

    session = load_session(year, gp, session_name, round_number)
    laps = session.laps
    total_laps = int(laps["LapNumber"].max())
    fuel = fuel_model(year, session_name, fuel_distance(session, total_laps))
    per_lap = fuel["seconds_per_lap"]

    drivers: List[Dict[str, Any]] = []
    by_compound: Dict[str, List[pd.DataFrame]] = {}
    for code in sorted(str(d) for d in laps["Driver"].dropna().unique()):
        mine = laps[laps["Driver"] == code]
        clean = clean_laps(mine)
        stints = stint_summary(mine, clean, per_lap, total_laps)
        corrected = corrected_times(clean, per_lap, total_laps)
        clean = clean.assign(Corrected=corrected.to_numpy())  # positional, so a repeated index can't misalign it
        drivers.append({
            "code": code, **driver_profile(session, code),
            "pace": float(corrected.median()) if len(clean) else None,
            "gap": None, "clean_laps": int(len(clean)), "stints": stints,
        })
        for stint in stints:
            if stint["deg_per_lap"] is None:
                continue
            rows = clean[clean["Stint"] == stint["stint"]]
            frame = rows[["TyreLife", "Corrected"]].dropna()
            by_compound.setdefault(stint["compound"], []).append(frame)

    counts = [d["clean_laps"] for d in drivers if d["clean_laps"] >= MIN_PACE_LAPS]
    needed = max(MIN_PACE_LAPS, MIN_PACE_SHARE * float(np.median(counts))) if counts else MIN_PACE_LAPS
    for d in drivers:
        if d["clean_laps"] < needed:
            d["pace"] = None
    ranked = [d["pace"] for d in drivers if d["pace"] is not None]
    if not ranked:
        raise SessionDataError("No driver has enough clean laps in this session to measure race pace.")
    best = min(ranked)
    for d in drivers:
        if d["pace"] is not None:
            d["gap"] = float(d["pace"] - best)
    drivers.sort(key=lambda d: (d["pace"] is None, d["pace"] if d["pace"] is not None else 0.0, d["code"]))

    payload = {"fuel": fuel, "drivers": drivers, "compounds": compound_degradation(by_compound)}
    _cache[key] = (time.time(), payload)
    return payload
