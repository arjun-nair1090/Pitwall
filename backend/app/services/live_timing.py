"""F1's own live timing feed (livetiming.formula1.com), the source for live sessions.

OpenF1 locks every request (past sessions included) behind a paid key while a session is running,
so live data comes from here instead. The feed is a SignalR hub: subscribing returns a snapshot of
every topic, then each change arrives as a patch to merge into it. Lists are patched as dicts keyed
by index ({"Sectors": {"0": {...}}}). Without an F1 TV login the hub sends timing, tyres, weather,
race control and team radio, but not car telemetry (CarData.z) or car positions (Position.z). With the
token from `python -m fastf1 auth f1tv --authenticate`, it sends those two as well.
"""
import base64
import copy
import json
import re
import zlib
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import requests

NEGOTIATE_URL = "https://livetiming.formula1.com/signalrcore/negotiate"
CONNECTION_URL = "wss://livetiming.formula1.com/signalrcore"
STATIC_URL = "https://livetiming.formula1.com/static/"
TOPICS = [
    "Heartbeat", "DriverList", "ExtrapolatedClock", "RaceControlMessages", "SessionInfo",
    "SessionStatus", "TeamRadio", "TimingAppData", "TimingStats", "TrackStatus", "WeatherData",
    "SessionData", "TimingData", "TopThree", "LapCount",
]
# Only sent to an F1 TV subscriber.
CAR_TOPICS = ["Position.z", "CarData.z"]
# CarData channel numbers.
RPM, SPEED, GEAR, THROTTLE, BRAKE, DRS = "0", "2", "3", "4", "5", "45"
# Pedal channels are 0-100; a car with no reading (parked, in the garage) reports 104.
NO_PEDAL_READING = 100
# A qualifying lap slower than this share of the fastest is a cool-down lap or a lap through a red
# flag, not a timed attempt (the same 107% the sport uses for a representative lap).
PUSH_LAP_LIMIT = 1.07
# Race control sets a restart in track time: "SQ1 WILL RESUME AT 20:46", "SQ2 WILL START AT 21:11".
RESTART_PATTERN = re.compile(r"\bWILL (?:RESUME|RESTART|START) AT (\d{1,2}):(\d{2})\b")
DELAY_PATTERN = re.compile(r"\bWILL BE DELAYED\b|\bSUSPENDED\b")
# "CAR 6 (HAD) TIME 1:32.048 DELETED - TRACK LIMITS ...": a lap the stewards struck off.
DELETED_LAP_PATTERN = re.compile(r"\bCAR (\d+) \(\w+\) TIME (\d+:\d+\.\d+) DELETED\b")
# Statuses after which the session is over and its timing is no longer worth showing as live.
CLOSED_STATUSES = {"Finalised", "Ends"}
# The hub sends a Heartbeat every few seconds, so this long without a message means the link is dead.
STALE_AFTER_SECONDS = 60
RECONNECT_DELAY_SECONDS = 30


# --- Merging -------------------------------------------------------------------------------------

def _merge(target: Any, patch: Any) -> Any:
    """Merge a feed patch into the current value and return the result."""
    if isinstance(patch, dict) and isinstance(target, list):
        merged = list(target)
        for key, value in patch.items():
            if not str(key).isdigit():
                continue
            index = int(key)
            while len(merged) <= index:
                merged.append({})
            merged[index] = _merge(merged[index], value)
        return merged
    if isinstance(patch, dict) and isinstance(target, dict):
        merged = dict(target)
        for key, value in patch.items():
            merged[key] = _merge(merged.get(key), value)
        return merged
    return copy.deepcopy(patch)


def _inflate(data: Any) -> Optional[Dict[str, Any]]:
    """The car topics are base64 raw-deflate JSON."""
    try:
        return json.loads(zlib.decompress(base64.b64decode(data), -zlib.MAX_WBITS))
    except (TypeError, ValueError, zlib.error):
        return None


