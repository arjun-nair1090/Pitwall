"""A race replay on the real session clock.

One lap of the race is replayed as the leader ran it: every car is placed where it really was at
each moment of that lap, so the gaps between cars are the true gaps. (Replaying each driver's own
lap N from a common start would erase them: on a typical lap the field is spread over tens of
seconds.) Positions and car data are resampled onto one shared grid of moments, so the frontend
can play it back at any speed without lining anything up.
"""
import threading
from collections import OrderedDict
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

from app.services.session_info import SessionDataError, driver_profile, load_session

STEP_SECONDS = 0.5

# Stepping through a race asks for one lap after another. A session's position data is large and slow
# to load, so the few most recent races are kept in memory rather than reloaded for every lap.
_MAX_SESSIONS = 2
_sessions: "OrderedDict[Tuple, Any]" = OrderedDict()
_sessions_lock = threading.Lock()


def clear_cache() -> None:
    with _sessions_lock:
        _sessions.clear()


def _cached_session(year: int, gp: str, session_name: str, round_number: Optional[int]):
    key = (year, round_number or gp, session_name)
    with _sessions_lock:
        if key in _sessions:
            _sessions.move_to_end(key)
            return _sessions[key]
    session = load_session(year, gp, session_name, round_number, telemetry=True)
    with _sessions_lock:
        _sessions[key] = session
        while len(_sessions) > _MAX_SESSIONS:
            _sessions.popitem(last=False)
    return session


def _seconds(value: Any) -> Optional[float]:
    if value is None or pd.isna(value):
        return None
    return float(pd.Timedelta(value).total_seconds())


def lap_window(laps: pd.DataFrame, lap_number: int) -> Tuple[float, float]:
    """(start, end) of a lap on the session clock, in seconds: the lap as the leader ran it."""
    total = int(laps["LapNumber"].max())
    if lap_number < 1 or lap_number > total:
        raise SessionDataError(
            "Lap numbers start at 1." if lap_number < 1 else f"That race had only {total} laps."
        )

    rows = laps[laps["LapNumber"] == lap_number].dropna(subset=["Time"])
    if rows.empty:
        raise SessionDataError(f"There is no timing for lap {lap_number} of this race.")
    leader = rows.sort_values("Time").iloc[0]
    end = _seconds(leader["Time"])

    start = _seconds(leader.get("LapStartTime"))
    if start is None and _seconds(leader.get("LapTime")) is not None:
        start = end - _seconds(leader["LapTime"])
    if start is None and lap_number > 1:
        previous = laps[(laps["Driver"] == leader["Driver"]) & (laps["LapNumber"] == lap_number - 1)]
        if not previous.empty:
            start = _seconds(previous.iloc[0]["Time"])
    if start is None:
        starts = [s for s in (_seconds(v) for v in rows["LapStartTime"]) if s is not None]
        start = float(np.median(starts)) if starts else None
    if start is None or end is None or end <= start:
        raise SessionDataError(f"Couldn't work out when lap {lap_number} started and ended.")
    return start, end


def frame_times(duration: float, step: float = STEP_SECONDS) -> np.ndarray:
    """Moments 0, step, 2*step ... duration. Always finishes exactly on the end of the window."""
    times = np.arange(0.0, duration, step)
    return np.append(times, duration)


def interpolate(session_times: np.ndarray, values: np.ndarray, at: np.ndarray) -> np.ndarray:
    return np.interp(at, session_times, values.astype(float))


def hold(session_times: np.ndarray, values: np.ndarray, at: np.ndarray) -> np.ndarray:
    """The last known value at each moment, for channels that jump (gear, DRS, brake)."""
    index = np.searchsorted(session_times, at, side="right") - 1
    return values[np.clip(index, 0, len(values) - 1)]


def _to_seconds(series: pd.Series) -> np.ndarray:
    return series.dt.total_seconds().to_numpy(dtype=float)


def _ints(values: np.ndarray) -> List[int]:
    return [int(v) for v in np.rint(values)]


