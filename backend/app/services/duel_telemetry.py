"""Head-to-head, dominance and pedal-behaviour analysis over FastF1 lap telemetry.

The maths lives in small pure functions over telemetry frames so it can be tested without a
network; the three ``*_payload`` orchestrators load a session, pick laps and call them.
"""
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

from app.services.session_info import (
    SessionDataError,
    driver_profile,
    load_session,
    pick_lap,
)

DEFAULT_SECTOR_METRES = 50


def acceleration(tel: pd.DataFrame) -> np.ndarray:
    """Longitudinal acceleration in m/s^2, from speed (km/h) against time."""
    if len(tel) < 2:
        return np.zeros(len(tel))
    time_seconds = tel["Time"].dt.total_seconds().to_numpy(dtype=float)
    speed_ms = tel["Speed"].to_numpy(dtype=float) / 3.6
    time_step = np.gradient(time_seconds)
    time_step[time_step == 0] = 0.001  # repeated timestamps would divide by zero
    return np.gradient(speed_ms) / time_step


def _num(value: Any, cast=float, default=0):
    return cast(value) if pd.notna(value) else default


def telemetry_points(tel: pd.DataFrame) -> List[Dict[str, float]]:
    """One dict per telemetry sample, with every channel the charts use. Gaps become zero."""
    accel = acceleration(tel)
    return [
        {
            "distance": _num(d, float, 0.0),
            "speed": _num(s, float, 0.0),
            "throttle": _num(t, float, 0.0),
            "brake": _num(b, float, 0.0),
            "gear": _num(g, int, 0),
            "rpm": _num(r, int, 0),
            "drs": _num(drs, int, 0),
            "time": float(time.total_seconds()) if pd.notna(time) else 0.0,
            "x": _num(x, float, 0.0),
            "y": _num(y, float, 0.0),
            "acceleration": _num(a, float, 0.0),
        }
        for d, s, t, b, g, r, drs, time, x, y, a in zip(
            tel["Distance"], tel["Speed"], tel["Throttle"], tel["Brake"], tel["nGear"],
            tel["RPM"], tel["DRS"], tel["Time"], tel["X"], tel["Y"], accel,
        )
    ]


def pedal_shares(tel: pd.DataFrame) -> Optional[Dict[str, float]]:
    """Share of a lap spent throttle-only, brake-only, both, or neither. None if it can't be timed."""
    if len(tel) < 2:
        return None
    step = tel["Time"].dt.total_seconds().diff().fillna(0)
    total = float(step.sum())
    if total <= 0:
        return None
    throttle = tel["Throttle"] > 0
    brake = tel["Brake"].astype(bool)

    def share(mask: pd.Series) -> float:
        return float(step[mask].sum() / total * 100)

    return {
        "throttle_pct": share(throttle & ~brake),
        "brake_pct": share(brake & ~throttle),
        "both_pct": share(brake & throttle),
        "coast_pct": share(~brake & ~throttle),
    }


