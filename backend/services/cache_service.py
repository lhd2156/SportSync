"""
SportSync - Cache Service.

Redis wrapper for consistent cache access across the application.
All cache keys use prefixed namespaces to avoid collisions.
"""
import json
from typing import Any

import redis

from config import settings
from constants import REDIS_PREFIX_CACHE

# Shared Redis client instance
redis_client = redis.from_url(settings.redis_url, decode_responses=True)


def get_cached(key: str) -> Any | None:
    """Retrieve a cached value by key. Returns None on cache miss."""
    full_key = f"{REDIS_PREFIX_CACHE}{key}"
    value = redis_client.get(full_key)
    if value:
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return value
    return None


def set_cached(key: str, value: Any, ttl_seconds: int) -> None:
    """Store a value in cache with a TTL. Serializes dicts/lists to JSON."""
    full_key = f"{REDIS_PREFIX_CACHE}{key}"
    serialized = json.dumps(value) if isinstance(value, (dict, list)) else str(value)
    redis_client.setex(full_key, ttl_seconds, serialized)


def delete_cached(key: str) -> None:
    """Remove a specific key from cache."""
    full_key = f"{REDIS_PREFIX_CACHE}{key}"
    redis_client.delete(full_key)


def invalidate_pattern(pattern: str) -> None:
    """Delete all cache keys matching a pattern. Use sparingly."""
    full_pattern = f"{REDIS_PREFIX_CACHE}{pattern}"
    keys = redis_client.keys(full_pattern)
    if keys:
        redis_client.delete(*keys)
