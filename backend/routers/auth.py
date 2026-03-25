"""
SportSync - Auth Router.

Handles register, login, Google OAuth, refresh, logout, and onboarding.
All business logic delegated to auth_service. This file only handles
HTTP concerns: request parsing, response formatting, and cookie setting.
"""
import logging
import time
from datetime import date, datetime
from urllib.parse import quote, urlparse

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy import func
from sqlalchemy.orm import Session

from config import settings
from database import get_db
from dependencies import get_current_user
from models.user import User
from models.team import Team, UserSport, UserTeam
from schemas.auth import (
    RegisterRequest,
    LoginRequest,
    GoogleAuthRequest,
    AuthResponse,
    OnboardingStep1Request,
    OnboardingStep2Request,
    OnboardingCompleteRequest,
    SetPasswordRequest,
    ChangePasswordRequest,
    PasswordResetRequest,
    PasswordResetConfirmRequest,
    PasswordResetCodeConfirmRequest,
    TokenRefreshResponse,
)
from schemas.common import (
    DetailResponse,
    OnboardingCompleteResponse,
    PasswordResetResponse,
    ValidResponse,
)
from services.auth_service import (
    hash_password,
    verify_password,
    create_access_token,
    create_refresh_token,
    create_password_reset_token,
    decode_token,
    generate_session_token,
    check_account_locked,
    clear_expired_account_lock,
    get_account_lockout_remaining_seconds,
    format_lockout_duration,
    record_failed_login,
    reset_failed_logins,
    store_session_in_redis,
    validate_session_in_redis,
    delete_session_from_redis,
    blacklist_token,
    is_token_blacklisted,
)
from services.security_service import check_rate_limit, check_subject_rate_limit
from services.cache_service import redis_client
from services.email_service import email_delivery_configured, send_password_reset_code_email
from services.password_reset_service import (
    delete_password_reset_code,
    generate_password_reset_code,
    store_password_reset_code,
    verify_password_reset_code,
)
from services.profile_validation import (
    is_valid_person_name,
    normalize_display_handle,
    normalize_display_handle_key,
    sanitize_display_handle_candidate,
)
from constants import (
    CACHE_TTL_SESSION,
    MINIMUM_AGE_YEARS,
    REDIS_PREFIX_PASSWORD_RESET,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])
logger = logging.getLogger(__name__)
GENERIC_PASSWORD_RESET_MESSAGE = (
    "If an account exists for that email, reset instructions will be sent."
)
_local_used_password_reset_tokens: dict[str, int] = {}


def _normalize_email(email: str | None) -> str:
    """Trim and lowercase email input for consistent matching/storage."""
    return str(email or "").strip().lower()


def _normalize_display_name(display_name: str | None) -> str:
    """Trim display handles before comparing or storing them."""
    return normalize_display_handle(display_name)


def _normalize_display_name_key(display_name: str | None) -> str:
    """Build the unique storage key for display handles."""
    return normalize_display_handle_key(display_name)


def _find_user_by_email(db: Session, email: str | None) -> User | None:
    """Find a user by email using a case-insensitive, trimmed lookup."""
    normalized_email = _normalize_email(email)
    if not normalized_email:
        return None
    return (
        db.query(User)
        .filter(func.lower(User.email) == normalized_email)
        .first()
    )


def _find_user_by_display_name(
    db: Session,
    display_name: str | None,
    *,
    exclude_user_id: str | None = None,
) -> User | None:
    """Find a user by display handle using case-insensitive matching."""
    normalized_display_name = _normalize_display_name(display_name)
    if not normalized_display_name:
        return None

    query = db.query(User).filter(
        User.display_name_normalized == _normalize_display_name_key(normalized_display_name)
    )
    if exclude_user_id:
        query = query.filter(User.id != exclude_user_id)
    return query.first()


def _is_display_name_integrity_error(error: IntegrityError) -> bool:
    details = " ".join(
        str(part)
        for part in (error.orig, error.statement, error.params)
        if part is not None
    ).lower()
    return "display_name_normalized" in details


def _commit_or_raise_display_name_conflict(db: Session) -> None:
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        if _is_display_name_integrity_error(exc):
            raise HTTPException(
                status_code=409,
                detail="Display name already taken. Please choose another.",
            ) from exc
        raise


