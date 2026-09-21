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


# --- generate_text: shared, non-blocking LLM access --------------------------

from types import SimpleNamespace  # noqa: E402


class _FakeAnthropic:
    def __init__(self, content=None, error=None):
        self.calls = []
        self._content = content
        self._error = error
        self.messages = SimpleNamespace(create=self._create)

    def _create(self, **kwargs):
        self.calls.append(kwargs)
        if self._error:
            raise self._error
        return SimpleNamespace(content=self._content)


class _FakeOpenAI:
    def __init__(self, text=None, error=None):
        self.calls = []
        completions = SimpleNamespace(create=self._create)
        self.chat = SimpleNamespace(completions=completions)
        self._text = text
        self._error = error

    def _create(self, **kwargs):
        self.calls.append(kwargs)
        if self._error:
            raise self._error
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=self._text))])


def _engine(anthropic_client=None, openai_client=None):
    engine = ai_engineer.AIEngineer.__new__(ai_engineer.AIEngineer)
    engine.anthropic_client = anthropic_client
    engine.openai_client = openai_client
    return engine


@pytest.mark.asyncio
async def test_generate_text_reads_the_text_block_even_when_a_thinking_block_comes_first():
    # Current Claude models think by default, so content[0] is often a thinking
    # block -- indexing content[0].text would raise or return the wrong thing.
    content = [
        SimpleNamespace(type="thinking", thinking=""),
        SimpleNamespace(type="text", text="The debrief text."),
    ]
    engine = _engine(anthropic_client=_FakeAnthropic(content=content))
    assert await engine.generate_text("sys", "user") == "The debrief text."


@pytest.mark.asyncio
async def test_generate_text_uses_the_configured_model_and_passes_prompts_through():
    fake = _FakeAnthropic(content=[SimpleNamespace(type="text", text="ok")])
    engine = _engine(anthropic_client=fake)
    await engine.generate_text("the system prompt", "the user prompt", max_tokens=1234)

    call = fake.calls[0]
    assert call["model"] == ai_engineer.settings.ANTHROPIC_MODEL
    assert call["system"] == "the system prompt"
    assert call["messages"] == [{"role": "user", "content": "the user prompt"}]
    assert call["max_tokens"] == 1234


@pytest.mark.asyncio
async def test_generate_text_only_sends_effort_to_models_that_support_it(monkeypatch):
    content = [SimpleNamespace(type="text", text="ok")]

    supported = _FakeAnthropic(content=content)
    monkeypatch.setattr(ai_engineer.settings, "ANTHROPIC_MODEL", "claude-opus-5")
    await _engine(anthropic_client=supported).generate_text("s", "u")
    assert supported.calls[0]["output_config"] == {"effort": "low"}

    unsupported = _FakeAnthropic(content=content)
    monkeypatch.setattr(ai_engineer.settings, "ANTHROPIC_MODEL", "claude-haiku-4-5")
    await _engine(anthropic_client=unsupported).generate_text("s", "u")
    assert "output_config" not in unsupported.calls[0]


@pytest.mark.asyncio
async def test_generate_text_falls_back_to_openai_when_anthropic_fails():
    engine = _engine(
        anthropic_client=_FakeAnthropic(error=RuntimeError("model unavailable")),
        openai_client=_FakeOpenAI(text="from openai"),
    )
    assert await engine.generate_text("s", "u") == "from openai"


@pytest.mark.asyncio
async def test_generate_text_falls_back_to_openai_when_anthropic_returns_no_text():
    engine = _engine(
        anthropic_client=_FakeAnthropic(content=[SimpleNamespace(type="thinking", thinking="")]),
        openai_client=_FakeOpenAI(text="from openai"),
    )
    assert await engine.generate_text("s", "u") == "from openai"


@pytest.mark.asyncio
async def test_generate_text_returns_none_when_no_provider_is_available():
    assert await _engine().generate_text("s", "u") is None
    both_fail = _engine(
        anthropic_client=_FakeAnthropic(error=RuntimeError("x")),
        openai_client=_FakeOpenAI(error=RuntimeError("y")),
    )
    assert await both_fail.generate_text("s", "u") is None


@pytest.mark.asyncio
async def test_generate_text_never_blocks_the_event_loop():
    import asyncio
    import threading
    seen = {}

    class _Recording(_FakeAnthropic):
        def _create(self, **kwargs):
            seen["thread"] = threading.current_thread()
            return SimpleNamespace(content=[SimpleNamespace(type="text", text="ok")])

    await _engine(anthropic_client=_Recording()).generate_text("s", "u")
    assert seen["thread"] is not threading.main_thread()


@pytest.mark.asyncio
async def test_call_llm_returns_the_offline_notice_when_no_provider_is_available():
    result = await _engine().call_llm("q", "some context")
    assert "some context" in result
    assert "API_KEY" in result
