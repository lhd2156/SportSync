"""
SportSync - Feed Personalization Service.

Builds and caches a personalized content feed for each user based on
their saved teams and selected sports. Cached for 5 minutes in Redis,
invalidated immediately when a user saves or unsaves a team.
"""
from sqlalchemy.orm import Session

from models.team import Team, UserTeam, UserSport
from models.game import Game
from services.cache_service import get_cached, set_cached
from constants import CACHE_TTL_FEED, REDIS_PREFIX_FEED


def build_personalized_feed(db: Session, user_id: str) -> list[dict]:
    """
    Build a prioritized game feed for the dashboard.

    Priority 1: Games involving the user's saved teams
    Priority 2: Games in the same league as saved teams
    Priority 3: Games in other sports the user selected during onboarding
    Priority 4: All remaining games (explore section)
    """
    cache_key = f"{REDIS_PREFIX_FEED}{user_id}"
    cached = get_cached(cache_key)
    if cached:
        return cached

    # Get user's saved team IDs and selected sports
    saved_team_ids = {
        str(ut.team_id)
        for ut in db.query(UserTeam).filter(UserTeam.user_id == user_id).all()
    }

    selected_sports = {
        us.sport
        for us in db.query(UserSport).filter(UserSport.user_id == user_id).all()
    }

    # Get the leagues the user's saved teams belong to
    saved_teams = (
        db.query(Team).filter(Team.id.in_(saved_team_ids)).all()
        if saved_team_ids
        else []
    )
    saved_leagues = {t.league for t in saved_teams}

    # Fetch all recent and upcoming games
    all_games = (
        db.query(Game)
        .order_by(Game.scheduled_at.desc())
        .limit(100)
        .all()
    )

    priority_1 = []
    priority_2 = []
    priority_3 = []
    priority_4 = []

    for game in all_games:
        home_id = str(game.home_team_id)
        away_id = str(game.away_team_id)

        game_dict = _game_to_dict(game)

        if home_id in saved_team_ids or away_id in saved_team_ids:
            game_dict["priority"] = 1
            priority_1.append(game_dict)
        elif game.league in saved_leagues:
            game_dict["priority"] = 2
            priority_2.append(game_dict)
        elif game.sport in selected_sports:
            game_dict["priority"] = 3
            priority_3.append(game_dict)
        else:
            game_dict["priority"] = 4
            priority_4.append(game_dict)

    feed = priority_1 + priority_2 + priority_3 + priority_4

    set_cached(cache_key, feed, CACHE_TTL_FEED)
    return feed


def _game_to_dict(game: Game) -> dict:
    """Convert a Game ORM object to a serializable dict."""
    return {
        "id": str(game.id),
        "home_team_id": str(game.home_team_id),
        "away_team_id": str(game.away_team_id),
        "sport": game.sport,
        "league": game.league,
        "status": game.status,
        "home_score": game.home_score,
        "away_score": game.away_score,
        "scheduled_at": game.scheduled_at.isoformat(),
    }