def _generate_unique_display_name(
    db: Session,
    preferred_display_name: str | None,
    fallback_seed: str | None,
) -> str:
    """Generate a unique handle for OAuth users when Google data collides."""
    normalized_preferred = sanitize_display_handle_candidate(preferred_display_name)
    normalized_seed = sanitize_display_handle_candidate(fallback_seed)

    for candidate in (normalized_preferred, normalized_seed):
        if candidate and not _find_user_by_display_name(db, candidate):
            return candidate

    base_candidate = normalized_seed or normalized_preferred or "sportsync"
    suffix = 2
    generated = base_candidate
    while _find_user_by_display_name(db, generated):
        generated = f"{base_candidate}_{suffix}"
        suffix += 1
    return generated


def _set_refresh_cookie(response: Response, token: str, max_age: int) -> None:
    """Set the refresh token as an HTTP-only cookie."""
    response.set_cookie(
        key="refresh_token",
        value=token,
        max_age=max_age,
        httponly=True,
        secure=settings.cookie_secure,
        samesite=settings.cookie_samesite_value,
        path="/",
        domain=settings.cookie_domain_value,
    )


def _clear_auth_cookies(response: Response) -> None:
    """Remove all auth cookies on logout."""
    response.delete_cookie("refresh_token", path="/", domain=settings.cookie_domain_value)
    response.delete_cookie("session_token", path="/", domain=settings.cookie_domain_value)


def _calculate_age(dob: date) -> int:
    """Calculate age from date of birth. Used to enforce 18+ requirement."""
    today = date.today()
    age = today.year - dob.year
    if (today.month, today.day) < (dob.month, dob.day):
        age -= 1
    return age


def _resolve_frontend_origin(request: Request) -> str:
    """Pick the safest frontend origin available for reset links."""
    allowed_origins = set(settings.redirect_allowlist_list)
    candidate_origins = [
        request.headers.get("origin"),
        request.headers.get("referer"),
        *settings.redirect_allowlist_list,
        settings.production_domain,
    ]

    for candidate in candidate_origins:
        if not candidate:
            continue
        try:
            normalized = settings._normalize_origin(candidate)
            if normalized in allowed_origins:
                return normalized
        except Exception:
            continue

    if settings.production_domain.strip():
        try:
            normalized_production = settings._normalize_origin(settings.production_domain)
            if normalized_production in allowed_origins:
                return normalized_production
        except Exception:
            pass

    if allowed_origins:
        return sorted(allowed_origins)[0]

    logger.error("No allowed frontend origin configured for password reset links.")
    raise HTTPException(
        status_code=500,
        detail="Password reset is temporarily unavailable.",
    )


def _build_password_reset_url(request: Request, token: str) -> str:
    frontend_origin = _resolve_frontend_origin(request).rstrip("/")
    return f"{frontend_origin}/reset-password?token={quote(token)}"


def _build_password_reset_code_url(request: Request, email: str) -> str:
    frontend_origin = _resolve_frontend_origin(request).rstrip("/")
    return f"{frontend_origin}/reset-password?email={quote(_normalize_email(email))}"


def _prune_local_used_password_reset_tokens() -> None:
    """Drop expired local token markers used when Redis is unavailable."""
    now_ts = int(time.time())
    expired = [
        jti for jti, expires_at in _local_used_password_reset_tokens.items()
        if expires_at <= now_ts
    ]
    for jti in expired:
        _local_used_password_reset_tokens.pop(jti, None)


def _get_password_reset_user(
    db: Session,
    token: str,
    *,
    require_unused: bool = True,
) -> tuple[User, dict]:
    payload = decode_token(token)
    if not payload or payload.get("type") != "password_reset":
        raise HTTPException(status_code=400, detail="This reset link is invalid or expired.")

    user_id = str(payload.get("sub") or "").strip()
    if not user_id:
        raise HTTPException(status_code=400, detail="This reset link is invalid or expired.")

    reset_jti = str(payload.get("jti") or "").strip()
    if require_unused and reset_jti:
        if redis_client:
            used_key = f"{REDIS_PREFIX_PASSWORD_RESET}used:{reset_jti}"
            try:
                if redis_client.exists(used_key):
                    raise HTTPException(status_code=400, detail="This reset link has already been used.")
            except HTTPException:
                raise
            except Exception:
                logger.exception("Failed to check password reset token usage for jti=%s", reset_jti)
        else:
            _prune_local_used_password_reset_tokens()
            if reset_jti in _local_used_password_reset_tokens:
                raise HTTPException(status_code=400, detail="This reset link has already been used.")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=400, detail="This reset link is invalid or expired.")

    return user, payload


