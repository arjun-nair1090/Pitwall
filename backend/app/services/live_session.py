"""Which session the live page shows, and its timing board, from OpenF1 records.

Pure functions: f1_data_service fetches the records and caches them, this module decides what they
mean. A session is live from its start until a little after its scheduled end (sessions overrun);
otherwise the page shows the most recent session that has started, never one still to come.
"""
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd

# Sessions run long (red flags, a late start), so a session counts as live this long after its
# scheduled end.
LIVE_GRACE = timedelta(minutes=15)
NEUTRAL_COLOUR = "#7f7f7f"


def _parse(value: Any) -> Optional[datetime]:
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


def pick_session(sessions: List[Dict[str, Any]], now: datetime) -> Optional[Tuple[Dict[str, Any], bool]]:
    """The session running now (live) or else the most recent one to have started, or None."""
    started = []
    for s in sessions or []:
        if not isinstance(s, dict) or s.get("is_cancelled"):
            continue
        start, end = _parse(s.get("date_start")), _parse(s.get("date_end"))
        if start is None or end is None or start > now:
            continue
        started.append((start, end, s))
    if not started:
        return None
    start, end, latest = max(started, key=lambda item: item[0])
    return latest, now <= end + LIVE_GRACE


def session_metadata(session: Dict[str, Any], meeting: Optional[Dict[str, Any]], live: bool) -> Dict[str, Any]:
    circuit = session.get("circuit_short_name") or session.get("location") or ""
    return {
        "session_key": session["session_key"],
        "year": session.get("year"),
        "location": session.get("location"),
        "country": session.get("country_name"),
        "circuit_name": circuit,
        "circuit_short_name": circuit,
        "meeting_name": (meeting or {}).get("meeting_name") or circuit,
        "session_name": session.get("session_name"),
        "date_start": session.get("date_start"),
        "date_end": session.get("date_end"),
        "live": live,
        "source": "openf1",
    }


def driver_entry(d: Dict[str, Any]) -> Dict[str, Any]:
    colour = d.get("team_colour") or d.get("team_color")
    return {
        "driver_number": d["driver_number"],
        "code": d.get("name_acronym") or d.get("code") or "UNK",
        "first_name": d.get("first_name") or "",
        "last_name": d.get("last_name") or "",
        "full_name": d.get("full_name") or d.get("broadcast_name") or "",
        "team_name": d.get("team_name") or "Unknown",
        "team_color": f"#{str(colour).lstrip('#')}" if colour else NEUTRAL_COLOUR,
        "country_code": d.get("country_code") or "",
    }


def _latest_by(records: List[Dict[str, Any]], key: str) -> Dict[str, Dict[str, Any]]:
    """Each driver's record with the highest `key` (date or lap number)."""
    latest: Dict[str, Dict[str, Any]] = {}
    for r in records or []:
        if not isinstance(r, dict) or r.get("driver_number") is None or r.get(key) is None:
            continue
        num = str(r["driver_number"])
        if num not in latest or r[key] >= latest[num][key]:
            latest[num] = r
    return latest


def build_leaderboard(laps, stints, intervals, positions) -> Dict[str, Dict[str, Any]]:
    """The timing board: one row per driver with a lap, keyed by car number."""
    last_laps = _latest_by(laps, "lap_number")
    last_stints = _latest_by(stints, "stint_number")
    last_intervals = _latest_by(intervals, "date")
    last_positions = _latest_by(positions, "date")

    board = {}
    for num, lap in last_laps.items():
        stint = last_stints.get(num) or {}
        interval = last_intervals.get(num) or {}
        tyre_age = None
        if stint:
            laps_on_stint = (stint["lap_end"] - stint["lap_start"] + 1) if stint.get("lap_end") and stint.get("lap_start") else 0
            tyre_age = (stint.get("tyre_age_at_start") or 0) + laps_on_stint
        gap = interval.get("gap_to_leader")
        board[num] = {
            "position": (last_positions.get(num) or {}).get("position"),
            "lap_number": lap.get("lap_number"),
            "last_lap_time": lap.get("lap_duration"),
            "s1": lap.get("duration_sector_1"),
            "s2": lap.get("duration_sector_2"),
            "s3": lap.get("duration_sector_3"),
            "compound": stint.get("compound"),
            "tyre_age": tyre_age,
            "gap_to_leader": gap,
            # the leader has no car ahead; OpenF1 reports 0 for it
            "gap_to_next": None if gap == 0 else interval.get("interval"),
            "is_pit": lap.get("lap_duration") is None,
        }
    return board


def _seconds(value: Any) -> Optional[float]:
    return value.total_seconds() if pd.notna(value) else None


