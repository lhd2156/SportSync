"""
SportSync - Auth Router.

Handles register, login, Google OAuth, refresh, logout, and onboarding.
All business logic delegated to auth_service. This file only handles
HTTP concerns: request parsing, response formatting, and cookie setting.
"""
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from database import get_db
from dependencies import get_current_user
from models.user import User
from models.team import UserSport, UserTeam
from schemas.auth import (
    RegisterRequest,
    LoginRequest,
    GoogleAuthRequest,
    AuthResponse,
    OnboardingStep1Request,
    OnboardingStep2Request,
    OnboardingCompleteRequest,
    SetPasswordRequest,
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
from services.security_service import check_rate_limit
from services.cache_service import redis_client
from constants import MINIMUM_AGE_YEARS

router = APIRouter(prefix="/api/auth", tags=["auth"])


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

    existing = db.query(User).filter(User.email == body.email.lower()).first()
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")

    user = User(
        email=body.email.lower(),
        hashed_password=hash_password(body.password),
        first_name=body.first_name,
        last_name=body.last_name,
        display_name=body.display_name,
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

    user = db.query(User).filter(User.email == body.email.lower()).first()
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
    )


@router.post("/google", response_model=AuthResponse)
async def google_auth(
    body: GoogleAuthRequest,
    response: Response,
    db: Session = Depends(get_db),
):
    """Authenticate or register via Google OAuth 2.0."""
    import httpx

    async with httpx.AsyncClient() as client:
        google_resp = await client.get(
            f"https://oauth2.googleapis.com/tokeninfo?id_token={body.google_token}"
        )

    if google_resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid Google token")

    google_data = google_resp.json()
    email = google_data.get("email", "").lower()
    google_id = google_data.get("sub")

    if not email or not google_id:
        raise HTTPException(status_code=401, detail="Invalid Google token data")

    user = db.query(User).filter(User.email == email).first()
    is_new = False

    if not user:
        user = User(
            email=email,
            google_id=google_id,
            display_name=google_data.get("name"),
            profile_picture_url=google_data.get("picture"),
            is_onboarded=False,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        is_new = True
    else:
        if not user.google_id:
            user.google_id = google_id
            db.commit()

    access_token = create_access_token(str(user.id))
    refresh_token, max_age = create_refresh_token(str(user.id))
    _set_refresh_cookie(response, refresh_token, max_age)

    return AuthResponse(
        access_token=access_token,
        is_onboarded=user.is_onboarded,
        is_new_user=is_new,
    )


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
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    new_access = create_access_token(str(user.id))
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

    user.display_name = body.display_name
    user.date_of_birth = body.date_of_birth
    user.gender = body.gender
    if body.profile_picture_url:
        user.profile_picture_url = body.profile_picture_url
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
    for team_id in body.team_ids:
        db.add(UserTeam(user_id=user.id, team_id=team_id))

    user.is_onboarded = True
    db.commit()

    return {"detail": "Onboarding complete", "is_onboarded": True}


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
