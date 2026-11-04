"""Gemini, through its OpenAI-compatible endpoint, driving the same loops as Claude. No network."""
import asyncio
from types import SimpleNamespace

from openai.types.chat import ChatCompletion

from app.services import ai_engineer, data_assistant, gemini_chat


def completion(message, finish="stop"):
    return ChatCompletion.model_validate({
        "id": "c", "object": "chat.completion", "created": 0, "model": "gemini",
        "choices": [{"index": 0, "finish_reason": finish, "message": {"role": "assistant", **message}}],
    })


class FakeOpenAI:
    """Shaped like openai.AsyncOpenAI: await client.chat.completions.create(...) and await client.close()."""

    def __init__(self, *scripted):
        self.scripted = list(scripted)
        self.calls = []
        self.chat = SimpleNamespace(completions=self)
        self.closed = False

    async def create(self, **kwargs):
        self.calls.append({**kwargs, "messages": [dict(m) for m in kwargs["messages"]]})
        return self.scripted.pop(0)

    async def close(self):
        self.closed = True


CALL = {"id": "call_1", "type": "function", "function": {"name": "race_pace", "arguments": '{"year": 2024, "round": 14}'},
        # Gemini 3 rejects the next turn unless each tool call comes back with its signature
        "extra_content": {"google": {"thought_signature": "sig"}}}


def test_the_assistant_loop_runs_on_gemini(monkeypatch):
    monkeypatch.setitem(data_assistant._IMPLEMENTATIONS, "race_pace", lambda **_: {"leader": "VER"})
    fake = FakeOpenAI(completion({"content": None, "tool_calls": [CALL]}, "tool_calls"),
                      completion({"content": "Verstappen had the best pace."}))
    out = asyncio.run(data_assistant.ask("Pace at Spa 2024?", [], client=gemini_chat.GeminiClient(fake)))

    assert out["answer"] == "Verstappen had the best pace."
    assert out["sources"] == [{"tool": "race_pace", "input": {"year": 2024, "round": 14, "session": "R"}, "ok": True}]
    first, second = fake.calls
    assert first["messages"][0]["role"] == "system"
    assert first["tools"][0]["function"]["name"] == "season_schedule"
    assistant, tool = second["messages"][-2:]
    assert assistant["tool_calls"][0]["extra_content"] == CALL["extra_content"]
    assert tool == {"role": "tool", "tool_call_id": "call_1", "content": '{"leader": "VER"}'}


def test_unreadable_arguments_go_back_to_the_model_as_an_error(monkeypatch):
    bad = {**CALL, "function": {"name": "race_pace", "arguments": "{oops"}}
    fake = FakeOpenAI(completion({"content": None, "tool_calls": [bad]}, "tool_calls"), completion({"content": "Sorry."}))
    out = asyncio.run(data_assistant.ask("Pace?", [], client=gemini_chat.GeminiClient(fake)))
    assert out["answer"] == "Sorry." and out["sources"] == []
    assert fake.calls[1]["messages"][-1]["content"] == "The tool input must be an object."


def test_a_cut_off_reply_is_marked_and_forced_text_disables_tools():
    fake = FakeOpenAI(completion({"content": "Half an ans"}, "length"))
    r = asyncio.run(gemini_chat.GeminiClient(fake).messages.create(
        model="ignored", max_tokens=10, system="s", messages=[{"role": "user", "content": "q"}],
        tools=data_assistant.TOOLS, tool_choice={"type": "none"}))
    assert r.stop_reason == "max_tokens"
    assert fake.calls[0]["tool_choice"] == "none"


def test_make_client_prefers_claude_then_gemini(monkeypatch):
    monkeypatch.setattr(data_assistant.settings, "ANTHROPIC_API_KEY", "")
    monkeypatch.setattr(data_assistant.settings, "GEMINI_API_KEY", "your_gemini_api_key_here")
    assert data_assistant.make_client() is None
    monkeypatch.setattr(data_assistant.settings, "GEMINI_API_KEY", "test-not-real")
    client = data_assistant.make_client()
    try:
        assert isinstance(client, gemini_chat.GeminiClient)
    finally:
        asyncio.run(client.close())


def test_the_engineer_writes_with_gemini_when_it_is_the_only_key(monkeypatch):
    for key in ("ANTHROPIC_API_KEY", "OPENAI_API_KEY"):
        monkeypatch.setattr(ai_engineer.settings, key, "")
    monkeypatch.setattr(ai_engineer.settings, "GEMINI_API_KEY", "test-not-real")
    engineer = ai_engineer.AIEngineer()
    seen = {}

    def create(**kwargs):
        seen.update(kwargs)
        return completion({"content": "Box this lap."})

    monkeypatch.setattr(engineer.gemini_client.chat.completions, "create", create)
    assert asyncio.run(engineer.generate_text("sys", "user")) == "Box this lap."
    assert seen["model"] == ai_engineer.settings.GEMINI_MODEL


# ---- Groq takes over when Gemini's free daily allowance runs out ----

def _rate_limited():
    import httpx
    import openai
    request = httpx.Request("POST", "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions")
    return openai.RateLimitError("Quota exceeded: requests per day", response=httpx.Response(429, request=request), body=None)


