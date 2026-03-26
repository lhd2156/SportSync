"""
SportSync - TheSportsDB Integration Service.

Fetches live scores, team data, standings, and game schedules from
TheSportsDB API. All responses cached in Redis with appropriate TTLs.
"""
import httpx

from config import settings
from services.cache_service import get_cached, set_cached
from constants import (
    CACHE_TTL_LIVE_SCORES,
    CACHE_TTL_STANDINGS,
    CACHE_TTL_TEAM_DATA,
)

SPORTSDB_BASE_URL = "https://www.thesportsdb.com/api/v1/json"


def _api_url(endpoint: str) -> str:
    """Build TheSportsDB API URL with the configured API key."""
    key = settings.sportsdb_api_key.strip()
    if not key:
        raise RuntimeError("SPORTSDB_API_KEY is not configured.")
    return f"{SPORTSDB_BASE_URL}/{key}/{endpoint}"


async def fetch_teams_by_league(league_name: str) -> list[dict]:
    """
    Fetch all teams for a given league from TheSportsDB.
    Caches results for 6 hours since team rosters rarely change.
    """
    cache_key = f"sportsdb:teams:{league_name}"
    cached = get_cached(cache_key)
    if cached:
        return cached

    url = _api_url(f"search_all_teams.php?l={league_name}")
    async with httpx.AsyncClient() as client:
        response = await client.get(url, timeout=10.0)

    if response.status_code != 200:
        return []

    data = response.json()
    teams = data.get("teams") or []

    result = [
        {
            "external_id": t.get("idTeam", ""),
            "name": t.get("strTeam", ""),
            "short_name": t.get("strTeamShort", ""),
            "sport": t.get("strSport", ""),
            "league": t.get("strLeague", ""),
            "logo_url": t.get("strBadge", ""),
            "city": t.get("strStadiumLocation", ""),
        }
        for t in teams
    ]

    set_cached(cache_key, result, CACHE_TTL_TEAM_DATA)
    return result


async def fetch_live_scores(league_id: str) -> list[dict]:
    """
    Fetch live scores for a league. Uses a short 2-minute cache
    so the dashboard stays fresh during active games.
    """
    cache_key = f"sportsdb:live:{league_id}"
    cached = get_cached(cache_key)
    if cached:
        return cached

    url = _api_url(f"livescore.php?l={league_id}")
    async with httpx.AsyncClient() as client:
        response = await client.get(url, timeout=10.0)

    if response.status_code != 200:
        return []

    data = response.json()
    events = data.get("events") or []

    result = [
        {
            "external_id": e.get("idEvent", ""),
            "home_team": e.get("strHomeTeam", ""),
            "away_team": e.get("strAwayTeam", ""),
            "home_score": _parse_score(e.get("intHomeScore")),
            "away_score": _parse_score(e.get("intAwayScore")),
            "status": e.get("strStatus", ""),
            "sport": e.get("strSport", ""),
            "league": e.get("strLeague", ""),
        }
        for e in events
    ]

    set_cached(cache_key, result, CACHE_TTL_LIVE_SCORES)
    return result


async def fetch_past_events(league_id: str) -> list[dict]:
    """
    Fetch recent completed events for a league.
    Cached for 1 hour as historical results do not change.
    """
    cache_key = f"sportsdb:past:{league_id}"
    cached = get_cached(cache_key)
    if cached:
        return cached

    url = _api_url(f"eventspastleague.php?id={league_id}")
    async with httpx.AsyncClient() as client:
        response = await client.get(url, timeout=10.0)

    if response.status_code != 200:
        return []

    data = response.json()
    events = data.get("events") or []

    result = [
        {
            "external_id": e.get("idEvent", ""),
            "home_team": e.get("strHomeTeam", ""),
            "away_team": e.get("strAwayTeam", ""),
            "home_score": _parse_score(e.get("intHomeScore")),
            "away_score": _parse_score(e.get("intAwayScore")),
            "date": e.get("dateEvent", ""),
            "sport": e.get("strSport", ""),
            "league": e.get("strLeague", ""),
        }
        for e in events
    ]

    set_cached(cache_key, result, CACHE_TTL_STANDINGS)
    return result


async def fetch_upcoming_events(league_id: str) -> list[dict]:
    """Fetch next scheduled events for a league."""
    cache_key = f"sportsdb:upcoming:{league_id}"
    cached = get_cached(cache_key)
    if cached:
        return cached

    url = _api_url(f"eventsnextleague.php?id={league_id}")
    async with httpx.AsyncClient() as client:
        response = await client.get(url, timeout=10.0)

    if response.status_code != 200:
        return []

    data = response.json()
    events = data.get("events") or []

    result = [
        {
            "external_id": e.get("idEvent", ""),
            "home_team": e.get("strHomeTeam", ""),
            "away_team": e.get("strAwayTeam", ""),
            "date": e.get("dateEvent", ""),
            "time": e.get("strTime", ""),
            "sport": e.get("strSport", ""),
            "league": e.get("strLeague", ""),
        }
        for e in events
    ]

    set_cached(cache_key, result, CACHE_TTL_STANDINGS)
    return result


def _parse_score(value) -> int:
    """Safely parse a score value that may be None or a string."""
    if value is None:
        return 0
    try:
        return int(value)
    except (ValueError, TypeError):
        return 0


# League IDs for TheSportsDB lookup
LEAGUE_IDS = {
    "NFL": "4391",
    "NBA": "4387",
    "MLB": "4424",
    "NHL": "4380",
    "EPL": "4328",
}
