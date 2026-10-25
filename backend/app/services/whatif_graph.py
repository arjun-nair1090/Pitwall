"""LangGraph flow for what-if counterfactuals.

    START -> simulate -> explain -> END

``simulate`` runs the deterministic tyre-degradation counterfactual (whatif.compute_whatif);
``explain`` asks the LLM to put the result into words, with a grounded template fallback.
The graph is sequential on purpose: the explanation must never start before -- or be
produced without -- a valid simulation, so an invalid hypothetical raises before the LLM
is ever called."""
import asyncio
import functools
from typing import Any, Dict, List, TypedDict

from app.services import whatif
from app.services.ai_engineer import ai_engineer


class WhatIfState(TypedDict):
    laps: Any
    driver_code: str
    changes: List[Dict[str, Any]]
    result: Dict[str, Any]
    explanation: str
    explanation_source: str


async def simulate_node(state: WhatIfState) -> Dict[str, Any]:
    result = await asyncio.to_thread(whatif.compute_whatif, state["laps"], state["driver_code"], state["changes"])
    return {"result": result}


async def explain_node(state: WhatIfState) -> Dict[str, Any]:
    out = await whatif.explain(state["result"], ai_engineer)
    return {"explanation": out["explanation"], "explanation_source": out["source"]}


# Compiled on first use: LangGraph takes most of a second to import.
@functools.cache
def _graph():
    from langgraph.graph import END, START, StateGraph

    workflow = StateGraph(WhatIfState)
    workflow.add_node("simulate", simulate_node)
    workflow.add_node("explain", explain_node)
    workflow.add_edge(START, "simulate")
    workflow.add_edge("simulate", "explain")
    workflow.add_edge("explain", END)
    return workflow.compile()


async def run_whatif(laps: Any, driver_code: str, changes: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Raises whatif.WhatIfError for an invalid hypothetical."""
    final = await _graph().ainvoke({
        "laps": laps,
        "driver_code": driver_code,
        "changes": changes,
        "result": {},
        "explanation": "",
        "explanation_source": "",
    })
    return {
        "result": final["result"],
        "explanation": final["explanation"],
        "explanation_source": final["explanation_source"],
    }