def _apply_car_message(state: Dict[str, Any], topic: str, data: Any) -> None:
    """Each car message is a batch of samples, not a patch: keep only the latest sample per car."""
    batch = _inflate(data)
    if not batch:
        return
    cars = state.setdefault("_cars", {"positions": {}, "telemetry": {}})
    if topic == "Position.z":
        for sample in batch.get("Position") or []:
            for number, entry in (sample.get("Entries") or {}).items():
                cars["positions"][number] = {**entry, "Timestamp": sample.get("Timestamp")}
    else:
        for sample in batch.get("Entries") or []:
            for number, car in (sample.get("Cars") or {}).items():
                cars["telemetry"][number] = car.get("Channels") or {}


def _track_laps(state: Dict[str, Any], data: Dict[str, Any]) -> None:
    """Keep each driver's last real lap for qualifying, where the tower should never show an out lap
    (started from the pit lane), an in lap (ended in it), or a cool-down lap.

    The pit flags only describe the car right now, so they are remembered across the lap: a lap
    that was flagged PitOut or InPit at any point before it completed is not a timed attempt."""
    laps = state.setdefault("_laps", {})
    lines = data.get("Lines") if isinstance(data.get("Lines"), dict) else {}
    previous = (state.get("TimingData") or {}).get("Lines") or {}

    def fastest() -> Optional[float]:
        times = [e["push"] for e in laps.values() if e.get("push")]
        return min(times) if times else None

    if "TimingData" not in state:
        # A snapshot: joining mid-session there is no lap history, so accept each driver's last lap
        # unless it is far off the field's best.
        bests = [_seconds(_value(l.get("BestLapTime"))) for l in lines.values() if isinstance(l, dict)]
        reference = min((t for t in bests if t), default=None)
        for number, line in lines.items():
            if not isinstance(line, dict):
                continue
            last = _seconds(_value(line.get("LastLapTime")))
            laps[number] = {
                "from_pit": bool(line.get("PitOut") or line.get("InPit")),
                "pit_in": False,
                "push": last if last and (reference is None or last <= reference * PUSH_LAP_LIMIT) else None,
            }
        return

    for number, line in lines.items():
        if not isinstance(line, dict):
            continue
        before = previous.get(number) or {}
        entry = laps.setdefault(number, {"from_pit": False, "pit_in": False, "push": None})
        pit_out = line.get("PitOut", before.get("PitOut"))
        in_pit = line.get("InPit", before.get("InPit"))
        entry["from_pit"] = entry["from_pit"] or bool(pit_out)
        entry["pit_in"] = entry["pit_in"] or bool(in_pit)

        lap_text = _value(line.get("LastLapTime"))
        if not lap_text or lap_text == _value(before.get("LastLapTime")):
            continue  # no lap completed in this patch

        lap = _seconds(lap_text)
        reference = fastest()
        real = not entry["from_pit"] and not entry["pit_in"]
        if lap and real and (reference is None or lap <= reference * PUSH_LAP_LIMIT):
            entry["push"] = lap
        # The next lap starts from the pits if the car is still in (or leaving) the pit lane.
        entry["from_pit"] = bool(pit_out or in_pit)
        entry["pit_in"] = False


def _lap_start(state: Dict[str, Any], number: str, from_pit: bool) -> None:
    """Begin a driver's next lap: whether it starts from the pit lane, and the track status so far."""
    status = str((state.get("TrackStatus") or {}).get("Status") or "1")
    state.setdefault("_lapacc", {})[number] = {"pit_out": from_pit, "track": {status}}


