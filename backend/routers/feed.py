"""
SportSync - Feed Router.

Personalized feed endpoint that returns prioritized game content
based on the user's saved teams and selected sports.
"""
from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from database import get_db
from dependencies import get_current_user
from models.user import User
from services.feed_service import build_personalized_feed

router = APIRouter(prefix="/api/user", tags=["feed"])


@router.get("/feed")
async def get_feed(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Get personalized feed prioritized by:
    1. Saved teams
    2. Same league as saved teams
    3. Other selected sports
    4. Explore (everything else)
    """
    feed = build_personalized_feed(db, str(user.id))
    return feed
