import asyncio

from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import BaseModel, field_validator, model_validator
from typing import List, Optional
from app.services.f1_data_service import f1_service
from app.services import duel_telemetry, latest_result, race_replay
from app.services import session_info as session_info_service
from app.services.race_debrief import NoResultsError
from app.services.session_info import SessionDataError

router = APIRouter()

# FastF1's session identifiers, keyed by the names used in the event schedule.
_SESSION_CODES = {
    "Practice 1": "FP1", "Practice 2": "FP2", "Practice 3": "FP3",
    "Qualifying": "Q", "Sprint Qualifying": "SQ", "Sprint Shootout": "SS",
    "Sprint": "S", "Race": "R",
}


def _weekend_sessions(schedule_row) -> List[str]:
    """The sessions this race weekend actually ran, in order (a sprint weekend has no FP2, say)."""
    codes = []
    for i in range(1, 6):
        code = _SESSION_CODES.get(str(schedule_row.get(f"Session{i}")))
        if code:
            codes.append(code)
    return codes


def _analysis_error(error: Exception, what: str) -> HTTPException:
    """Turn a failure while loading session data into the right HTTP error.

    A session that has no data (or a driver who didn't run) is the caller's 404 with a message
    written for the person using the app; anything else is logged and reported without leaking
    internals."""
    if isinstance(error, SessionDataError):
        return HTTPException(status_code=404, detail=str(error))
    print(f"Loading {what} failed: {error!r}")
    return HTTPException(status_code=502, detail=f"Couldn't load {what} right now. Try again shortly.")


class TelemetryCompareRequest(BaseModel):
    year: int
    gp: str = ""
    round: Optional[int] = None  # exact race number in the season; preferred over gp when given
    session: Optional[str] = "Race"
    driver1: str
    driver2: str
    driver1_lap: Optional[int] = None
    driver2_lap: Optional[int] = None

    @field_validator("driver1", "driver2")
    @classmethod
    def _normalise_code(cls, value: str) -> str:
        code = value.strip().upper()
        if not code:
            raise ValueError("Choose a driver.")
        return code

    @model_validator(mode="after")
    def _needs_a_race_and_two_different_laps(self):
        if not self.gp and not self.round:
            raise ValueError("Give a race name or a round number.")
        if self.driver1 == self.driver2 and self.driver1_lap == self.driver2_lap:
            raise ValueError("Pick two different drivers, or two different laps of the same driver.")
        return self

@router.get("/sessions/active")
async def get_active_session():
    """Get active session key and metadata."""
    try:
        session_key = await f1_service.get_latest_session_key()
        metadata = await f1_service.sync_session_metadata(session_key)
        if not metadata:
            raise HTTPException(status_code=404, detail="Active session not found")
        return metadata
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/sessions/{session_key}/drivers")
async def get_session_drivers(session_key: int):
    """Get all drivers for a session."""
    try:
        drivers = await f1_service.get_drivers(session_key)
        return drivers
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/sessions/{session_key}/timing")
async def get_session_timing(session_key: int):
    """Get live timing table and gaps for a session."""
    try:
        timing = await f1_service.get_live_timing(session_key)
        return timing
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/sessions/{session_key}/weather")
async def get_session_weather(session_key: int):
    """Get current weather details for a session."""
    try:
        weather = await f1_service.get_live_weather(session_key)
        if not weather:
            raise HTTPException(status_code=404, detail="Weather data not available")
        return weather
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/sessions/{session_key}/race-control")
async def get_session_race_control(session_key: int):
    """Get race control messages."""
    try:
        messages = await f1_service.get_live_race_control(session_key)
        return messages
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/sessions/{session_key}/radios")
async def get_session_radios(session_key: int):
    """Get driver team radio recordings."""
    try:
        radios = await f1_service.get_live_radios(session_key)
        return radios
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/circuits/{session_key}/layout")
async def get_circuit_layout(session_key: int, year: int = 2024, gp: str = "Belgium", session_type: str = "Race"):
    """Get circuit layout coordinates from FastF1."""
    try:
        # FastF1 is blocking, we run in thread pool
        layout = await asyncio.to_thread(f1_service.get_circuit_layout, year, gp, session_type)
        if "error" in layout:
            raise HTTPException(status_code=400, detail=layout["error"])
        return layout
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/telemetry/compare")
async def compare_telemetry(req: TelemetryCompareRequest):
    """Compare two drivers' telemetry (synchronized by distance)."""
    try:
        return await asyncio.to_thread(
            duel_telemetry.head_to_head_payload,
            req.year, req.gp, req.session, req.driver1, req.driver2, req.driver1_lap, req.driver2_lap, req.round,
        )
    except Exception as e:
        raise _analysis_error(e, "the telemetry comparison")

class PedalBehaviorRequest(BaseModel):
    year: int
    gp: str = ""
    round: Optional[int] = None
    session: Optional[str] = "Race"

    @model_validator(mode="after")
    def _needs_a_race(self):
        if not self.gp and not self.round:
            raise ValueError("Give a race name or a round number.")
        return self