def fastf1_leaderboard(results: pd.DataFrame, laps: pd.DataFrame) -> Dict[str, Dict[str, Any]]:
    """The final classification of a FastF1 race, in the same shape as build_leaderboard.

    Results give the order and gaps: the winner's Time is the race time, everyone else's is their gap
    to the winner; a lapped car has no Time and a Status such as "+1 Lap".
    """
    board = {}
    previous_gap: Optional[float] = None
    for _, row in results.sort_values("Position").iterrows():
        num = str(row["DriverNumber"])
        position = int(row["Position"]) if pd.notna(row["Position"]) else None
        status = str(row.get("Status") or "")
        if position == 1:
            gap: Any = 0.0
        elif pd.notna(row.get("Time")):
            gap = round(row["Time"].total_seconds(), 3)
        elif status.startswith("+"):
            gap = status.upper()
        else:
            gap = None
        interval = None
        if isinstance(gap, float) and isinstance(previous_gap, float) and position != 1:
            interval = round(gap - previous_gap, 3)
        previous_gap = gap if isinstance(gap, float) else None

        driver_laps = laps[laps["DriverNumber"].astype(str) == num].sort_values("LapNumber")
        last = driver_laps.iloc[-1] if not driver_laps.empty else None
        board[num] = {
            "position": position,
            "lap_number": int(last["LapNumber"]) if last is not None else None,
            "last_lap_time": _seconds(last["LapTime"]) if last is not None else None,
            "s1": _seconds(last["Sector1Time"]) if last is not None else None,
            "s2": _seconds(last["Sector2Time"]) if last is not None else None,
            "s3": _seconds(last["Sector3Time"]) if last is not None else None,
            "compound": last["Compound"] if last is not None and pd.notna(last["Compound"]) else None,
            "tyre_age": int(last["TyreLife"]) if last is not None and pd.notna(last["TyreLife"]) else None,
            "gap_to_leader": gap,
            "gap_to_next": interval,
            "is_pit": bool(last is not None and pd.isna(last["LapTime"])),
        }
    return board


def fastf1_driver_entries(results: pd.DataFrame) -> List[Dict[str, Any]]:
    entries = []
    for _, row in results.iterrows():
        colour = row.get("TeamColor")
        entries.append({
            "driver_number": int(row["DriverNumber"]),
            "code": row.get("Abbreviation") or "UNK",
            "first_name": row.get("FirstName") or "",
            "last_name": row.get("LastName") or "",
            "full_name": row.get("FullName") or "",
            "team_name": row.get("TeamName") or "Unknown",
            "team_color": f"#{str(colour).lstrip('#')}" if isinstance(colour, str) and colour else NEUTRAL_COLOUR,
            "country_code": row.get("CountryCode") if isinstance(row.get("CountryCode"), str) else "",
        })
    return entries


def fastf1_race_control(messages: Optional[pd.DataFrame], limit: int = 20) -> List[Dict[str, Any]]:
    """Race control messages, newest first. FastF1 times are UTC without a zone."""
    if messages is None or messages.empty:
        return []
    out = []
    for _, m in messages.sort_values("Time", ascending=False).head(limit).iterrows():
        flag = m.get("Flag")
        out.append({
            "timestamp": m["Time"].tz_localize("UTC").isoformat() if pd.notna(m["Time"]) else None,
            "category": m.get("Category"),
            "message": m.get("Message"),
            "flag": flag if isinstance(flag, str) and flag else None,
        })
    return out


def apply_classification(board: Dict[str, Dict[str, Any]], results: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """A finished session's official result over its timing board: final positions and gaps, and
    DNF/DNS/DSQ in place of the stale gap a car had when it stopped."""
    out = {num: dict(row) for num, row in board.items()}
    classified = []
    for r in results or []:
        num = str(r.get("driver_number"))
        if num not in out:
            continue
        row = out[num]
        outcome = "DSQ" if r.get("dsq") else "DNF" if r.get("dnf") else "DNS" if r.get("dns") else None
        # a car that retired after 90% of the distance is still classified, and keeps its place
        position = None if r.get("dsq") or r.get("dns") else r.get("position")
        if position is None:
            row.update(position=None, gap_to_leader=outcome, gap_to_next=None)
            continue
        row.update(position=position, gap_to_leader=outcome or r.get("gap_to_leader"), gap_to_next=None)
        classified.append(row)

    classified.sort(key=lambda row: row["position"])
    for ahead, row in zip(classified, classified[1:]):
        a, b = ahead["gap_to_leader"], row["gap_to_leader"]
        if isinstance(a, (int, float)) and isinstance(b, (int, float)):
            row["gap_to_next"] = round(b - a, 3)
    return out
