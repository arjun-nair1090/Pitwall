"""Small helpers shared by every module that calls an LLM SDK."""
from typing import Any

# Models that accept output_config.effort. It errors on some older models, so
# only send it where it's known to be accepted.
_EFFORT_MODEL_PREFIXES = (
    "claude-opus-5",
    "claude-sonnet-5",
    "claude-opus-4-8",
    "claude-opus-4-7",
    "claude-opus-4-6",
    "claude-sonnet-4-6",
    "claude-fable-5",
)


def supports_effort(model: str) -> bool:
    return model.startswith(_EFFORT_MODEL_PREFIXES)


def extract_text(response: Any) -> str:
    """Concatenated text blocks of an Anthropic response ("" if there are none).

    ``response.content[0]`` is often a *thinking* block on current models, so
    indexing it either raises or returns the wrong thing."""
    return "".join(b.text for b in response.content if getattr(b, "type", None) == "text").strip()
