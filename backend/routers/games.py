"""
SportSync - Games Router.

Upcoming and recent games. Supports sport/league filtering.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional

from database import get_db
from models.game import Game
from models.team import Team
from models.prediction import Prediction
from services.cache_service import get_cached, set_cached
from constants import CACHE_TTL_STANDINGS

router = APIRouter(prefix="/api/games", tags=["games"])


@router.get("")
async def list_games(
    sport: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """Upcoming and recent games, filter by sport or status."""
    cache_key = f"games:{sport or 'all'}:{status or 'all'}"
    cached = get_cached(cache_key)
    if cached:
        return cached

    query = db.query(Game)
    if sport:
        query = query.filter(Game.sport == sport)
    if status:
        query = query.filter(Game.status == status)

    games = query.order_by(Game.scheduled_at.desc()).limit(50).all()

    result = []
    for g in games:
        home = db.query(Team).filter(Team.id == g.home_team_id).first()
        away = db.query(Team).filter(Team.id == g.away_team_id).first()
        result.append({
            "id": str(g.id),
            "home_team": _team_dict(home),
            "away_team": _team_dict(away),
            "sport": g.sport,
            "league": g.league,
            "status": g.status,
            "home_score": g.home_score,
            "away_score": g.away_score,
            "scheduled_at": g.scheduled_at.isoformat(),
        })

    set_cached(cache_key, result, CACHE_TTL_STANDINGS)
    return result


@router.get("/{game_id}")
async def get_game(game_id: str, db: Session = Depends(get_db)):
    """Single game detail with scores and prediction if available."""
    game = db.query(Game).filter(Game.id == game_id).first()
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")

    home = db.query(Team).filter(Team.id == game.home_team_id).first()
    away = db.query(Team).filter(Team.id == game.away_team_id).first()
    prediction = db.query(Prediction).filter(Prediction.game_id == game.id).first()

    result = {
        "id": str(game.id),
        "home_team": _team_dict(home),
        "away_team": _team_dict(away),
        "sport": game.sport,
        "league": game.league,
        "status": game.status,
        "home_score": game.home_score,
        "away_score": game.away_score,
        "scheduled_at": game.scheduled_at.isoformat(),
        "prediction": None,
    }

    if prediction:
        result["prediction"] = {
            "home_win_prob": prediction.home_win_prob,
            "away_win_prob": prediction.away_win_prob,
            "model_version": prediction.model_version,
        }

    return result


def _team_dict(team: Team | None) -> dict:
    """Convert a Team ORM object to a dict for JSON response."""
    if not team:
        return {"id": None, "name": "Unknown", "short_name": "", "logo_url": None}
    return {
        "id": str(team.id),
        "name": team.name,
        "short_name": team.short_name,
        "logo_url": team.logo_url,
        "city": team.city,
    }