# ──────────────────────────────────────────────────────────────
# Public Endpoints (no auth required)
# ──────────────────────────────────────────────────────────────


@router.post("/register", response_model=AuthResponse)
async def register(
    request: Request,
    body: RegisterRequest,
    response: Response,
    db: Session = Depends(get_db),
):
    """Create a new account with email, password, date of birth, and display name."""
    check_rate_limit(request, "register")

    if body.password != body.confirm_password:
        raise HTTPException(status_code=400, detail="Passwords do not match")

    # Enforce 18+ age requirement at registration
    age = _calculate_age(body.date_of_birth)
    if age < MINIMUM_AGE_YEARS:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You must be 18 or older to use SportSync",
        )

    normalized_email = _normalize_email(body.email)
    normalized_display_name = _normalize_display_name(body.display_name)

    existing = _find_user_by_email(db, normalized_email)
    if existing:
        raise HTTPException(
            status_code=409,
            detail="Email already registered. Please log in instead.",
        )

    # Check display name uniqueness
    existing_display = _find_user_by_display_name(db, normalized_display_name)
    if existing_display:
        raise HTTPException(
            status_code=409,
            detail="Display name already taken. Please choose another.",
        )

    user = User(
        email=normalized_email,
        hashed_password=hash_password(body.password),
        role="user",
        first_name=body.first_name.strip(),
        last_name=body.last_name.strip(),
        display_name=normalized_display_name,
        display_name_normalized=_normalize_display_name_key(normalized_display_name),
        date_of_birth=body.date_of_birth,
        gender=body.gender,
        is_onboarded=False,
    )
    db.add(user)
    _commit_or_raise_display_name_conflict(db)
    db.refresh(user)

    access_token = create_access_token(str(user.id))
    refresh_token, max_age = create_refresh_token(str(user.id))
    _set_refresh_cookie(response, refresh_token, max_age)

    return AuthResponse(
        access_token=access_token,
        is_onboarded=False,
        is_new_user=True,
        user_id=str(user.id),
        email=user.email,
        display_name=user.display_name,
        date_of_birth=str(user.date_of_birth) if user.date_of_birth else None,
        gender=user.gender,
        first_name=user.first_name,
        last_name=user.last_name,
        provider="email",
        has_password=bool(user.hashed_password),
    )


@router.post("/login", response_model=AuthResponse)
async def login(
    request: Request,
    body: LoginRequest,
    response: Response,
    db: Session = Depends(get_db),
):
    """Authenticate with email and password."""
    check_rate_limit(request, "login")

    normalized_email = _normalize_email(body.email)
    user = _find_user_by_email(db, normalized_email)
    if not user or not user.hashed_password:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    clear_expired_account_lock(db, user)

    if check_account_locked(user):
        remaining_seconds = get_account_lockout_remaining_seconds(user)
        remaining_duration = format_lockout_duration(remaining_seconds)
        raise HTTPException(
            status_code=423,
            detail=f"Account locked. Please try again in {remaining_duration}.",
        )

    if not verify_password(body.password, user.hashed_password):
        record_failed_login(db, user)
        if check_account_locked(user):
            remaining_seconds = get_account_lockout_remaining_seconds(user)
            remaining_duration = format_lockout_duration(remaining_seconds)
            raise HTTPException(
                status_code=423,
                detail=f"Account locked. Please try again in {remaining_duration}.",
            )
        raise HTTPException(status_code=401, detail="Invalid email or password")

    reset_failed_logins(db, user)

    access_token = create_access_token(str(user.id))
    refresh_token, max_age = create_refresh_token(str(user.id), body.remember_me)
    _set_refresh_cookie(response, refresh_token, max_age)

    # Store Remember Me session in Redis for long-lived access
    if body.remember_me:
        session_token = generate_session_token()
        if redis_client:
            store_session_in_redis(redis_client, session_token, str(user.id))
        response.set_cookie(
            key="session_token",
            value=session_token,
            max_age=CACHE_TTL_SESSION,
            httponly=True,
            secure=settings.cookie_secure,
            samesite=settings.cookie_samesite_value,
            path="/",
            domain=settings.cookie_domain_value,
        )

    return AuthResponse(
        access_token=access_token,
        is_onboarded=user.is_onboarded,
        user_id=str(user.id),
        email=user.email,
        display_name=user.display_name,
        date_of_birth=str(user.date_of_birth) if user.date_of_birth else None,
        gender=user.gender,
        first_name=getattr(user, 'first_name', None),
        last_name=getattr(user, 'last_name', None),
        provider="google" if user.google_id else "email",
        has_password=bool(user.hashed_password),
    )


