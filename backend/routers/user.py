"""
SportSync - User Router.

Handles user profile, saved teams, and personalized feed endpoints.
All routes require authentication.
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from database import get_db
from models.user import User
from models.team import Team, UserTeam
from schemas.user import UserProfileResponse, UserProfileUpdateRequest
from services.auth_service import decode_token
from services.cache_service import delete_cached
from constants import REDIS_PREFIX_FEED

router = APIRouter(prefix="/api/user", tags=["user"])


def _get_user_from_token(request: Request, db: Session) -> User:
    """Extract user from JWT in Authorization header."""
    auth_header = request.headers.get("Authorization", "")
    token = auth_header.replace("Bearer ", "")
    payload = decode_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")

    user = db.query(User).filter(User.id == payload["sub"]).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.get("/profile", response_model=UserProfileResponse)
async def get_profile(request: Request, db: Session = Depends(get_db)):
    """Get the current user's profile."""
    user = _get_user_from_token(request, db)
    return UserProfileResponse(
        id=str(user.id),
        email=user.email,
        display_name=user.display_name,
        date_of_birth=str(user.date_of_birth) if user.date_of_birth else None,
        gender=user.gender,
        profile_picture_url=user.profile_picture_url,
        is_onboarded=user.is_onboarded,
        created_at=user.created_at,
    )


@router.put("/profile")
async def update_profile(
    body: UserProfileUpdateRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """Update the user's display name, gender, or profile picture."""
    user = _get_user_from_token(request, db)

    if body.display_name is not None:
        user.display_name = body.display_name
    if body.gender is not None:
        user.gender = body.gender
    if body.profile_picture_url is not None:
        user.profile_picture_url = body.profile_picture_url

    db.commit()
    return {"detail": "Profile updated"}


@router.get("/teams")
async def get_saved_teams(request: Request, db: Session = Depends(get_db)):
    """Get the user's saved teams list."""
    user = _get_user_from_token(request, db)

    saved = (
        db.query(Team)
        .join(UserTeam, Team.id == UserTeam.team_id)
        .filter(UserTeam.user_id == user.id)
        .all()
    )

    return [
        {
            "id": str(t.id),
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
async def save_team(team_id: str, request: Request, db: Session = Depends(get_db)):
    """Save a team to the user's favorites. Invalidates feed cache."""
    user = _get_user_from_token(request, db)

    existing = (
        db.query(UserTeam)
        .filter(UserTeam.user_id == user.id, UserTeam.team_id == team_id)
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="Team already saved")

    db.add(UserTeam(user_id=user.id, team_id=team_id))
    db.commit()

    # Invalidate the personalized feed cache so it rebuilds with new team
    delete_cached(f"{REDIS_PREFIX_FEED}{user.id}")

    return {"detail": "Team saved"}


@router.delete("/teams/{team_id}")
async def unsave_team(team_id: str, request: Request, db: Session = Depends(get_db)):
    """Remove a team from the user's favorites. Invalidates feed cache."""
    user = _get_user_from_token(request, db)

    record = (
        db.query(UserTeam)
        .filter(UserTeam.user_id == user.id, UserTeam.team_id == team_id)
        .first()
    )
    if not record:
        raise HTTPException(status_code=404, detail="Team not in saved list")

    db.delete(record)
    db.commit()

    delete_cached(f"{REDIS_PREFIX_FEED}{user.id}")

    return {"detail": "Team removed"}
