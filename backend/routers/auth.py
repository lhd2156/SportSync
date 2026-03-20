"""
SportSync - Auth Router.

Handles register, login, Google OAuth, refresh, logout, and onboarding.
All business logic delegated to auth_service. This file only handles
HTTP concerns: request parsing, response formatting, and cookie setting.
"""
import logging
import secrets
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import func
from sqlalchemy.orm import Session

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
    TokenRefreshResponse,
)
from services.auth_service import (
    hash_password,
    verify_password,
    create_access_token,
    create_refresh_token,
    decode_token,
    generate_session_token,
    check_account_locked,
    record_failed_login,
    reset_failed_logins,
    store_session_in_redis,
    delete_session_from_redis,
    blacklist_token,
    is_token_blacklisted,
)
from services.security_service import check_rate_limit, check_subject_rate_limit
from services.cache_service import redis_client
from constants import (
    MINIMUM_AGE_YEARS,
    RATE_LIMIT_PASSWORD_RESET_WINDOW,
    REDIS_PREFIX_PASSWORD_RESET,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])
logger = logging.getLogger(__name__)
GENERIC_PASSWORD_RESET_MESSAGE = (
    "If an account exists for that email, reset instructions will be sent."
)


def _normalize_email(email: str | None) -> str:
    """Trim and lowercase email input for consistent matching/storage."""
    return str(email or "").strip().lower()


def _normalize_display_name(display_name: str | None) -> str:
    """Trim display handles before comparing or storing them."""
    return str(display_name or "").strip()


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
        func.lower(User.display_name) == normalized_display_name.lower()
    )
    if exclude_user_id:
        query = query.filter(User.id != exclude_user_id)
    return query.first()


def _generate_unique_display_name(
    db: Session,
    preferred_display_name: str | None,
    fallback_seed: str | None,
) -> str:
    """Generate a unique handle for OAuth users when Google data collides."""
    normalized_preferred = _normalize_display_name(preferred_display_name)
    normalized_seed = _normalize_display_name(fallback_seed)

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
    """Set the refresh token as an HTTP-only secure cookie."""
    response.set_cookie(
        key="refresh_token",
        value=token,
        max_age=max_age,
        httponly=True,
        secure=True,
        samesite="strict",
        path="/",
    )


def _clear_auth_cookies(response: Response) -> None:
    """Remove all auth cookies on logout."""
    response.delete_cookie("refresh_token", path="/")
    response.delete_cookie("session_token", path="/")


