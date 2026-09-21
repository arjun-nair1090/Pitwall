from openai import OpenAI
from anthropic import Anthropic
from app.core.config import settings
from app.services.llm_utils import extract_text, supports_effort

class AICommentator:
    def __init__(self):
        self.openai_client = None
        self.anthropic_client = None
        if settings.OPENAI_API_KEY and "your_openai" not in settings.OPENAI_API_KEY:
            self.openai_client = OpenAI(api_key=settings.OPENAI_API_KEY)
        if settings.ANTHROPIC_API_KEY and "your_anthropic" not in settings.ANTHROPIC_API_KEY:
            self.anthropic_client = Anthropic(api_key=settings.ANTHROPIC_API_KEY)

    def generate_commentary(self, event_description: str) -> str:
        """Create a professional F1 commentator transcript or text snippet for a given live event.

        Synchronous (blocking) SDK calls — callers on the event loop must run this via
        asyncio.to_thread, never await it directly.
        """
        prompt = (
            "You are a professional Formula 1 lead commentator (like David Croft or Martin Brundle).\n"
            "Here is a live event that just happened on track:\n"
            f"'{event_description}'\n\n"
            "Deliver an energetic, dramatic, and professional commentary snippet (1-2 sentences) about this event. "
            "Sound passionate, use British English racing terms (e.g., 'down the inside', 'wheel-to-wheel', 'box box', 'purple sectors'), and keep it brief."
        )

        if self.anthropic_client:
            try:
                kwargs = dict(
                    model=settings.ANTHROPIC_MODEL,
                    # Thinking counts toward max_tokens; a tiny cap can be spent
                    # entirely on thinking and leave an empty answer.
                    max_tokens=1024,
                    messages=[{"role": "user", "content": prompt}],
                )
                if supports_effort(settings.ANTHROPIC_MODEL):
                    kwargs["output_config"] = {"effort": "low"}
                text = extract_text(self.anthropic_client.messages.create(**kwargs))
                if text:
                    return text
            except Exception as e:
                print(f"Anthropic Commentator Error: {e}")

        if self.openai_client:
            try:
                response = self.openai_client.chat.completions.create(
                    model=settings.OPENAI_MODEL,
                    messages=[{"role": "user", "content": prompt}],
                    max_tokens=100
                )
                text = (response.choices[0].message.content or "").strip()
                if text:
                    return text
            except Exception as e:
                print(f"OpenAI Commentator Error: {e}")

        # Rule-based fallback if no LLM client is configured/reachable
        return f"And there it is! {event_description}! Absolute drama on the track!"

ai_commentator = AICommentator()
