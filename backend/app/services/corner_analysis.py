"""Corner-by-corner lap analysis over FastF1 telemetry and the official corner list.

The maths lives in small pure functions over telemetry frames so it can be tested without a
network. A lap is cut into one zone per corner (halfway between neighbouring corner markers),
and each zone is summarised by its time, speeds and braking point.
"""
import time
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

from app.services.session_info import SessionDataError, driver_laps, driver_profile, load_session

# How far along the lap, either side of a corner's reference distance, a sample may sit and
# still be matched to that corner. Keeps a corner from snapping onto a track crossing.
MARKER_WINDOW_M = 300.0

# A release shorter than this, between two bursts of braking, is still one braking event.
BRAKE_GAP_M = 50.0

# How far either side of a corner's marker its apex is looked for. Further out, the lowest speed
# in a zone is often the previous corner's exit or the next one's braking.
APEX_WINDOW_M = 100.0

# A driver needs this many clean laps before their spread means anything.
MIN_CLEAN_LAPS = 3
# Laps slower than this multiple of the driver's best are traffic, a mistake or a safety car.
CLEAN_LAP_LIMIT = 1.07

_CACHE_TTL_SECONDS = 600
_cache: Dict[Tuple, Tuple[float, Dict[str, Any]]] = {}


def clear_cache() -> None:
    _cache.clear()


def circuit_corners(session) -> List[Dict[str, Any]]:
    """The official corners in lap order. Empty when FastF1 can't build circuit info."""
    try:
        frame = session.get_circuit_info().corners
        corners = []
        for _, row in frame.iterrows():
            number = int(row["Number"])
            letter = row["Letter"] if isinstance(row["Letter"], str) else ""
            corners.append({
                "number": number,
                "letter": letter,
                "label": f"T{number}{letter}",
                "x": float(row["X"]),
                "y": float(row["Y"]),
                "angle": float(row["Angle"]),
                "distance": float(row["Distance"]),
            })
    except Exception:
        return []
    corners.sort(key=lambda c: c["distance"])
    return corners


def _usable(tel: pd.DataFrame) -> pd.DataFrame:
    """Telemetry without the samples that can't be placed, timed or have a speed (raw data has gaps)."""
    return tel.dropna(subset=["Distance", "Time", "Speed"])


def _between_samples(distance: np.ndarray, x: np.ndarray, y: np.ndarray, k: int, corner: Dict[str, Any]) -> float:
    """The distance of the point nearest the corner on the track either side of sample k. Samples
    are several metres apart, so snapping to one would put two drivers' zones in different places."""
    marker, nearest = float(distance[k]), np.inf
    for a, b in ((k - 1, k), (k, k + 1)):
        if a < 0 or b >= len(distance):
            continue
        dx, dy = x[b] - x[a], y[b] - y[a]
        length = dx * dx + dy * dy
        if not length > 0:  # a repeated or missing position gives no direction to project onto
            continue
        t = min(max(((corner["x"] - x[a]) * dx + (corner["y"] - y[a]) * dy) / length, 0.0), 1.0)
        gap = np.hypot(x[a] + t * dx - corner["x"], y[a] + t * dy - corner["y"])
        if gap < nearest:
            marker, nearest = float(distance[a] + t * (distance[b] - distance[a])), gap
    return marker


def corner_markers(tel: pd.DataFrame, corners: List[Dict[str, Any]]) -> List[float]:
    """Where each corner sits on this lap, as a distance in metres, never going backwards."""
    tel = _usable(tel)
    if tel.empty:
        return []
    distance = tel["Distance"].to_numpy(dtype=float)
    x = tel["X"].to_numpy(dtype=float)
    y = tel["Y"].to_numpy(dtype=float)
    markers: List[float] = []
    for corner in corners:
        ref = corner["distance"]
        candidates = np.flatnonzero(np.abs(distance - ref) <= MARKER_WINDOW_M)
        if len(candidates):
            gap = np.hypot(x[candidates] - corner["x"], y[candidates] - corner["y"])
            gap[np.isnan(gap)] = np.inf  # samples without a position can't be nearest
            marker = _between_samples(distance, x, y, int(candidates[int(np.argmin(gap))]), corner)
        else:
            marker = float(min(max(ref, distance[0]), distance[-1]))
        if markers:
            marker = max(marker, markers[-1])
        markers.append(marker)
    return markers