@router.post("/telemetry/pedal-behavior")
async def pedal_behavior(req: PedalBehaviorRequest):
    """Analyze throttle and brake usage for the fastest lap of all drivers in the session."""
    try:
        return await asyncio.to_thread(
            duel_telemetry.pedal_behavior_payload, req.year, req.gp, req.session, req.round
        )
    except Exception as e:
        raise _analysis_error(e, "the pedal analysis")


@router.get("/stats/standings")
async def get_stats_standings(year: int = Query(...)):
    """Get driver and constructor standings for a given year."""
    try:
        standings = await f1_service.get_season_standings(year)
        if "error" in standings:
            raise HTTPException(status_code=400, detail=standings["error"])
        return standings
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/telemetry/replay")
async def get_telemetry_replay(
    year: int = Query(...),
    gp: str = Query(""),
    round: Optional[int] = Query(None),
    lap_number: int = Query(1),
):
    """One lap of a past race on the real session clock: every car's position and car data at
    each moment of the leader's lap, so the gaps between cars are true."""
    if not gp and not round:
        raise HTTPException(status_code=422, detail="Give a race name or a round number.")
    try:
        return await asyncio.to_thread(race_replay.replay_payload, year, gp, "R", lap_number, round)
    except Exception as e:
        raise _analysis_error(e, "the replay")

class AIChatRequest(BaseModel):
    session_key: int
    question: str

@router.post("/ai/chat")
async def ai_chat(req: AIChatRequest):
    """Ask the AI Race Engineer a question about the active session."""
    try:
        from app.services.ai_engineer import answer_question
        response = await answer_question(req.question, req.session_key)
        return {"response": response}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/sessions/{session_key}/strategy")
async def get_session_strategy(session_key: int):
    """Get AI Strategist recommendations and alerts for the session."""
    try:
        from app.services.ai_strategist import ai_strategist
        strategy = await ai_strategist.get_strategy_recommendations(session_key)
        return strategy
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/races/historical")
async def get_historical_races(year: int):
    """Get all races for a given year using FastF1."""
    try:
        import fastf1
        import pandas as pd
        schedule = fastf1.get_event_schedule(year)
        from app.services.predictions_service import race_start_utc

        # Filter out pre-season testing. `event_name` is the exact FastF1 EventName
        # and `race_start_utc` the real lights-out instant (null if unknown), so
        # clients can tell open races from finished ones without guessing.
        races = []
        for _, row in schedule.iterrows():
            if str(row["EventFormat"]) == "testing":
                continue
            start = race_start_utc(row)
            races.append({
                "round": int(row["RoundNumber"]) if "RoundNumber" in row and pd.notna(row["RoundNumber"]) else None,
                "country": str(row["Country"]),
                "location": str(row["Location"]),
                "event_name": str(row["EventName"]),
                "sessions": _weekend_sessions(row),
                "race_start_utc": start.strftime("%Y-%m-%dT%H:%M:%SZ") if start is not None else None,
            })
        return races
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/races/session-info")
async def get_session_info(
    year: int = Query(...),
    gp: Optional[str] = Query(None),
    round: Optional[int] = Query(None),
    session: str = Query("R"),
):
    """Who took part in a session, in which team colours, how many laps it ran, and each
    driver's actual tyre stints. Lets the UI offer only drivers and laps that exist."""
    if not gp and not round:
        raise HTTPException(status_code=422, detail="Give a race name or a round number.")
    try:
        return await asyncio.to_thread(session_info_service.session_info, year, gp or "", session, round)
    except Exception as e:
        raise _analysis_error(e, "the session details")

@router.get("/races/latest-result")
async def get_latest_race_result():
    """Final classification of the most recent completed race (results only)."""
    try:
        return await asyncio.to_thread(latest_result.latest_classification)
    except NoResultsError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        print(f"latest-result failed: {e}")  # log the cause; the client only needs what to try next
        raise HTTPException(status_code=502, detail="Couldn't load the latest race result. Try again shortly.")

@router.get("/races/results")
async def get_race_results(year: int = Query(...), round: int = Query(...)):
    """Final classification of a past race: positions, grid, status, points and team colours."""
    try:
        return await asyncio.to_thread(latest_result.race_results, year, round)
    except NoResultsError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        print(f"race results failed for {year} round {round}: {e}")  # log the cause; the client only needs what to try next
        raise HTTPException(status_code=502, detail="Couldn't load this race's results. Try again shortly.")

@router.get("/drivers/known-codes")
async def get_known_driver_codes():
    """Static fallback list of recent driver codes for UI dropdowns.

    NOT live standings — Ergast is deprecated and OpenF1 standings require a paid
    plan, and FastF1 has no fast 'get_drivers' call without loading a full session.
    Use /stats/standings for real season standings.
    """
    from app.services.f1_data_service import FALLBACK_2024_DRIVERS
    return {"driver_standings": [{"driver_code": d["code"]} for d in FALLBACK_2024_DRIVERS]}


class StintPlan(BaseModel):
    compound: str
    laps: int