def _record_laps(state: Dict[str, Any], data: Dict[str, Any], at: Optional[str]) -> None:
    """Keep a row for every lap a driver completes, in the shape the tyre model and the forecasts
    read: lap time, tyre and age, stint, whether it was a lap into or out of the pits, the track
    statuses it ran under, and the place at its end.

    A lap into the pits is one that ends in the pit lane (the line runs across it); the next lap then
    starts from it. The flags are only read at the line, as the cars also run in and out of the pit
    lane before the start."""
    lines = data.get("Lines") if isinstance(data.get("Lines"), dict) else {}
    if "TimingData" not in state:
        # A snapshot: no lap has been seen completing yet; note where each car is starting its lap.
        for number, line in lines.items():
            if isinstance(line, dict):
                _lap_start(state, number, bool(line.get("InPit") or line.get("PitOut")))
        return

    previous = (state.get("TimingData") or {}).get("Lines") or {}
    app_lines = (state.get("TimingAppData") or {}).get("Lines") or {}
    history = state.setdefault("_history", {})
    for number, line in lines.items():
        if not isinstance(line, dict):
            continue
        before = previous.get(number) or {}
        acc = state.setdefault("_lapacc", {}).get(number)
        if acc is None:
            _lap_start(state, number, bool(before.get("InPit") or before.get("PitOut")))
            acc = state["_lapacc"][number]
        if line.get("PitOut"):
            acc["pit_out"] = True

        laps = line.get("NumberOfLaps")
        if not isinstance(laps, int) or laps <= (before.get("NumberOfLaps") or 0):
            continue
        in_pit = bool(line.get("InPit", before.get("InPit")))
        pit_out = bool(line.get("PitOut", before.get("PitOut")))
        stints = [s for s in _as_list((app_lines.get(number) or {}).get("Stints")) if isinstance(s, dict)]
        stint = stints[-1] if stints else {}
        position = line.get("Position", before.get("Position"))
        compound = stint.get("Compound")
        # Only changed fields are sent, so a lap exactly as quick as the last comes without a time.
        lap_time = line["LastLapTime"] if "LastLapTime" in line else before.get("LastLapTime")
        history.setdefault(number, []).append({
            "lap": laps,
            "lap_time": _seconds(_value(lap_time)),
            "compound": compound if compound and compound != "UNKNOWN" else None,
            "tyre_age": stint.get("TotalLaps"),
            "start_laps": stint.get("StartLaps"),
            "stint": len(stints) or None,
            "pit_in": in_pit,
            "pit_out": acc["pit_out"],
            "track": "".join(sorted(acc["track"])),
            "position": int(position) if str(position or "").isdigit() else None,
            "time": at,
        })
        _lap_start(state, number, in_pit or pit_out)


def apply_message(state: Dict[str, Any], topic: str, data: Any, at: Optional[str] = None) -> None:
    """Merge one topic's snapshot or patch into the state. `at` is the message's UTC time."""
    if topic in CAR_TOPICS:
        _apply_car_message(state, topic, data)
        return
    if not isinstance(data, dict):
        return
    if topic == "TimingData":
        _track_laps(state, data)
        _record_laps(state, data, at)
    state[topic] = _merge(state.get(topic, {}), data)
    if topic == "TrackStatus" and data.get("Status"):
        for acc in (state.get("_lapacc") or {}).values():
            acc["track"].add(str(data["Status"]))
    if topic == "SessionStatus" and data.get("Status") == "Started":
        # Lights out (or a restart): the laps start now, so nothing from before them counts.
        lines = (state.get("TimingData") or {}).get("Lines") or {}
        for number in list(state.get("_lapacc") or {}):
            line = lines.get(number) or {}
            _lap_start(state, number, bool(line.get("InPit") or line.get("PitOut")))


# --- Parsing -------------------------------------------------------------------------------------

def _as_list(value: Any) -> List[Any]:
    """A list in the feed can arrive as a dict keyed by index; return it as a list either way."""
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        return [value[k] for k in sorted((k for k in value if str(k).isdigit()), key=int)]
    return []


def _number(value: Any) -> Optional[float]:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _seconds(text: Any) -> Optional[float]:
    """Parse "1:30.606" or "28.101" to seconds; "" or anything else is None."""
    if not isinstance(text, str) or not text.strip():
        return None
    try:
        total = 0.0
        for part in text.strip().split(":"):
            total = total * 60 + float(part)
        return round(total, 3)
    except ValueError:
        return None


def _gap(text: Any) -> Optional[float]:
    """Parse a gap: "+0.214" is 0.214, the leader's "LAP 12" is 0. A lapped gap ("1L") has no number."""
    if not isinstance(text, str) or not text.strip():
        return None
    if text.upper().startswith("LAP"):
        return 0.0
    return _number(text.strip().lstrip("+"))


def _value(field: Any) -> Any:
    return field.get("Value") if isinstance(field, dict) else field