def _valleys(speed: np.ndarray) -> np.ndarray:
    """Which samples sit at a local speed minimum: lower than the nearest different speed on each
    side. Speeds repeat between samples, so a repeat on the way up or down isn't a minimum."""
    changes = np.diff(speed) != 0
    run = np.concatenate([[0], np.cumsum(changes)])  # which stretch of equal speeds each sample is in
    level = speed[np.concatenate([[0], np.flatnonzero(changes) + 1])]
    valley = np.zeros(len(level), dtype=bool)
    valley[1:-1] = (level[1:-1] < level[:-2]) & (level[1:-1] < level[2:])
    return valley[run]


def corner_metrics(tel: pd.DataFrame, corners: List[Dict[str, Any]]) -> List[Dict[str, Optional[float]]]:
    """Per-corner time, apex/entry/exit speed and braking distance for one lap, in corner order."""
    tel = _usable(tel)
    if not corners or tel.empty:
        return []
    markers = corner_markers(tel, corners)
    distance = tel["Distance"].to_numpy(dtype=float)
    seconds = tel["Time"].dt.total_seconds().to_numpy(dtype=float)
    speed = tel["Speed"].to_numpy(dtype=float)
    braking = (tel["Brake"] == True).to_numpy()  # a missing flag isn't braking
    valleys = _valleys(speed)

    bounds = [float(distance[0])]
    bounds += [(a + b) / 2 for a, b in zip(markers, markers[1:])]
    bounds.append(float(distance[-1]))

    rows: List[Dict[str, Optional[float]]] = []
    previous_apex = -1  # sample index of the previous corner's apex; no corner before the first
    for i, marker in enumerate(markers):
        start, end = bounds[i], bounds[i + 1]
        in_zone = np.flatnonzero((distance >= start) & (distance <= end))
        speed_start = float(np.interp(start, distance, speed))
        speed_end = float(np.interp(end, distance, speed))
        if len(in_zone):
            near = in_zone[np.abs(distance[in_zone] - marker) <= APEX_WINDOW_M]
            dips = near[valleys[near]]
            if len(dips):
                apex = int(dips[int(np.argmin(speed[dips]))])
                apex_speed = float(speed[apex])
            else:
                # taken flat or while accelerating: the corner's speed is the speed at its marker
                pool = near if len(near) else in_zone
                apex = int(pool[int(np.argmin(np.abs(distance[pool] - marker)))])
                apex_speed = float(np.interp(marker, distance, speed))
            # a zone can end while the car is still slowing, so its end counts towards the minimum
            after = np.flatnonzero(distance > end)
            if len(after) and speed[after[0]] < speed[in_zone[-1]]:
                apex_speed = min(apex_speed, speed_end)
            # the marker can sit just past the apex sample, so the apex speed counts towards the entry
            entry = max(speed_start, float(speed[in_zone[0]:apex + 1].max()), apex_speed)
        else:
            apex = int(np.argmin(np.abs(distance - marker)))
            entry = max(speed_start, float(speed[apex]))
            apex_speed = min(float(speed[apex]), speed_start, speed_end)

        brake_before: Optional[float] = None
        braked = in_zone[(in_zone <= apex) & braking[in_zone]]
        if len(braked):
            first = int(braked[-1])
            while True:
                while first > 0 and braking[first - 1]:  # the run may have begun in the previous zone
                    first -= 1
                # a brief release followed by more braking is the same event, but never reach
                # back past the previous corner's apex
                earlier = np.flatnonzero(braking[previous_apex + 1:first])
                if not len(earlier):
                    break
                before = previous_apex + 1 + int(earlier[-1])
                if distance[first] - distance[before] >= BRAKE_GAP_M:
                    break
                first = before
            # a run reaching the previous corner's apex is that corner's braking, not this one's
            if first > previous_apex:
                brake_before = float(marker - distance[first])
        previous_apex = apex

        rows.append({
            "zone_time": float(np.interp(end, distance, seconds) - np.interp(start, distance, seconds)),
            "apex_speed": apex_speed,
            "entry_speed": entry,
            "exit_speed": speed_end,
            "brake_before_m": brake_before,
        })
    return rows


def corner_duel(corners: List[Dict[str, Any]], tel1: pd.DataFrame, tel2: pd.DataFrame) -> List[Dict[str, Any]]:
    """Both drivers' corner metrics side by side. A positive time_delta means driver 1 gained there."""
    metrics1 = corner_metrics(tel1, corners)
    metrics2 = corner_metrics(tel2, corners)
    if not metrics1 or not metrics2:
        return []
    return [
        {
            "label": corner["label"],
            "number": corner["number"],
            "letter": corner["letter"],
            "x": corner["x"],
            "y": corner["y"],
            "angle": corner["angle"],
            "driver1": one,
            "driver2": two,
            "time_delta": two["zone_time"] - one["zone_time"],
        }
        for corner, one, two in zip(corners, metrics1, metrics2)
    ]


