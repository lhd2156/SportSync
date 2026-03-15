"""
SportSync - Scores Router.

Live and recent scores across all sports. Redis cached with short TTL.
Paginated (20 per page).
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import Optional

from database import get_db
from models.game import Game
from models.team import Team
from services.cache_service import get_cached, set_cached
from constants import CACHE_TTL_LIVE_SCORES

router = APIRouter(prefix="/api/scores", tags=["scores"])

DEFAULT_PAGE_SIZE = 20


@router.get("")
async def get_scores(
    sport: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(DEFAULT_PAGE_SIZE, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """Live and recent scores. Paginated, cached for 2 minutes."""
    cache_key = f"scores:{sport or 'all'}:p{page}:s{page_size}"
    cached = get_cached(cache_key)
    if cached:
        return cached

    query = (
        db.query(Game)
        .filter(Game.status.in_(["live", "final"]))
    )

    if sport:
        query = query.filter(Game.sport == sport)

    games = (
        query.order_by(Game.scheduled_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    result = []
    for g in games:
        home = db.query(Team).filter(Team.id == g.home_team_id).first()
        away = db.query(Team).filter(Team.id == g.away_team_id).first()
        result.append({
            "id": str(g.id),
            "home_team": {
                "id": str(home.id) if home else None,
                "name": home.name if home else "Unknown",
                "short_name": home.short_name if home else "",
                "logo_url": home.logo_url if home else None,
            },
            "away_team": {
                "id": str(away.id) if away else None,
                "name": away.name if away else "Unknown",
                "short_name": away.short_name if away else "",
                "logo_url": away.logo_url if away else None,
            },
            "sport": g.sport,
            "league": g.league,
            "status": g.status,
            "home_score": g.home_score,
            "away_score": g.away_score,
            "scheduled_at": g.scheduled_at.isoformat(),
        })

    set_cached(cache_key, result, CACHE_TTL_LIVE_SCORES)
    return result
