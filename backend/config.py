"""
SportSync API - Application Configuration.

Loads all settings from environment variables using Pydantic Settings.
Never hardcode secrets here; they come from .env or environment.
"""
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # Database
    database_url: str = "postgresql://sportsync_user:sportsync_local_password@localhost:5432/sportsync"

    # Redis
    redis_url: str = "redis://localhost:6379"

    # JWT Authentication
    jwt_secret: str = "change-me-to-a-real-secret-at-least-32-chars"
    jwt_algorithm: str = "HS256"
    jwt_access_expire_minutes: int = 15
    jwt_refresh_expire_days: int = 7
    jwt_remember_me_expire_days: int = 30

    # Google OAuth 2.0
    google_client_id: str = ""
    google_client_secret: str = ""

    # TheSportsDB
    sportsdb_api_key: str = ""

    # AWS
    aws_s3_bucket: str = "sportsync-assets"
    aws_access_key_id: str = ""
    aws_secret_access_key: str = ""

    # CORS
    cors_origins: str = "http://localhost:5173,http://localhost:5174"

    # Environment
    environment: str = "development"

    @property
    def cors_origins_list(self) -> list[str]:
        """Split comma-separated origins into a list for CORS middleware."""
        return [origin.strip() for origin in self.cors_origins.split(",")]

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