class RateLimitedOpenAI(FakeOpenAI):
    """Answers the scripted replies, then is rate limited like a used-up free tier."""

    async def create(self, **kwargs):
        if not self.scripted:
            raise _rate_limited()
        return await super().create(**kwargs)


def test_groq_takes_over_mid_question_when_gemini_is_rate_limited(monkeypatch):
    monkeypatch.setitem(data_assistant._IMPLEMENTATIONS, "race_pace", lambda **_: {"leader": "VER"})
    gemini = RateLimitedOpenAI(completion({"content": None, "tool_calls": [CALL]}, "tool_calls"))
    groq = FakeOpenAI(completion({"content": "Verstappen had the best pace."}))
    client = gemini_chat.FallbackClient(gemini_chat.GeminiClient(gemini), gemini_chat.GroqClient(groq))

    out = asyncio.run(data_assistant.ask("Pace at Spa 2024?", [], client=client))

    assert out["answer"] == "Verstappen had the best pace."
    assert groq.calls[0]["model"] == gemini_chat.settings.GROQ_MODEL
    # Gemini's private signature field isn't sent to Groq; the standard parts of the call are
    replayed = groq.calls[0]["messages"][-2]["tool_calls"][0]
    assert replayed == {"id": "call_1", "type": "function", "function": CALL["function"]}
    asyncio.run(client.close())
    assert gemini.closed and groq.closed


def test_the_last_provider_being_rate_limited_still_reaches_the_caller():
    import openai
    import pytest
    client = gemini_chat.FallbackClient(gemini_chat.GeminiClient(RateLimitedOpenAI()), gemini_chat.GroqClient(RateLimitedOpenAI()))
    with pytest.raises(openai.RateLimitError):
        asyncio.run(client.messages.create(max_tokens=10, system="s", messages=[{"role": "user", "content": "q"}]))


def test_after_a_rate_limit_the_next_questions_go_straight_to_groq():
    gemini = RateLimitedOpenAI()
    first = gemini_chat.FallbackClient(gemini_chat.GeminiClient(gemini), gemini_chat.GroqClient(FakeOpenAI(completion({"content": "a"}))))
    asyncio.run(first.messages.create(max_tokens=10, system="s", messages=[{"role": "user", "content": "q"}]))
    fresh_gemini = FakeOpenAI(completion({"content": "from gemini"}))
    groq = FakeOpenAI(completion({"content": "from groq"}))
    second = gemini_chat.FallbackClient(gemini_chat.GeminiClient(fresh_gemini), gemini_chat.GroqClient(groq))
    r = asyncio.run(second.messages.create(max_tokens=10, system="s", messages=[{"role": "user", "content": "q"}]))
    assert r.content[0].text == "from groq" and fresh_gemini.calls == []


def test_a_gemini_outage_also_hands_over_to_groq():
    import httpx
    import openai

    class Down(FakeOpenAI):
        async def create(self, **kwargs):
            raise openai.APIConnectionError(request=httpx.Request("POST", "https://gemini.example"))

    groq = FakeOpenAI(completion({"content": "from groq"}))
    client = gemini_chat.FallbackClient(gemini_chat.GeminiClient(Down()), gemini_chat.GroqClient(groq))
    r = asyncio.run(client.messages.create(max_tokens=10, system="s", messages=[{"role": "user", "content": "q"}]))
    assert r.content[0].text == "from groq"
    assert gemini_chat._resting == {}  # an outage isn't a used-up allowance: the next question tries Gemini again


def test_make_client_falls_back_from_gemini_to_groq(monkeypatch):
    monkeypatch.setattr(data_assistant.settings, "ANTHROPIC_API_KEY", "")
    monkeypatch.setattr(data_assistant.settings, "GEMINI_API_KEY", "")
    monkeypatch.setattr(data_assistant.settings, "GROQ_API_KEY", "test-not-real")
    client = data_assistant.make_client()
    try:
        assert isinstance(client, gemini_chat.GroqClient)
    finally:
        asyncio.run(client.close())
    monkeypatch.setattr(data_assistant.settings, "GEMINI_API_KEY", "test-not-real")
    client = data_assistant.make_client()
    try:
        assert isinstance(client, gemini_chat.FallbackClient)
        assert client._clients[0]._chat.max_retries == 0  # a busy Gemini hands over at once
    finally:
        asyncio.run(client.close())


def test_the_engineer_writes_with_groq_when_gemini_fails(monkeypatch):
    for key in ("ANTHROPIC_API_KEY", "OPENAI_API_KEY"):
        monkeypatch.setattr(ai_engineer.settings, key, "")
    monkeypatch.setattr(ai_engineer.settings, "GEMINI_API_KEY", "test-not-real")
    monkeypatch.setattr(ai_engineer.settings, "GROQ_API_KEY", "test-not-real")
    engineer = ai_engineer.AIEngineer()

    def quota_used_up(**kwargs):
        raise _rate_limited()

    monkeypatch.setattr(engineer.gemini_client.chat.completions, "create", quota_used_up)
    monkeypatch.setattr(engineer.groq_client.chat.completions, "create", lambda **kwargs: completion({"content": "Box."}))
    assert asyncio.run(engineer.generate_text("sys", "user")) == "Box."
