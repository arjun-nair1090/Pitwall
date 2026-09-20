import re
from typing import Any, Dict, Optional, Tuple

import pandas as pd


def slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")


def make_doc_id(year: int, event: str, session: str, driver_code: str) -> str:
    return f"{year}_{slugify(event)}_{slugify(session)}_{driver_code.lower()}"


def _clean_laps_for_trend(stint_laps: pd.DataFrame) -> pd.DataFrame:
    """Exclude the in-lap/out-lap (and any lap FastF1 flags as inaccurate) from a degradation calc."""
    mask = stint_laps["PitInTime"].isna() & stint_laps["PitOutTime"].isna()
    if "IsAccurate" in stint_laps.columns:
        mask &= stint_laps["IsAccurate"].fillna(True)
    return stint_laps[mask]


def _describe_stint(stint_number: int, stint_laps: pd.DataFrame) -> str:
    compound = stint_laps["Compound"].iloc[0]
    lap_start = int(stint_laps["LapNumber"].min())
    lap_end = int(stint_laps["LapNumber"].max())
    clean = _clean_laps_for_trend(stint_laps)

    if len(clean) < 3:
        trend = "insufficient laps for a trend"
    else:
        clean = clean.sort_values("LapNumber")
        first_time = clean["LapTime"].iloc[0].total_seconds()
        last_time = clean["LapTime"].iloc[-1].total_seconds()
        num_laps = len(clean)
        rate = (last_time - first_time) / (num_laps - 1)
        trend = f"degrading ~{rate:.2f}s/lap"

    return f"{compound} (laps {lap_start}-{lap_end}, {trend})"


def build_driver_session_summary(
    laps: pd.DataFrame,
    driver_code: str,
    event_name: str,
    year: int,
    session_name: str,
    race_control_messages: Optional[pd.DataFrame] = None,
) -> Tuple[str, Dict[str, Any]]:
    driver_laps = laps[laps["Driver"] == driver_code].sort_values("LapNumber")
    team = driver_laps["Team"].iloc[0] if not driver_laps.empty else "Unknown"

    stint_descriptions = []
    for stint_number, stint_laps in driver_laps.groupby("Stint"):
        stint_descriptions.append(_describe_stint(int(stint_number), stint_laps))
    num_pit_stops = max(0, len(stint_descriptions) - 1)

    fastest = driver_laps.loc[driver_laps["LapTime"].idxmin()] if driver_laps["LapTime"].notna().any() else None
    finishing_position = (
        driver_laps["Position"].iloc[-1]
        if not driver_laps.empty and pd.notna(driver_laps["Position"].iloc[-1])
        else None
    )

    lines = []
    result_clause = f"finished P{int(finishing_position)}" if finishing_position is not None else "result unknown"
    lines.append(f"{driver_code} ({team}) {result_clause} at the {year} {event_name} ({session_name}).")
    lines.append(f"Strategy: {' then '.join(stint_descriptions)}.")
    lines.append(f"{num_pit_stops} pit stop{'s' if num_pit_stops != 1 else ''}.")

    if fastest is not None:
        fastest_lap_time = fastest["LapTime"].total_seconds()
        minutes = int(fastest_lap_time // 60)
        seconds = fastest_lap_time % 60
        lines.append(
            f"Fastest lap: {minutes}:{seconds:06.3f} on lap {int(fastest['LapNumber'])} ({fastest['Compound']} tire)."
        )

    if race_control_messages is not None and not race_control_messages.empty:
        messages = race_control_messages["Message"].dropna().unique().tolist()
        if messages:
            lines.append("Race control: " + "; ".join(messages[:5]) + ".")

    text = " ".join(lines)
    metadata = {
        "year": year,
        "event": event_name,
        "session": session_name,
        "driver_code": driver_code,
        "team": team,
    }
    return text, metadata
