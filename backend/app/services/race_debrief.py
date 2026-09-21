"""Post-race debrief.

Two layers, deliberately separated:

1. ``build_race_facts`` -- plain, deterministic code that turns FastF1's results,
   laps and race-control frames into a JSON-safe dict of facts. Every number a
   reader sees comes from here.
2. ``generate_debrief`` -- asks an LLM to *narrate* those facts, checks the output
   is grounded, and otherwise falls back to a template built from the same facts.

The model never supplies data, only wording, so it can't hallucinate a lap time,
and the feature still works with no API key at all."""
import json
import re
from collections import Counter
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd

MAX_DEBRIEF_CHARS = 3000
STRATEGY_DRIVERS = 10
MAX_GAINERS = 3


class NoResultsError(Exception):
    """The session has no usable final classification (not run yet, or not published)."""


# --- formatting -----------------------------------------------------------------

def _lap_time(seconds: float) -> str:
    minutes = int(seconds // 60)
    return f"{minutes}:{seconds - minutes * 60:06.3f}"


def _race_time(seconds: float) -> str:
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    return f"{hours}:{minutes:02d}:{seconds % 60:06.3f}"


def _seconds(value: Any) -> Optional[float]:
    if value is None or pd.isna(value):
        return None
    return float(pd.Timedelta(value).total_seconds())


def _text(value: Any) -> Optional[str]:
    if value is None or pd.isna(value):
        return None
    cleaned = str(value).strip()
    return cleaned or None


def _is_retired(status: Optional[str]) -> bool:
    if not status or status == "Finished" or status == "Lapped" or status.startswith("+"):
        return False
    return True


# --- facts ----------------------------------------------------------------------

def _neutralisations(race_control: Optional[pd.DataFrame]) -> Dict[str, int]:
    counts = {"safety_cars": 0, "virtual_safety_cars": 0, "red_flags": 0}
    if race_control is None or race_control.empty:
        return counts
    for _, row in race_control.iterrows():
        message = (_text(row.get("Message")) or "").upper()
        category = _text(row.get("Category")) or ""
        flag = (_text(row.get("Flag")) or "").upper()
        if category == "SafetyCar" and "DEPLOYED" in message:
            # "... IN THIS LAP" / "... ENDING" close a period that was already counted.
            counts["virtual_safety_cars" if "VIRTUAL" in message else "safety_cars"] += 1
        elif flag == "RED":
            counts["red_flags"] += 1
    return counts


def _fastest_lap(laps: pd.DataFrame, names: Dict[str, str]) -> Optional[Dict[str, Any]]:
    if laps is None or laps.empty or "LapTime" not in laps.columns:
        return None
    candidates = laps[laps["LapTime"].notna()]
    if "Deleted" in candidates.columns:
        candidates = candidates[~candidates["Deleted"].fillna(False).astype(bool)]  # deleted laps don't count
    if candidates.empty:
        return None
    best = candidates.loc[candidates["LapTime"].idxmin()]
    code = str(best["Driver"])
    return {
        "code": code,
        "name": names.get(code, code),
        "lap": int(best["LapNumber"]),
        "time": _lap_time(_seconds(best["LapTime"])),
        "compound": _text(best.get("Compound")),
    }


def _strategy(laps: pd.DataFrame, code: str) -> Optional[Dict[str, Any]]:
    driver_laps = laps[(laps["Driver"] == code) & laps["Stint"].notna()]
    if driver_laps.empty:
        return None
    stints = []
    for _, stint_laps in driver_laps.groupby("Stint", sort=True):
        compounds = stint_laps["Compound"].dropna()
        compound = Counter(compounds).most_common(1)[0][0] if len(compounds) else "UNKNOWN"
        stints.append({"compound": str(compound), "laps": int(len(stint_laps))})
    return {"code": code, "stops": max(0, len(stints) - 1), "stints": stints}


def build_race_facts(
    results: pd.DataFrame,
    laps: pd.DataFrame,
    race_control: Optional[pd.DataFrame],
    event_name: str,
    year: int,
    session_name: str = "Race",
) -> Dict[str, Any]:
    if results is None or results.empty or not {"Abbreviation", "Position"}.issubset(results.columns):
        raise NoResultsError("This session has no final classification yet.")

    ranked = results.assign(Position=pd.to_numeric(results["Position"], errors="coerce"))
    ranked = ranked.dropna(subset=["Position"]).sort_values("Position")
    if ranked.empty or float(ranked.iloc[0]["Position"]) != 1.0:
        raise NoResultsError("This session has no final classification yet.")

    field_size = len(ranked)
    names = {str(r["Abbreviation"]): _text(r.get("FullName")) or str(r["Abbreviation"]) for _, r in ranked.iterrows()}

    def entry(row: pd.Series) -> Dict[str, Any]:
        code = str(row["Abbreviation"])
        grid = row.get("GridPosition")
        # FastF1 reports a pit-lane start as grid position 0: that is last, not first.
        grid = field_size if grid is None or pd.isna(grid) or float(grid) <= 0 else int(grid)
        position = int(row["Position"])
        points = row.get("Points")
        return {
            "code": code,
            "name": names[code],
            "team": _text(row.get("TeamName")) or "Unknown",
            "position": position,
            "grid": grid,
            "positions_gained": grid - position,
            "points": 0 if points is None or pd.isna(points) else int(points),
            "status": _text(row.get("Status")),
        }

    entries = [entry(row) for _, row in ranked.iterrows()]
    time_by_code = {str(r["Abbreviation"]): _seconds(r.get("Time")) for _, r in ranked.iterrows()}
    laps_by_code = {str(r["Abbreviation"]): r.get("Laps") for _, r in ranked.iterrows()}

    winner = dict(entries[0])
    winner_seconds = time_by_code[winner["code"]]
    winner["race_time"] = _race_time(winner_seconds) if winner_seconds is not None else None

    podium = []
    for e in entries[:3]:
        item = {k: e[k] for k in ("position", "code", "name", "team", "grid", "positions_gained", "points")}
        gap = time_by_code[e["code"]]
        # For the winner FastF1's Time is the total race time; for everyone else it is the gap.
        item["gap"] = f"+{gap:.3f}s" if e["position"] > 1 and gap is not None else None
        podium.append(item)

    gainers = [
        {"code": e["code"], "name": e["name"], "positions_gained": e["positions_gained"]}
        for e in entries
        if not _is_retired(e["status"]) and e["positions_gained"] > 0
    ]
    gainers.sort(key=lambda g: -g["positions_gained"])  # stable: ties stay in finishing order

    retirements = []
    for e in entries:
        if not _is_retired(e["status"]):
            continue
        completed = laps_by_code.get(e["code"])
        retirements.append({
            "code": e["code"],
            "name": e["name"],
            "team": e["team"],
            "status": e["status"],
            # FastF1's Laps is laps *completed*: 0 means they went out on the opening lap.
            "laps_completed": None if completed is None or pd.isna(completed) else int(completed),
        })

    has_laps = laps is not None and not laps.empty and {"Driver", "Stint", "LapNumber"}.issubset(laps.columns)
    strategies: List[Dict[str, Any]] = []
    if has_laps:
        for e in entries[:STRATEGY_DRIVERS]:
            strategy = _strategy(laps, e["code"])
            if strategy:
                strategies.append(strategy)

    return {
        "event": event_name,
        "year": int(year),
        "session": session_name,
        "total_laps": int(laps["LapNumber"].max()) if has_laps else None,
        "winner": winner,
        "podium": podium,
        "fastest_lap": _fastest_lap(laps, names) if has_laps else None,
        "strategies": strategies,
        "biggest_gainers": gainers[:MAX_GAINERS],
        "retirements": retirements,
        "neutralisations": _neutralisations(race_control),
    }


# --- template fallback ----------------------------------------------------------

def _plural(n: int, noun: str) -> str:
    return f"{n} {noun}{'' if n == 1 else 's'}"


def _stint_phrase(stints: List[Dict[str, Any]]) -> str:
    return " then ".join(f"{s['compound']} ({_plural(s['laps'], 'lap')})" for s in stints)


def render_template_debrief(facts: Dict[str, Any]) -> str:
    winner = facts["winner"]
    paragraphs = []

    if winner["grid"] == 1:
        start = "from pole position"
    elif winner["positions_gained"] > 0:
        start = f"from P{winner['grid']}, gaining {_plural(winner['positions_gained'], 'place')}"
    else:
        start = f"from P{winner['grid']}"
    opening = f"{winner['name']} ({winner['team']}) won the {facts['year']} {facts['event']} {start}"
    if winner.get("race_time"):
        opening += f", crossing the line in {winner['race_time']}"
    paragraphs.append(opening + ".")

    podium = facts["podium"]
    if len(podium) >= 3:
        second, third = podium[1], podium[2]
        second_gap = ", " + second["gap"] + " behind" if second["gap"] else ""
        third_gap = " (" + third["gap"] + ")" if third["gap"] else ""
        paragraphs.append(f"{second['name']} took second{second_gap}, ahead of {third['name']}{third_gap} in third.")

    fastest = facts.get("fastest_lap")
    if fastest:
        compound = f" on {fastest['compound']} tyres" if fastest["compound"] else ""
        paragraphs.append(f"The fastest lap, {fastest['time']}, was set by {fastest['name']} on lap {fastest['lap']}{compound}.")

    winner_strategy = next((s for s in facts["strategies"] if s["code"] == winner["code"]), None)
    if winner_strategy:
        paragraphs.append(
            f"{winner['name']} ran {_stint_phrase(winner_strategy['stints'])}, "
            f"making {_plural(winner_strategy['stops'], 'stop')}."
        )

    gainers = [g for g in facts["biggest_gainers"] if g["code"] != winner["code"]]
    if gainers:
        movers = ", ".join(f"{g['name']} (+{g['positions_gained']})" for g in gainers)
        paragraphs.append(f"Among the biggest climbers from the grid: {movers}.")

    if facts["retirements"]:
        def _retired(r: Dict[str, Any]) -> str:
            base = f"{r['name']} ({r['team']}) retired"
            completed = r["laps_completed"]
            if completed is None:
                return base
            if completed == 0:
                return base + " on the opening lap"
            return base + f" after {_plural(completed, 'lap')}"

        paragraphs.append("; ".join(_retired(r) for r in facts["retirements"]) + ".")

    n = facts["neutralisations"]
    events = []
    if n["safety_cars"]:
        events.append(_plural(n["safety_cars"], "safety car"))
    if n["virtual_safety_cars"]:
        events.append(_plural(n["virtual_safety_cars"], "virtual safety car"))
    if n["red_flags"]:
        events.append(_plural(n["red_flags"], "red flag"))
    if events:
        joined = events[0] if len(events) == 1 else ", ".join(events[:-1]) + " and " + events[-1]
        paragraphs.append(f"The race featured {joined}.")

    return "\n\n".join(paragraphs)


# --- AI narration ---------------------------------------------------------------

_SYSTEM_PROMPT = (
    "You are a Formula 1 journalist writing a concise post-race debrief.\n"
    "Use ONLY the facts in the JSON data block the user provides. Do not invent or infer lap times, "
    "positions, incidents, causes, weather, team radio or quotes. If something is not in the data, do "
    "not mention it. Refer to drivers by name. Write 3 short paragraphs of plain prose (about 150-220 "
    "words): the result and how the winner won, the podium fight and strategy, then notable movers, "
    "retirements and neutralisations if the data has any. No headings, no bullet points."
)


def build_debrief_prompt(facts: Dict[str, Any]) -> Tuple[str, str]:
    user = "Write the debrief for this race.\n\n```json\n" + json.dumps(facts, indent=2) + "\n```"
    return _SYSTEM_PROMPT, user


def is_grounded(text: Optional[str], facts: Dict[str, Any]) -> bool:
    """Cheap sanity check on model output: non-empty, bounded, and it names the actual winner.

    It can't prove every sentence is true -- that's what the prompt constraints and the
    structured facts are for -- but it catches the failure that matters most, a debrief
    about the wrong race or the wrong winner, and runaway output."""
    if not text or not text.strip() or len(text) > MAX_DEBRIEF_CHARS:
        return False
    winner = facts["winner"]
    surname = winner["name"].split()[-1]
    return bool(
        re.search(rf"\b{re.escape(surname)}\b", text, re.IGNORECASE)
        or re.search(rf"\b{re.escape(winner['code'])}\b", text)
    )


async def generate_debrief(facts: Dict[str, Any], engineer: Any) -> Dict[str, str]:
    system, user = build_debrief_prompt(facts)
    try:
        text = await engineer.generate_text(system, user, max_tokens=4096)
    except Exception:
        text = None
    if is_grounded(text, facts):
        return {"summary": text.strip(), "source": "ai"}
    return {"summary": render_template_debrief(facts), "source": "template"}
