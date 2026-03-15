"""
SportSync - Security Service.

Rate limiting, IP-based request throttling, and security utilities.
All rate limits enforced via Redis counters with sliding windows.
"""
from fastapi import Request, HTTPException, status

from constants import (
    RATE_LIMIT_LOGIN_MAX,
    RATE_LIMIT_LOGIN_WINDOW,
    RATE_LIMIT_REGISTER_MAX,
    RATE_LIMIT_REGISTER_WINDOW,
    REDIS_PREFIX_RATE_LIMIT,
)
from services.cache_service import redis_client


def get_client_ip(request: Request) -> str:
    """Extract the client IP, respecting X-Forwarded-For from Nginx."""
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def check_rate_limit(request: Request, action: str) -> None:
    """
    Enforce rate limiting per IP address. Raises 429 if limit exceeded.
    Different limits for login vs registration to prevent abuse.
    """
    ip = get_client_ip(request)
    key = f"{REDIS_PREFIX_RATE_LIMIT}{action}:{ip}"

    if action == "login":
        max_attempts = RATE_LIMIT_LOGIN_MAX
        window = RATE_LIMIT_LOGIN_WINDOW
    elif action == "register":
        max_attempts = RATE_LIMIT_REGISTER_MAX
        window = RATE_LIMIT_REGISTER_WINDOW
    else:
        return

    current = redis_client.get(key)

    if current and int(current) >= max_attempts:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many attempts. Please try again later.",
        )

    pipe = redis_client.pipeline()
    pipe.incr(key)
    pipe.expire(key, window)
    pipe.execute()