@router.post("/google", response_model=AuthResponse)
async def google_auth(
    request: Request,
    body: GoogleAuthRequest,
    response: Response,
    db: Session = Depends(get_db),
):
    """Authenticate or register via Google OAuth 2.0."""
    import httpx

    check_rate_limit(request, "google")

    try:
        async with httpx.AsyncClient() as client:
            google_resp = await client.get(
                f"https://oauth2.googleapis.com/tokeninfo?id_token={body.google_token}"
            )

        if google_resp.status_code != 200:
            logger.warning(
                "Google token rejected with status %s",
                google_resp.status_code,
            )
            raise HTTPException(status_code=401, detail="Invalid Google token")

        google_data = google_resp.json()
        email = _normalize_email(google_data.get("email", ""))
        google_id = google_data.get("sub")
        google_audience = str(google_data.get("aud") or "").strip()
        email_verified = str(google_data.get("email_verified") or "").strip().lower()
        google_display_name = sanitize_display_handle_candidate(google_data.get("name") or "") or None
        raw_google_first_name = str(google_data.get("given_name") or "").strip() or None
        raw_google_last_name = str(google_data.get("family_name") or "").strip() or None
        google_first_name = raw_google_first_name if is_valid_person_name(raw_google_first_name) else None
        google_last_name = raw_google_last_name if is_valid_person_name(raw_google_last_name) else None
        google_picture = str(google_data.get("picture") or "").strip() or None

        if not email or not google_id:
            logger.warning("Google token missing required email/sub fields")
            raise HTTPException(status_code=401, detail="Invalid Google token data")

        configured_client_id = settings.google_client_id.strip()
        if configured_client_id and google_audience != configured_client_id:
            logger.warning("Google token audience mismatch for email=%s", email)
            raise HTTPException(status_code=401, detail="Invalid Google token")

        if email_verified not in {"true", "1"}:
            logger.warning("Google token email not verified for email=%s", email)
            raise HTTPException(status_code=401, detail="Invalid Google token")

        user = _find_user_by_email(db, email)
        is_new = False

        if not user:
            user = User(
                email=email,
                google_id=google_id,
                role="user",
                display_name=_generate_unique_display_name(
                    db,
                    google_display_name,
                    email.split("@")[0],
                ),
                first_name=google_first_name,
                last_name=google_last_name,
                profile_picture_url=google_picture,
                is_onboarded=False,
            )
            user.display_name_normalized = _normalize_display_name_key(user.display_name)
            db.add(user)
            _commit_or_raise_display_name_conflict(db)
            db.refresh(user)
            is_new = True
        else:
            did_update = False
            if not user.google_id:
                user.google_id = google_id
                did_update = True
            if not getattr(user, "first_name", None) and google_first_name:
                user.first_name = google_first_name
                did_update = True
            if not getattr(user, "last_name", None) and google_last_name:
                user.last_name = google_last_name
                did_update = True
            if not getattr(user, "display_name", None) and google_display_name:
                user.display_name = _generate_unique_display_name(
                    db,
                    google_display_name,
                    email.split("@")[0],
                )
                user.display_name_normalized = _normalize_display_name_key(user.display_name)
                did_update = True
            if not getattr(user, "profile_picture_url", None) and google_picture:
                user.profile_picture_url = google_picture
                did_update = True
            if did_update:
                _commit_or_raise_display_name_conflict(db)
                db.refresh(user)

        access_token = create_access_token(str(user.id))
        refresh_token, max_age = create_refresh_token(str(user.id))
        _set_refresh_cookie(response, refresh_token, max_age)

        return AuthResponse(
            access_token=access_token,
            is_onboarded=user.is_onboarded,
            is_new_user=is_new,
            user_id=str(user.id),
            email=user.email,
            display_name=user.display_name,
            date_of_birth=str(user.date_of_birth) if user.date_of_birth else None,
            gender=user.gender,
            profile_picture_url=user.profile_picture_url,
            first_name=getattr(user, 'first_name', None),
            last_name=getattr(user, 'last_name', None),
            provider="google" if user.google_id else "email",
            has_password=bool(user.hashed_password),
        )
    except HTTPException:
        raise
    except Exception:
        logger.exception("Unexpected Google auth failure")
        raise HTTPException(status_code=500, detail="Unable to complete sign in right now")