def _qualifying_stat(line: Dict[str, Any], key: str, part: Optional[int]) -> Any:
    """In qualifying the gaps live in Stats, one entry per part (Q1, Q2, Q3). A driver still running
    is timed against the current part (where the fastest driver's own gap is blank); a driver who was
    knocked out keeps the gap from the last part they ran."""
    stats = _as_list(line.get("Stats"))
    if part and not line.get("KnockedOut") and 0 < part <= len(stats):
        stat = stats[part - 1]
        return stat.get(key) if isinstance(stat, dict) else None
    for stat in reversed(stats):
        if isinstance(stat, dict) and stat.get(key):
            return stat[key]
    return None


def _gmt_offset(info: Dict[str, Any]) -> timedelta:
    """The track's offset from UTC, from SessionInfo's "08:00:00" (or "-05:00:00")."""
    text = str(info.get("GmtOffset", "0:0:0"))
    try:
        hours, minutes, seconds = (int(p) for p in text.lstrip("-").split(":"))
    except ValueError:
        return timedelta()
    offset = timedelta(hours=hours, minutes=minutes, seconds=seconds)
    return -offset if text.startswith("-") else offset


def _utc(text: Any) -> Optional[datetime]:
    """Parse a feed timestamp ("2026-10-09T12:42:13" or "...12:46:00.11Z"); both are UTC."""
    try:
        moment = datetime.fromisoformat(str(text).replace("Z", "+00:00"))
    except ValueError:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def _best_lap(line: Dict[str, Any]) -> Optional[float]:
    """A driver's best valid lap: this qualifying part's (BestLapTime), else the best from the last
    part they set a valid lap in (BestLapTimes), e.g. when their only lap this part was deleted."""
    return _seconds(_value(line.get("BestLapTime"))) or next(
        (t for t in (_seconds(_value(b)) for b in reversed(_as_list(line.get("BestLapTimes")))) if t), None
    )


