"""Session lookups shared by the analysis endpoints.

One place turns a (year, race, session) request into a loaded FastF1 session and reports the
facts the UI needs to build its pickers: who actually took part, in which team colours, how long
the race was, and what strategy each driver ran.
"""
import time
from typing import Any, Dict, Optional, Tuple

import fastf1
import pandas as pd

FALLBACK_COLOR = "#9AA3B2"
_CACHE_TTL_SECONDS = 600
_cache: Dict[Tuple, Tuple[float, Dict[str, Any]]] = {}


class SessionDataError(Exception):
    """A well-formed request that can't be answered: no data for that session, or the race
    hasn't happened. The message is written for the person using the app."""


# Since October 2026 F1's timing archive only serves signed-in F1 TV subscribers. FastF1 sends the
# token itself once someone has signed in on this machine.
ARCHIVE_INDEX_URL = "https://livetiming.formula1.com/static/{year}/Index.json"
ARCHIVE_SIGN_IN = "python -m fastf1 auth f1tv --authenticate"
_ARCHIVE_TTL_SECONDS = 120
_ARCHIVE_STATUS: Dict[int, Tuple[float, bool]] = {}


def clear_cache() -> None:
    _cache.clear()
    _ARCHIVE_STATUS.clear()


def _probe_archive(year: int) -> Optional[int]:
    """The archive's HTTP status for that season's index, or None if it can't be reached."""
    try:
        return fastf1.req.Cache.requests_get(ARCHIVE_INDEX_URL.format(year=year), timeout=10).status_code
    except Exception:
        return None


def archive_locked(year: int) -> bool:
    """Whether F1's timing archive is refusing this machine (no F1 TV sign-in), cached briefly."""
    cached = _ARCHIVE_STATUS.get(year)
    if cached and cached[0] > time.monotonic():
        return cached[1]
    locked = _probe_archive(year) in (401, 403)
    _ARCHIVE_STATUS[year] = (time.monotonic() + _ARCHIVE_TTL_SECONDS, locked)
    return locked


def _no_data_error(message: str, year: int, label: str) -> SessionDataError:
    if archive_locked(year):
        return SessionDataError(
            f"Formula 1's timing archive needs an F1 TV sign-in to download {label} {year}. "
            f"Sign in once on the machine running the backend with: {ARCHIVE_SIGN_IN}"
        )
    return SessionDataError(message)


def load_session(
    year: int,
    gp: str,
    session_name: str,
    round_number: Optional[int] = None,
    *,
    telemetry: bool = False,
):
    """Load a session by round number when known (exact) or by name (FastF1 fuzzy-matches)."""
    event = round_number if round_number else gp
    label = f"round {round_number}" if round_number else gp
    try:
        session = fastf1.get_session(year, event, session_name)
    except Exception as e:
        raise SessionDataError(f"Couldn't find the {session_name} session for {label} {year}.") from e

    try:
        session.load(laps=True, telemetry=telemetry, weather=False, messages=False)
        laps = session.laps  # raises if the load silently failed
    except Exception as e:
        raise _no_data_error(
            f"There's no data for {label} {year} yet. The session may not have taken place.", year, label
        ) from e

    if laps is None or laps.empty:
        raise _no_data_error(f"There's no lap data for {label} {year} ({session_name}) yet.", year, label)
    return session


def team_colour(value: Any) -> str:
    text = str(value).strip().lstrip("#") if value is not None and not pd.isna(value) else ""
    return f"#{text.upper()}" if len(text) == 6 else FALLBACK_COLOR


def driver_profile(session, code: str) -> Dict[str, str]:
    """Name, team and real team colour for a driver in this session (neutral values if unrecorded)."""
    profile = {"name": code, "team": "", "color": FALLBACK_COLOR}
    results = getattr(session, "results", None)
    if results is None or results.empty or "Abbreviation" not in results.columns:
        return profile
    match = results[results["Abbreviation"] == code]
    if match.empty:
        return profile
    row = match.iloc[0]
    if "FullName" in row.index and not pd.isna(row["FullName"]):
        profile["name"] = str(row["FullName"])
    if "TeamName" in row.index and not pd.isna(row["TeamName"]):
        profile["team"] = str(row["TeamName"])
    if "TeamColor" in row.index:
        profile["color"] = team_colour(row["TeamColor"])
    return profile


# Track status digits for a Safety Car, red flag, VSC and VSC ending.
NEUTRALISED_DIGITS = "4567"


