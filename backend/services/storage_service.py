"""
SportSync object storage service.

Supports S3-compatible storage for avatars when configured and falls back to
local file storage for local development. No avatar payloads are stored as
base64 data URLs.
"""
from __future__ import annotations

import mimetypes
import uuid
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote, urlparse

from config import BACKEND_DIR, settings

UPLOADS_DIR = BACKEND_DIR / "uploads"
AVATAR_UPLOADS_DIR = UPLOADS_DIR / "avatars"

_LOCAL_URL_PREFIX = "/uploads/avatars/"

_EXTENSIONS_BY_CONTENT_TYPE = {
    "image/gif": ".gif",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}


@dataclass
class StoredObject:
    public_url: str
    object_key: str | None = None
    provider: str = "local"


def _is_s3_enabled() -> bool:
    # Allow either static credentials or the default AWS credential chain
    # (for example EC2 instance roles) as long as a bucket is configured.
    return bool(settings.aws_s3_bucket.strip())


def _build_avatar_object_key(user_id: str, content_type: str) -> str:
    extension = _EXTENSIONS_BY_CONTENT_TYPE.get(content_type.lower())
    if not extension:
        guessed_extension = mimetypes.guess_extension(content_type.lower()) or ".bin"
        extension = ".jpg" if guessed_extension == ".jpe" else guessed_extension
    return f"avatars/{user_id}/{uuid.uuid4().hex}{extension}"


def _get_s3_client():
    import boto3

    client_kwargs: dict[str, object] = {
        "aws_access_key_id": settings.aws_access_key_id.strip() or None,
        "aws_secret_access_key": settings.aws_secret_access_key.strip() or None,
        "region_name": settings.aws_region.strip() or None,
    }
    endpoint_url = settings.aws_s3_endpoint_url.strip()
    if endpoint_url:
        client_kwargs["endpoint_url"] = endpoint_url
    if settings.aws_s3_use_path_style:
        client_kwargs["config"] = boto3.session.Config(s3={"addressing_style": "path"})
    return boto3.client("s3", **client_kwargs)


def _build_s3_public_url(object_key: str) -> str:
    public_base = settings.aws_s3_public_base_url.strip().rstrip("/")
    bucket = settings.aws_s3_bucket.strip()
    if public_base:
        return f"{public_base}/{quote(object_key)}"

    endpoint_url = settings.aws_s3_endpoint_url.strip().rstrip("/")
    if endpoint_url:
        if settings.aws_s3_use_path_style:
            return f"{endpoint_url}/{bucket}/{quote(object_key)}"
        parsed = urlparse(endpoint_url)
        host = parsed.netloc or parsed.path
        scheme = parsed.scheme or "https"
        return f"{scheme}://{bucket}.{host}/{quote(object_key)}"

    region = settings.aws_region.strip() or "us-east-1"
    if region == "us-east-1":
        return f"https://{bucket}.s3.amazonaws.com/{quote(object_key)}"
    return f"https://{bucket}.s3.{region}.amazonaws.com/{quote(object_key)}"


def _upload_to_s3(payload: bytes, content_type: str, user_id: str) -> StoredObject:
    client = _get_s3_client()
    object_key = _build_avatar_object_key(user_id, content_type)
    client.put_object(
        Bucket=settings.aws_s3_bucket.strip(),
        Key=object_key,
        Body=payload,
        ContentType=content_type,
        CacheControl="public, max-age=31536000, immutable",
    )
    return StoredObject(
        public_url=_build_s3_public_url(object_key),
        object_key=object_key,
        provider="s3",
    )


def _guess_content_type(path: Path) -> str:
    guessed, _ = mimetypes.guess_type(path.name)
    return guessed or "application/octet-stream"


def _upload_to_local_storage(payload: bytes, content_type: str, user_id: str) -> StoredObject:
    object_key = _build_avatar_object_key(user_id, content_type)
    target_path = (UPLOADS_DIR / object_key).resolve()
    target_path.parent.mkdir(parents=True, exist_ok=True)
    target_path.write_bytes(payload)
    return StoredObject(
        public_url=f"{_LOCAL_URL_PREFIX}{target_path.name}",
        object_key=object_key,
        provider="local",
    )


