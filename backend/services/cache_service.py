"""
SportSync - Cache Service.

Redis wrapper for consistent cache access across the application.
All cache keys use prefixed namespaces to avoid collisions.
Falls back gracefully if Redis is unavailable (local dev without Docker).
"""
import json
import logging
from typing import Any

from config import settings
from constants import REDIS_PREFIX_CACHE

logger = logging.getLogger(__name__)

# Shared Redis client instance — may be None if Redis unavailable
try:
    import redis
    redis_client = redis.from_url(settings.redis_url, decode_responses=True)
    redis_client.ping()
except Exception:
    logger.warning("Redis not available, caching disabled for local dev")
    redis_client = None  # type: ignore


def get_cached(key: str) -> Any | None:
    """Retrieve a cached value by key. Returns None on cache miss or no Redis."""
    if not redis_client:
        return None
    full_key = f"{REDIS_PREFIX_CACHE}{key}"
    try:
        value = redis_client.get(full_key)
        if value:
            try:
                return json.loads(value)
            except json.JSONDecodeError:
                return value
    except Exception:
        pass
    return None


def set_cached(key: str, value: Any, ttl_seconds: int) -> None:
    """Store a value in cache with a TTL. Serializes dicts/lists to JSON."""
    if not redis_client:
        return
    full_key = f"{REDIS_PREFIX_CACHE}{key}"
    serialized = json.dumps(value) if isinstance(value, (dict, list)) else str(value)
    try:
        redis_client.setex(full_key, ttl_seconds, serialized)
    except Exception:
        pass


def delete_cached(key: str) -> None:
    """Remove a specific key from cache."""
    if not redis_client:
        return
    full_key = f"{REDIS_PREFIX_CACHE}{key}"
    try:
        redis_client.delete(full_key)
    except Exception:
        pass


def invalidate_pattern(pattern: str) -> None:
    """Delete all cache keys matching a pattern. Use sparingly."""
    if not redis_client:
        return
    full_pattern = f"{REDIS_PREFIX_CACHE}{pattern}"
    try:
        keys = redis_client.keys(full_pattern)
        if keys:
            redis_client.delete(*keys)
    except Exception:
        pass
