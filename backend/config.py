"""
SportSync API - Application Configuration.

Loads all settings from environment variables using Pydantic Settings.
Never hardcode secrets here; they come from .env or environment.
"""
from urllib.parse import urlparse

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # Database
    database_url: str = "sqlite:///./sportsync.db"

    # Redis
    redis_url: str = "redis://localhost:6379"

    # JWT Authentication
    jwt_secret: str = "change-me-to-a-real-secret-at-least-32-chars"
    jwt_algorithm: str = "HS256"
    jwt_access_expire_days: int = 7
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
    production_domain: str = "https://sportsync.app"
    redirect_allowlist: str = ""

    # Environment
    environment: str = "development"

    @staticmethod
    def _normalize_origin(origin: str) -> str:
        """Normalize origins so comparisons and allowlists stay exact."""
        parsed = urlparse(origin.strip())
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError(f"Invalid origin configured: {origin}")
        return f"{parsed.scheme}://{parsed.netloc}".rstrip("/")

    @staticmethod
    def _is_local_origin(origin: str) -> bool:
        """Treat localhost-like origins as development-only."""
        host = urlparse(origin).hostname or ""
        return host in {"localhost", "127.0.0.1"} or host.endswith(".local")

    @property
    def cors_origins_list(self) -> list[str]:
        """Split comma-separated origins into a list for CORS middleware."""
        configured = [
            self._normalize_origin(origin)
            for origin in self.cors_origins.split(",")
            if origin.strip()
        ]
        if self.environment.lower() == "production":
            non_local = [origin for origin in configured if not self._is_local_origin(origin)]
            if non_local:
                return non_local
            if self.production_domain.strip():
                return [self._normalize_origin(self.production_domain)]
            return []
        if configured:
            return configured
        if self.production_domain.strip():
            return [self._normalize_origin(self.production_domain)]
        return []

    @property
    def redirect_allowlist_list(self) -> list[str]:
        """Return the validated set of external redirect origins."""
        origins: set[str] = set(self.cors_origins_list)
        if self.production_domain.strip():
            origins.add(self._normalize_origin(self.production_domain))
        for origin in self.redirect_allowlist.split(","):
            origin = origin.strip()
            if origin:
                origins.add(self._normalize_origin(origin))
        return sorted(origins)

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
