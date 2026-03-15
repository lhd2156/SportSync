"""
SportSync - Authentication Service.

Handles JWT creation/validation, password hashing, Google token
verification, session management, and all auth business logic.
Routers call this service; it never imports from routers.
"""
import secrets
from datetime import datetime, timedelta, timezone

from jose import jwt, JWTError
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from config import settings
from constants import (
    BCRYPT_COST_FACTOR,
    MAX_FAILED_LOGIN_ATTEMPTS,
    ACCOUNT_LOCKOUT_MINUTES,
    SESSION_TOKEN_BYTES,
    CACHE_TTL_SESSION,
    REDIS_PREFIX_SESSION,
    REDIS_PREFIX_BLACKLIST,
)
from models.user import User

# bcrypt context with configurable cost factor
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto", bcrypt__rounds=BCRYPT_COST_FACTOR)


def hash_password(password: str) -> str:
    """Hash a plaintext password using bcrypt with cost factor 12."""
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    """Compare a plaintext password against its bcrypt hash."""
    return pwd_context.verify(plain, hashed)


def create_access_token(user_id: str, expires_minutes: int | None = None) -> str:
    """
    Create a short-lived JWT access token (default 15 minutes).
    Signed with HS256. Stored in memory on the client, never in localStorage.
    """
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=expires_minutes or settings.jwt_access_expire_minutes
    )
    payload = {
        "sub": str(user_id),
        "exp": expire,
        "type": "access",
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def create_refresh_token(user_id: str, remember_me: bool = False) -> tuple[str, int]:
    """
    Create a refresh token with appropriate expiry.
    Returns (token, max_age_seconds) for cookie setting.
    """
    days = settings.jwt_remember_me_expire_days if remember_me else settings.jwt_refresh_expire_days
    expire = datetime.now(timezone.utc) + timedelta(days=days)
    max_age = days * 86400

    payload = {
        "sub": str(user_id),
        "exp": expire,
        "type": "refresh",
    }
    token = jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    return token, max_age


def decode_token(token: str) -> dict | None:
    """Decode and verify a JWT. Returns payload or None if invalid."""
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        return payload
    except JWTError:
        return None


def generate_session_token() -> str:
    """Generate a cryptographically random session token for Remember Me."""
    return secrets.token_urlsafe(SESSION_TOKEN_BYTES)


def check_account_locked(user: User) -> bool:
    """
    Check whether the account is currently locked due to too many
    failed login attempts. Returns True if locked.
    """
    if user.locked_until and user.locked_until > datetime.utcnow():
        return True
    return False


def record_failed_login(db: Session, user: User) -> None:
    """
    Increment the failed login counter and lock the account
    after reaching the maximum allowed attempts.
    """
    user.failed_login_attempts += 1
    if user.failed_login_attempts >= MAX_FAILED_LOGIN_ATTEMPTS:
        user.locked_until = datetime.utcnow() + timedelta(minutes=ACCOUNT_LOCKOUT_MINUTES)
    db.commit()


def reset_failed_logins(db: Session, user: User) -> None:
    """Clear the failed login counter after a successful login."""
    user.failed_login_attempts = 0
    user.locked_until = None
    user.last_login_at = datetime.utcnow()
    db.commit()


def store_session_in_redis(redis_client, token: str, user_id: str) -> None:
    """Store a Remember Me session token in Redis with 30-day TTL."""
    key = f"{REDIS_PREFIX_SESSION}{token}"
    redis_client.setex(key, CACHE_TTL_SESSION, str(user_id))


def validate_session_in_redis(redis_client, token: str) -> str | None:
    """Look up a session token in Redis. Returns user_id or None."""
    key = f"{REDIS_PREFIX_SESSION}{token}"
    return redis_client.get(key)


def delete_session_from_redis(redis_client, token: str) -> None:
    """Remove a session token from Redis on logout."""
    key = f"{REDIS_PREFIX_SESSION}{token}"
    redis_client.delete(key)


def blacklist_token(redis_client, token: str, ttl_seconds: int) -> None:
    """
    Add a JWT to the Redis blacklist so it cannot be reused after logout.
    TTL matches the token's remaining lifetime.
    """
    key = f"{REDIS_PREFIX_BLACKLIST}{token}"
    redis_client.setex(key, ttl_seconds, "1")


def is_token_blacklisted(redis_client, token: str) -> bool:
    """Check whether a JWT has been blacklisted (logged out)."""
    key = f"{REDIS_PREFIX_BLACKLIST}{token}"
    return redis_client.exists(key) > 0
