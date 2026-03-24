"""
SportSync - Security Service.

Rate limiting, IP-based request throttling, and security utilities.
All rate limits enforced via Redis counters with sliding windows.
Falls back gracefully if Redis is unavailable (local dev without Docker).
"""
import hashlib
import logging
import time

from fastapi import Request, HTTPException, status

from constants import (
    RATE_LIMIT_LOGIN_MAX,
    RATE_LIMIT_LOGIN_WINDOW,
    RATE_LIMIT_PASSWORD_RESET_MAX,
    RATE_LIMIT_PASSWORD_RESET_WINDOW,
    RATE_LIMIT_REGISTER_MAX,
    RATE_LIMIT_REGISTER_WINDOW,
    REDIS_PREFIX_PASSWORD_RESET,
    REDIS_PREFIX_RATE_LIMIT,
)
from services.cache_service import redis_client


logger = logging.getLogger(__name__)
_LOCAL_RATE_LIMIT_BUCKETS: dict[str, list[float]] = {}


def _check_local_window_limit(key: str, max_attempts: int, window_seconds: int, detail: str) -> None:
    now = time.time()
    attempts = [ts for ts in _LOCAL_RATE_LIMIT_BUCKETS.get(key, []) if now - ts < window_seconds]
    if len(attempts) >= max_attempts:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=detail)
    attempts.append(now)
    _LOCAL_RATE_LIMIT_BUCKETS[key] = attempts


def get_client_ip(request: Request) -> str:
    """Extract the client IP, respecting X-Forwarded-For from Nginx."""
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def check_rate_limit(request: Request, action: str) -> None:
    """
    Enforce rate limiting per IP address. Raises 429 if limit exceeded.
    Falls back to an in-process limiter if Redis is unavailable.
    """
    ip = get_client_ip(request)

    if action == "login":
        max_attempts = RATE_LIMIT_LOGIN_MAX
        window = RATE_LIMIT_LOGIN_WINDOW
        detail = "Too many attempts. Please try again later."
    elif action == "register":
        max_attempts = RATE_LIMIT_REGISTER_MAX
        window = RATE_LIMIT_REGISTER_WINDOW
        detail = "Too many attempts. Please try again later."
    else:
        return

    key = f"{REDIS_PREFIX_RATE_LIMIT}{action}:{ip}"

    if not redis_client:
        _check_local_window_limit(f"local:{action}:{ip}", max_attempts, window, detail)
        return

    try:
        current = redis_client.get(key)

        if current and int(current) >= max_attempts:
            raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=detail)

        pipe = redis_client.pipeline()
        pipe.incr(key)
        pipe.expire(key, window)
        pipe.execute()
    except HTTPException:
        raise
    except Exception:
        logger.exception("rate_limit_redis_failed", extra={"action": action, "ip": ip})
        _check_local_window_limit(f"local:{action}:{ip}", max_attempts, window, detail)


def check_subject_rate_limit(action: str, subject: str) -> None:
    """
    Enforce subject-based limits, such as password reset requests per email.
    Subject values are hashed before storing in Redis.
    """
    if not subject:
        return

    normalized_subject = subject.strip().lower()
    if not normalized_subject:
        return

    if action == "password_reset":
        max_attempts = RATE_LIMIT_PASSWORD_RESET_MAX
        window = RATE_LIMIT_PASSWORD_RESET_WINDOW
        prefix = REDIS_PREFIX_PASSWORD_RESET
        detail = "Too many attempts. Please try again later."
    else:
        return

    subject_hash = hashlib.sha256(normalized_subject.encode("utf-8")).hexdigest()
    key = f"{prefix}{action}:{subject_hash}"

    if not redis_client:
        _check_local_window_limit(f"local:{key}", max_attempts, window, detail)
        return

    try:
        current = redis_client.get(key)
        if current and int(current) >= max_attempts:
            raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=detail)

        pipe = redis_client.pipeline()
        pipe.incr(key)
        pipe.expire(key, window)
        pipe.execute()
    except HTTPException:
        raise
    except Exception:
        logger.exception("subject_rate_limit_redis_failed", extra={"action": action})
        _check_local_window_limit(f"local:{key}", max_attempts, window, detail)
