"""Answer a fan's question by letting a language model call the app's own analyses as tools.

The model never sees raw payloads: each tool returns a short summary (a few thousand characters at
most) and the model may only report what those summaries say. Every call made is returned alongside
the answer so the page can link to the analysis behind it."""
import asyncio
import json
from datetime import date
from typing import Any, Callable, Dict, List, Optional, Tuple

from fastapi import HTTPException

from app.core.config import settings
from app.services import (
    championship_data, latest_result, pit_window, race_battles, race_pace, win_probability,
)
from app.services.championship_sim import ChampionshipError
from app.services.llm_utils import extract_text, supports_effort
from app.services.race_debrief import NoResultsError
from app.services.session_info import SessionDataError

MAX_TOOL_ROUNDS = 6
MAX_TOKENS = 2048
MAX_RESULT_CHARS = 4000
NO_ANSWER = "Sorry, I couldn't put an answer together. Try rephrasing the question."
FAILED = "That analysis failed to load."
_TRUNCATED = " ...(cut short)"

_SERVICE_ERRORS = (SessionDataError, ChampionshipError, NoResultsError, ValueError, HTTPException)


def system_prompt() -> str:
    return (
        "You answer questions about Formula 1 using only the results of the tools provided. "
        "Never use outside knowledge for numbers, results or facts. If the tools can't answer, say so plainly.\n"
        "Seasons 2018 onward. Telemetry-based tools (race pace, overtakes, pit window, win probability) "
        "only work for sessions this server has data for. If one returns an error, say that race isn't "
        "available here.\n"
        "Keep answers under 150 words, in plain sentences, no tables. Name drivers by surname. "
        "Round times to 0.1 s unless a smaller gap matters.\n"
        f"Today's date is {date.today().isoformat()}."
    )


# ---- the condensers: a payload in, a small summary out ----

def condense_season_schedule(schedule: Any) -> List[Dict[str, Any]]:
    return [
        {"round": int(r["round"]), "name": str(r["name"]), "date": str(r["date"])[:10], "sprint": bool(r["sprint"])}
        for _, r in schedule.iterrows()
    ]


