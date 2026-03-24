"""
SportSync API - Application Configuration.

Loads all settings from environment variables using Pydantic Settings.
Never hardcode secrets here; they come from .env or environment.
"""
from pathlib import Path
from urllib.parse import urlparse, urlunparse

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # Database
    database_url: str = "postgresql://sportsync_user:sportsync_local_password@localhost:5432/sportsync"
    database_auto_create: bool = False

    # Redis
    redis_url: str = ""

    # JWT Authentication
    jwt_secret: str = ""
    jwt_algorithm: str = "HS256"
    jwt_access_expire_minutes: int = 15
    jwt_refresh_expire_days: int = 7
    jwt_remember_me_expire_days: int = 7
    password_reset_expire_minutes: int = 60

    # Google OAuth 2.0
    google_client_id: str = ""
    google_client_secret: str = ""

    # TheSportsDB
    sportsdb_api_key: str = ""

    # AWS
    aws_s3_bucket: str = "sportsync-assets"
    aws_access_key_id: str = ""
    aws_secret_access_key: str = ""
    aws_region: str = "us-east-1"
    aws_s3_endpoint_url: str = ""
    aws_s3_public_base_url: str = ""
    aws_s3_use_path_style: bool = False

    # CORS
    cors_origins: str = ""
    production_domain: str = ""
    redirect_allowlist: str = ""
    cookie_domain: str = ""
    cookie_samesite: str = "strict"

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

    @classmethod
    def _add_loopback_aliases(cls, origins: list[str]) -> list[str]:
        """Mirror localhost/127.0.0.1 origins so either loopback host works in dev."""
        expanded: set[str] = set()
        for origin in origins:
            normalized = cls._normalize_origin(origin)
            expanded.add(normalized)

            parsed = urlparse(normalized)
            host = parsed.hostname or ""
            if host not in {"localhost", "127.0.0.1"}:
                continue

            alias_host = "127.0.0.1" if host == "localhost" else "localhost"
            alias_netloc = alias_host
            if parsed.port:
                alias_netloc = f"{alias_host}:{parsed.port}"

            expanded.add(
                urlunparse((parsed.scheme, alias_netloc, "", "", "", "")).rstrip("/")
            )

        return sorted(expanded)

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
            return self._add_loopback_aliases(configured)
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
        if self.environment.lower() != "production":
            return self._add_loopback_aliases(sorted(origins))
        return sorted(origins)

    @property
    def cookie_domain_value(self) -> str | None:
        """Return the cookie domain for production deployments, or None for localhost/dev."""
        configured = self.cookie_domain.strip()
        if configured:
            normalized = configured.lstrip(".").strip().lower()
            if normalized and normalized not in {"localhost", "127.0.0.1"}:
                return normalized

        if self.environment.lower() != "production" or not self.production_domain.strip():
            return None

        parsed = urlparse(self.production_domain.strip())
        host = (parsed.hostname or "").strip().lower().lstrip(".")
        if not host or host in {"localhost", "127.0.0.1"}:
            return None
        return host

    @property
    def cookie_secure(self) -> bool:
        """Cookies should only be marked secure outside local development."""
        return self.environment.lower() == "production"

    @property
    def cookie_samesite_value(self) -> str:
        """Normalize SameSite for FastAPI's cookie API."""
        normalized = self.cookie_samesite.strip().lower()
        if normalized in {"lax", "strict", "none"}:
            return normalized
        return "strict"

    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env",
        env_file_encoding="utf-8",
    )

settings = Settings()
