from pydantic_settings import BaseSettings, SettingsConfigDict
from dotenv import load_dotenv

# Load environment variables
load_dotenv()


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # App Settings
    env: str = "dev"
    debug: bool = True
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    api_v1_str: str = "/api/v1"
    ws_v1_str: str = "/ws/v1"

    # Supabase
    supabase_url: str | None = None
    supabase_anon_key: str | None = None
    supabase_service_role_key: str | None = None
    supabase_jwt_secret: str | None = None

    # Deepgram
    deepgram_api_key: str | None = None

    # Redis
    redis_url: str = "redis://localhost:6379/0"

    # AI Providers
    gemini_api_key: str | None = None
    openai_api_key: str | None = None
    anthropic_api_key: str | None = None
    # 🔥 Nayi Keys yahan add ho gayi hain
    groq_api_key: str | None = None
    openrouter_api_key: str | None = None

    # Audio/Video (Phase 2-3)
    elevenlabs_api_key: str | None = None
    heygen_api_key: str | None = None

    # Security
    jwt_secret_key: str = "mockpanel_super_secret_key_2026_change_me"
    jwt_algorithm: str = "HS256"


# Global settings instance
settings = Settings()