def neutralised_laps(track_status: pd.Series) -> pd.Series:
    """True for each lap whose TrackStatus shows any part of it run under a Safety Car, red flag or VSC."""
    return track_status.map(
        lambda status: pd.notna(status) and any(c in str(status) for c in NEUTRALISED_DIGITS)
    ).astype(bool)


def driver_laps(laps: pd.DataFrame, code: str) -> pd.DataFrame:
    """All of one driver's laps, or a message naming who *did* run if they took no part."""
    subset = laps[laps["Driver"] == code]
    if subset.empty:
        ran = ", ".join(sorted(str(d) for d in laps["Driver"].dropna().unique()))
        raise SessionDataError(f"{code} has no laps in this session. Drivers with laps: {ran}.")
    return subset


def pick_lap(laps: pd.DataFrame, code: str, lap_number: Optional[int] = None) -> pd.Series:
    """A specific lap of one driver's, or their fastest timed lap when no number is given."""
    subset = driver_laps(laps, code)
    if lap_number:
        match = subset[subset["LapNumber"] == lap_number]
        if match.empty:
            raise SessionDataError(f"{code} has no lap {lap_number} (they completed {int(subset['LapNumber'].max())} laps).")
        return match.iloc[0]

    # FastF1's own pick_fastest ignores deleted laps; a plain frame falls back to the quickest time.
    fastest = subset.pick_fastest() if hasattr(subset, "pick_fastest") else None
    if fastest is None or pd.isna(fastest["LapTime"]):
        timed = subset.dropna(subset=["LapTime"])
        fastest = timed.loc[timed["LapTime"].idxmin()] if not timed.empty else None
    if fastest is None:
        raise SessionDataError(f"{code} has no valid timed lap in this session.")
    return fastest


def _stints(driver_laps: pd.DataFrame) -> list:
    if "Stint" not in driver_laps.columns or "Compound" not in driver_laps.columns:
        return []
    stints = []
    for _, stint_laps in driver_laps.dropna(subset=["Stint"]).groupby("Stint", sort=True):
        compounds = stint_laps["Compound"].dropna()
        compound = str(compounds.mode().iloc[0]) if not compounds.empty else "UNKNOWN"
        stints.append({"compound": compound, "laps": int(len(stint_laps))})
    return stints


def _driver_entry(code: str, driver_laps: pd.DataFrame, result_row: Optional[pd.Series]) -> Dict[str, Any]:
    timed = driver_laps.dropna(subset=["LapTime"]) if "LapTime" in driver_laps.columns else driver_laps.iloc[0:0]
    fastest = timed.loc[timed["LapTime"].idxmin()] if not timed.empty else None

    def field(name: str, default: Any) -> Any:
        if result_row is None or name not in result_row.index or pd.isna(result_row[name]):
            return default
        return result_row[name]

    position = field("Position", None)
    return {
        "code": code,
        "name": str(field("FullName", code)),
        "team": str(field("TeamName", "")),
        "color": team_colour(field("TeamColor", None)),
        "position": int(position) if position is not None else None,
        "status": str(field("Status", "")).strip() or None,
        "laps": int(driver_laps["LapNumber"].max()) if not driver_laps.empty else 0,
        "fastest_lap": int(fastest["LapNumber"]) if fastest is not None else None,
        "fastest_time": float(fastest["LapTime"].total_seconds()) if fastest is not None else None,
        "stints": _stints(driver_laps),
    }


def session_info(year: int, gp: str, session_name: str = "R", round_number: Optional[int] = None) -> Dict[str, Any]:
    key = (year, round_number or gp, session_name)
    cached = _cache.get(key)
    if cached and time.time() - cached[0] < _CACHE_TTL_SECONDS:
        return cached[1]

    session = load_session(year, gp, session_name, round_number)
    laps = session.laps
    results = getattr(session, "results", None)
    result_rows: Dict[str, pd.Series] = {}
    if results is not None and not results.empty and "Abbreviation" in results.columns:
        result_rows = {str(row["Abbreviation"]): row for _, row in results.iterrows()}

    drivers = [
        _driver_entry(str(code), laps[laps["Driver"] == code], result_rows.get(str(code)))
        for code in laps["Driver"].dropna().unique()
    ]
    drivers.sort(key=lambda d: (d["position"] is None, d["position"] or 0, d["code"]))

    event = session.event
    info = {
        "year": year,
        "round": int(event["RoundNumber"]) if "RoundNumber" in event and not pd.isna(event["RoundNumber"]) else round_number,
        "event_name": str(event["EventName"]) if "EventName" in event else gp,
        "session": session_name,
        "total_laps": int(laps["LapNumber"].max()),
        "drivers": drivers,
    }
    _cache[key] = (time.time(), info)
    return info