@router.post("/refresh", response_model=TokenRefreshResponse)
async def refresh(request: Request, response: Response, db: Session = Depends(get_db)):
    """Issue a new access token using the refresh token cookie."""
    check_rate_limit(request, "refresh")

    refresh_token = request.cookies.get("refresh_token")
    if not refresh_token:
        raise HTTPException(status_code=401, detail="No refresh token")

    if is_token_blacklisted(redis_client, refresh_token):
        raise HTTPException(status_code=401, detail="Token revoked")

    payload = decode_token(refresh_token)
    if not payload or payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    user_id = payload.get("sub")
    remember_me = bool(payload.get("remember_me", False))
    if remember_me:
        session_token = request.cookies.get("session_token")
        if not session_token or not redis_client:
            raise HTTPException(status_code=401, detail="Persistent session expired")

        remembered_user_id = validate_session_in_redis(redis_client, session_token)
        if str(remembered_user_id or "") != str(user_id):
            raise HTTPException(status_code=401, detail="Persistent session expired")
        store_session_in_redis(redis_client, session_token, str(user_id))

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    exp = int(payload.get("exp", 0) or 0)
    remaining = max(int(exp - datetime.utcnow().timestamp()), 1)
    blacklist_token(redis_client, refresh_token, remaining)

    new_access = create_access_token(str(user.id))
    new_refresh, max_age = create_refresh_token(str(user.id), remember_me=remember_me)
    _set_refresh_cookie(response, new_refresh, max_age)
    return TokenRefreshResponse(access_token=new_access)


@router.post("/logout", response_model=DetailResponse)
async def logout(request: Request, response: Response):
    """Clear all auth cookies and blacklist the current tokens in Redis."""
    check_rate_limit(request, "logout")

    refresh_token = request.cookies.get("refresh_token")
    session_token = request.cookies.get("session_token")

    if refresh_token:
        payload = decode_token(refresh_token)
        if payload:
            exp = payload.get("exp", 0)
            remaining = max(int(exp - datetime.utcnow().timestamp()), 0)
            blacklist_token(redis_client, refresh_token, remaining)

    if session_token and redis_client:
        delete_session_from_redis(redis_client, session_token)

    _clear_auth_cookies(response)
    return {"detail": "Logged out"}


