from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
from app.services.f1_data_service import f1_service

router = APIRouter()

class TelemetryCompareRequest(BaseModel):
    year: int
    gp: str
    driver1: str
    driver2: str

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
        comparison = await f1_service.fetch_historical_comparison(
            req.year, req.gp, req.driver1, req.driver2
        )
        if "error" in comparison:
            raise HTTPException(status_code=400, detail=comparison["error"])
        return comparison
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

