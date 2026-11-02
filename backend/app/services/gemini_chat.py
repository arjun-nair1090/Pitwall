"""Gemini through Google's OpenAI-compatible endpoint, shaped like the Anthropic client the assistant loop
calls: ``await client.messages.create(...)`` returns text and tool_use blocks with a stop_reason, and the
loop's Anthropic-style messages (tool_use blocks out, tool_result blocks back) are translated both ways."""
import json
from types import SimpleNamespace
from typing import Any, Dict, List

from app.core.config import settings

BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"
_STOP = {"tool_calls": "tool_use", "length": "max_tokens"}


def gemini_key() -> str:
    """The configured key, or "" when unset or still the .env.example placeholder."""
    key = settings.GEMINI_API_KEY
    return "" if not key or "your_gemini" in key else key


def _to_chat(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for m in messages:
        content = m["content"]
        if isinstance(content, str):
            out.append({"role": m["role"], "content": content})
        elif m["role"] == "assistant":
            text = "".join(b.text for b in content if b.type == "text")
            # replayed as received: Gemini 3 needs each call's thought signature back
            calls = [b.raw for b in content if b.type == "tool_use"]
            out.append({"role": "assistant", "content": text or None, **({"tool_calls": calls} if calls else {})})
        else:
            out.extend({"role": "tool", "tool_call_id": r["tool_use_id"], "content": r["content"]} for r in content)
    return out


class _Messages:
    def __init__(self, chat: Any):
        self._chat = chat

    async def create(self, *, max_tokens: int, system: str, messages: List[Dict[str, Any]], tools=None,
                     tool_choice=None, **_anthropic_only: Any) -> Any:
        # the model is GEMINI_MODEL whatever the caller names; caching and effort are Anthropic settings
        kwargs: Dict[str, Any] = dict(
            # thinking counts toward max_tokens, as with Claude; the loop asks Claude for low effort too
            model=settings.GEMINI_MODEL, max_tokens=max_tokens, reasoning_effort="low",
            messages=[{"role": "system", "content": system}, *_to_chat(messages)],
        )
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


class GeminiClient:
    def __init__(self, chat: Any):
        self.messages = _Messages(chat)
        self._chat = chat

    async def close(self) -> None:
        await self._chat.close()
