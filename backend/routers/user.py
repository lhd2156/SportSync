"""
SportSync - User Router.

Handles user profile, saved teams, and personalized feed endpoints.
All routes require authentication via get_current_user dependency.
"""

from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile
from sqlalchemy import func
from sqlalchemy.orm import Session

from database import get_db
from dependencies import get_current_user
from models.user import User
from models.team import Team, UserTeam, UserSport
from schemas.user import (
    AvatarUploadResponse,
    DeleteAccountRequest,
    UserProfileResponse,
    UserProfileUpdateRequest,
)
from schemas.common import DetailResponse
from schemas.sports import TeamResponse
from services.auth_service import verify_password
from services.cache_service import delete_cached
from constants import REDIS_PREFIX_FEED
from services.profile_validation import normalize_display_handle, validate_display_handle, validate_person_name
from services.storage_service import (
    build_local_avatar_public_url,
    delete_avatar,
    store_profile_avatar,
)

router = APIRouter(prefix="/api/user", tags=["user"])

MAX_PROFILE_IMAGE_BYTES = 2 * 1024 * 1024
ALLOWED_PROFILE_IMAGE_TYPES = {"image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"}


def _normalize_display_name(display_name: str | None) -> str:
    """Trim display handles before comparing or storing them."""
    return normalize_display_handle(display_name)


def _find_conflicting_display_name(
    db: Session,
    display_name: str | None,
    *,
    exclude_user_id: str | None = None,
) -> User | None:
    """Find another user using the same display handle, ignoring case."""
    normalized_display_name = _normalize_display_name(display_name)
    if not normalized_display_name:
        return None

    query = db.query(User).filter(
        func.lower(User.display_name) == normalized_display_name.lower()
    )
    if exclude_user_id:
        query = query.filter(User.id != exclude_user_id)
    return query.first()


def _resolve_team_record(db: Session, team_id: str) -> Team | None:
    """Accept either the internal team id or the external sports API id."""
    normalized_team_id = (team_id or "").strip()
    if not normalized_team_id:
        return None

    return (
        db.query(Team)
        .filter((Team.id == normalized_team_id) | (Team.external_id == normalized_team_id))
        .first()
    )


@router.get("/profile", response_model=UserProfileResponse)
async def get_profile(
    user: User = Depends(get_current_user),
):
    """Get the current user's profile."""
    return UserProfileResponse(
        id=str(user.id),
        email=user.email,
        display_name=user.display_name,
        first_name=user.first_name,
        last_name=user.last_name,
        date_of_birth=str(user.date_of_birth) if user.date_of_birth else None,
        gender=user.gender,
        profile_picture_url=user.profile_picture_url,
        is_onboarded=user.is_onboarded,
        sports=[selected.sport for selected in user.selected_sports],
        provider="google" if user.google_id else "email",
        has_password=bool(user.hashed_password),
        created_at=user.created_at,
    )


