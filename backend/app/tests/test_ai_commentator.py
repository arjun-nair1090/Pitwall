from types import SimpleNamespace

from app.core.config import settings
from app.services.ai_commentator import AICommentator
from app.services.llm_utils import extract_text, supports_effort


def _commentator(anthropic_client=None, openai_client=None):
    c = AICommentator.__new__(AICommentator)
    c.anthropic_client = anthropic_client
    c.openai_client = openai_client
    return c


class _Anthropic:
    def __init__(self, content=None, error=None):
        self.calls = []
        self._content, self._error = content, error
        self.messages = SimpleNamespace(create=self._create)

    def _create(self, **kwargs):
        self.calls.append(kwargs)
        if self._error:
            raise self._error
        return SimpleNamespace(content=self._content)


def test_commentary_reads_the_text_block_after_a_thinking_block():
    fake = _Anthropic(content=[SimpleNamespace(type="thinking", thinking=""), SimpleNamespace(type="text", text="  Down the inside!  ")])
    assert _commentator(anthropic_client=fake).generate_commentary("Overtake") == "Down the inside!"


def test_commentary_uses_the_configured_model_and_leaves_room_for_thinking():
    fake = _Anthropic(content=[SimpleNamespace(type="text", text="ok")])
    _commentator(anthropic_client=fake).generate_commentary("Overtake")
    call = fake.calls[0]
    assert call["model"] == settings.ANTHROPIC_MODEL
    # 100 tokens can be consumed entirely by thinking, leaving an empty answer.
    assert call["max_tokens"] >= 1024


def test_commentary_falls_back_to_a_rule_based_line_when_no_provider_works():
    fake = _Anthropic(error=RuntimeError("down"))
    text = _commentator(anthropic_client=fake).generate_commentary("Verstappen passes Norris")
    assert "Verstappen passes Norris" in text


def test_commentary_falls_back_when_the_model_returns_no_text():
    fake = _Anthropic(content=[SimpleNamespace(type="thinking", thinking="")])
    text = _commentator(anthropic_client=fake).generate_commentary("Safety car")
    assert "Safety car" in text


def test_extract_text_joins_text_blocks_and_ignores_others():
    response = SimpleNamespace(content=[
        SimpleNamespace(type="thinking", thinking="hmm"),
        SimpleNamespace(type="text", text="One. "),
        SimpleNamespace(type="text", text="Two."),
    ])
    assert extract_text(response) == "One. Two."
    assert extract_text(SimpleNamespace(content=[])) == ""


def test_supports_effort_is_limited_to_models_known_to_accept_it():
    assert supports_effort("claude-opus-5")
    assert supports_effort("claude-sonnet-5")
    assert not supports_effort("claude-haiku-4-5")
    assert not supports_effort("claude-3-5-sonnet-20241022")
