import re
from datetime import datetime
from typing import Optional, Tuple

import pandas as pd

EXACT_MATCH_POINTS = 25
PARTIAL_MATCH_POINTS_PER_DRIVER = 10

# A driver code is FIA's three-letter abbreviation. We validate the *shape*, not
# membership in a fixed list: the real grid changes every season (and mid-season),
# a hardcoded list would silently reject legitimate drivers, and an unknown-but-
# well-formed code can only ever score zero. The UI restricts choices to the
# season's actual grid.
_DRIVER_CODE_RE = re.compile(r"^[A-Z]{3}$")


def normalize_code(code: str) -> str:
    return code.strip().upper()


def validate_prediction(predicted_p1: str, predicted_p2: str, predicted_p3: str) -> Optional[str]:
    codes = [normalize_code(c) for c in (predicted_p1, predicted_p2, predicted_p3)]
    for raw, code in zip((predicted_p1, predicted_p2, predicted_p3), codes):
        # isascii() first: str.upper() expands some non-ASCII characters into
        # ASCII ones ("ß" -> "SS"), which would let a 2-character input through.
        if not raw.strip().isascii() or not _DRIVER_CODE_RE.match(code):
            return f"'{raw}' is not a valid three-letter driver code."
    # Compare *normalized* codes -- "VER" and "ver" are the same driver.
    if len(set(codes)) != 3:
        return "Predictions must name three distinct drivers."
    return None


def race_start_utc(event_schedule_row: pd.Series) -> Optional[pd.Timestamp]:
    """The Race session's start as a naive UTC timestamp, or None if the event has
    no Race session or its start time is unknown.

    The Race isn't always Session5 (Sprint weekends), so scan Session1..Session5.
    Prefer FastF1's explicit ``SessionNDateUtc`` column. ``SessionNDate`` is
    tz-aware *local track time* -- stripping its tz without converting leaves the
    local wall-clock time, which is off by the track's UTC offset (up to 11-12h).
    """
    for i in range(1, 6):
        if event_schedule_row.get(f"Session{i}") != "Race":
            continue

        utc_value = event_schedule_row.get(f"Session{i}DateUtc")
        if utc_value is not None and not pd.isna(utc_value):
            return pd.Timestamp(utc_value).tz_localize(None)

        local_value = event_schedule_row.get(f"Session{i}Date")
        if local_value is None or pd.isna(local_value):
            return None
        stamp = pd.Timestamp(local_value)
        if stamp.tzinfo is not None:
            return stamp.tz_convert("UTC").tz_localize(None)
        return stamp  # naive => already UTC
    return None


def race_has_started(event_schedule_row: pd.Series, now: datetime) -> bool:
    """True once lights-out has passed. Fails *closed*: if the start time can't be
    determined, treat the race as started so predictions stay locked rather than
    staying open indefinitely."""
    start = race_start_utc(event_schedule_row)
    if start is None:
        return True
    return start <= pd.Timestamp(now)


def top3_from_results(results: Optional[pd.DataFrame]) -> Optional[Tuple[str, str, str]]:
    """The official podium from a FastF1 ``session.results`` frame, or None unless
    the classification is final: exactly positions 1, 2 and 3, each with a driver
    code. A partial or not-yet-published result must never be scored as final."""
    if results is None or results.empty:
        return None
    if not {"Position", "Abbreviation"}.issubset(results.columns):
        return None

    ranked = results.assign(Position=pd.to_numeric(results["Position"], errors="coerce"))
    ranked = ranked.dropna(subset=["Position"]).sort_values("Position")
    podium = ranked.iloc[:3]
    if len(podium) < 3 or [float(p) for p in podium["Position"]] != [1.0, 2.0, 3.0]:
        return None

    codes = []
    for code in podium["Abbreviation"]:
        if code is None or pd.isna(code) or not str(code).strip():
            return None
        codes.append(normalize_code(str(code)))
    return (codes[0], codes[1], codes[2])


def find_event(year: int, event_name: str) -> Optional[pd.Series]:
    """The schedule row whose EventName matches exactly, or None. Blocking (network
    on a cold FastF1 cache) -- call via asyncio.to_thread from async routes.

    Exact match on purpose: predictions are stored under, and scored by, the
    canonical name. Any near-miss ("Belgian Grand Prix ") must be rejected here,
    not silently skip the race-start lock."""
    import fastf1

    schedule = fastf1.get_event_schedule(year)
    matching = schedule[schedule["EventName"] == event_name]
    if matching.empty:
        return None
    return matching.iloc[0]


def fetch_actual_top3(year: int, event_name: str) -> Optional[Tuple[str, str, str]]:
    """The real, final podium for a race, or None if it isn't published/final yet.
    Blocking -- call via asyncio.to_thread from async routes."""
    import fastf1

    session = fastf1.get_session(year, event_name, "Race")
    session.load(laps=False, telemetry=False, weather=False)
    return top3_from_results(session.results)


def score_prediction(predicted: Tuple[str, str, str], actual_top3: Tuple[str, str, str]) -> int:
    if tuple(predicted) == tuple(actual_top3):
        return EXACT_MATCH_POINTS
    correct_drivers = set(predicted) & set(actual_top3)
    return len(correct_drivers) * PARTIAL_MATCH_POINTS_PER_DRIVER