def session_from_state(state: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    info = state.get("SessionInfo") or {}
    if not info.get("Key"):
        return None
    meeting = info.get("Meeting") or {}
    offset = _gmt_offset(info)

    def to_utc(local: Any) -> Optional[str]:
        try:
            return (datetime.fromisoformat(local) - offset).replace(tzinfo=timezone.utc).isoformat()
        except (TypeError, ValueError):
            return None

    start = to_utc(info.get("StartDate"))
    return {
        "session_key": int(info["Key"]),
        "year": int(start[:4]) if start else datetime.now(timezone.utc).year,
        "location": meeting.get("Location"),
        "country": (meeting.get("Country") or {}).get("Name"),
        "circuit_name": meeting.get("Name"),
        "meeting_name": meeting.get("Name"),
        "circuit_short_name": (meeting.get("Circuit") or {}).get("ShortName"),
        "session_name": info.get("Name"),
        "session_type": info.get("Type"),
        "date_start": start,
        "date_end": to_utc(info.get("EndDate")),
    }


def is_session_active(state: Dict[str, Any]) -> bool:
    if session_from_state(state) is None:
        return False
    status = (state.get("SessionStatus") or {}).get("Status")
    return status not in CLOSED_STATUSES


def session_status_from_state(state: Dict[str, Any]) -> Dict[str, Any]:
    """Whether the session is stopped (red flag, suspended, or a delayed restart between qualifying
    parts) and, once race control has announced it, when it restarts, in UTC."""
    status = (state.get("SessionStatus") or {}).get("Status")
    track = state.get("TrackStatus") or {}
    red_flag = track.get("Status") == "5" or track.get("Message") == "Red"

    series = [e for e in _as_list((state.get("SessionData") or {}).get("StatusSeries")) if isinstance(e, dict)]
    starts = [t for t in (_utc(e.get("Utc")) for e in series if e.get("SessionStatus") == "Started") if t]
    last_start = max(starts, default=None)

    # The latest restart or delay notice made since the session last ran.
    announcement = None
    messages = [m for m in _as_list((state.get("RaceControlMessages") or {}).get("Messages")) if isinstance(m, dict)]
    for message in messages:
        sent = _utc(message.get("Utc"))
        text = message.get("Message") or ""
        if not sent or (last_start is not None and sent <= last_start):
            continue
        if not (RESTART_PATTERN.search(text) or DELAY_PATTERN.search(text)):
            continue
        if announcement is None or sent >= _utc(announcement.get("Utc")):
            announcement = message

    stopped = (
        red_flag
        or status == "Aborted"
        or (status == "Inactive" and last_start is not None)
        or (status == "Finished" and announcement is not None)
    )
    if not stopped:
        return {"stopped": False, "red_flag": False, "announcement": None, "resumes_at": None}

    resumes_at = None
    match = RESTART_PATTERN.search(announcement.get("Message", "")) if announcement else None
    if match:
        offset = _gmt_offset(state.get("SessionInfo") or {})
        local_sent = _utc(announcement.get("Utc")) + offset
        local_restart = local_sent.replace(hour=int(match.group(1)), minute=int(match.group(2)), second=0, microsecond=0)
        if local_restart < local_sent - timedelta(hours=12):
            local_restart += timedelta(days=1)  # announced before midnight for a restart after it
        resumes_at = (local_restart - offset).isoformat()

    return {
        "stopped": True,
        "red_flag": red_flag,
        "announcement": announcement.get("Message") if announcement else None,
        "resumes_at": resumes_at,
    }


def drivers_from_state(state: Dict[str, Any]) -> List[Dict[str, Any]]:
    drivers = []
    for number, d in (state.get("DriverList") or {}).items():
        if not str(number).isdigit() or not isinstance(d, dict):
            continue
        colour = d.get("TeamColour") or "7f7f7f"
        drivers.append({
            "driver_number": int(number),
            "code": d.get("Tla", "UNK"),
            "first_name": d.get("FirstName", ""),
            "last_name": d.get("LastName", ""),
            "full_name": d.get("FullName", ""),
            "team_name": d.get("TeamName", "Unknown"),
            "team_color": colour if colour.startswith("#") else f"#{colour}",
            "country_code": "",
        })
    return drivers


def timing_from_state(state: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    app_lines = (state.get("TimingAppData") or {}).get("Lines") or {}
    is_qualifying = (state.get("SessionInfo") or {}).get("Type") == "Qualifying"
    lines = (state.get("TimingData") or {}).get("Lines") or {}
    part = (state.get("TimingData") or {}).get("SessionPart")
    field_best = min((t for t in (_best_lap(l) for l in lines.values() if isinstance(l, dict)) if t), default=None)
    deleted = set()
    for message in _as_list((state.get("RaceControlMessages") or {}).get("Messages")):
        match = DELETED_LAP_PATTERN.search(message.get("Message") or "") if isinstance(message, dict) else None
        if match:
            deleted.add((match.group(1), _seconds(match.group(2))))
    timing = {}
    for number, line in lines.items():
        if not isinstance(line, dict):
            continue
        sectors = _as_list(line.get("Sectors"))
        sector = lambda i: _seconds(_value(sectors[i])) if i < len(sectors) else None
        position = int(line["Position"]) if str(line.get("Position", "")).isdigit() else None

        # Race: GapToLeader / IntervalToPositionAhead. Practice: TimeDiffToFastest / TimeDiffToPositionAhead.
        # Qualifying: the same two, per part, under Stats. The leader's own gap is blank, so it is zero.
        gap_text = (_value(line.get("GapToLeader")) or line.get("TimeDiffToFastest")
                    or _qualifying_stat(line, "TimeDiffToFastest", part))
        interval_text = (_value(line.get("IntervalToPositionAhead")) or _value(line.get("TimeDiffToPositionAhead"))
                         or _qualifying_stat(line, "TimeDifftoPositionAhead", part))
        gap_to_leader = 0.0 if position == 1 and not gap_text else _gap(gap_text)
        gap_to_next = None if position == 1 else _gap(interval_text)

        stints = [s for s in _as_list((app_lines.get(number) or {}).get("Stints")) if isinstance(s, dict)]
        stint = stints[-1] if stints else {}
        compound = stint.get("Compound")
        # In qualifying only a timed attempt counts as the lap time (no out, in or cool-down laps).
        if is_qualifying:
            last_lap = ((state.get("_laps") or {}).get(number) or {}).get("push")
            if (number, last_lap) in deleted:
                last_lap = None
            if last_lap is None:
                # No valid lap seen since joining (or it was deleted): their best lap is one, if it is a
                # representative time. F1 leaves deleted laps out of the best.
                best = _best_lap(line)
                if best and field_best and best <= field_best * PUSH_LAP_LIMIT:
                    last_lap = best
        else:
            last_lap = _seconds(_value(line.get("LastLapTime")))

        timing[number] = {
            "position": position,
            "lap_number": line.get("NumberOfLaps"),
            "last_lap_time": last_lap,
            "s1": sector(0),
            "s2": sector(1),
            "s3": sector(2),
            "gap_to_leader": gap_to_leader,
            "gap_to_next": gap_to_next,
            "compound": compound if compound and compound != "UNKNOWN" else None,
            "tyre_age": stint.get("TotalLaps") if stint else None,
            "is_pit": bool(line.get("InPit") or line.get("PitOut")),
            "retired": bool(line.get("Retired")),
        }
    return timing


def _runs(rows: List[Dict[str, Any]]) -> List[List[Dict[str, Any]]]:
    """A driver's laps split into runs on one set of tyres: a run ends with a lap into the pits, or
    where the stint changes across laps the feed missed."""
    runs: List[List[Dict[str, Any]]] = []
    for row in rows:
        previous = runs[-1][-1] if runs else None
        if previous is None or previous["pit_in"] or previous["stint"] != row["stint"]:
            runs.append([])
        runs[-1].append(row)
    return runs


def lap_history_from_state(state: Dict[str, Any]) -> Dict[str, List[Dict[str, Any]]]:
    """Every lap seen completing since the feed joined the session, per driver number.

    The tyre's age at the end of each lap is its age when fitted (StartLaps) plus the laps run on it,
    the rule FastF1 uses. The feed's own lap counter for the tyre lags the lap line, and a stint the
    feed lists twice stops counting. Joining mid-run there is no fitting lap to count from, so the age
    first seen is counted on from. The compound is the run's latest, as the feed corrects it in place."""
    history = {}
    for number, rows in (state.get("_history") or {}).items():
        derived = []
        for run in _runs(rows):
            first = run[0]
            earlier = [r for r in rows if r["lap"] == first["lap"] - 1]
            fitted_here = first["lap"] == 1 or bool(earlier and earlier[0]["pit_in"])
            if fitted_here and first.get("start_laps") is not None:
                anchor = first["start_laps"] + 1
            else:
                anchor = first.get("tyre_age")
            compound = next((r["compound"] for r in reversed(run) if r["compound"]), None)
            for row in run:
                out = {k: v for k, v in row.items() if k != "start_laps"}
                out["compound"] = compound
                out["tyre_age"] = None if anchor is None else anchor + row["lap"] - first["lap"]
                derived.append(out)
        history[number] = derived
    return history


def used_compounds_from_state(state: Dict[str, Any]) -> Dict[str, List[str]]:
    """The compounds each driver has run this session, in the order fitted."""
    used = {}
    for number, line in ((state.get("TimingAppData") or {}).get("Lines") or {}).items():
        stints = [s for s in _as_list((line or {}).get("Stints")) if isinstance(s, dict)]
        compounds = [s.get("Compound") for s in stints if s.get("Compound") and s.get("Compound") != "UNKNOWN"]
        used[number] = list(dict.fromkeys(compounds))
    return used


def race_snapshot_from_state(state: Dict[str, Any]) -> Dict[str, Any]:
    """Everything the live race forecasts read, taken together so it all describes one moment."""
    return {
        "session": session_from_state(state) or {},
        "timing": timing_from_state(state),
        "drivers": drivers_from_state(state),
        "history": lap_history_from_state(state),
        "lap_count": lap_count_from_state(state),
        "track_status": str((state.get("TrackStatus") or {}).get("Status") or "1"),
        "used": used_compounds_from_state(state),
    }


def lap_count_from_state(state: Dict[str, Any]) -> Dict[str, Optional[int]]:
    """The leader's current lap and the race distance (a session without laps has neither)."""
    count = state.get("LapCount") or {}
    current, total = count.get("CurrentLap"), count.get("TotalLaps")
    return {"current": current if isinstance(current, int) and current > 0 else None,
            "total": total if isinstance(total, int) and total > 0 else None}


def weather_from_state(state: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    w = state.get("WeatherData")
    if not w or _number(w.get("AirTemp")) is None:
        return None
    return {
        "air_temperature": _number(w.get("AirTemp")),
        "track_temperature": _number(w.get("TrackTemp")),
        "humidity": _number(w.get("Humidity")),
        "rainfall": _number(w.get("Rainfall")),
        "wind_speed": _number(w.get("WindSpeed")),
        "wind_direction": _number(w.get("WindDirection")),
        "live_signal": True,
    }


def race_control_from_state(state: Dict[str, Any], limit: int = 20) -> List[Dict[str, Any]]:
    messages = [m for m in _as_list((state.get("RaceControlMessages") or {}).get("Messages")) if isinstance(m, dict)]
    messages.sort(key=lambda m: m.get("Utc", ""), reverse=True)
    return [
        {"timestamp": m.get("Utc"), "category": m.get("Category"), "message": m.get("Message"), "flag": m.get("Flag")}
        for m in messages[:limit]
    ]


def radios_from_state(state: Dict[str, Any], limit: int = 20) -> List[Dict[str, Any]]:
    session_path = (state.get("SessionInfo") or {}).get("Path", "")
    captures = [c for c in _as_list((state.get("TeamRadio") or {}).get("Captures")) if isinstance(c, dict)]
    captures.sort(key=lambda c: c.get("Utc", ""), reverse=True)
    return [
        {
            "driver_number": int(c["RacingNumber"]) if str(c.get("RacingNumber", "")).isdigit() else None,
            "timestamp": c.get("Utc"),
            "recording_url": f"{STATIC_URL}{session_path}{c.get('Path', '')}",
        }
        for c in captures[:limit]
    ]


def car_frames_from_state(state: Dict[str, Any]) -> List[Dict[str, Any]]:
    """The latest position and telemetry of each car, in the shape the map and telemetry panels read."""
    cars = state.get("_cars") or {}
    frames = []
    for number, pos in (cars.get("positions") or {}).items():
        if not str(number).isdigit():
            continue
        channels = (cars.get("telemetry") or {}).get(number, {})
        pedal = lambda channel: value if (value := channels.get(channel, 0)) <= NO_PEDAL_READING else 0
        frames.append({
            "driver_number": int(number),
            "timestamp": pos.get("Timestamp"),
            "speed": channels.get(SPEED, 0),
            "throttle": pedal(THROTTLE),
            "brake": pedal(BRAKE),
            "gear": channels.get(GEAR, 0),
            "rpm": channels.get(RPM, 0),
            "drs": channels.get(DRS, 0),
            "x": pos.get("X", 0),
            "y": pos.get("Y", 0),
            "z": pos.get("Z", 0),
            "live_signal": True,
        })
    return frames


def f1tv_token() -> Optional[str]:
    """The F1 TV token FastF1's sign-in stored, if there is one and it has not expired. Never prompts:
    signing in is a one-off step a person runs (`python -m fastf1 auth f1tv --authenticate`)."""
    try:
        from fastf1.internals.f1account.tokens import TokenStore

        token = TokenStore.default().load()
        if token is None:
            return None
        if not token.is_valid():
            print("The stored F1 TV token has expired; car positions need a fresh sign-in.")
            return None
        return token.value
    except Exception:
        return None


# --- Connection ----------------------------------------------------------------------------------

class LiveTimingFeed:
    """Keeps a merged copy of the live timing feed, reconnecting in a background thread."""

    def __init__(self):
        self._state: Dict[str, Any] = {}
        self._lock = threading.Lock()
        self._last_message = 0.0
        self._connected = False
        self.has_car_data = False
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="f1-live-timing", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def _read(self, parse, *args):
        with self._lock:
            return parse(self._state, *args)

    def _is_fresh(self) -> bool:
        return self._connected and time.time() - self._last_message < STALE_AFTER_SECONDS

    def active_session(self) -> Optional[Dict[str, Any]]:
        """The session the feed is covering, or None when it has no live session (or no link)."""
        if not self._is_fresh() or not self._read(is_session_active):
            return None
        return {**self._read(session_from_state), "live": True, "source": "f1-live"}

    def serves(self, session_key: int) -> bool:
        session = self.active_session()
        return session is not None and session["session_key"] == session_key

    def drivers(self) -> List[Dict[str, Any]]:
        return self._read(drivers_from_state)

    def timing(self) -> Dict[str, Dict[str, Any]]:
        return self._read(timing_from_state)

    def weather(self) -> Optional[Dict[str, Any]]:
        return self._read(weather_from_state)

    def race_control(self) -> List[Dict[str, Any]]:
        return self._read(race_control_from_state)

    def radios(self) -> List[Dict[str, Any]]:
        return self._read(radios_from_state)

    def session_status(self) -> Dict[str, Any]:
        return self._read(session_status_from_state)

    def car_frames(self) -> List[Dict[str, Any]]:
        return self._read(car_frames_from_state)

    def lap_count(self) -> Dict[str, Optional[int]]:
        return self._read(lap_count_from_state)

    def race_snapshot(self) -> Dict[str, Any]:
        return self._read(race_snapshot_from_state)

    def _on_feed(self, args: Any) -> None:
        # A live message is [topic, data, utc].
        if isinstance(args, list) and len(args) >= 2 and isinstance(args[0], str):
            at = args[2] if len(args) > 2 and isinstance(args[2], str) else None
            with self._lock:
                apply_message(self._state, args[0], args[1], at)
            self._last_message = time.time()

    def _on_snapshot(self, completion: Any) -> None:
        # The reply to Subscribe is a snapshot of every topic: {topic: data}.
        result = getattr(completion, "result", None)
        if isinstance(result, dict):
            with self._lock:
                previous = self._state
                self._state = {}
                for topic, data in result.items():
                    apply_message(self._state, topic, data)
                # A reconnect to the same session keeps the laps seen so far; the snapshot has none.
                key = (self._state.get("SessionInfo") or {}).get("Key")
                if key is not None and key == (previous.get("SessionInfo") or {}).get("Key"):
                    self._state["_history"] = previous.get("_history", {})
            self._last_message = time.time()

    def _connect(self):
        from signalrcore.hub_connection_builder import HubConnectionBuilder

        # The hub's load balancer wants the sticky-session cookie from a pre-negotiate request.
        response = requests.options(NEGOTIATE_URL, timeout=10)
        headers = {}
        if "AWSALBCORS" in response.cookies:
            headers["Cookie"] = f"AWSALBCORS={response.cookies['AWSALBCORS']}"

        options: Dict[str, Any] = {"verify_ssl": True, "headers": headers}
        token = f1tv_token()
        if token:
            options["access_token_factory"] = lambda: token
        self.has_car_data = bool(token)
        topics = TOPICS + CAR_TOPICS if token else TOPICS

        connection = HubConnectionBuilder().with_url(CONNECTION_URL, options=options).build()
        connection.on_open(lambda: setattr(self, "_connected", True))
        connection.on_close(lambda: setattr(self, "_connected", False))
        connection.on("feed", self._on_feed)
        connection.start()

        deadline = time.time() + 15
        while not self._connected and time.time() < deadline and not self._stop.is_set():
            time.sleep(0.1)
        if not self._connected:
            connection.stop()
            raise ConnectionError("F1 live timing hub did not open")
        self._last_message = time.time()
        connection.send("Subscribe", [topics], on_invocation=self._on_snapshot)
        return connection

    def _run(self) -> None:
        while not self._stop.is_set():
            connection = None
            try:
                connection = self._connect()
                print(f"Connected to the F1 live timing feed ({'with' if self.has_car_data else 'without'} F1 TV car data).")
                while not self._stop.is_set() and self._is_fresh():
                    time.sleep(1)
                if not self._stop.is_set():
                    print("F1 live timing feed went quiet; reconnecting.")
            except Exception as e:
                print(f"F1 live timing feed unavailable: {e}")
            finally:
                self._connected = False
                if connection is not None:
                    try:
                        connection.stop()
                    except Exception:
                        pass
            self._stop.wait(RECONNECT_DELAY_SECONDS)


live_timing_feed = LiveTimingFeed()
