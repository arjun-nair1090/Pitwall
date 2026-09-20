from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
from app.services.f1_data_service import f1_service

router = APIRouter()

class TelemetryCompareRequest(BaseModel):
    year: int
    gp: str
    session: Optional[str] = "Race"
    driver1: str
    driver2: str
    driver1_lap: Optional[int] = None
    driver2_lap: Optional[int] = None

@router.get("/sessions/active")
async def get_active_session():
    """Get active session key and metadata."""
    try:
        session_key = await f1_service.get_latest_session_key()
        metadata = await f1_service.sync_session_metadata(session_key)
        if not metadata:
            raise HTTPException(status_code=404, detail="Active session not found")
        return metadata
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
        import asyncio
        layout = await asyncio.to_thread(f1_service.get_circuit_layout, year, gp, session_type)
        if "error" in layout:
            raise HTTPException(status_code=400, detail=layout["error"])
        return layout
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/telemetry/compare")
async def compare_telemetry(req: TelemetryCompareRequest):
    """Compare two drivers' telemetry (synchronized by distance)."""
    try:
        comparison = await f1_service.get_head_to_head_telemetry(
            req.year, req.gp, req.session, req.driver1, req.driver2, req.driver1_lap, req.driver2_lap
        )
        if "error" in comparison:
            raise HTTPException(status_code=400, detail=comparison["error"])
        return comparison
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/telemetry/dominance")
async def dominance_map(req: TelemetryCompareRequest):
    """Generate a track dominance map comparing two drivers' mini-sectors."""
    try:
        dominance = await f1_service.get_dominance_map(
            req.year, req.gp, req.session, req.driver1, req.driver2
        )
        if "error" in dominance:
            raise HTTPException(status_code=400, detail=dominance["error"])
        return dominance
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class PedalBehaviorRequest(BaseModel):
    year: int
    gp: str
    session: Optional[str] = "Race"

@router.post("/telemetry/pedal-behavior")
async def pedal_behavior(req: PedalBehaviorRequest):
    """Analyze throttle and brake usage for the fastest lap of all drivers in the session."""
    try:
        behavior = await f1_service.get_pedal_behavior(
            req.year, req.gp, req.session
        )
        if "error" in behavior:
            raise HTTPException(status_code=400, detail=behavior["error"])
        return behavior
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/stats/standings")
async def get_stats_standings(year: int = Query(...)):
    """Get driver and constructor standings for a given year."""
    try:
        standings = await f1_service.get_season_standings(year)
        if "error" in standings:
            raise HTTPException(status_code=400, detail=standings["error"])
        return standings
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/telemetry/replay")
async def get_telemetry_replay(year: int = Query(...), gp: str = Query(...), lap_number: Optional[int] = Query(None)):
    """Fetch downsampled historical telemetry for full race replay."""
    try:
        replay = await f1_service.get_historical_replay(year, gp, lap_number)
        if "error" in replay:
            raise HTTPException(status_code=400, detail=replay["error"])
        return replay
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

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


class CommentaryRequest(BaseModel):
    event_description: str

@router.post("/ai/commentary")
async def ai_commentary(req: CommentaryRequest):
    """Generate live F1 commentary for a given on-track event description."""
    try:
        import asyncio
        from app.services.ai_commentator import ai_commentator
        commentary = await asyncio.to_thread(ai_commentator.generate_commentary, req.event_description)
        return {"commentary": commentary}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/races/historical")
async def get_historical_races(year: int):
    """Get all races for a given year using FastF1."""
    try:
        import fastf1
        schedule = fastf1.get_event_schedule(year)
        # Filter out pre-season testing and return countries
        races = [{"country": str(row["Country"]), "location": str(row["Location"])} for _, row in schedule.iterrows() if str(row["EventFormat"]) != "testing"]
        return races
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

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
    gp: str
    session: Optional[str] = "Race"
    stints: List[StintPlan]
    driver_code: Optional[str] = None

@router.post("/strategy/simulate")
async def simulate_strategy(req: StrategySimulationRequest):
    """Predict a hypothetical tire strategy's race time using a degradation model
    fit to the real session's own lap data."""
    try:
        import asyncio
        from app.services import strategy_simulator

        def _run():
            import fastf1
            session = fastf1.get_session(req.year, req.gp, req.session)
            session.load(laps=True, weather=False, telemetry=False)
            laps = session.laps
            if laps.empty:
                return {"error": "No lap data available for this session."}

            expected_total_laps = int(laps["LapNumber"].max())
            stints = [s.model_dump() for s in req.stints]
            validation_error = strategy_simulator.validate_stint_plan(stints, expected_total_laps)
            if validation_error:
                return {"error": validation_error}

            compound_stats = strategy_simulator.compute_compound_stats(laps)
            pit_loss = strategy_simulator.estimate_pit_loss_seconds(laps, compound_stats)
            prediction = strategy_simulator.simulate_stint_plan(compound_stats, stints, pit_loss)
            prediction["pit_loss_seconds_used"] = pit_loss
            prediction["compound_stats"] = compound_stats

            if req.driver_code:
                actual = strategy_simulator.get_actual_driver_total_seconds(laps, req.driver_code.upper())
                if actual is not None:
                    prediction["actual_driver_total_seconds"] = actual
                    prediction["delta_seconds"] = prediction["predicted_total_seconds"] - actual

            return prediction

        result = await asyncio.to_thread(_run)
        if "error" in result:
            raise HTTPException(status_code=400, detail=result["error"])
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/share/result-card")
async def get_result_card(
    year: int = Query(...),
    gp: str = Query(...),
    driver: str = Query(...),
    session: str = Query("Race"),
):
    """Generate a shareable PNG result card for a driver's real session result."""
    try:
        import asyncio
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
