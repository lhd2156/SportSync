"""
SportSync - Authentication Service.

Handles JWT creation/validation, password hashing, Google token
verification, session management, and all auth business logic.
Routers call this service; it never imports from routers.
"""
import math
import secrets
import time
import uuid
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from jwt import InvalidTokenError
from sqlalchemy.orm import Session

from config import settings
from constants import (
    MAX_FAILED_LOGIN_ATTEMPTS,
    ACCOUNT_LOCKOUT_MINUTES,
    BCRYPT_COST_FACTOR,
    SESSION_TOKEN_BYTES,
    CACHE_TTL_SESSION,
    REDIS_PREFIX_SESSION,
    REDIS_PREFIX_BLACKLIST,
)
from models.user import User


_LOCAL_BLACKLIST: dict[str, int] = {}


def hash_password(password: str) -> str:
    """Hash a plaintext password using bcrypt."""
    salt = bcrypt.gensalt(rounds=BCRYPT_COST_FACTOR)
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    """Compare a plaintext password against its bcrypt hash."""
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def create_access_token(user_id: str, expires_minutes: int | None = None) -> str:
    """
    Create a short-lived JWT access token.
    Signed with HS256. Stored in memory on the client, never in localStorage.
    """
    issued_at = datetime.now(timezone.utc)
    expire = issued_at + timedelta(
        minutes=expires_minutes if expires_minutes is not None else settings.jwt_access_expire_minutes
    )
    payload = {
        "sub": str(user_id),
        "iat": issued_at,
        "exp": expire,
        "jti": str(uuid.uuid4()),
        "type": "access",
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def create_refresh_token(user_id: str, remember_me: bool = False) -> tuple[str, int]:
    """
    Create a refresh token with appropriate expiry.
    Returns (token, max_age_seconds) for cookie setting.
    """
    days = settings.jwt_remember_me_expire_days if remember_me else settings.jwt_refresh_expire_days
    issued_at = datetime.now(timezone.utc)
    expire = issued_at + timedelta(days=days)
    max_age = days * 86400

    payload = {
        "sub": str(user_id),
        "iat": issued_at,
        "exp": expire,
        "jti": str(uuid.uuid4()),
        "remember_me": remember_me,
        "type": "refresh",
    }
    token = jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    return token, max_age


def create_password_reset_token(user_id: str) -> tuple[str, int]:
    """
    Create a short-lived password reset token.
    Returns (token, max_age_seconds) so callers can align any one-time-use tracking.
    """
    issued_at = datetime.now(timezone.utc)
    expire = issued_at + timedelta(minutes=settings.password_reset_expire_minutes)
    max_age = settings.password_reset_expire_minutes * 60

    payload = {
        "sub": str(user_id),
        "iat": issued_at,
        "exp": expire,
        "jti": str(uuid.uuid4()),
        "type": "password_reset",
    }
    token = jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    return token, max_age


def decode_token(token: str) -> dict | None:
    """Decode and verify a JWT. Returns payload or None if invalid."""
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        return payload
    except InvalidTokenError:
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


def clear_expired_account_lock(db: Session, user: User) -> None:
    """Reset lock state once the lockout window has passed."""
    if user.locked_until and user.locked_until <= datetime.utcnow():
        user.failed_login_attempts = 0
        user.locked_until = None
        db.commit()
        db.refresh(user)


def get_account_lockout_remaining_seconds(user: User) -> int:
    """Return the remaining lockout duration in seconds."""
    if not user.locked_until:
        return 0
    remaining_seconds = int((user.locked_until - datetime.utcnow()).total_seconds())
    return max(remaining_seconds, 0)


def format_lockout_duration(seconds: int) -> str:
    """Format lockout time in a short user-facing form."""
    if seconds <= 60:
        return "1 minute"
    if seconds < 3600:
        minutes = max(1, math.ceil(seconds / 60))
        unit = "minute" if minutes == 1 else "minutes"
        return f"{minutes} {unit}"

    hours = seconds // 3600
    remaining_minutes = math.ceil((seconds % 3600) / 60)
    hour_unit = "hour" if hours == 1 else "hours"
    if remaining_minutes <= 0:
        return f"{hours} {hour_unit}"

    minute_unit = "minute" if remaining_minutes == 1 else "minutes"
    return f"{hours} {hour_unit} {remaining_minutes} {minute_unit}"


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
    """Store a Remember Me session token in Redis with a 7-day TTL."""
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
    if redis_client:
        redis_client.setex(key, ttl_seconds, "1")
        return

    _LOCAL_BLACKLIST[token] = int(time.time()) + max(1, int(ttl_seconds))


def is_token_blacklisted(redis_client, token: str) -> bool:
    """Check whether a JWT has been blacklisted (logged out)."""
    if redis_client:
        key = f"{REDIS_PREFIX_BLACKLIST}{token}"
        return redis_client.exists(key) > 0

    now = int(time.time())
    expired = [candidate for candidate, expires_at in _LOCAL_BLACKLIST.items() if expires_at <= now]
    for candidate in expired:
        _LOCAL_BLACKLIST.pop(candidate, None)
    return token in _LOCAL_BLACKLIST