def condense_race_result(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    rows = payload["classification"]
    shown = rows[:10] + [r for r in rows[10:] if not r.get("finished")]
    return [{"position": r["position"], "code": r["code"], "team": r["team"],
             "points": r.get("points"), "status": r.get("status")} for r in shown]


def condense_championship_odds(payload: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "after_round": payload["after_round"],
        "drivers": [{"code": d["code"], "points": d["points"], "title_probability": d["title_probability"],
                     "status": d["status"]} for d in payload["drivers"][:8]],
        "constructors": [{"team": c["team"], "points": c["points"], "title_probability": c["title_probability"],
                          "status": c["status"]} for c in payload["constructors"][:4]],
        "points_available": payload["points_available"],
    }


def condense_race_pace(payload: Dict[str, Any]) -> Dict[str, Any]:
    ranked = [d for d in payload["drivers"] if d.get("gap") is not None][:10]
    return {
        "drivers": [{"code": d["code"], "pace_gap_s": round(float(d["gap"]), 3), "clean_laps": d["clean_laps"]}
                    for d in ranked],
        "compounds": [{"compound": c["compound"], "deg_per_lap": round(float(c["deg_per_lap"]), 3)}
                      for c in payload["compounds"]],
    }


def condense_overtakes(payload: Dict[str, Any]) -> Dict[str, Any]:
    drivers = [{"code": d["code"], "start_gain": d["start_gain"], "made": d["made"], "lost": d["lost"]}
               for d in payload["drivers"] if d["start_gain"] or d["made"] or d["lost"]]
    longest = sorted(payload["battles"], key=lambda b: (-b["laps"], b["start_lap"]))[:5]
    return {
        "total_passes": len(payload["overtakes"]),
        "drivers": drivers,
        "battles": [{"chaser": b["chaser"], "leader": b["leader"], "laps": b["laps"], "start_lap": b["start_lap"],
                     "end_lap": b["end_lap"], "outcome": b["outcome"]} for b in longest],
    }


def condense_pit_window(payload: Dict[str, Any]) -> Dict[str, Any]:
    def window(d: Dict[str, Any]) -> Optional[Dict[str, int]]:
        w = d.get("window")
        return {"open": w["open"], "close": w["close"]} if w else None

    return {
        "lap": payload["lap"],
        "total_laps": payload["total_laps"],
        "drivers": [{"code": d["code"], "position": d["position"], "compound": d["compound"],
                     "tyre_age": d["tyre_age"], "status": d["status"], "window": window(d)}
                    for d in payload["drivers"]],
        "undercuts": [{"chaser": u["chaser"], "leader": u["leader"], "gap": u["gap"], "margin": u["margin"],
                       "verdict": u["verdict"]} for u in payload["undercuts"][:5]],
    }


def condense_win_probability(payload: Dict[str, Any]) -> Dict[str, Any]:
    at = payload["at"]
    top = sorted(at["rows"], key=lambda r: -r["probability"])[:5]
    favourite = []
    for entry in payload["laps"]:
        if entry["lap"] % 5 == 0 and entry["odds"]:
            code, p = max(entry["odds"].items(), key=lambda kv: kv[1])
            favourite.append({"lap": entry["lap"], "code": code, "p": p})
    return {
        "lap": at["lap"],
        "total_laps": payload["total_laps"],
        "top": [{"code": r["code"], "probability": r["probability"], "gap": r["gap"],
                 "projected_gap": r["projected_gap"]} for r in top],
        "favourite": favourite,
    }


# ---- the tools ----

def _race_tool(description: str, extra: Optional[Dict[str, Any]] = None, session: bool = True) -> Dict[str, Any]:
    properties: Dict[str, Any] = {
        "year": {"type": "integer", "description": "The season, 2018 or later."},
        "round": {"type": "integer", "description": "The race's round number in that season."},
    }
    if session:
        properties["session"] = {"type": "string", "enum": ["R", "S"],
                                 "description": "R for the race (the default), S for the sprint."}
    properties.update(extra or {})
    return {"description": description, "properties": properties}


_SPECS: Dict[str, Dict[str, Any]] = {
    "season_schedule": {
        "description": "The race calendar of a season: each round's number, name, date and whether it has a sprint.",
        "properties": {"year": {"type": "integer", "description": "The season, 2018 or later."}},
        "required": ["year"],
    },
    "race_result": {
        **_race_tool("The final classification of a race: the top ten and every car that didn't finish, "
                     "with team, points and finishing status.", session=False),
        "required": ["year", "round"],
    },
    "championship_odds": {
        "description": "The title race after a round: points, each contender's chance of the championship and "
                       "whether it is clinched or out of reach, for drivers and constructors. Defaults to the "
                       "latest completed round.",
        "properties": {
            "year": {"type": "integer", "description": "The season, 2018 or later."},
            "after_round": {"type": "integer", "description": "Judge the standings after this round."},
        },
        "required": ["year"],
    },
    "race_pace": {
        **_race_tool("Who was fastest on race pace, fuel-corrected, and how fast each tyre compound wore."),
        "required": ["year", "round"],
    },
    "overtakes": {
        **_race_tool("How many on-track passes there were, who gained or lost places at the start and in "
                     "passes, and the longest battles between cars."),
        "required": ["year", "round"],
    },
    "pit_window": {
        **_race_tool("Each driver's pit window, tyre state and the undercuts on, at the end of a given lap.",
                     {"lap": {"type": "integer", "description": "The lap to look at."}}),
        "required": ["year", "round", "lap"],
    },
    "win_probability": {
        **_race_tool("Each driver's chance of winning the race at a given lap, worked out from only the laps "
                     "run so far, and who was the favourite as the race went on. Defaults to half distance.",
                     {"lap": {"type": "integer", "description": "The lap to look at."}}),
        "required": ["year", "round"],
    },
}

TOOLS: List[Dict[str, Any]] = [
    {"name": name, "description": spec["description"],
     "input_schema": {"type": "object", "properties": spec["properties"], "required": spec["required"]}}
    for name, spec in _SPECS.items()
]

_ENUMS = {"session": ("R", "S")}
_DEFAULTS = {"session": "R"}


def _clean(name: str, args: Any) -> Dict[str, Any]:
    """The input the tool will run with, or a ValueError the model can read and correct."""
    spec = _SPECS[name]
    if not isinstance(args, dict):
        raise ValueError("The tool input must be an object.")
    clean: Dict[str, Any] = {}
    for key in spec["properties"]:
        value = args.get(key)
        if value is None:
            if key in spec["required"]:
                raise ValueError(f"{key} is required.")
            if key in _DEFAULTS:
                clean[key] = _DEFAULTS[key]
            continue
        if key in _ENUMS:
            if value not in _ENUMS[key]:
                raise ValueError(f"{key} must be one of {', '.join(_ENUMS[key])}.")
        elif isinstance(value, bool) or not isinstance(value, int):
            raise ValueError(f"{key} must be a whole number.")
        elif value < 1:
            raise ValueError(f"{key} must be 1 or more.")
        clean[key] = value
    return clean


def _season_schedule(year: int) -> Any:
    return condense_season_schedule(championship_data._season(year)[2])


def _race_result(year: int, round: int) -> Any:
    return condense_race_result(latest_result.race_results(year, round))


def _championship_odds(year: int, after_round: Optional[int] = None) -> Any:
    return condense_championship_odds(championship_data.championship_odds(year, after_round))


def _race_pace(year: int, round: int, session: str = "R") -> Any:
    return condense_race_pace(race_pace.race_pace_payload(year, "", session, round))


def _overtakes(year: int, round: int, session: str = "R") -> Any:
    return condense_overtakes(race_battles.race_battles_payload(year, "", session, round))


def _pit_window(year: int, round: int, lap: int, session: str = "R") -> Any:
    return condense_pit_window(pit_window.pit_window_replay(year, "", session, round, lap))


def _win_probability(year: int, round: int, session: str = "R", lap: Optional[int] = None) -> Any:
    return condense_win_probability(win_probability.win_probability_replay(year, "", session, round, lap))


_IMPLEMENTATIONS: Dict[str, Callable[..., Any]] = {
    "season_schedule": _season_schedule,
    "race_result": _race_result,
    "championship_odds": _championship_odds,
    "race_pace": _race_pace,
    "overtakes": _overtakes,
    "pit_window": _pit_window,
    "win_probability": _win_probability,
}


def _dump(result: Any) -> str:
    out = json.dumps(result)
    if len(out) > MAX_RESULT_CHARS:
        out = out[: MAX_RESULT_CHARS - len(_TRUNCATED)] + _TRUNCATED
    return out


def run_tool(name: str, args: Any) -> Tuple[str, bool]:
    """Run one tool. Returns (text for the model, ok). Never raises. Blocking: call it in a thread."""
    if name not in _SPECS:
        return f"Unknown tool: {name}.", False
    try:
        clean = _clean(name, args)
    except ValueError as e:
        return str(e), False
    return _run_clean(name, clean)


def _run_clean(name: str, clean: Dict[str, Any]) -> Tuple[str, bool]:
    try:
        return _dump(_IMPLEMENTATIONS[name](**clean)), True
    except HTTPException as e:
        return str(e.detail), False
    except _SERVICE_ERRORS as e:
        return str(e), False
    except Exception as e:
        print(f"The assistant's {name} tool failed: {e!r}")
        return FAILED, False


# ---- the loop ----

def make_client() -> Any:
    """A client built from settings, or None when no usable key is configured."""
    key = settings.ANTHROPIC_API_KEY
    if not key or "your_anthropic" in key:
        return None
    from anthropic import Anthropic
    return Anthropic(api_key=key)


def _conversation(question: str, history: List[Dict[str, str]]) -> List[Dict[str, Any]]:
    """The earlier turns as plain text, then the question, alternating user and assistant."""
    turns = [(h["role"], h["text"]) for h in history] + [("user", question)]
    messages: List[Dict[str, Any]] = []
    for role, body in turns:
        if not messages and role != "user":
            continue
        if messages and messages[-1]["role"] == role:
            messages[-1]["content"] += "\n" + body
        else:
            messages.append({"role": role, "content": body})
    return messages


async def _call(client: Any, messages: List[Dict[str, Any]], forced_text: bool) -> Any:
    kwargs: Dict[str, Any] = dict(
        model=settings.ANTHROPIC_MODEL, max_tokens=MAX_TOKENS, system=system_prompt(),
        messages=messages, tools=TOOLS,
    )
    if supports_effort(settings.ANTHROPIC_MODEL):
        kwargs["output_config"] = {"effort": "low"}
    if forced_text:
        kwargs["tool_choice"] = {"type": "none"}
    return await asyncio.to_thread(client.messages.create, **kwargs)


async def _run_block(block: Any) -> Tuple[Dict[str, Any], Optional[Dict[str, Any]]]:
    """(the tool_result block, the source it came from or None)."""
    name, args = block.name, block.input
    if name not in _SPECS:
        text, ok, source = f"Unknown tool: {name}.", False, None
    else:
        try:
            clean = _clean(name, args)
        except ValueError as e:
            text, ok, source = str(e), False, None
        else:
            text, ok = await asyncio.to_thread(_run_clean, name, clean)
            source = {"tool": name, "input": clean, "ok": ok}
    result: Dict[str, Any] = {"type": "tool_result", "tool_use_id": block.id, "content": text}
    if not ok:
        result["is_error"] = True
    return result, source


async def ask(question: str, history: List[Dict[str, str]], client: Any = None) -> Dict[str, Any]:
    client = client if client is not None else make_client()
    if client is None:
        raise RuntimeError("No client is configured.")
    messages = _conversation(question, history)
    sources: List[Dict[str, Any]] = []
    seen = set()

    response = await _call(client, messages, forced_text=False)
    rounds = 0
    while response.stop_reason == "tool_use" and rounds < MAX_TOOL_ROUNDS:
        blocks = [b for b in response.content if getattr(b, "type", None) == "tool_use"]
        if not blocks:
            break
        rounds += 1
        outcomes = await asyncio.gather(*(_run_block(b) for b in blocks))
        for _, source in outcomes:
            if source is None:
                continue
            key = (source["tool"], json.dumps(source["input"], sort_keys=True))
            if key not in seen:
                seen.add(key)
                sources.append(source)
        messages.append({"role": "assistant", "content": response.content})
        messages.append({"role": "user", "content": [result for result, _ in outcomes]})
        response = await _call(client, messages, forced_text=rounds >= MAX_TOOL_ROUNDS)

    return {"answer": extract_text(response) or NO_ANSWER, "sources": sources}
