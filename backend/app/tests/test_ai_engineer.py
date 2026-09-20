from unittest.mock import AsyncMock, patch

import pytest

from app.services import ai_engineer


@pytest.mark.asyncio
async def test_answer_question_includes_historical_context_when_available():
    with patch.object(
        ai_engineer.ai_engineer, "retrieve_race_context", new=AsyncMock(return_value={
            "drivers": [], "timing": {}, "weather": None, "race_control": [],
        })
    ), patch(
        "app.services.rag_service.query_historical_context",
        return_value="## Historical Context (RAG)\n- [2023 Belgian Grand Prix — Race — VER]: some summary",
    ), patch.object(
        ai_engineer.ai_engineer, "call_llm", new=AsyncMock(return_value="final answer")
    ) as mock_call_llm:
        response = await ai_engineer.answer_question("How did VER do at Spa?", session_key=123)

    assert response == "final answer"
    call_args = mock_call_llm.call_args
    context_md_arg = call_args.args[1] if len(call_args.args) > 1 else call_args.kwargs["context_md"]
    assert "Historical Context (RAG)" in context_md_arg
    assert "some summary" in context_md_arg


@pytest.mark.asyncio
async def test_answer_question_works_when_historical_context_unavailable():
    with patch.object(
        ai_engineer.ai_engineer, "retrieve_race_context", new=AsyncMock(return_value={
            "drivers": [], "timing": {}, "weather": None, "race_control": [],
        })
    ), patch(
        "app.services.rag_service.query_historical_context", return_value=""
    ), patch.object(
        ai_engineer.ai_engineer, "call_llm", new=AsyncMock(return_value="final answer")
    ) as mock_call_llm:
        response = await ai_engineer.answer_question("Any question", session_key=123)

    assert response == "final answer"
    call_args = mock_call_llm.call_args
    context_md_arg = call_args.args[1] if len(call_args.args) > 1 else call_args.kwargs["context_md"]
    assert "Historical Context (RAG)" not in context_md_arg