def _calculate_age(dob: date) -> int:
    """Calculate age from date of birth. Used to enforce 18+ requirement."""
    today = date.today()
    age = today.year - dob.year
    if (today.month, today.day) < (dob.month, dob.day):
        age -= 1
    return age


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
        first_name=body.first_name.strip(),
        last_name=body.last_name.strip(),
        display_name=normalized_display_name,
        date_of_birth=body.date_of_birth,
        gender=body.gender,
        is_onboarded=False,
    )
    db.add(user)
    db.commit()
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

    if check_account_locked(user):
        raise HTTPException(status_code=423, detail="Account locked. Try again later.")

    if not verify_password(body.password, user.hashed_password):
        record_failed_login(db, user)
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
            max_age=2592000,
            httponly=True,
            secure=True,
            samesite="strict",
            path="/",
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
    body: GoogleAuthRequest,
    response: Response,
    db: Session = Depends(get_db),
):
    """Authenticate or register via Google OAuth 2.0."""
    import httpx

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
        google_display_name = _normalize_display_name(google_data.get("name") or "") or None
        google_first_name = str(google_data.get("given_name") or "").strip() or None
        google_last_name = str(google_data.get("family_name") or "").strip() or None
        google_picture = str(google_data.get("picture") or "").strip() or None

        if not email or not google_id:
            logger.warning("Google token missing required email/sub fields")
            raise HTTPException(status_code=401, detail="Invalid Google token data")

        user = _find_user_by_email(db, email)
        is_new = False

        if not user:
            user = User(
                email=email,
                google_id=google_id,
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
            db.add(user)
            db.commit()
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
                did_update = True
            if not getattr(user, "profile_picture_url", None) and google_picture:
                user.profile_picture_url = google_picture
                did_update = True
            if did_update:
                db.commit()
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
    refresh_token = request.cookies.get("refresh_token")
    if not refresh_token:
        raise HTTPException(status_code=401, detail="No refresh token")

    if redis_client and is_token_blacklisted(redis_client, refresh_token):
        raise HTTPException(status_code=401, detail="Token revoked")

    payload = decode_token(refresh_token)
    if not payload or payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    user_id = payload.get("sub")
    remember_me = bool(payload.get("remember_me", False))
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    if redis_client:
        exp = int(payload.get("exp", 0) or 0)
        remaining = max(int(exp - datetime.utcnow().timestamp()), 1)
        blacklist_token(redis_client, refresh_token, remaining)

    new_access = create_access_token(str(user.id))
    new_refresh, max_age = create_refresh_token(str(user.id), remember_me=remember_me)
    _set_refresh_cookie(response, new_refresh, max_age)
    return TokenRefreshResponse(access_token=new_access)


@router.post("/logout")
async def logout(request: Request, response: Response):
    """Clear all auth cookies and blacklist the current tokens in Redis."""
    refresh_token = request.cookies.get("refresh_token")
    session_token = request.cookies.get("session_token")

    if refresh_token:
        payload = decode_token(refresh_token)
        if payload and redis_client:
            exp = payload.get("exp", 0)
            remaining = max(int(exp - datetime.utcnow().timestamp()), 0)
            blacklist_token(redis_client, refresh_token, remaining)

    if session_token and redis_client:
        delete_session_from_redis(redis_client, session_token)

    _clear_auth_cookies(response)
    return {"detail": "Logged out"}


@router.post("/password-reset")
async def request_password_reset(
    body: PasswordResetRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """
    Rate-limited password reset request endpoint.
    Always returns a generic response so account existence is never exposed.
    """
    normalized_email = _normalize_email(body.email)
    client_ip = request.client.host if request.client else "unknown"

    try:
        check_subject_rate_limit("password_reset", normalized_email)
        user = _find_user_by_email(db, normalized_email)
        if user and redis_client:
            reset_token = secrets.token_urlsafe(32)
            redis_client.setex(
                f"{REDIS_PREFIX_PASSWORD_RESET}token:{reset_token}",
                RATE_LIMIT_PASSWORD_RESET_WINDOW,
                str(user.id),
            )
        elif user:
            logger.warning(
                "Password reset requested for user_id=%s but Redis is unavailable",
                user.id,
            )
    except Exception:
        logger.exception(
            "Password reset request failed for email=%s ip=%s",
            normalized_email,
            client_ip,
        )

    return {"detail": GENERIC_PASSWORD_RESET_MESSAGE}


# ──────────────────────────────────────────────────────────────
# Protected Endpoints (auth required via get_current_user)
# ──────────────────────────────────────────────────────────────


@router.post("/onboarding/step-1")
async def onboarding_step_1(
    body: OnboardingStep1Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Save personal info. Enforces 18+ age requirement server-side."""
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
    user.date_of_birth = body.date_of_birth
    user.gender = body.gender
    if body.profile_picture_url:
        user.profile_picture_url = body.profile_picture_url.strip()
    db.commit()

    return {"detail": "Step 1 complete"}


@router.post("/onboarding/step-2")
async def onboarding_step_2(
    body: OnboardingStep2Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Save selected sports from onboarding."""
    db.query(UserSport).filter(UserSport.user_id == user.id).delete()
    for sport in body.sports:
        db.add(UserSport(user_id=user.id, sport=sport))
    db.commit()

    return {"detail": "Step 2 complete"}


@router.post("/onboarding/complete")
async def onboarding_complete(
    body: OnboardingCompleteRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Save favorite teams and mark onboarding as complete."""
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
    db.commit()

    return {"detail": "Onboarding complete", "is_onboarded": True, "teams_saved": len(saved_team_ids)}


@router.post("/set-password")
async def set_password(
    body: SetPasswordRequest,
    user: User = Depends(get_current_user),
):
    """Allow Google users to set a password for email login."""
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


@router.post("/change-password")
async def change_password(
    body: ChangePasswordRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Change the current user's password. Existing-password accounts must confirm the current password."""
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
