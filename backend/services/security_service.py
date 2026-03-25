"""
SportSync - Security Service.

Rate limiting, IP-based request throttling, and security utilities.
All rate limits enforced via Redis counters with sliding windows.
Falls back gracefully if Redis is unavailable (local dev without Docker).
"""
import hashlib
import ipaddress
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
_AUTH_ACTION_LIMITS = {
    "login": (
        RATE_LIMIT_LOGIN_MAX,
        RATE_LIMIT_LOGIN_WINDOW,
        "Too many attempts. Please try again later.",
    ),
    "register": (
        RATE_LIMIT_REGISTER_MAX,
        RATE_LIMIT_REGISTER_WINDOW,
        "Too many attempts. Please try again later.",
    ),
    "google": (
        RATE_LIMIT_LOGIN_MAX,
        RATE_LIMIT_LOGIN_WINDOW,
        "Too many sign-in attempts. Please try again later.",
    ),
    "refresh": (
        RATE_LIMIT_LOGIN_MAX,
        RATE_LIMIT_LOGIN_WINDOW,
        "Too many session refresh attempts. Please try again later.",
    ),
    "logout": (
        RATE_LIMIT_LOGIN_MAX,
        RATE_LIMIT_LOGIN_WINDOW,
        "Too many logout attempts. Please try again later.",
    ),
    "password_reset_confirm": (
        RATE_LIMIT_PASSWORD_RESET_MAX,
        RATE_LIMIT_PASSWORD_RESET_WINDOW,
        "Too many password reset attempts. Please try again later.",
    ),
    "password_reset_request": (
        RATE_LIMIT_PASSWORD_RESET_MAX,
        RATE_LIMIT_PASSWORD_RESET_WINDOW,
        "Too many password reset attempts. Please try again later.",
    ),
    "password_reset_validate": (
        RATE_LIMIT_PASSWORD_RESET_MAX,
        RATE_LIMIT_PASSWORD_RESET_WINDOW,
        "Too many password reset attempts. Please try again later.",
    ),
    "password_reset_code_confirm": (
        RATE_LIMIT_PASSWORD_RESET_MAX,
        RATE_LIMIT_PASSWORD_RESET_WINDOW,
        "Too many password reset attempts. Please try again later.",
    ),
    "onboarding_step_1": (
        RATE_LIMIT_REGISTER_MAX,
        RATE_LIMIT_REGISTER_WINDOW,
        "Too many onboarding attempts. Please try again later.",
    ),
    "onboarding_step_2": (
        RATE_LIMIT_REGISTER_MAX,
        RATE_LIMIT_REGISTER_WINDOW,
        "Too many onboarding attempts. Please try again later.",
    ),
    "onboarding_complete": (
        RATE_LIMIT_REGISTER_MAX,
        RATE_LIMIT_REGISTER_WINDOW,
        "Too many onboarding attempts. Please try again later.",
    ),
    "set_password": (
        RATE_LIMIT_LOGIN_MAX,
        RATE_LIMIT_LOGIN_WINDOW,
        "Too many password attempts. Please try again later.",
    ),
    "change_password": (
        RATE_LIMIT_LOGIN_MAX,
        RATE_LIMIT_LOGIN_WINDOW,
        "Too many password attempts. Please try again later.",
    ),
}


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


def ip_is_allowed(ip_address: str, allowlist: list[str]) -> bool:
    """Check whether an IP belongs to any configured allowlist entry."""
    if not allowlist:
        return True

    try:
        client_ip = ipaddress.ip_address(ip_address)
    except ValueError:
        return False

    for raw_entry in allowlist:
        entry = raw_entry.strip()
        if not entry:
            continue
        try:
            if "/" in entry:
                if client_ip in ipaddress.ip_network(entry, strict=False):
                    return True
            elif client_ip == ipaddress.ip_address(entry):
                return True
        except ValueError:
            logger.warning("Invalid API allowlist entry ignored: %s", entry)
            continue

    return False


def check_rate_limit(request: Request, action: str) -> None:
    """
    Enforce rate limiting per IP address. Raises 429 if limit exceeded.
    Falls back to an in-process limiter if Redis is unavailable.
    """
    ip = get_client_ip(request)

    config = _AUTH_ACTION_LIMITS.get(action)
    if not config:
        return
    max_attempts, window, detail = config

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