def clean_laps(laps: pd.DataFrame) -> pd.DataFrame:
    """One driver's representative laps: timed, not a pit lap, not deleted, not the standing-start
    lap, not run under a Safety Car, red flag or VSC, and within 7% of their best."""
    timed = laps[laps["LapTime"].notna() & laps["PitInTime"].isna() & laps["PitOutTime"].isna()]
    timed = timed[timed["LapNumber"] != 1]
    if "TrackStatus" in timed.columns:
        neutralised = timed["TrackStatus"].map(lambda status: pd.notna(status) and any(c in str(status) for c in "4567"))
        timed = timed[~neutralised]
    if "Deleted" in timed.columns:
        deleted = timed["Deleted"].map(lambda flag: bool(flag) if pd.notna(flag) else False)
        timed = timed[~deleted]
    if timed.empty:
        return timed
    return timed[timed["LapTime"] <= timed["LapTime"].min() * CLEAN_LAP_LIMIT]


def _mean_sd(values: List[float]) -> Dict[str, float]:
    return {
        "mean": float(np.mean(values)),
        "sd": float(np.std(values, ddof=1)) if len(values) > 1 else 0.0,
    }


def summarise_consistency(corners: List[Dict[str, Any]], per_lap: Dict[int, List[Dict[str, Any]]]) -> Dict[str, Any]:
    """Spread of each corner across a driver's laps, plus their best lap and the ideal lap
    built from each corner's best zone time. Both laps are on the telemetry basis."""
    laps = sorted(per_lap)
    rows = []
    for i, corner in enumerate(corners):
        times = [per_lap[lap][i]["zone_time"] for lap in laps]
        best = min(times)
        braked = [per_lap[lap][i]["brake_before_m"] for lap in laps if per_lap[lap][i]["brake_before_m"] is not None]
        rows.append({
            "label": corner["label"],
            "number": corner["number"],
            "letter": corner["letter"],
            "apex_speed": _mean_sd([per_lap[lap][i]["apex_speed"] for lap in laps]),
            "brake_before_m": _mean_sd(braked) if braked else None,
            "zone_time": {"best": best, **_mean_sd(times)},
            "per_lap": [
                {
                    "lap": lap,
                    "zone_time": time_,
                    "delta_to_best": time_ - best,
                    "apex_speed": per_lap[lap][i]["apex_speed"],
                    "brake_before_m": per_lap[lap][i]["brake_before_m"],
                }
                for lap, time_ in zip(laps, times)
            ],
        })
    return {
        "laps": laps,
        "corners": rows,
        "best_lap": min(sum(m["zone_time"] for m in per_lap[lap]) for lap in laps),
        "ideal_lap": sum(row["zone_time"]["best"] for row in rows),
    }


def _too_few(code: str, count: int) -> SessionDataError:
    return SessionDataError(
        f"{code} has only {count} clean laps in this session; at least {MIN_CLEAN_LAPS} are needed to judge consistency."
    )


def corner_consistency_payload(
    year: int, gp: str, session_name: str, driver: str, round_number: Optional[int] = None
) -> Dict[str, Any]:
    key = (year, round_number or gp, session_name, driver)
    cached = _cache.get(key)
    if cached and time.time() - cached[0] < _CACHE_TTL_SECONDS:
        return cached[1]

    from app.services.duel_telemetry import _lap_telemetry  # duel_telemetry imports this module

    session = load_session(year, gp, session_name, round_number, telemetry=True)
    corners = circuit_corners(session)
    if not corners:
        raise SessionDataError("Corner data isn't available for this session.")

    clean = clean_laps(driver_laps(session.laps, driver))
    if len(clean) < MIN_CLEAN_LAPS:
        raise _too_few(driver, len(clean))

    per_lap: Dict[int, List[Dict[str, Any]]] = {}
    for _, lap in clean.iterlaps():
        try:
            metrics = corner_metrics(_lap_telemetry(lap, driver), corners)
        except SessionDataError:
            continue  # a lap without telemetry is left out rather than failing the rest
        if metrics:
            per_lap[int(lap["LapNumber"])] = metrics
    if len(per_lap) < MIN_CLEAN_LAPS:
        raise _too_few(driver, len(per_lap))

    payload = {**summarise_consistency(corners, per_lap), "driver": {"code": driver, **driver_profile(session, driver)}}
    _cache[key] = (time.time(), payload)
    return payload
