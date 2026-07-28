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
        return f"postgresql://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}@{host}:5432/{self.POSTGRES_DB}"

    REDIS_URL: str = os.getenv("REDIS_URL", "redis://redis:6379/0")
    
    @property
    def REDIS_CONNECTION_URL(self) -> str:
        url = self.REDIS_URL
        if os.getenv("RUNNING_LOCALLY") == "true":
            url = url.replace("redis:6379", "localhost:6379")
        return url

    API_V1_STR_PREFIX: str = os.getenv("API_V1_STR_PREFIX", "/api/v1")
    CORS_ALLOWED_ORIGINS: list[str] = os.getenv("CORS_ALLOWED_ORIGINS", "http://localhost:3000").split(",")
    SECRET_KEY: str = os.getenv("SECRET_KEY")
    if not SECRET_KEY:
        raise ValueError("SECRET_KEY must be set in environment variables")

    OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")TYPE: str = os.getenv("FASTF1_SESSION_TYPE", "Race")
    FASTF1_YEAR: int = int(os.getenv("FASTF1_YEAR", "2024"))
    FASTF1_CACHE_DIR: str = os.getenv("FASTF1_CACHE_DIR", "data/fastf1_cache")

settings = Settings()