class StrategySimulationRequest(BaseModel):
    year: int
    gp: str = ""
    round: Optional[int] = None
    session: Optional[str] = "Race"
    stints: List[StintPlan]
    driver_code: Optional[str] = None

    @model_validator(mode="after")
    def _needs_a_race(self):
        if not self.gp and not self.round:
            raise ValueError("Give a race name or a round number.")
        return self

@router.post("/strategy/simulate")
async def simulate_strategy(req: StrategySimulationRequest):
    """Predict a hypothetical tire strategy's race time using a degradation model
    fit to the real session's own lap data."""
    from app.services import strategy_simulator
    from app.services.session_info import load_session

    def _run():
        session = load_session(req.year, req.gp, req.session, req.round)
        laps = session.laps
        expected_total_laps = int(laps["LapNumber"].max())
        stints = [s.model_dump() for s in req.stints]
        validation_error = strategy_simulator.validate_stint_plan(stints, expected_total_laps)
        if validation_error:
            raise HTTPException(status_code=400, detail=validation_error)

        compound_stats = strategy_simulator.compute_compound_stats(laps)
        pit_loss = strategy_simulator.estimate_pit_loss_seconds(laps, compound_stats)
        prediction = strategy_simulator.simulate_stint_plan(compound_stats, stints, pit_loss)
        prediction["total_laps"] = expected_total_laps
        prediction["pit_loss_seconds_used"] = pit_loss
        prediction["compound_stats"] = compound_stats

        if req.driver_code:
            actual = strategy_simulator.get_actual_driver_total_seconds(
                laps, req.driver_code.upper(), expected_laps=expected_total_laps
            )
            if actual is not None:
                prediction["actual_driver_total_seconds"] = actual
                prediction["delta_seconds"] = prediction["predicted_total_seconds"] - actual

        return prediction

    try:
        return await asyncio.to_thread(_run)
    except HTTPException:
        raise
    except Exception as e:
        raise _analysis_error(e, "the strategy simulation")


@router.get("/share/result-card")
async def get_result_card(
    year: int = Query(...),
    gp: str = Query(...),
    driver: str = Query(...),
    session: str = Query("Race"),
):
    """Generate a shareable PNG result card for a driver's real session result."""
    try:
        from app.services.card_generator import render_result_card
        from app.services.history_summarizer import build_driver_session_summary
        from app.services.f1_data_service import FALLBACK_2024_DRIVERS

        driver_code = driver.upper()

        def _run() -> bytes:
            import fastf1
            import pandas as pd

            fastf1_session = fastf1.get_session(year, gp, session)
            fastf1_session.load(laps=True, weather=False, telemetry=False)
            laps = fastf1_session.laps
            driver_laps = laps[laps["Driver"] == driver_code]
            if driver_laps.empty:
                return None

            race_control = None
            try:
                race_control = fastf1_session.race_control_messages
            except Exception:
                pass

            summary_text, meta = build_driver_session_summary(
                laps, driver_code, gp, year, session, race_control
            )
            strategy_sentence = next(
                (s.strip() for s in summary_text.split(". ") if s.strip().startswith("Strategy:")),
                summary_text,
            )
            if not strategy_sentence.endswith("."):
                strategy_sentence += "."

            fastest = driver_laps.loc[driver_laps["LapTime"].idxmin()] if driver_laps["LapTime"].notna().any() else None
            if fastest is not None and pd.notna(fastest["LapTime"]):
                total = fastest["LapTime"].total_seconds()
                fastest_lap_str = f"{int(total // 60)}:{total % 60:06.3f}"
            else:
                fastest_lap_str = "N/A"

            position_val = driver_laps["Position"].iloc[-1] if pd.notna(driver_laps["Position"].iloc[-1]) else None
            position = int(position_val) if position_val is not None else None

            team_color = next(
                (d["team_color"] for d in FALLBACK_2024_DRIVERS if d["code"] == driver_code),
                "#E10600",
            )

            return render_result_card(
                driver_code=driver_code,
                team_color=team_color,
                position=position,
                year=year,
                event_name=gp,
                session_name=session,
                fastest_lap_str=fastest_lap_str,
                strategy_text=strategy_sentence,
            )

        png_bytes = await asyncio.to_thread(_run)
        if png_bytes is None:
            raise HTTPException(status_code=404, detail=f"No lap data found for driver {driver_code} in this session.")
        return Response(content=png_bytes, media_type="image/png")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/drivers/{driver_code}/season-insights")
async def get_driver_season_insights(driver_code: str, year: int = Query(...)):
    """Season standing plus any already-ingested race-by-race summaries (RAG corpus)
    for this driver. Insights are [] (not an error) until the ingestion script has
    been run for this year -- see the README's 'Seeding historical data' section."""
    try:
        from app.services import rag_service

        driver_code = driver_code.upper()
        standings = await f1_service.get_season_standings(year)
        standing = None
        if "driver_standings" in standings:
            standing = next(
                (d for d in standings["driver_standings"] if d.get("driver_code") == driver_code),
                None,
            )

        insights = rag_service.get_driver_season_documents(year, driver_code)

        return {
            "driver_code": driver_code,
            "year": year,
            "standing": standing,
            "insights": insights,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
