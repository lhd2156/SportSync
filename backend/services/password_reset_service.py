"""
SportSync password reset code service.

Stores short-lived one-time reset codes in Redis when available
with a local in-memory fallback for development and tests.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import threading
import time
from typing import Any

from config import settings
from constants import (
    PASSWORD_RESET_CODE_LENGTH,
    PASSWORD_RESET_CODE_MAX_ATTEMPTS,
    REDIS_PREFIX_PASSWORD_RESET,
)
from services.cache_service import redis_client

_LOCAL_RESET_CODES: dict[str, tuple[float, dict[str, Any]]] = {}
_LOCAL_RESET_CODES_LOCK = threading.Lock()


def _key_for_email(email: str) -> str:
    return f"{REDIS_PREFIX_PASSWORD_RESET}code:{email.strip().lower()}"


def _hash_code(email: str, code: str) -> str:
    payload = f"{email.strip().lower()}:{code.strip()}".encode("utf-8")
    secret = settings.jwt_secret.encode("utf-8")
    return hmac.new(secret, payload, hashlib.sha256).hexdigest()


def _local_prune() -> None:
    now = time.time()
    with _LOCAL_RESET_CODES_LOCK:
        expired_keys = [key for key, (expires_at, _) in _LOCAL_RESET_CODES.items() if expires_at <= now]
        for key in expired_keys:
            _LOCAL_RESET_CODES.pop(key, None)


def generate_password_reset_code() -> str:
    """Create a numeric code that is easy to type on mobile/desktop."""
    upper_bound = 10 ** PASSWORD_RESET_CODE_LENGTH
    return f"{secrets.randbelow(upper_bound):0{PASSWORD_RESET_CODE_LENGTH}d}"


def store_password_reset_code(email: str, code: str, *, user_id: str, ttl_seconds: int) -> None:
    key = _key_for_email(email)
    payload = {
        "user_id": user_id,
        "code_hash": _hash_code(email, code),
        "attempts": 0,
    }
    if redis_client:
        redis_client.setex(key, ttl_seconds, json.dumps(payload))
        return

    expires_at = time.time() + max(ttl_seconds, 1)
    with _LOCAL_RESET_CODES_LOCK:
        _LOCAL_RESET_CODES[key] = (expires_at, payload)


def _load_payload(email: str) -> dict[str, Any] | None:
    key = _key_for_email(email)
    if redis_client:
        raw = redis_client.get(key)
        if not raw:
            return None
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            redis_client.delete(key)
            return None

    _local_prune()
    with _LOCAL_RESET_CODES_LOCK:
        entry = _LOCAL_RESET_CODES.get(key)
        if not entry:
            return None
        _, payload = entry
        return dict(payload)


def _save_payload(email: str, payload: dict[str, Any], ttl_seconds: int) -> None:
    key = _key_for_email(email)
    if redis_client:
        redis_client.setex(key, max(ttl_seconds, 1), json.dumps(payload))
        return

    expires_at = time.time() + max(ttl_seconds, 1)
    with _LOCAL_RESET_CODES_LOCK:
        _LOCAL_RESET_CODES[key] = (expires_at, dict(payload))


def delete_password_reset_code(email: str) -> None:
    key = _key_for_email(email)
    if redis_client:
        redis_client.delete(key)
        return

    with _LOCAL_RESET_CODES_LOCK:
        _LOCAL_RESET_CODES.pop(key, None)


def verify_password_reset_code(email: str, code: str) -> str | None:
    """
    Validate a one-time reset code.

    Returns the associated user_id when valid, else None.
    Invalid attempts increment and eventually invalidate the code.
    """
    key = _key_for_email(email)
    payload = _load_payload(email)
    if not payload:
        return None

    expected_hash = str(payload.get("code_hash") or "")
    candidate_hash = _hash_code(email, code)
    if hmac.compare_digest(expected_hash, candidate_hash):
        return str(payload.get("user_id") or "")

    attempts = int(payload.get("attempts") or 0) + 1
    if attempts >= PASSWORD_RESET_CODE_MAX_ATTEMPTS:
        delete_password_reset_code(email)
        return None

    if redis_client:
        ttl_seconds = int(redis_client.ttl(key))
        ttl_seconds = max(ttl_seconds, 1)
    else:
        with _LOCAL_RESET_CODES_LOCK:
            expires_at = _LOCAL_RESET_CODES.get(key, (time.time(), {}))[0]
        ttl_seconds = max(int(expires_at - time.time()), 1)

    payload["attempts"] = attempts
    _save_payload(email, payload, ttl_seconds)
    return None
