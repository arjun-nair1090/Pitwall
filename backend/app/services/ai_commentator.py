import os
from openai import OpenAI
from app.core.config import settings

class AICommentator:
    def __init__(self):
        self.openai_client = None
        if settings.OPENAI_API_KEY and "your_openai" not in settings.OPENAI_API_KEY:
            self.openai_client = OpenAI(api_key=settings.OPENAI_API_KEY)

    def generate_commentary(self, event_description: str) -> str:
        """Create a professional F1 commentator transcript or text snippet for a given live event."""
        prompt = (
            "You are a professional Formula 1 lead commentator (like David Croft or Martin Brundle).\n"
            "Here is a live event that just happened on track:\n"
            f"'{event_description}'\n\n"
            "Deliver an energetic, dramatic, and professional commentary snippet (1-2 sentences) about this event. "
            "Sound passionate, use British English racing terms (e.g., 'down the inside', 'wheel-to-wheel', 'box box', 'purple sectors'), and keep it brief."
        )
        
        if self.openai_client:
            try:
                response = self.openai_client.chat.completions.create(
                    model="gpt-4o",
                    messages=[{"role": "user", "content": prompt}],
                    max_tokens=100
                )
                return response.choices[0].message.content.strip()
            except Exception as e:
                print(f"OpenAI Commentator Error: {e}")
                
        # Rule-based fallback if OpenAI client is offline
        return f"And there it is! {event_description}! Absolute drama on the track!"

ai_commentator = AICommentator()
