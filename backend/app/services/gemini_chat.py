"""Gemini and Groq through their OpenAI-compatible endpoints, shaped like the Anthropic client the assistant
loop calls: ``await client.messages.create(...)`` returns text and tool_use blocks with a stop_reason, and the
loop's Anthropic-style messages (tool_use blocks out, tool_result blocks back) are translated both ways.
FallbackClient moves on to Groq once Gemini's free daily allowance runs out."""
import json
from types import SimpleNamespace
from typing import Any, Dict, List, Optional

from app.core.config import settings

BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"
GROQ_BASE_URL = "https://api.groq.com/openai/v1"
_STOP = {"tool_calls": "tool_use", "length": "max_tokens"}


def gemini_key() -> str:
    """The configured key, or "" when unset or still the .env.example placeholder."""
    key = settings.GEMINI_API_KEY
    return "" if not key or "your_gemini" in key else key


def groq_key() -> str:
    key = settings.GROQ_API_KEY
    return "" if not key or "your_groq" in key else key


def _to_chat(messages: List[Dict[str, Any]], replay_extra: bool) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for m in messages:
        content = m["content"]
        if isinstance(content, str):
            out.append({"role": m["role"], "content": content})
        elif m["role"] == "assistant":
            text = "".join(b.text for b in content if b.type == "text")
            # Gemini 3 needs each call's thought signature back; other APIs get only the standard fields
            calls = [b.raw if replay_extra else {k: b.raw[k] for k in ("id", "type", "function")}
                     for b in content if b.type == "tool_use"]
            out.append({"role": "assistant", "content": text or None, **({"tool_calls": calls} if calls else {})})
        else:
            out.extend({"role": "tool", "tool_call_id": r["tool_use_id"], "content": r["content"]} for r in content)
    return out


class _Messages:
    def __init__(self, chat: Any, model: str, reasoning_effort: Optional[str], replay_extra: bool):
        self._chat = chat
        self._model, self._effort, self._replay_extra = model, reasoning_effort, replay_extra

    async def create(self, *, max_tokens: int, system: str, messages: List[Dict[str, Any]], tools=None,
                     tool_choice=None, **_anthropic_only: Any) -> Any:
        # the model is this client's whatever the caller names; caching and effort are Anthropic settings
        kwargs: Dict[str, Any] = dict(
            model=self._model, max_tokens=max_tokens,
            messages=[{"role": "system", "content": system}, *_to_chat(messages, self._replay_extra)],
        )
        if self._effort:
            # thinking counts toward max_tokens, as with Claude; the loop asks Claude for low effort too
            kwargs["reasoning_effort"] = self._effort
        if tools:
            kwargs["tools"] = [{"type": "function", "function": {
                "name": t["name"], "description": t["description"], "parameters": t["input_schema"]}} for t in tools]
        if tool_choice and tool_choice.get("type") == "none":
            kwargs["tool_choice"] = "none"
        choice = (await self._chat.chat.completions.create(**kwargs)).choices[0]
        msg = choice.message
        blocks: List[Any] = [SimpleNamespace(type="text", text=msg.content)] if msg.content else []
        for call in msg.tool_calls or []:
            try:
                args = json.loads(call.function.arguments or "{}")
            except json.JSONDecodeError:
                args = None  # the loop answers "The tool input must be an object." and the model retries
            blocks.append(SimpleNamespace(type="tool_use", id=call.id, name=call.function.name, input=args,
                                          raw=call.model_dump(exclude_none=True)))
        return SimpleNamespace(content=blocks, stop_reason=_STOP.get(choice.finish_reason, "end_turn"))


class ChatClient:
    def __init__(self, chat: Any, model: str, reasoning_effort: Optional[str] = None, replay_extra: bool = False):
        self.messages = _Messages(chat, model, reasoning_effort, replay_extra)
        self._chat = chat

    async def close(self) -> None:
        await self._chat.close()


class GeminiClient(ChatClient):
    def __init__(self, chat: Any):
        super().__init__(chat, settings.GEMINI_MODEL, reasoning_effort="low", replay_extra=True)


class GroqClient(ChatClient):
    def __init__(self, chat: Any):
        # gpt-oss takes low/medium/high; Llama models have no reasoning setting, so others get their default
        effort = "low" if "gpt-oss" in settings.GROQ_MODEL else None
        super().__init__(chat, settings.GROQ_MODEL, reasoning_effort=effort)


class FallbackClient:
    """Asks the first client until it's rate limited (a used-up free tier, say), then the next one, for
    that call and the rest of the conversation."""

    def __init__(self, *clients: ChatClient):
        self._clients = list(clients)
        self._current = 0
        self.messages = self

    async def create(self, **kwargs: Any) -> Any:
        import openai
        while True:
            try:
                return await self._clients[self._current].messages.create(**kwargs)
            except openai.RateLimitError as e:
                if self._current == len(self._clients) - 1:
                    raise
                print(f"The assistant was rate limited ({e}); trying the next provider.")
                self._current += 1

    async def close(self) -> None:
        for client in self._clients:
            await client.close()