@router.post("/password-reset", response_model=PasswordResetResponse)
async def request_password_reset(
    body: PasswordResetRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """
    Rate-limited password reset request endpoint.
    Always returns a generic response so account existence is never exposed.
    """
    check_rate_limit(request, "password_reset_request")

    normalized_email = _normalize_email(body.email)
    client_ip = request.client.host if request.client else "unknown"
    response_payload: dict[str, str] = {"detail": GENERIC_PASSWORD_RESET_MESSAGE}

    if settings.environment.lower() == "production" and not email_delivery_configured():
        logger.error("Password reset requested in production but SMTP is not configured.")
        raise HTTPException(
            status_code=503,
            detail="Password reset is temporarily unavailable.",
        )

    try:
        check_subject_rate_limit("password_reset", normalized_email)
        user = _find_user_by_email(db, normalized_email)
        if user:
            reset_code = generate_password_reset_code()
            ttl_seconds = max(settings.password_reset_expire_minutes * 60, 60)
            store_password_reset_code(
                normalized_email,
                reset_code,
                user_id=str(user.id),
                ttl_seconds=ttl_seconds,
            )
            logger.info("Password reset code generated for user_id=%s", user.id)
            if email_delivery_configured():
                send_password_reset_code_email(
                    to_email=user.email,
                    code=reset_code,
                    expires_minutes=settings.password_reset_expire_minutes,
                )
            if settings.environment.lower() != "production":
                response_payload["dev_reset_url"] = _build_password_reset_code_url(request, normalized_email)
                response_payload["dev_reset_code"] = reset_code
    except Exception:
        logger.exception(
            "Password reset request failed for email=%s ip=%s",
            normalized_email,
            client_ip,
        )

    return response_payload


@router.get("/password-reset/validate", response_model=ValidResponse)
async def validate_password_reset_token(
    token: str,
    request: Request,
    db: Session = Depends(get_db),
):
    """Check whether a password reset token is valid before showing the form."""
    check_rate_limit(request, "password_reset_validate")

    _get_password_reset_user(db, token, require_unused=True)
    return {"valid": True}


@router.post("/password-reset/confirm", response_model=DetailResponse)
async def confirm_password_reset(
    body: PasswordResetConfirmRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """Set a new password using a valid password reset token."""
    check_rate_limit(request, "password_reset_confirm")

    if body.password != body.confirm_password:
        raise HTTPException(status_code=400, detail="Passwords do not match")

    user, payload = _get_password_reset_user(db, body.token, require_unused=True)
    user.hashed_password = hash_password(body.password)
    user.failed_login_attempts = 0
    user.locked_until = None
    db.commit()

    reset_jti = str(payload.get("jti") or "").strip()
    if reset_jti:
        try:
            exp = payload.get("exp")
            if isinstance(exp, (int, float)):
                ttl_seconds = max(int(exp - datetime.utcnow().timestamp()), 1)
                if redis_client:
                    redis_client.setex(
                        f"{REDIS_PREFIX_PASSWORD_RESET}used:{reset_jti}",
                        ttl_seconds,
                        "1",
                    )
                else:
                    _prune_local_used_password_reset_tokens()
                    _local_used_password_reset_tokens[reset_jti] = int(time.time()) + ttl_seconds
        except Exception:
            logger.exception("Failed to mark password reset token as used for jti=%s", reset_jti)

    return {"detail": "Password reset successfully. Please sign in with your new password."}


@router.post("/password-reset/code/confirm", response_model=DetailResponse)
async def confirm_password_reset_code(
    body: PasswordResetCodeConfirmRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """Set a new password using a valid emailed one-time code."""
    check_rate_limit(request, "password_reset_code_confirm")

    if body.password != body.confirm_password:
        raise HTTPException(status_code=400, detail="Passwords do not match")

    normalized_email = _normalize_email(body.email)
    user = _find_user_by_email(db, normalized_email)
    if not user:
        raise HTTPException(status_code=400, detail="That code is invalid or expired.")

    verified_user_id = verify_password_reset_code(normalized_email, body.code)
    if not verified_user_id or verified_user_id != str(user.id):
        raise HTTPException(status_code=400, detail="That code is invalid or expired.")

    user.hashed_password = hash_password(body.password)
    user.failed_login_attempts = 0
    user.locked_until = None
    db.commit()
    delete_password_reset_code(normalized_email)

    return {"detail": "Password reset successfully. Please sign in with your new password."}


# ──────────────────────────────────────────────────────────────
# Protected Endpoints (auth required via get_current_user)
# ──────────────────────────────────────────────────────────────


@router.post("/onboarding/step-1", response_model=DetailResponse)
async def onboarding_step_1(
    body: OnboardingStep1Request,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Save personal info. Enforces 18+ age requirement server-side."""
    check_rate_limit(request, "onboarding_step_1")

    age = _calculate_age(body.date_of_birth)
    if age < MINIMUM_AGE_YEARS:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You must be 18 or older to use SportSync",
        )

    normalized_display_name = _normalize_display_name(body.display_name)
    if not normalized_display_name:
        raise HTTPException(status_code=400, detail="Display name is required")

    existing_display = _find_user_by_display_name(
        db,
        normalized_display_name,
        exclude_user_id=str(user.id),
    )
    if existing_display:
        raise HTTPException(
            status_code=409,
            detail="Display name already taken. Please choose another.",
        )

    user.display_name = normalized_display_name
    user.display_name_normalized = _normalize_display_name_key(normalized_display_name)
    user.date_of_birth = body.date_of_birth
    user.gender = body.gender
    if body.profile_picture_url:
        user.profile_picture_url = body.profile_picture_url.strip()
    _commit_or_raise_display_name_conflict(db)

    return {"detail": "Step 1 complete"}


@router.post("/onboarding/step-2", response_model=DetailResponse)
async def onboarding_step_2(
    body: OnboardingStep2Request,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Save selected sports from onboarding."""
    check_rate_limit(request, "onboarding_step_2")

    db.query(UserSport).filter(UserSport.user_id == user.id).delete()
    for sport in body.sports:
        db.add(UserSport(user_id=user.id, sport=sport))
    _commit_or_raise_display_name_conflict(db)

    return {"detail": "Step 2 complete"}


@router.post("/onboarding/complete", response_model=OnboardingCompleteResponse)
async def onboarding_complete(
    body: OnboardingCompleteRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Save favorite teams and mark onboarding as complete."""
    check_rate_limit(request, "onboarding_complete")

    saved_team_ids: set[str] = set()

    for raw_team_id in body.team_ids:
        normalized_team_id = (raw_team_id or "").strip()
        if not normalized_team_id:
            continue

        # Try direct ID or external_id match first
        team = (
            db.query(Team)
            .filter((Team.id == normalized_team_id) | (Team.external_id == normalized_team_id))
            .first()
        )

        # Fallback: try matching as TheSportsDB ID (onboarding uses these)
        if not team:
            team = (
                db.query(Team)
                .filter(Team.external_id.like(f"%:{normalized_team_id}"))
                .first()
            )

        if not team or team.id in saved_team_ids:
            continue

        existing = (
            db.query(UserTeam)
            .filter(UserTeam.user_id == user.id, UserTeam.team_id == team.id)
            .first()
        )
        if existing:
            saved_team_ids.add(team.id)
            continue

        db.add(UserTeam(user_id=user.id, team_id=team.id))
        saved_team_ids.add(team.id)

    user.is_onboarded = True
    _commit_or_raise_display_name_conflict(db)

    return {"detail": "Onboarding complete", "is_onboarded": True, "teams_saved": len(saved_team_ids)}


@router.post("/set-password", response_model=DetailResponse)
async def set_password(
    body: SetPasswordRequest,
    request: Request,
    user: User = Depends(get_current_user),
):
    """Allow Google users to set a password for email login."""
    check_rate_limit(request, "set_password")

    if body.password != body.confirm_password:
        raise HTTPException(status_code=400, detail="Passwords do not match")

    from database import SessionLocal

    db = SessionLocal()
    try:
        db_user = db.query(User).filter(User.id == user.id).first()
        if db_user:
            db_user.hashed_password = hash_password(body.password)
            db.commit()
    finally:
        db.close()

    return {"detail": "Password set successfully"}


@router.post("/change-password", response_model=DetailResponse)
async def change_password(
    body: ChangePasswordRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Change the current user's password. Existing-password accounts must confirm the current password."""
    check_rate_limit(request, "change_password")

    if body.new_password != body.confirm_password:
        raise HTTPException(status_code=400, detail="Passwords do not match")

    db_user = db.query(User).filter(User.id == user.id).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")

    if db_user.hashed_password:
        if not body.current_password:
            raise HTTPException(status_code=400, detail="Current password is required")
        if not verify_password(body.current_password, db_user.hashed_password):
            raise HTTPException(status_code=401, detail="Current password is incorrect")

    db_user.hashed_password = hash_password(body.new_password)
    db.commit()

    return {"detail": "Password updated successfully"}
