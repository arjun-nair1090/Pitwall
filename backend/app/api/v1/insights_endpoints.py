"""AI race insights: post-race debrief and what-if strategy counterfactuals."""
import asyncio
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field, model_validator

from app.services import race_debrief, whatif, whatif_graph
from app.services.ai_engineer import ai_engineer
from app.services.session_frames import LruCache, SessionFrames, load_session_frames

router = APIRouter()

# FastF1 lap-level data starts in 2018.
MIN_YEAR = 2018
MAX_YEAR = 2100
SessionName = Literal["Race", "Sprint"]

# Only LLM-written summaries are cached. A template summary is cheap to rebuild, and
# caching it would keep serving the fallback after an API key is configured.
_SUMMARY_CACHE = LruCache(maxsize=32)


async def _load_frames(year: int, gp: str, session: str) -> SessionFrames:
    try:
        return await asyncio.to_thread(load_session_frames, year, gp, session)
    except Exception as e:
        # Log the cause server-side; the client only needs to know what to try next.
        print(f"Failed to load session {year} {gp!r} {session}: {e}")
        raise HTTPException(
            status_code=502,
            detail="Couldn't load data for that session. Check the year and Grand Prix, or try again shortly.",
        )


@router.get("/debrief")
async def race_debrief_endpoint(
    year: int = Query(ge=MIN_YEAR, le=MAX_YEAR),
    gp: str = Query(min_length=1, max_length=100),
    session: SessionName = "Race",
) -> Dict[str, Any]:
    """Post-race debrief: deterministic facts plus a written summary (AI-written when a
    model is configured and its output checks out, otherwise a template)."""
    frames = await _load_frames(year, gp, session)
    try:
        facts = race_debrief.build_race_facts(
            frames.results, frames.laps, frames.race_control, frames.event_name, year, session
        )
    except race_debrief.NoResultsError as e:
        raise HTTPException(status_code=404, detail=str(e))

    key = (year, gp.strip().lower(), session)
    cached = _SUMMARY_CACHE.get(key)
    if cached is not None:
        return {"facts": facts, **cached}

    written = await race_debrief.generate_debrief(facts, ai_engineer)
    if written["source"] == "ai":
        _SUMMARY_CACHE.set(key, written)
    return {"facts": facts, **written}


class WhatIfChange(BaseModel):
    type: Literal["shift_stop", "change_compound"]
    stop: Optional[int] = Field(default=None, ge=1, le=10)
    laps: Optional[int] = Field(default=None, ge=-60, le=60)
    stint: Optional[int] = Field(default=None, ge=1, le=11)
    compound: Optional[str] = Field(default=None, max_length=20)

    @model_validator(mode="after")
    def required_fields_for_type(self) -> "WhatIfChange":
        if self.type == "shift_stop" and (self.stop is None or self.laps is None):
            raise ValueError("A pit-stop change needs both 'stop' and 'laps'.")
        if self.type == "change_compound" and (self.stint is None or not self.compound):
            raise ValueError("A compound change needs both 'stint' and 'compound'.")
        return self


class WhatIfRequest(BaseModel):
    year: int = Field(ge=MIN_YEAR, le=MAX_YEAR)
    gp: str = Field(min_length=1, max_length=100)
    session: SessionName = "Race"
    driver_code: str = Field(pattern=r"^[A-Za-z]{3}$")
    changes: List[WhatIfChange] = Field(min_length=1, max_length=5)


@router.post("/whatif")
async def whatif_endpoint(req: WhatIfRequest) -> Dict[str, Any]:
    """Counterfactual on a real driver's strategy ("what if they'd pitted 5 laps later?").

    Stateless and read-only -- it evaluates a hypothetical and stores nothing -- so, like
    /strategy/simulate, it needs no authentication."""
    frames = await _load_frames(req.year, req.gp, req.session)
    changes = [c.model_dump(exclude_none=True) for c in req.changes]
    try:
        out = await whatif_graph.run_whatif(frames.laps, req.driver_code.upper(), changes)
    except whatif.WhatIfError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return {
        **out["result"],
        "explanation": out["explanation"],
        "explanation_source": out["explanation_source"],
        "event": frames.event_name,
        "year": req.year,
        "session": req.session,
    }
