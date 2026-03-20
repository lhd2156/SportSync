"""
SportSync - User Router.

Handles user profile, saved teams, and personalized feed endpoints.
All routes require authentication via get_current_user dependency.
"""
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import func
from sqlalchemy.orm import Session

from database import get_db
from dependencies import get_current_user
from models.user import User
from models.team import Team, UserTeam, UserSport
from schemas.user import UserProfileResponse, UserProfileUpdateRequest, DeleteAccountRequest
from services.auth_service import verify_password
from services.cache_service import delete_cached
from constants import REDIS_PREFIX_FEED

router = APIRouter(prefix="/api/user", tags=["user"])


def _normalize_display_name(display_name: str | None) -> str:
    """Trim display handles before comparing or storing them."""
    return str(display_name or "").strip()


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


@router.put("/profile")
async def update_profile(
    body: UserProfileUpdateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update the user's profile, handle, avatar, and sport preferences."""
    if body.display_name is not None:
        normalized_display_name = _normalize_display_name(body.display_name)
        if not normalized_display_name:
            raise HTTPException(status_code=400, detail="Display handle is required")
        existing_display = _find_conflicting_display_name(
            db,
            normalized_display_name,
            exclude_user_id=str(user.id),
        )
        if existing_display:
            raise HTTPException(status_code=409, detail="Display handle already taken")
        user.display_name = normalized_display_name
    if body.first_name is not None:
        normalized_first_name = body.first_name.strip()
        if not normalized_first_name:
            raise HTTPException(status_code=400, detail="First name is required")
        user.first_name = normalized_first_name
    if body.last_name is not None:
        normalized_last_name = body.last_name.strip()
        if not normalized_last_name:
            raise HTTPException(status_code=400, detail="Last name is required")
        user.last_name = normalized_last_name
    if body.gender is not None:
        user.gender = body.gender
    if body.profile_picture_url is not None:
        user.profile_picture_url = body.profile_picture_url.strip() or None
    if body.sports is not None:
        db.query(UserSport).filter(UserSport.user_id == user.id).delete()
        for sport in body.sports:
            db.add(UserSport(user_id=user.id, sport=sport))
        delete_cached(f"{REDIS_PREFIX_FEED}{user.id}")

    db.commit()
    return {"detail": "Profile updated"}


@router.delete("/account")
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


@router.get("/teams")
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


@router.post("/teams/{team_id}")
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


@router.delete("/teams/{team_id}")
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
