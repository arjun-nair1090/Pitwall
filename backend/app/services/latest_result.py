"""Classification of the most recent completed race, for the landing page.

Loads results only (no laps, telemetry or messages), so it takes a couple of
seconds rather than the debrief's tens. Finished results never change, so they
are cached; the "which race is latest" answer is memoised briefly so landing-page
traffic does not re-read the schedule on every request.

All datetimes are naive UTC, matching predictions_service.race_start_utc."""
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Optional

import pandas as pd

from app.services.race_debrief import NoResultsError
from app.services.session_frames import LruCache

RACE_DURATION_BUFFER = timedelta(hours=3)  # a race started less than this ago may not be classified yet
MAX_CANDIDATES = 4
LATEST_TTL_SECONDS = 600

_RESULTS_CACHE = LruCache(maxsize=8)
_memo_lock = threading.Lock()
_memo: Dict[str, Any] = {}


def reset_caches() -> None:
    global _RESULTS_CACHE
    _RESULTS_CACHE = LruCache(maxsize=8)
    with _memo_lock:
        _memo.clear()


def _text(value: Any) -> Optional[str]:
    if value is None or pd.isna(value):
        return None
    cleaned = str(value).strip()
    return cleaned or None


def _seconds(value: Any) -> Optional[float]:
    if value is None or pd.isna(value):
        return None
    return float(pd.Timedelta(value).total_seconds())


def _finished(status: Optional[str]) -> bool:
    return status is None or status in ("Finished", "Lapped") or status.startswith("+")


def build_classification(results: Optional[pd.DataFrame]) -> List[Dict[str, Any]]:
    if results is None or results.empty or not {"Abbreviation", "Position"}.issubset(results.columns):
        raise NoResultsError("This race has no final classification yet.")
    ranked = results.assign(Position=pd.to_numeric(results["Position"], errors="coerce"))
    ranked = ranked.dropna(subset=["Position"]).sort_values("Position")
    if ranked.empty or float(ranked.iloc[0]["Position"]) != 1.0:
        raise NoResultsError("This race has no final classification yet.")

    field_size = len(ranked)
    rows: List[Dict[str, Any]] = []
    for _, r in ranked.iterrows():
        position = int(r["Position"])
        grid = r.get("GridPosition")
        # FastF1 reports a pit-lane start as grid position 0: that is last, not first.
        grid = field_size if grid is None or pd.isna(grid) or float(grid) <= 0 else int(grid)
        status = _text(r.get("Status"))
        elapsed = _seconds(r.get("Time"))
        code = str(r["Abbreviation"])
        rows.append({
            "position": position,
            "code": code,
            "name": _text(r.get("FullName")) or code,
            "team": _text(r.get("TeamName")) or "Unknown",
            "grid": grid,
            "status": status,
            "finished": _finished(status),
            # For the winner FastF1's Time is the total race time; for a car on the lead lap it is
            # the gap to the winner. For a lapped car it is NOT a gap to the winner (a car one lap
            # down can carry +10s while cars on the lead lap are a minute behind), so it is dropped
            # and the status ("Lapped", "+1 Lap") is shown instead.
            "race_time_seconds": elapsed if position == 1 else None,
            "gap_seconds": elapsed if position != 1 and status in (None, "Finished") else None,
        })
    return rows


def finished_races(
    year: int, now: datetime, get_schedule: Optional[Callable[[int], pd.DataFrame]] = None
) -> List[Dict[str, Any]]:
    """Races that have finished, newest first. Testing events and races with no known start are skipped."""
    if get_schedule is None:
        import fastf1

        get_schedule = fastf1.get_event_schedule
    from app.services.predictions_service import race_start_utc

    races: List[Dict[str, Any]] = []
    for _, row in get_schedule(year).iterrows():
        if str(row.get("EventFormat")) == "testing":
            continue
        start = race_start_utc(row)
        if start is None:
            continue
        start = start.to_pydatetime()
        if start + RACE_DURATION_BUFFER > now:
            continue
        races.append({
            "year": year,
            "event_name": str(row["EventName"]),
            "country": str(row.get("Country", "")),
            "start": start,
        })
    races.sort(key=lambda r: r["start"], reverse=True)
    return races


def _load_results(year: int, event_name: str) -> pd.DataFrame:
    import fastf1

    session = fastf1.get_session(year, event_name, "Race")
    session.load(laps=False, telemetry=False, weather=False, messages=False)
    return session.results


def _utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def latest_classification(
    now: Optional[datetime] = None,
    *,
    list_races: Callable[[int, datetime], List[Dict[str, Any]]] = finished_races,
    load_results: Callable[[int, str], pd.DataFrame] = _load_results,
    clock: Callable[[], float] = time.monotonic,
) -> Dict[str, Any]:
    """Blocking -- call via asyncio.to_thread from async routes."""
    with _memo_lock:
        hit = _memo.get("latest")
        if hit is not None and clock() - hit[0] < LATEST_TTL_SECONDS:
            return hit[1]

    now = now or _utc_now()
    candidates = list_races(now.year, now)[:MAX_CANDIDATES]
    if len(candidates) < MAX_CANDIDATES:  # early in the year: reach back into last season
        candidates += list_races(now.year - 1, now)[: MAX_CANDIDATES - len(candidates)]

    errors: List[Exception] = []
    for race in candidates:
        key = (race["year"], race["event_name"])
        payload = _RESULTS_CACHE.get(key)
        if payload is None:
            try:
                payload = {
                    "event": race["event_name"],
                    "year": race["year"],
                    "country": race["country"],
                    "classification": build_classification(load_results(race["year"], race["event_name"])),
                }
            except NoResultsError:
                continue  # not published yet: try the race before it
            except Exception as e:
                print(f"latest-result: could not load {key}: {e}")
                errors.append(e)
                continue
            _RESULTS_CACHE.set(key, payload)
        with _memo_lock:
            _memo["latest"] = (clock(), payload)
        return payload

    if candidates and len(errors) == len(candidates):
        raise errors[-1]  # everything failed with a real error: surface it, don't say "no results"
    raise NoResultsError("No completed race results are available yet.")


def race_results(
    year: int,
    round_number: int,
    *,
    load_results: Callable[[int, Any], pd.DataFrame] = _load_results,
) -> Dict[str, Any]:
    """Final classification of any race (by round), with points and team colours, for the archive.
    Finished results never change, so they are cached. Blocking -- call via asyncio.to_thread."""
    from app.services.session_info import FALLBACK_COLOR, team_colour

    key = ("round", year, round_number)
    cached = _RESULTS_CACHE.get(key)
    if cached is not None:
        return cached

    try:
        results = load_results(year, round_number)
    except ValueError as e:  # FastF1 rejects a round the season doesn't have
        raise NoResultsError(f"There's no round {round_number} in {year}.") from e
    classification = build_classification(results)  # raises NoResultsError when unpublished

    by_code = {str(r["Abbreviation"]): r for _, r in results.iterrows()}
    for row in classification:
        source = by_code.get(row["code"])
        points = source.get("Points") if source is not None else None
        row["points"] = None if points is None or pd.isna(points) else float(points)
        colour = source.get("TeamColor") if source is not None else None
        row["color"] = team_colour(colour) if colour is not None and not pd.isna(colour) else FALLBACK_COLOR

    payload = {"year": year, "round": round_number, "classification": classification}
    _RESULTS_CACHE.set(key, payload)
    return payload
