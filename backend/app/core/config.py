import os
from pydantic import BaseModel
from dotenv import load_dotenv

# Load env variables from root .env file
load_dotenv(os.path.join(os.path.dirname(__file__), "../../../.env"))

class Settings(BaseModel):
    POSTGRES_USER: str = os.getenv("POSTGRES_USER", "postgres")
    POSTGRES_PASSWORD: str = os.getenv("POSTGRES_PASSWORD", "f1password")
    POSTGRES_DB: str = os.getenv("POSTGRES_DB", "f1_pitwall")
    POSTGRES_HOST: str = os.getenv("POSTGRES_HOST", "postgres")
    
    @property
    def DATABASE_URL(self) -> str:
        # Fallback to localhost if running outside Docker for testing
        host = self.POSTGRES_HOST
        if os.getenv("RUNNING_LOCALLY") == "true":
            host = "localhost"
        return f"postgresql+psycopg2://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}@{host}:5432/{self.POSTGRES_DB}"

    REDIS_URL: str = os.getenv("REDIS_URL", "redis://redis:6379/0")
    
    @property
    def REDIS_CONNECTION_URL(self) -> str:
        url = self.REDIS_URL
        if os.getenv("RUNNING_LOCALLY") == "true":
            url = url.replace("redis:6379", "localhost:6379")
        return url

    CORS_ALLOWED_ORIGINS: list[str] = os.getenv("CORS_ALLOWED_ORIGINS", "http://localhost:3000").split(",")
    SECRET_KEY: str = os.getenv("SECRET_KEY")
    if not SECRET_KEY:
        raise ValueError("SECRET_KEY must be set in environment variables")

    CHROMA_HOST: str = os.getenv("CHROMA_HOST", "chromadb")
    CHROMA_PORT: int = int(os.getenv("CHROMA_PORT", "8000"))

    @property
    def CHROMA_CONNECTION_HOST(self) -> str:
        if os.getenv("RUNNING_LOCALLY") == "true":
            return "localhost"
        return self.CHROMA_HOST

    @property
    def CHROMA_CONNECTION_PORT(self) -> int:
        if os.getenv("RUNNING_LOCALLY") == "true":
            return 8001  # docker-compose maps host 8001 -> container 8000
        return self.CHROMA_PORT

    OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
    ANTHROPIC_API_KEY: str = os.getenv("ANTHROPIC_API_KEY", "")
    # Used when no Anthropic key is set; free from https://aistudio.google.com/apikey
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
    # Takes over when Gemini's free daily allowance runs out; free from https://console.groq.com/keys
    GROQ_API_KEY: str = os.getenv("GROQ_API_KEY", "")
    # Model IDs are configuration: hardcoded IDs go stale when a model is retired,
    # which silently degrades every AI feature to its fallback.
    ANTHROPIC_MODEL: str = os.getenv("ANTHROPIC_MODEL", "claude-opus-5")
    OPENAI_MODEL: str = os.getenv("OPENAI_MODEL", "gpt-4o")
    # Google's alias for its newest Flash-Lite model, so the default never names a retired one. Lite, because
    # the free tier allows full Flash only 20 requests a day and one question to Ask the data uses several.
    GEMINI_MODEL: str = os.getenv("GEMINI_MODEL", "gemini-flash-lite-latest")
    # Must support tool calls for Ask the data; gpt-oss-120b does, on a free allowance of about 1,000 requests a day.
    GROQ_MODEL: str = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")
    FASTF1_CACHE_DIR: str = os.getenv("FASTF1_CACHE_DIR", "data/fastf1_cache")

settings = Settings()