@router.put("/profile", response_model=DetailResponse)
async def update_profile(
    body: UserProfileUpdateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update the user's profile, handle, avatar, and sport preferences."""
    if body.display_name is not None:
        normalized_display_name = validate_display_handle(body.display_name)
        existing_display = _find_conflicting_display_name(
            db,
            normalized_display_name,
            exclude_user_id=str(user.id),
        )
        if existing_display:
            raise HTTPException(status_code=409, detail="Display handle already taken")
        user.display_name = normalized_display_name
    if body.first_name is not None:
        normalized_first_name = validate_person_name(body.first_name, "First name")
        user.first_name = normalized_first_name
    if body.last_name is not None:
        normalized_last_name = validate_person_name(body.last_name, "Last name")
        user.last_name = normalized_last_name
    if body.gender is not None:
        user.gender = body.gender
    if body.profile_picture_url is not None:
        next_profile_picture_url = body.profile_picture_url.strip() or None
        previous_profile_picture_url = user.profile_picture_url
        user.profile_picture_url = next_profile_picture_url
        if previous_profile_picture_url and previous_profile_picture_url != next_profile_picture_url:
            delete_avatar(previous_profile_picture_url)
    if body.sports is not None:
        db.query(UserSport).filter(UserSport.user_id == user.id).delete()
        for sport in body.sports:
            db.add(UserSport(user_id=user.id, sport=sport))
        delete_cached(f"{REDIS_PREFIX_FEED}{user.id}")

    db.commit()
    return {"detail": "Profile updated"}


@router.post("/profile/avatar", response_model=AvatarUploadResponse)
async def upload_profile_avatar(
    request: Request,
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Upload a profile avatar to object storage or local file storage."""
    content_type = str(file.content_type or "").strip().lower()
    if content_type not in ALLOWED_PROFILE_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="Choose a PNG, JPG, WEBP, or GIF image.")

    payload = await file.read()
    if not payload:
        raise HTTPException(status_code=400, detail="That image file was empty.")
    if len(payload) > MAX_PROFILE_IMAGE_BYTES:
        raise HTTPException(status_code=400, detail="Keep the profile picture under 2 MB.")

    previous_avatar = user.profile_picture_url
    stored_avatar = store_profile_avatar(payload, content_type, str(user.id))
    public_url = stored_avatar.public_url
    if stored_avatar.provider == "local":
        public_url = build_local_avatar_public_url(str(request.base_url), public_url)

    user.profile_picture_url = public_url
    db.commit()
    delete_avatar(previous_avatar)

    return {
        "detail": "Avatar updated",
        "profile_picture_url": user.profile_picture_url,
    }


@router.delete("/account", response_model=DetailResponse)
async def delete_account(
    body: DeleteAccountRequest,
    response: Response,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete the current user's account after explicit confirmation."""
    if body.confirm_text.strip().upper() != "DELETE":
        raise HTTPException(status_code=400, detail='Type "DELETE" to confirm account removal')

    db_user = db.query(User).filter(User.id == user.id).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")

    if db_user.hashed_password:
        if not body.current_password:
            raise HTTPException(status_code=400, detail="Current password is required")
        if not verify_password(body.current_password, db_user.hashed_password):
            raise HTTPException(status_code=401, detail="Current password is incorrect")

    db.query(UserTeam).filter(UserTeam.user_id == user.id).delete()
    db.query(UserSport).filter(UserSport.user_id == user.id).delete()
    delete_cached(f"{REDIS_PREFIX_FEED}{user.id}")
    db.delete(db_user)
    db.commit()

    response.delete_cookie("refresh_token", path="/")
    response.delete_cookie("session_token", path="/")
    return {"detail": "Account deleted"}


@router.get("/teams", response_model=list[TeamResponse])
async def get_saved_teams(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get the user's saved teams list."""
    saved = (
        db.query(Team)
        .join(UserTeam, Team.id == UserTeam.team_id)
        .filter(UserTeam.user_id == user.id)
        .all()
    )

    return [
        {
            "id": str(t.id),
            "external_id": t.external_id,
            "name": t.name,
            "short_name": t.short_name,
            "sport": t.sport,
            "league": t.league,
            "logo_url": t.logo_url,
            "city": t.city,
        }
        for t in saved
    ]


@router.post("/teams/{team_id}", response_model=DetailResponse)
async def save_team(
    team_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Save a team to the user's favorites. Invalidates feed cache."""
    team = _resolve_team_record(db, team_id)
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")

    existing = (
        db.query(UserTeam)
        .filter(UserTeam.user_id == user.id, UserTeam.team_id == team.id)
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="Team already saved")

    db.add(UserTeam(user_id=user.id, team_id=team.id))
    db.commit()

    delete_cached(f"{REDIS_PREFIX_FEED}{user.id}")

    return {"detail": "Team saved"}


@router.delete("/teams/{team_id}", response_model=DetailResponse)
async def unsave_team(
    team_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Remove a team from the user's favorites. Invalidates feed cache."""
    team = _resolve_team_record(db, team_id)
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")

    record = (
        db.query(UserTeam)
        .filter(UserTeam.user_id == user.id, UserTeam.team_id == team.id)
        .first()
    )
    if not record:
        raise HTTPException(status_code=404, detail="Team not in saved list")

    db.delete(record)
    db.commit()

    delete_cached(f"{REDIS_PREFIX_FEED}{user.id}")

    return {"detail": "Team removed"}