def dominance_segments(
    tel1: pd.DataFrame,
    tel2: pd.DataFrame,
    code1: str,
    code2: str,
    color1: str,
    color2: str,
    sector_m: int = DEFAULT_SECTOR_METRES,
) -> List[Dict[str, Any]]:
    """Split the lap into mini-sectors and say which driver carried more speed through each.
    Ties go to the first driver. Positions come from the first driver's line."""
    max_distance = float(max(tel1["Distance"].max(), tel2["Distance"].max()))
    if not np.isfinite(max_distance) or max_distance <= 0:
        return []
    count = max(int(max_distance // sector_m), 1)
    edges = np.linspace(0, max_distance, count + 1)

    sector1 = pd.cut(tel1["Distance"], edges, labels=False, include_lowest=True)
    sector2 = pd.cut(tel2["Distance"], edges, labels=False, include_lowest=True)
    speed1 = tel1.groupby(sector1)["Speed"].mean()
    speed2 = tel2.groupby(sector2)["Speed"].mean()
    xs = tel1.groupby(sector1)["X"].mean()
    ys = tel1.groupby(sector1)["Y"].mean()

    segments = []
    for i in range(count):
        if i not in speed1.index or i not in speed2.index or i not in xs.index:
            continue
        s1, s2 = float(speed1[i]), float(speed2[i])
        if np.isnan(s1) or np.isnan(s2) or np.isnan(xs[i]) or np.isnan(ys[i]):
            continue
        first = s1 >= s2
        segments.append({
            "minisector": i,
            "x": float(xs[i]),
            "y": float(ys[i]),
            "dominant": 1 if first else 2,
            "dominant_driver": code1 if first else code2,
            "color": color1 if first else color2,
            "speed_delta": abs(s1 - s2),
        })
    return segments


def _lap_telemetry(lap: pd.Series, code: str) -> pd.DataFrame:
    number = int(lap["LapNumber"])
    try:
        tel = lap.get_telemetry()
    except Exception as e:
        raise SessionDataError(f"Telemetry for {code}'s lap {number} isn't available.") from e
    if tel is None or tel.empty:
        raise SessionDataError(f"No telemetry was recorded for {code}'s lap {number}.")
    return tel


def _duel(
    year: int, gp: str, session_name: str, driver1: str, driver2: str,
    lap1: Optional[int], lap2: Optional[int], round_number: Optional[int],
) -> Tuple[Any, pd.Series, pd.DataFrame, pd.Series, pd.DataFrame]:
    session = load_session(year, gp, session_name, round_number, telemetry=True)
    row1 = pick_lap(session.laps, driver1, lap1)
    row2 = pick_lap(session.laps, driver2, lap2)
    return session, row1, _lap_telemetry(row1, driver1), row2, _lap_telemetry(row2, driver2)


def _driver_payload(session, code: str, lap: pd.Series, tel: pd.DataFrame) -> Dict[str, Any]:
    profile = driver_profile(session, code)
    return {
        "code": code,
        "name": profile["name"],
        "team": profile["team"],
        "color": profile["color"],
        "lap_number": int(lap["LapNumber"]),
        "lap_time": float(lap["LapTime"].total_seconds()) if pd.notna(lap["LapTime"]) else None,
        "compound": str(lap["Compound"]) if "Compound" in lap.index and pd.notna(lap["Compound"]) else "Unknown",
        "telemetry": telemetry_points(tel),
    }


def head_to_head_payload(
    year: int, gp: str, session_name: str, driver1: str, driver2: str,
    driver1_lap: Optional[int] = None, driver2_lap: Optional[int] = None,
    round_number: Optional[int] = None,
) -> Dict[str, Any]:
    session, lap1, tel1, lap2, tel2 = _duel(year, gp, session_name, driver1, driver2, driver1_lap, driver2_lap, round_number)
    return {
        "driver1": _driver_payload(session, driver1, lap1, tel1),
        "driver2": _driver_payload(session, driver2, lap2, tel2),
    }


def dominance_payload(
    year: int, gp: str, session_name: str, driver1: str, driver2: str,
    driver1_lap: Optional[int] = None, driver2_lap: Optional[int] = None,
    round_number: Optional[int] = None,
) -> Dict[str, Any]:
    session, _, tel1, _, tel2 = _duel(year, gp, session_name, driver1, driver2, driver1_lap, driver2_lap, round_number)
    p1, p2 = driver_profile(session, driver1), driver_profile(session, driver2)
    return {
        "driver1": {"code": driver1, "color": p1["color"]},
        "driver2": {"code": driver2, "color": p2["color"]},
        "dominance": dominance_segments(tel1, tel2, driver1, driver2, p1["color"], p2["color"]),
    }


def pedal_behavior_payload(year: int, gp: str, session_name: str, round_number: Optional[int] = None) -> Dict[str, Any]:
    """Pedal-state shares over each driver's fastest lap, quickest first."""
    session = load_session(year, gp, session_name, round_number, telemetry=True)
    rows = []
    for code in session.laps["Driver"].dropna().unique():
        try:
            lap = pick_lap(session.laps, str(code))
            shares = pedal_shares(_lap_telemetry(lap, str(code)))
        except SessionDataError:
            continue  # no timed lap or no telemetry for this driver: leave them out
        if shares is None:
            continue
        profile = driver_profile(session, str(code))
        rows.append({
            "driver_code": str(code),
            "name": profile["name"],
            "team": profile["team"],
            "color": profile["color"],
            "lap_time": float(lap["LapTime"].total_seconds()),
            **shares,
        })
    if not rows:
        raise SessionDataError("No lap telemetry is available for this session.")
    rows.sort(key=lambda r: r["lap_time"])
    return {"data": rows}
