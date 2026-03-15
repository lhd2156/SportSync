"""
SportSync - Teams Router.

Browse teams, filter by sport/league. Redis cached.
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import Optional

from database import get_db
from models.team import Team
from schemas.sports import TeamResponse
from services.cache_service import get_cached, set_cached
from constants import CACHE_TTL_TEAM_DATA

router = APIRouter(prefix="/api/teams", tags=["teams"])


@router.get("", response_model=list[TeamResponse])
async def list_teams(
    sport: Optional[str] = Query(None),
    league: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """All teams, optionally filtered by sport and league. Redis cached."""
    cache_key = f"teams:{sport or 'all'}:{league or 'all'}"
    cached = get_cached(cache_key)
    if cached:
        return cached

    query = db.query(Team)
    if sport:
        query = query.filter(Team.sport == sport)
    if league:
        query = query.filter(Team.league == league)

    teams = query.order_by(Team.name).all()
    result = [
        TeamResponse(
            id=str(t.id),
            external_id=t.external_id,
            name=t.name,
            short_name=t.short_name,
            sport=t.sport,
            league=t.league,
            logo_url=t.logo_url,
            city=t.city,
        ).model_dump()
        for t in teams
    ]

    set_cached(cache_key, result, CACHE_TTL_TEAM_DATA)
    return result


@router.get("/{team_id}", response_model=TeamResponse)
async def get_team(team_id: str, db: Session = Depends(get_db)):
    """Single team detail with cached response."""
    cache_key = f"team:{team_id}"
    cached = get_cached(cache_key)
    if cached:
        return cached

    team = db.query(Team).filter(Team.id == team_id).first()
    if not team:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Team not found")

    result = TeamResponse(
        id=str(team.id),
        external_id=team.external_id,
        name=team.name,
        short_name=team.short_name,
        sport=team.sport,
        league=team.league,
        logo_url=team.logo_url,
        city=team.city,
    ).model_dump()

    set_cached(cache_key, result, CACHE_TTL_TEAM_DATA)
    return result