def _driver_frames(pos: pd.DataFrame, car: Optional[pd.DataFrame], moments: np.ndarray) -> Dict[str, List[int]]:
    pos_times = _to_seconds(pos["SessionTime"])
    frames = {
        "x": _ints(interpolate(pos_times, pos["X"].to_numpy(), moments)),
        "y": _ints(interpolate(pos_times, pos["Y"].to_numpy(), moments)),
    }
    if car is None or car.empty:
        zeros = [0] * len(moments)
        return {**frames, "speed": zeros, "throttle": zeros, "brake": zeros, "gear": zeros, "rpm": zeros, "drs": zeros}

    car_times = _to_seconds(car["SessionTime"])
    frames.update({
        "speed": _ints(interpolate(car_times, car["Speed"].to_numpy(), moments)),
        "throttle": _ints(interpolate(car_times, car["Throttle"].to_numpy(), moments)),
        "rpm": _ints(interpolate(car_times, car["RPM"].to_numpy(), moments)),
        "gear": [int(v) for v in hold(car_times, car["nGear"].to_numpy(), moments)],
        "brake": [int(bool(v)) for v in hold(car_times, car["Brake"].to_numpy(), moments)],
        "drs": [int(v) for v in hold(car_times, car["DRS"].to_numpy(), moments)],
    })
    return frames


def _order(lap_rows: pd.DataFrame, leader_end: float) -> List[Dict[str, Any]]:
    """Positions at the end of the lap, with each driver's gap to the leader and their tyres."""
    ranked = lap_rows.copy()
    ranked["_end"] = ranked["Time"].map(_seconds)
    ranked = ranked.sort_values(["Position", "_end"], na_position="last")
    order = []
    for index, (_, row) in enumerate(ranked.iterrows(), start=1):
        position = row.get("Position")
        lap_time = _seconds(row.get("LapTime"))
        end = row["_end"]
        tyre_age = row.get("TyreLife")
        compound = row.get("Compound")
        order.append({
            "code": str(row["Driver"]),
            "position": int(position) if position is not None and not pd.isna(position) else index,
            "gap_to_leader": round(end - leader_end, 3) if end is not None else None,
            "lap_time": lap_time,
            "compound": str(compound) if compound is not None and not pd.isna(compound) else None,
            "tyre_age": int(tyre_age) if tyre_age is not None and not pd.isna(tyre_age) else None,
            "in_pit": bool(pd.notna(row.get("PitInTime")) or pd.notna(row.get("PitOutTime"))),
        })
    return order


def replay_payload(
    year: int,
    gp: str,
    session_name: str,
    lap_number: int,
    round_number: Optional[int] = None,
    step: float = STEP_SECONDS,
) -> Dict[str, Any]:
    session = _cached_session(year, gp, session_name, round_number)
    laps = session.laps
    pos_data = getattr(session, "pos_data", None)
    if not pos_data:
        raise SessionDataError("This session has no position data, so it can't be replayed.")

    start, end = lap_window(laps, lap_number)
    duration = end - start
    times = frame_times(duration, step)
    moments = start + times
    car_data = getattr(session, "car_data", {}) or {}

    lap_rows = laps[laps["LapNumber"] == lap_number]
    order = _order(lap_rows, end)
    rank = {o["code"]: o["position"] for o in order}
    active = set(rank)

    numbers = laps.drop_duplicates("Driver").set_index("Driver")["DriverNumber"].astype(str).to_dict()
    drivers = []
    for code, number in numbers.items():
        pos = pos_data.get(number)
        if pos is None or pos.empty:
            continue
        profile = driver_profile(session, code)
        drivers.append({
            "code": code,
            "number": number,
            "name": profile["name"],
            "team": profile["team"],
            "color": profile["color"],
            "active": code in active,
            **_driver_frames(pos, car_data.get(number), moments),
        })
    if not drivers:
        raise SessionDataError("This session has no position data, so it can't be replayed.")
    drivers.sort(key=lambda d: (d["code"] not in active, rank.get(d["code"], 99), d["code"]))

    # The circuit outline: the leader's own line through the window, at the tracker's full rate.
    leader = next(d for d in drivers if d["active"]) if any(d["active"] for d in drivers) else drivers[0]
    leader_pos = pos_data[leader["number"]]
    pos_times = _to_seconds(leader_pos["SessionTime"])
    inside = (pos_times >= start) & (pos_times <= end)
    outline = {
        "x": _ints(leader_pos["X"].to_numpy(dtype=float)[inside]),
        "y": _ints(leader_pos["Y"].to_numpy(dtype=float)[inside]),
    }

    event = session.event
    return {
        "year": year,
        "round": int(event["RoundNumber"]) if "RoundNumber" in event and not pd.isna(event["RoundNumber"]) else round_number,
        "event_name": str(event["EventName"]) if "EventName" in event else gp,
        "lap": lap_number,
        "total_laps": int(laps["LapNumber"].max()),
        "step": step,
        "duration": round(float(duration), 3),
        "frames": int(len(times)),
        "drivers": drivers,
        "order": order,
        "outline": outline,
    }