def store_profile_avatar(payload: bytes, content_type: str, user_id: str) -> StoredObject:
    """Persist an avatar in S3-compatible storage when configured."""
    if _is_s3_enabled():
        try:
            return _upload_to_s3(payload, content_type, user_id)
        except Exception:
            # Fall back to local file storage so development never regresses.
            pass
    return _upload_to_local_storage(payload, content_type, user_id)


def build_local_avatar_public_url(base_origin: str, public_url: str) -> str:
    """Resolve a local avatar path into a browser-safe absolute URL."""
    if public_url.startswith("http://") or public_url.startswith("https://"):
        return public_url
    return f"{base_origin.rstrip('/')}{public_url}"


def _local_avatar_path_from_url(public_url: str) -> Path | None:
    parsed = urlparse(public_url)
    path = parsed.path or public_url
    if not path.startswith(_LOCAL_URL_PREFIX):
        return None
    file_name = path.removeprefix(_LOCAL_URL_PREFIX)
    if not file_name:
        return None
    return (AVATAR_UPLOADS_DIR / file_name).resolve()


def _delete_local_avatar(public_url: str) -> None:
    target_path = _local_avatar_path_from_url(public_url)
    if not target_path or not target_path.exists():
        return
    try:
        target_path.unlink()
    except OSError:
        pass


def _extract_s3_object_key(public_url: str) -> str | None:
    bucket = settings.aws_s3_bucket.strip()
    parsed = urlparse(public_url)
    path = parsed.path.lstrip("/")
    if not path:
        return None

    if settings.aws_s3_public_base_url.strip():
        base = settings.aws_s3_public_base_url.strip().rstrip("/")
        if public_url.startswith(base + "/"):
            return public_url[len(base) + 1 :]

    if settings.aws_s3_use_path_style and path.startswith(f"{bucket}/"):
        return path[len(bucket) + 1 :]

    endpoint_url = settings.aws_s3_endpoint_url.strip()
    if endpoint_url:
        endpoint_host = urlparse(endpoint_url).netloc
        if parsed.netloc == endpoint_host and path.startswith(f"{bucket}/"):
            return path[len(bucket) + 1 :]
        if parsed.netloc.startswith(f"{bucket}."):
            return path

    if parsed.netloc.startswith(f"{bucket}.s3"):
        return path

    return None


def delete_avatar(public_url: str | None) -> None:
    """Delete a previously stored avatar object when possible."""
    if not public_url:
        return

    object_key = _extract_s3_object_key(public_url)
    if object_key and _is_s3_enabled():
        try:
            client = _get_s3_client()
            client.delete_object(Bucket=settings.aws_s3_bucket.strip(), Key=object_key)
            return
        except Exception:
            pass

    _delete_local_avatar(public_url)


def upload_static_directory(build_dir: Path, prefix: str = "") -> list[str]:
    """Upload a built static asset directory into S3-compatible storage."""
    if not _is_s3_enabled():
        raise RuntimeError("S3-compatible object storage is not configured.")

    resolved_build_dir = build_dir.resolve()
    if not resolved_build_dir.exists():
        raise FileNotFoundError(f"Static asset directory does not exist: {resolved_build_dir}")

    client = _get_s3_client()
    uploaded_keys: list[str] = []

    for file_path in sorted(resolved_build_dir.rglob("*")):
        if not file_path.is_file():
            continue
        relative_path = file_path.relative_to(resolved_build_dir).as_posix()
        normalized_prefix = prefix.strip().strip("/")
        object_key = f"{normalized_prefix}/{relative_path}" if normalized_prefix else relative_path
        content_type = _guess_content_type(file_path)
        is_hashed_asset = relative_path.startswith("assets/") and file_path.suffix in {".css", ".js", ".svg", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".ico"}
        cache_control = (
            "public, max-age=31536000, immutable"
            if is_hashed_asset
            else "public, max-age=300"
        )
        client.upload_file(
            str(file_path),
            settings.aws_s3_bucket.strip(),
            object_key,
            ExtraArgs={
                "ContentType": content_type,
                "CacheControl": cache_control,
            },
        )
        uploaded_keys.append(object_key)

    return uploaded_keys
