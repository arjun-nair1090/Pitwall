import os
from typing import TypedDict, Dict, Any, List
from datetime import datetime
from openai import OpenAI
from anthropic import Anthropic
from langgraph.graph import StateGraph, START, END
from app.core.config import settings
from app.services.f1_data_service import f1_service

# Define LangGraph state schema
class AgentState(TypedDict):
    question: str
    session_key: int
    context_md: str
    response: str

class AIEngineer:
    def __init__(self):
        self.openai_client = None
        self.anthropic_client = None
        
        if settings.OPENAI_API_KEY and "your_openai" not in settings.OPENAI_API_KEY:
            self.openai_client = OpenAI(api_key=settings.OPENAI_API_KEY)
        if settings.ANTHROPIC_API_KEY and "your_anthropic" not in settings.ANTHROPIC_API_KEY:
            self.anthropic_client = Anthropic(api_key=settings.ANTHROPIC_API_KEY)

    async def retrieve_race_context(self, session_key: int) -> Dict[str, Any]:
        """Fetch all relevant live context to build the prompt context."""
        drivers = await f1_service.get_drivers(session_key)
        timing = await f1_service.get_live_timing(session_key)
        weather = await f1_service.get_live_weather(session_key)
        race_control = await f1_service.get_live_race_control(session_key)
        
        context = {
            "drivers": drivers,
            "timing": timing,
            "weather": weather,
            "race_control": race_control,
            "timestamp": datetime.now().isoformat()
        }
        return context

    def format_context_as_markdown(self, context: Dict[str, Any]) -> str:
        """Format retrieved context as a clean Markdown string."""
        md = "# CURRENT F1 SESSION STATE\n\n"
        
        # Weather
        w = context.get("weather")
        if w:
            md += "## Weather Report\n"
            md += f"- Air Temp: {w.get('air_temperature')}°C\n"
            md += f"- Track Temp: {w.get('track_temperature')}°C\n"
            md += f"- Humidity: {w.get('humidity')}%\n"
            md += f"- Rainfall: {'Yes' if w.get('rainfall') == 1 else 'No'}\n"
            md += f"- Wind: {w.get('wind_speed')} m/s from {w.get('wind_direction')}°\n\n"
        
        # Leaderboard
        timing = context.get("timing", {})
        drivers_map = {d["driver_number"]: d for d in context.get("drivers", [])}
        
        md += "## Leaderboard & Live Timing\n"
        md += "| Pos | Driver | Number | Lap | Gap to Leader | Interval | Last Lap | S1 | S2 | S3 | Status |\n"
        md += "|---|---|---|---|---|---|---|---|---|---|---|\n"
        
        sorted_leaderboard = sorted(
            timing.items(),
            key=lambda x: x[1].get("position", 99)
        )
        
        for num_str, t in sorted_leaderboard:
            num = int(num_str)
            d = drivers_map.get(num, {"code": "UNK", "team_name": "Unknown"})
            status = "PIT" if t.get("is_pit") else "TRACK"
            md += f"| {t.get('position', '-')} | {d['code']} | {num} | {t.get('lap_number', '-')} | {t.get('gap_to_leader', '-')} | {t.get('gap_to_next', '-')} | {t.get('lap_time', '-')} | {t.get('s1', '-')} | {t.get('s2', '-')} | {t.get('s3', '-')} | {status} |\n"
        
        # Race Control
        rc = context.get("race_control", [])
        if rc:
            md += "\n## Race Control / Flags\n"
            for item in rc[:10]:
                md += f"- [{item.get('timestamp')}] ({item.get('category')}): {item.get('message')}\n"
                
        return md

    async def call_llm(self, question: str, context_md: str) -> str:
        """Query LLM models using OpenAI or Anthropic SDKs."""
        system_prompt = (
            "You are the Lead Race Engineer for an F1 team, working on the pit wall.\n"
            "Analyze the real-time telemetry, timing leaderboard, weather, and race control logs provided in the context.\n"
            "Answer the user's question with technical accuracy, professionalism, and high specificity.\n"
            "Always cite actual race metrics (such as lap times, sector gaps, tyre compound, or weather changes) from the context.\n"
            "If the information is not in the context, clearly state that you do not have the live telemetry for that detail.\n"
            "Never make up telemetry details. Be concise and speak like an engineer over team radio."
        )
        
        user_prompt = f"{context_md}\n\nUser Question: {question}\nResponse:"
        
        if self.anthropic_client:
            try:
                response = self.anthropic_client.messages.create(
                    model="claude-3-5-sonnet-20241022",
                    max_tokens=800,
                    system=system_prompt,
                    messages=[{"role": "user", "content": user_prompt}]
                )
                return response.content[0].text
            except Exception as e:
                print(f"Anthropic API Error: {e}")
                
        if self.openai_client:
            try:
                response = self.openai_client.chat.completions.create(
                    model="gpt-4o",
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt}
                    ],
                    max_tokens=800
                )
                return response.choices[0].message.content
            except Exception as e:
                print(f"OpenAI API Error: {e}")
        
        fallback_msg = (
            "**[PIT WALL AI ENGINEER MESSAGE]**\n"
            "LLM API client is offline or credentials are not configured. However, F1 Live Context is active:\n\n"
            f"{context_md}\n"
            "Configure a valid `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` in your `.env` file to enable AI insights."
        )
        return fallback_msg

ai_engineer = AIEngineer()

# --- LangGraph Workflow Definition ---

async def retrieve_context_node(state: AgentState) -> Dict[str, Any]:
    context = await ai_engineer.retrieve_race_context(state["session_key"])
    context_md = ai_engineer.format_context_as_markdown(context)
    return {"context_md": context_md}

async def generate_response_node(state: AgentState) -> Dict[str, Any]:
    response = await ai_engineer.call_llm(state["question"], state["context_md"])
    return {"response": response}

# Compile Workflow Graph
workflow = StateGraph(AgentState)
workflow.add_node("retrieve_context", retrieve_context_node)
workflow.add_node("generate_response", generate_response_node)

workflow.add_edge(START, "retrieve_context")
workflow.add_edge("retrieve_context", "generate_response")
workflow.add_edge("generate_response", END)

graph = workflow.compile()

# Unified wrapper
async def answer_question(question: str, session_key: int) -> str:
    res = await graph.ainvoke({"question": question, "session_key": session_key})
    return res["response"]
