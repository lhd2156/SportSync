"""
SportSync cache service.

Redis wrapper for consistent cache access and pub/sub across the application.
All cache keys use prefixed namespaces to avoid collisions.
Falls back to a local in-memory cache when Redis is unavailable.
"""

import json
import logging
import threading
import time
from copy import deepcopy
from fnmatch import fnmatch
from typing import Any

from config import settings
from constants import REDIS_PREFIX_CACHE

logger = logging.getLogger(__name__)
_LOCAL_CACHE: dict[str, tuple[float, Any]] = {}
_LOCAL_CACHE_LOCK = threading.Lock()

try:
    import redis

    redis_client = redis.from_url(settings.redis_url, decode_responses=True)
    redis_client.ping()
except Exception:
    logger.warning("Redis not available, using in-memory cache for local dev")
    redis_client = None  # type: ignore[assignment]


def _clone_value(value: Any) -> Any:
    if isinstance(value, (dict, list)):
        return deepcopy(value)
    return value


def _local_get(full_key: str) -> Any | None:
    now = time.time()
    with _LOCAL_CACHE_LOCK:
        entry = _LOCAL_CACHE.get(full_key)
        if not entry:
            return None
        expires_at, value = entry
        if expires_at <= now:
            _LOCAL_CACHE.pop(full_key, None)
            return None
        return _clone_value(value)


def _local_set(full_key: str, value: Any, ttl_seconds: int) -> None:
    expires_at = time.time() + max(ttl_seconds, 1)
    with _LOCAL_CACHE_LOCK:
        _LOCAL_CACHE[full_key] = (expires_at, _clone_value(value))


def _local_delete(full_key: str) -> None:
    with _LOCAL_CACHE_LOCK:
        _LOCAL_CACHE.pop(full_key, None)


def _local_invalidate_pattern(full_pattern: str) -> None:
    with _LOCAL_CACHE_LOCK:
        matching_keys = [key for key in _LOCAL_CACHE if fnmatch(key, full_pattern)]
        for key in matching_keys:
            _LOCAL_CACHE.pop(key, None)


def get_cached(key: str) -> Any | None:
    full_key = f"{REDIS_PREFIX_CACHE}{key}"
    if not redis_client:
        return _local_get(full_key)

    try:
        value = redis_client.get(full_key)
        if value:
            try:
                return json.loads(value)
            except json.JSONDecodeError:
                return value
    except Exception:
        logger.exception("Failed to read cache key %s", full_key)
    return None


def set_cached(key: str, value: Any, ttl_seconds: int) -> None:
    """Store a value in cache with a TTL."""
    full_key = f"{REDIS_PREFIX_CACHE}{key}"
    if not redis_client:
        _local_set(full_key, value, ttl_seconds)
        return

    serialized = json.dumps(value) if isinstance(value, (dict, list)) else str(value)
    try:
        redis_client.setex(full_key, ttl_seconds, serialized)
    except Exception:
        logger.exception("Failed to write cache key %s", full_key)


def delete_cached(key: str) -> None:
    """Remove a specific cache key."""
    full_key = f"{REDIS_PREFIX_CACHE}{key}"
    if not redis_client:
        _local_delete(full_key)
        return

    try:
        redis_client.delete(full_key)
    except Exception:
        logger.exception("Failed to delete cache key %s", full_key)


def invalidate_pattern(pattern: str) -> None:
    """Delete all cache keys matching a pattern."""
    full_pattern = f"{REDIS_PREFIX_CACHE}{pattern}"
    if not redis_client:
        _local_invalidate_pattern(full_pattern)
        return

    try:
        keys = redis_client.keys(full_pattern)
        if keys:
            redis_client.delete(*keys)
    except Exception:
        logger.exception("Failed to invalidate cache pattern %s", full_pattern)


def publish_message(channel: str, value: Any) -> bool:
    """Publish a message to a Redis pub/sub channel."""
    if not redis_client:
        return False

    if isinstance(value, str):
        payload = value
    else:
        try:
            payload = json.dumps(value)
        except (TypeError, ValueError):
            logger.warning("Skipping Redis publish for unserializable payload on %s", channel)
            return False

    try:
        redis_client.publish(channel, payload)
        return True
    except Exception:
        logger.exception("Failed to publish Redis message on %s", channel)
        return False
