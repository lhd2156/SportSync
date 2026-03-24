"""
Shared profile validation helpers.
"""
import re

NAME_PATTERN = re.compile(r"^[A-Za-z]+$")
DISPLAY_HANDLE_PATTERN = re.compile(r"^[A-Za-z0-9_]+$")


def normalize_person_name(value: str | None) -> str:
    return str(value or "").strip()


def is_valid_person_name(value: str | None) -> bool:
    normalized = normalize_person_name(value)
    return bool(normalized and NAME_PATTERN.fullmatch(normalized))


def validate_person_name(value: str | None, label: str) -> str:
    normalized = normalize_person_name(value)
    if not normalized:
        raise ValueError(f"{label} is required")
    if not is_valid_person_name(normalized):
        raise ValueError(f"{label} can only contain letters")
    return normalized


def normalize_display_handle(value: str | None) -> str:
    return str(value or "").strip()


def normalize_display_handle_key(value: str | None) -> str:
    normalized = normalize_display_handle(value)
    return normalized.lower()


def is_valid_display_handle(value: str | None) -> bool:
    normalized = normalize_display_handle(value)
    return bool(normalized and DISPLAY_HANDLE_PATTERN.fullmatch(normalized))


def validate_display_handle(value: str | None) -> str:
    normalized = normalize_display_handle(value)
    if not normalized:
        raise ValueError("Display handle is required")
    if not is_valid_display_handle(normalized):
        raise ValueError("Display handle can only contain letters, numbers, and underscores")
    return normalized


def sanitize_display_handle_candidate(value: str | None) -> str:
    normalized = normalize_display_handle(value)
    if not normalized:
        return ""
    sanitized = re.sub(r"[^A-Za-z0-9_]+", "_", normalized)
    sanitized = re.sub(r"_+", "_", sanitized).strip("_")
    return sanitized[:100]
