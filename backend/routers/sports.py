"""
SportSync - ESPN & TheSportsDB Hybrid Proxy Router

Backend proxy for sports API calls to bypass CORS restrictions
from the frontend. Uses ESPN API for live/upcoming game data and
TheSportsDB for team logos, league info, and news headlines.
Caches responses for 15 seconds to minimize API calls.
"""
import asyncio
import html
import json as _json
import logging
import re as _re
import time
import unicodedata
from datetime import datetime, timedelta, timezone
from functools import cmp_to_key
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, quote, unquote, urlencode, urlparse

from fastapi import APIRouter, Query, Response
import httpx
import requests

from constants import REDIS_CHANNEL_LIVE_SCORES
from services.cache_service import publish_message

router = APIRouter(prefix="/api/sports", tags=["sports"])
logger = logging.getLogger(__name__)

# Simple in-memory caches
_cache: dict[str, tuple[float, dict | list]] = {}
_text_cache: dict[str, tuple[float, str]] = {}
_binary_cache: dict[str, tuple[float, bytes, str]] = {}
_latest_activity_date_cache: dict[tuple[str, int], tuple[float, str | None]] = {}
_today_activity_cache: dict[tuple[str, str, str], tuple[float, list[dict]]] = {}
_event_activity_cache: dict[tuple[str, str, str], tuple[float, list[dict]]] = {}
_mlb_player_directory_cache: tuple[float, dict[str, list[str]]] | None = None
_espn_all_cache: dict[str, tuple[float, dict[str, list[dict]]]] = {}
_news_feed_cache: dict[str, tuple[float, dict[str, list[dict]]]] = {}
_highlights_feed_cache: dict[str, tuple[float, dict[str, object]]] = {}
_live_score_publish_state: dict[str, tuple[int, int, str]] = {}
_http_client: httpx.AsyncClient | None = None
CACHE_TTL = 15  # 15 seconds for near-real-time live data
BINARY_CACHE_TTL = 3600  # 1 hour for player headshots/logos
LATEST_ACTIVITY_DATE_TTL = 300  # 5 minutes for latest historical activity lookups
TODAY_ACTIVITY_CACHE_TTL = 8  # keep same-day activity fresh enough for the 12s dashboard poll
EVENT_ACTIVITY_CACHE_TTL = 8  # keep game-detail play-by-play feeling live without hammering ESPN
MLB_DIRECTORY_CACHE_TTL = 21600  # 6 hours for season-wide MLB player directory
ESPN_ALL_CACHE_TTL = 20
NEWS_FEED_CACHE_TTL = 300
HIGHLIGHTS_FEED_CACHE_TTL = 45
HIGHLIGHT_IMAGE_PROXY_TTL = 3600

THESPORTSDB_BASE = "https://www.thesportsdb.com/api/v1/json/3"

# ESPN scoreboard base URL — public, no API key needed
ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports"
APP_ROOT = Path(__file__).resolve().parents[1]
ACTIVITY_CACHE_DIR = APP_ROOT / ".cache" / "sports_activity"
ACTIVITY_CACHE_VERSION = "v27"

# League mapping: key → (espn_sport, espn_league, thesportsdb_id)
LEAGUES = {
    "NFL":  ("football",    "nfl",  4391),
    "NBA":  ("basketball",  "nba",  4387),
    "MLB":  ("baseball",    "mlb",  4424),
    "NHL":  ("hockey",      "nhl",  4380),
    "EPL":  ("soccer",      "eng.1", 4328),
}
SPORTSDB_SPORTS = {
    "NFL": "American Football",
    "NBA": "Basketball",
    "MLB": "Baseball",
    "NHL": "Ice Hockey",
    "EPL": "Soccer",
}
HIGHLIGHT_IMAGE_ALLOWED_HOSTS = (
    "a.espncdn.com",
    "espncdn.com",
    "video-cdn.espn.com",
    "media.video-cdn.espn.com",
    "img.mlbstatic.com",
    "mlbstatic.com",
    "nhl.bamcontent.com",
    "nhl.bamgrid.com",
    "images.nhle.com",
    "assets.nhle.com",
    "scorebat.com",
    "www.scorebat.com",
)

ESPN_STANDINGS_URLS = {
    "NFL": "https://site.api.espn.com/apis/v2/sports/football/nfl/standings",
    "NBA": "https://site.api.espn.com/apis/v2/sports/basketball/nba/standings",
    "MLB": "https://site.api.espn.com/apis/v2/sports/baseball/mlb/standings",
    "NHL": "https://site.api.espn.com/apis/v2/sports/hockey/nhl/standings",
    "EPL": "https://site.api.espn.com/apis/v2/sports/soccer/eng.1/standings",
}


def _emit_live_score_updates(games: list[dict]) -> None:
    """Publish changed live or final score states to Redis for the Go service."""
    for game in games:
        game_id = str(game.get("id") or "").strip()
        league_key = str(game.get("league") or "").strip().upper()
        status = str(game.get("status") or "").strip().lower()
        if not game_id or league_key not in LEAGUES or status not in {"live", "final"}:
            continue

        home_score = int(game.get("homeScore") or 0)
        away_score = int(game.get("awayScore") or 0)
        state = (home_score, away_score, status)
        if _live_score_publish_state.get(game_id) == state:
            continue

        _live_score_publish_state[game_id] = state
        sport_name, _, _ = LEAGUES[league_key]
        publish_message(
            REDIS_CHANNEL_LIVE_SCORES,
            {
                "game_id": game_id,
                "home_team": str(game.get("homeTeam") or ""),
                "away_team": str(game.get("awayTeam") or ""),
                "home_score": home_score,
                "away_score": away_score,
                "status": status,
                "sport": sport_name,
                "league": league_key,
            },
        )


def _extract_stat_lookup(stats: list[dict] | None) -> dict[str, str]:
    """Flatten ESPN standing stats into a name -> displayValue lookup."""
    lookup: dict[str, str] = {}
    for stat in stats or []:
        name = str(stat.get("name") or "").strip()
        display_value = str(stat.get("displayValue") or "").strip()
        short_name = str(stat.get("shortDisplayName") or "").strip()
        if name and display_value:
            lookup[name] = display_value
        if short_name and display_value:
            lookup[short_name] = display_value
    return lookup


def _build_headshot_placeholder_svg(label: str) -> bytes:
    clean_label = (label or "").strip()
    parts = [part for part in _re.split(r"\s+", clean_label) if part]
    initials = "".join(part[0].upper() for part in parts[:2]) or "SS"
    accessible_label = html.escape(clean_label or "Player")
    svg = f"""
<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160" role="img" aria-label="{accessible_label}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#22345a" />
      <stop offset="100%" stop-color="#0f1727" />
    </linearGradient>
  </defs>
  <rect width="160" height="160" rx="80" fill="url(#bg)" />
  <circle cx="80" cy="60" r="26" fill="#37507a" />
  <path d="M40 134c6-24 22-38 40-38s34 14 40 38" fill="#37507a" />
  <circle cx="80" cy="80" r="77" fill="none" stroke="#31486f" stroke-width="2" />
  <text x="80" y="147" text-anchor="middle" font-family="Arial, sans-serif" font-size="22" font-weight="700" fill="#d7e4ff">{html.escape(initials)}</text>
</svg>
""".strip()
    return svg.encode("utf-8")


def _normalize_standings_entry(entry: dict) -> dict:
    """Normalize one ESPN standings entry into frontend-friendly fields."""
    team_blob = entry.get("team") or {}
    logos = team_blob.get("logos") or []
    logo_url = ""
    for logo in logos:
        href = str((logo or {}).get("href") or "").strip()
        if href and ("scoreboard" in href or not logo_url):
            logo_url = href

    stats_lookup = _extract_stat_lookup(entry.get("stats"))
    record_value = stats_lookup.get("overall") or (
        "-".join(
            value
            for value in [
                stats_lookup.get("wins"),
                stats_lookup.get("losses"),
                stats_lookup.get("ties") or stats_lookup.get("otLosses") or stats_lookup.get("overtimeLosses"),
            ]
            if value
        )
    )

    return {
        "rank": stats_lookup.get("rank") or stats_lookup.get("playoffSeed") or "",
        "is_champion": False,
        "team": {
            "id": str(team_blob.get("id") or ""),
            "name": str(team_blob.get("displayName") or team_blob.get("shortDisplayName") or ""),
            "short_name": str(team_blob.get("abbreviation") or ""),
            "city": str(team_blob.get("location") or ""),
            "logo_url": logo_url,
        },
        "record": record_value,
        "stats": {
            "wins": stats_lookup.get("wins", ""),
            "losses": stats_lookup.get("losses", ""),
            "ties": stats_lookup.get("ties", ""),
            "otl": stats_lookup.get("otLosses") or stats_lookup.get("overtimeLosses") or "",
            "pct": stats_lookup.get("winPercent") or stats_lookup.get("divisionPercent") or stats_lookup.get("ppg") or "",
            "gb": stats_lookup.get("gamesBehind") or stats_lookup.get("gamesAhead") or "",
            "home": stats_lookup.get("Home") or "",
            "away": stats_lookup.get("Road") or "",
            "conference": stats_lookup.get("vs. Conf.") or "",
            "division": stats_lookup.get("vs. Div.") or stats_lookup.get("Intradivision") or "",
            "last_ten": stats_lookup.get("Last Ten Games") or "",
            "streak": stats_lookup.get("streak") or "",
            "points": stats_lookup.get("points") or "",
            "points_for": stats_lookup.get("pointsFor") or stats_lookup.get("avgPointsFor") or "",
            "points_against": stats_lookup.get("pointsAgainst") or stats_lookup.get("avgPointsAgainst") or "",
            "diff": stats_lookup.get("pointDifferential") or stats_lookup.get("differential") or "",
        },
    }


def _parse_linescore_value(linescore: dict) -> int:
    """Extract a numeric period/inning score from ESPN linescore payloads."""
    if not isinstance(linescore, dict):
        return 0

    for candidate in (
        linescore.get("value"),
        linescore.get("displayValue"),
        linescore.get("score"),
        linescore.get("points"),
        linescore.get("runs"),
    ):
        cleaned = str(candidate or "").strip()
        if not cleaned:
            continue

        match = _re.search(r"-?\d+", cleaned)
        if match:
            return int(match.group(0))

    return 0


def _collect_standings_groups(node: dict, groups: list[dict]) -> None:
    """Walk the ESPN standings tree and collect every node with entries."""
    standings = node.get("standings") or {}
    entries = standings.get("entries") or []
    if entries:
        normalized = [_normalize_standings_entry(entry) for entry in entries]

        # Sort entries: first try rank, then fall back to win% descending
        def _sort_key(e: dict) -> tuple[float, float, float]:
            raw_rank = e.get("rank") or ""
            try:
                rank_val = int(raw_rank)
            except (ValueError, TypeError):
                rank_val = 0
            # Treat rank 0 or missing as unranked
            rank_score = rank_val if rank_val > 0 else 9999

            # Secondary: sort by win % descending
            raw_pct = e.get("stats", {}).get("pct") or "0"
            try:
                pct_val = float(raw_pct)
            except (ValueError, TypeError):
                pct_val = 0.0

            # Tertiary: sort by points descending (for EPL/NHL)
            raw_pts = e.get("stats", {}).get("points") or "0"
            try:
                pts_val = float(raw_pts)
            except (ValueError, TypeError):
                pts_val = 0.0

            return (rank_score, -pct_val, -pts_val)

        normalized.sort(key=_sort_key)

        # Auto-assign sequential ranks when all ranks are 0 or missing
        all_ranks_bad = all(
            not str(e.get("rank") or "").strip() or str(e.get("rank") or "").strip() == "0"
            for e in normalized
        )
        if all_ranks_bad:
            for idx, e in enumerate(normalized, start=1):
                e["rank"] = str(idx)

        groups.append(
            {
                "id": str(node.get("id") or ""),
                "name": str(node.get("name") or node.get("displayName") or "Standings"),
                "short_name": str(node.get("abbreviation") or node.get("shortName") or ""),
                "entries": normalized,
            }
        )

    for child in node.get("children") or []:
        _collect_standings_groups(child, groups)


def _normalize_standings_seasons(seasons: list[dict] | None) -> list[dict]:
    """Normalize ESPN standings seasons into lightweight dropdown options."""
    normalized: list[dict] = []
    seen: set[str] = set()

    for season in seasons or []:
        year = str((season or {}).get("year") or "").strip()
        if not year or year in seen:
            continue

        display_name = str(
            (season or {}).get("displayName")
            or (season or {}).get("name")
            or year
        ).strip() or year

        normalized.append(
            {
                "year": year,
                "display_name": display_name,
                "start_date": str((season or {}).get("startDate") or "").strip(),
                "end_date": str((season or {}).get("endDate") or "").strip(),
            }
        )
        seen.add(year)

    return normalized


def _parse_iso_datetime(value: str | None) -> datetime | None:
    cleaned = str(value or "").strip()
    if not cleaned:
        return None

    normalized = cleaned.replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(normalized)
    except ValueError:
        return None

    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _normalize_mlb_inning_detail(value: str | None) -> str:
    cleaned = str(value or "").strip()
    if not cleaned:
        return ""

    direct_match = _re.search(
        r"\b(Top|Bottom|Bot|Middle|Mid|End)\s+(\d+)(st|nd|rd|th)\b",
        cleaned,
        _re.IGNORECASE,
    )
    if direct_match:
        half = direct_match.group(1).strip().lower()
        inning = direct_match.group(2)
        suffix = direct_match.group(3)
        label = {
            "bottom": "Bot",
            "bot": "Bot",
            "middle": "Mid",
            "mid": "Mid",
            "end": "End",
        }.get(half, "Top")
        return f"{label} {inning}{suffix}"

    inning_match = _re.search(
        r"\b(Top|Bottom|Bot|Middle|Mid|End)\s+of\s+the\s+(\d+)(st|nd|rd|th)\s+inning\b",
        cleaned,
        _re.IGNORECASE,
    )
    if inning_match:
        half = inning_match.group(1).strip().lower()
        inning = inning_match.group(2)
        suffix = inning_match.group(3)
        label = {
            "bottom": "Bot",
            "bot": "Bot",
            "middle": "Mid",
            "mid": "Mid",
            "end": "End",
        }.get(half, "Top")
        return f"{label} {inning}{suffix}"

    return ""


def _resolve_selected_standings_season(data: dict, season_year: str) -> dict:
    seasons = data.get("seasons") or []
    active_year = str(season_year or "").strip()
    if not active_year and seasons:
        first_year = str(((seasons[0] or {}).get("year") or "")).strip()
        if first_year:
            active_year = first_year
    if not active_year:
        active_year = str(((data.get("season") or {}).get("year") or "")).strip()

    for season in seasons:
        if str((season or {}).get("year") or "").strip() == active_year:
            return season

    return data.get("season") or {}


def _resolve_standings_season_type(season_blob: dict, type_id: str) -> dict:
    for season_type in season_blob.get("types") or []:
        if str((season_type or {}).get("id") or "").strip() == type_id:
            return season_type
    return {}


def _season_window_has_ended(end_date: str | None) -> bool:
    end_dt = _parse_iso_datetime(end_date)
    return bool(end_dt and end_dt <= datetime.now(timezone.utc))


def _format_scoreboard_date(value: str | None) -> str:
    dt = _parse_iso_datetime(value)
    return dt.strftime("%Y%m%d") if dt else ""


def _extract_event_winner(event: dict) -> dict | None:
    competition = ((event or {}).get("competitions") or [None])[0] or {}
    status_type = ((event or {}).get("status") or {}).get("type") or {}
    if not status_type.get("completed"):
        return None

    competitors = [team for team in (competition.get("competitors") or []) if isinstance(team, dict)]
    if len(competitors) < 2:
        return None

    winner_blob = next((team for team in competitors if team.get("winner") is True), None)
    if winner_blob is None:
        scored = []
        for team in competitors:
            raw_score = str(team.get("score") or "").strip()
            if not raw_score or not _re.fullmatch(r"-?\d+", raw_score):
                continue
            scored.append((int(raw_score), team))
        if len(scored) >= 2:
            winner_blob = max(scored, key=lambda item: item[0])[1]

    if winner_blob is None:
        return None

    team_blob = winner_blob.get("team") or {}
    logos = team_blob.get("logos") or []
    logo_url = ""
    for logo in logos:
        href = str((logo or {}).get("href") or "").strip()
        if href and ("scoreboard" in href or not logo_url):
            logo_url = href

    return {
        "team_id": str(team_blob.get("id") or "").strip(),
        "team_name": str(team_blob.get("displayName") or team_blob.get("shortDisplayName") or "").strip(),
        "team_abbr": str(team_blob.get("abbreviation") or "").strip(),
        "logo_url": logo_url,
        "event_id": str((event or {}).get("id") or "").strip(),
        "event_name": str((event or {}).get("name") or "").strip(),
        "event_date": str((event or {}).get("date") or "").strip(),
    }


def _mark_champion_entries(groups: list[dict], champion_team_id: str) -> None:
    clean_team_id = str(champion_team_id or "").strip()
    if not clean_team_id:
        return

    for group in groups:
        for entry in group.get("entries") or []:
            entry_team_id = str(((entry or {}).get("team") or {}).get("id") or "").strip()
            entry["is_champion"] = entry_team_id == clean_team_id


def _resolve_table_champion(groups: list[dict]) -> dict | None:
    ranked_entries: list[dict] = []
    for group in groups:
        ranked_entries.extend(group.get("entries") or [])

    if not ranked_entries:
        return None

    def _rank_value(entry: dict) -> int:
        raw_rank = str(entry.get("rank") or "").strip()
        try:
            rank_val = int(raw_rank)
            return rank_val if rank_val > 0 else 9999
        except (TypeError, ValueError):
            return 9999

    winner = min(ranked_entries, key=_rank_value)
    team_blob = winner.get("team") or {}
    team_id = str(team_blob.get("id") or "").strip()
    if not team_id:
        return None

    return {
        "team_id": team_id,
        "team_name": str(team_blob.get("name") or "").strip(),
        "team_abbr": str(team_blob.get("short_name") or "").strip(),
        "logo_url": str(team_blob.get("logo_url") or "").strip(),
        "event_id": "",
        "event_name": "",
        "event_date": "",
    }


async def _resolve_standings_champion(
    league_key: str,
    data: dict,
    groups: list[dict],
    season_blob: dict,
) -> dict | None:
    if not groups or not season_blob:
        return None

    if league_key == "EPL":
        if not _season_window_has_ended(season_blob.get("endDate")):
            return None
        return _resolve_table_champion(groups)

    postseason = _resolve_standings_season_type(season_blob, "3")
    if not postseason:
        return None

    start_date = _format_scoreboard_date(postseason.get("startDate"))
    end_date = _format_scoreboard_date(postseason.get("endDate"))
    if not start_date or not end_date:
        return None

    if not _season_window_has_ended(postseason.get("endDate")):
        return None

    sport_tuple = LEAGUES.get(league_key)
    if not sport_tuple:
        return None

    sport_name, espn_league, _ = sport_tuple
    scoreboard_url = (
        f"{ESPN_BASE}/{sport_name}/{espn_league}/scoreboard"
        f"?seasontype=3&dates={start_date}-{end_date}&limit=1000"
    )
    scoreboard_data = await _fetch_cached(scoreboard_url, timeout=12.0)
    if not isinstance(scoreboard_data, dict):
        return None

    completed_events = [
        event
        for event in (scoreboard_data.get("events") or [])
        if ((event.get("status") or {}).get("type") or {}).get("completed")
    ]
    if not completed_events:
        return None

    completed_events.sort(key=lambda event: str(event.get("date") or ""))
    return _extract_event_winner(completed_events[-1])


async def _get_http_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(
            follow_redirects=True,
            headers={"User-Agent": "SportSync/0.1"},
            limits=httpx.Limits(max_connections=50, max_keepalive_connections=20),
        )
    return _http_client


async def _reset_http_client() -> None:
    global _http_client
    if _http_client is not None and not _http_client.is_closed:
        await _http_client.aclose()
    _http_client = None


@router.get("/highlights/image", response_model=None)
async def sports_highlight_image(src: str = Query(..., description="Absolute highlight poster/image URL")):
    """Proxy highlight artwork through the backend so the UI gets stable, cached image loads."""
    clean_url = _clean_news_text(src)
    if not clean_url:
        return Response(status_code=400)

    parsed = urlparse(clean_url)
    if parsed.scheme not in {"http", "https"} or not _is_allowed_highlight_image_host(parsed.netloc):
        return Response(status_code=400)

    cache_key = f"highlight-image:{clean_url}"
    cached = _binary_cache.get(cache_key)
    if cached and time.time() - cached[0] < HIGHLIGHT_IMAGE_PROXY_TTL:
        _, cached_bytes, cached_media_type = cached
        return Response(
            content=cached_bytes,
            media_type=cached_media_type,
            headers={"Cache-Control": f"public, max-age={HIGHLIGHT_IMAGE_PROXY_TTL}"},
        )

    candidate_urls: list[str] = []

    def add_candidate(url: str):
        normalized = _clean_news_text(url)
        if normalized and normalized not in candidate_urls:
            candidate_urls.append(normalized)

    add_candidate(clean_url)
    for candidate in _build_espn_image_candidates(clean_url):
        add_candidate(candidate)

    client = await _get_http_client()
    for candidate_url in candidate_urls:
        try:
            response = await client.get(candidate_url, timeout=12.0)
            response.raise_for_status()
        except Exception:
            continue

        media_type = (response.headers.get("content-type") or "image/jpeg").split(";")[0].strip() or "image/jpeg"
        payload = response.content
        if not payload:
            continue

        _binary_cache[cache_key] = (time.time(), payload, media_type)
        return Response(
            content=payload,
            media_type=media_type,
            headers={"Cache-Control": f"public, max-age={HIGHLIGHT_IMAGE_PROXY_TTL}"},
        )

    return Response(status_code=404)


def _should_retry_scoreboard_fetch(url: str, data: dict | list | None) -> bool:
    return (
        isinstance(data, dict)
        and "/scoreboard" in url
        and "events" in data
        and not data.get("events")
    )


async def _fetch_via_requests(url: str, timeout: float) -> dict | list | None:
    def _request() -> dict | list | None:
        response = requests.get(
            url,
            timeout=timeout,
            headers={"User-Agent": "SportSync/0.1"},
        )
        if response.status_code == 429:
            return None
        response.raise_for_status()
        return response.json()

    try:
        return await asyncio.to_thread(_request)
    except Exception:
        return None


async def _fetch_cached(url: str, timeout: float = 10.0) -> dict | list | None:
    """Fetch a URL with simple in-memory caching."""
    now = time.time()
    if url in _cache:
        ts, data = _cache[url]
        if now - ts < CACHE_TTL:
            if _should_retry_scoreboard_fetch(url, data):
                _cache.pop(url, None)
            else:
                return data

    try:
        client = await _get_http_client()
        resp = await client.get(url, timeout=timeout)
        if resp.status_code == 429:
            return None
        data = resp.json()
        if not _should_retry_scoreboard_fetch(url, data):
            _cache[url] = (now, data)
            return data
    except Exception:
        logger.debug("Primary sports fetch failed for %s", url, exc_info=True)
        await _reset_http_client()

    data = await _fetch_via_requests(url, timeout)
    if data is not None:
        _cache[url] = (time.time(), data)
    return data

async def _fetch_fresh(url: str, timeout: float = 6.0) -> dict | list | None:
    """Fetch without cache — used for live activity to eliminate delay."""
    try:
        client = await _get_http_client()
        resp = await client.get(url, timeout=timeout)
        if resp.status_code == 429:
            return None
        data = resp.json()
        if not _should_retry_scoreboard_fetch(url, data):
            _cache[url] = (time.time(), data)
            return data
    except Exception:
        logger.debug("Fresh sports fetch failed for %s", url, exc_info=True)
        await _reset_http_client()

    data = await _fetch_via_requests(url, timeout)
    if data is not None:
        _cache[url] = (time.time(), data)
    return data


async def _fetch_text_cached(url: str, timeout: float = 10.0) -> str | None:
    """Fetch an HTML/text page with lightweight in-memory caching."""
    now = time.time()
    if url in _text_cache:
        ts, data = _text_cache[url]
        if now - ts < CACHE_TTL:
            return data

    try:
        client = await _get_http_client()
        resp = await client.get(
            url,
            timeout=timeout,
            headers={
                "User-Agent": "Mozilla/5.0",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
        )
        if resp.status_code != 200:
            return None
        text = resp.text
        _text_cache[url] = (now, text)
        return text
    except Exception:
        return None


async def _fetch_bytes_cached(url: str, timeout: float = 10.0) -> tuple[bytes, str] | None:
    """Fetch binary content with lightweight in-memory caching."""
    now = time.time()
    if url in _binary_cache:
        ts, data, content_type = _binary_cache[url]
        if now - ts < BINARY_CACHE_TTL:
            return data, content_type

    try:
        client = await _get_http_client()
        resp = await client.get(url, timeout=timeout)
        if resp.status_code >= 400 or not resp.content:
            return None
        content_type = resp.headers.get("content-type", "image/png")
        _binary_cache[url] = (now, resp.content, content_type)
        return resp.content, content_type
    except Exception:
        return None


def _build_espn_image_candidates(src: str) -> list[str]:
    clean_src = src.strip()
    if not clean_src:
        return []

    candidates: list[str] = []

    def add(url: str):
        if url and url not in candidates:
            candidates.append(url)

    try:
        parsed = urlparse(clean_src)
    except Exception:
        return []

    if "espncdn.com" not in parsed.netloc:
        return []

    add(clean_src)

    if parsed.path == "/combiner/i":
        query = parse_qs(parsed.query)
        img_path = (query.get("img") or [""])[0]
        if img_path:
            normalized_img_path = img_path
            for _ in range(2):
                decoded_img_path = unquote(normalized_img_path)
                if decoded_img_path == normalized_img_path:
                    break
                normalized_img_path = decoded_img_path

            if normalized_img_path.startswith("/"):
                add(f"https://a.espncdn.com{normalized_img_path}")
            elif normalized_img_path.startswith("http://") or normalized_img_path.startswith("https://"):
                add(normalized_img_path)

            encoded_img = quote(normalized_img_path, safe="/:")
            add(f"https://a.espncdn.com/combiner/i?img={encoded_img}&w=160&h=160")
            add(f"https://a.espncdn.com/combiner/i?img={encoded_img}&w=320&h=320")
    elif "/i/headshots/" in parsed.path:
        add(f"https://a.espncdn.com/combiner/i?img={quote(parsed.path, safe='/')}&w=160&h=160")

    return candidates


async def _build_mlb_headshot_candidates(name: str, team_name: str = "") -> list[str]:
    clean_name = name.strip()
    if not clean_name:
        return []

    data = await _fetch_cached(
        f"https://statsapi.mlb.com/api/v1/people/search?names={quote(clean_name)}",
        timeout=8.0,
    )
    if not isinstance(data, dict):
        return []

    people = data.get("people", []) or []
    team_lower = team_name.strip().lower()

    def score(person: dict) -> tuple[int, int]:
        full_name = str(person.get("fullName", "")).lower()
        current_team = str((person.get("currentTeam") or {}).get("name", "")).lower()
        exact_name = 0 if full_name == clean_name.lower() else 1
        team_match = 0 if team_lower and current_team and (team_lower in current_team or current_team in team_lower) else 1
        return (team_match, exact_name)

    candidates: list[str] = []
    for person in sorted(people, key=score)[:3]:
        pid = str(person.get("id", "")).strip()
        if not pid:
            continue
        for url in (
            f"https://img.mlbstatic.com/mlb-photos/image/upload/w_160,q_auto:best/v1/people/{pid}/headshot/67/current",
            f"https://img.mlbstatic.com/mlb-photos/image/upload/w_320,q_auto:best/v1/people/{pid}/headshot/67/current",
        ):
            if url not in candidates:
                candidates.append(url)

    return candidates


async def _build_mlb_roster_headshot_candidates(name: str, team_name: str = "") -> list[str]:
    clean_name = name.strip()
    clean_team = team_name.strip()
    if not clean_name or not clean_team:
        return []

    season = datetime.now().year
    teams_data = await _fetch_cached(
        f"https://statsapi.mlb.com/api/v1/teams?sportId=1&season={season}",
        timeout=8.0,
    )
    if not isinstance(teams_data, dict):
        return []

    normalized_target_team = _normalize_team_name(clean_team)
    normalized_target_name = _normalize_team_name(clean_name)

    team_id = ""
    for team in teams_data.get("teams", []) or []:
        if not isinstance(team, dict):
            continue
        candidates = {
            str(team.get("name", "")).strip(),
            str(team.get("teamName", "")).strip(),
            str(team.get("clubName", "")).strip(),
            f"{str(team.get('locationName', '')).strip()} {str(team.get('teamName', '')).strip()}".strip(),
        }
        normalized_candidates = {_normalize_team_name(candidate) for candidate in candidates if candidate}
        if normalized_target_team in normalized_candidates:
            team_id = str(team.get("id", "")).strip()
            break

    if not team_id:
        return []

    urls: list[str] = []
    seen_ids: set[str] = set()
    for roster_type in ("active", "40Man", "fullSeason"):
        roster_data = await _fetch_cached(
            f"https://statsapi.mlb.com/api/v1/teams/{team_id}/roster?rosterType={roster_type}&season={season}",
            timeout=8.0,
        )
        if not isinstance(roster_data, dict):
            continue

        for entry in roster_data.get("roster", []) or []:
            if not isinstance(entry, dict):
                continue
            person = entry.get("person", {}) or {}
            person_id = str(person.get("id", "")).strip()
            full_name = str(person.get("fullName", "")).strip()
            if not person_id or not full_name or person_id in seen_ids:
                continue

            normalized_full_name = _normalize_team_name(full_name)
            if normalized_full_name != normalized_target_name and normalized_target_name not in normalized_full_name:
                continue

            seen_ids.add(person_id)
            for url in (
                f"https://img.mlbstatic.com/mlb-photos/image/upload/w_160,q_auto:best/v1/people/{person_id}/headshot/67/current",
                f"https://img.mlbstatic.com/mlb-photos/image/upload/w_320,q_auto:best/v1/people/{person_id}/headshot/67/current",
            ):
                if url not in urls:
                    urls.append(url)

        if urls:
            break

    return urls


async def _get_mlb_player_directory() -> dict[str, list[str]]:
    global _mlb_player_directory_cache
    now = time.time()
    if _mlb_player_directory_cache and now - _mlb_player_directory_cache[0] < MLB_DIRECTORY_CACHE_TTL:
        return _mlb_player_directory_cache[1]

    season = datetime.now().year
    teams_data = await _fetch_cached(
        f"https://statsapi.mlb.com/api/v1/teams?sportId=1&season={season}",
        timeout=10.0,
    )
    if not isinstance(teams_data, dict):
        return _mlb_player_directory_cache[1] if _mlb_player_directory_cache else {}

    directory: dict[str, list[str]] = {}

    def remember(name_value: str, person_id: str):
        normalized = _normalize_team_name(name_value)
        if not normalized or not person_id:
            return
        urls = directory.setdefault(normalized, [])
        for url in (
            f"https://img.mlbstatic.com/mlb-photos/image/upload/w_160,q_auto:best/v1/people/{person_id}/headshot/67/current",
            f"https://img.mlbstatic.com/mlb-photos/image/upload/w_320,q_auto:best/v1/people/{person_id}/headshot/67/current",
        ):
            if url not in urls:
                urls.append(url)

    for team in teams_data.get("teams", []) or []:
        if not isinstance(team, dict):
            continue
        team_id = str(team.get("id", "")).strip()
        if not team_id:
            continue

        for roster_type in ("active", "40Man", "fullSeason"):
            roster_data = await _fetch_cached(
                f"https://statsapi.mlb.com/api/v1/teams/{team_id}/roster?rosterType={roster_type}&season={season}",
                timeout=8.0,
            )
            if not isinstance(roster_data, dict):
                continue

            for entry in roster_data.get("roster", []) or []:
                if not isinstance(entry, dict):
                    continue
                person = entry.get("person", {}) or {}
                person_id = str(person.get("id", "")).strip()
                full_name = str(person.get("fullName", "")).strip()
                if not person_id or not full_name:
                    continue
                remember(full_name, person_id)

    _mlb_player_directory_cache = (now, directory)
    return directory


async def _build_mlb_directory_headshot_candidates(name: str, team_name: str = "") -> list[str]:
    clean_name = name.strip()
    if not clean_name:
        return []

    directory = await _get_mlb_player_directory()
    normalized_target_name = _normalize_team_name(clean_name)
    if not normalized_target_name:
        return []

    exact = directory.get(normalized_target_name, [])
    if exact:
        return exact

    loose: list[str] = []
    for candidate_name, urls in directory.items():
        if normalized_target_name in candidate_name or candidate_name in normalized_target_name:
            for url in urls:
                if url not in loose:
                    loose.append(url)
    return loose


async def _build_sportsdb_image_candidates(name: str, team_name: str = "", league_key: str = "") -> list[str]:
    clean_name = name.strip()
    if not clean_name:
        return []

    data = await _fetch_cached(f"{THESPORTSDB_BASE}/searchplayers.php?p={quote(clean_name)}", timeout=8.0)
    if not isinstance(data, dict):
        return []

    players = data.get("player", []) or []
    team_lower = team_name.strip().lower()
    sport_lower = SPORTSDB_SPORTS.get(league_key.upper(), "").lower()

    def score(player: dict) -> tuple[int, int, int]:
        player_name = str(player.get("strPlayer", "")).lower()
        player_team = str(player.get("strTeam", "")).lower()
        player_sport = str(player.get("strSport", "")).lower()
        exact_name = 0 if player_name == clean_name.lower() else 1
        team_match = 0 if team_lower and player_team and (team_lower in player_team or player_team in team_lower) else 1
        sport_match = 0 if sport_lower and player_sport == sport_lower else 1
        return (team_match, sport_match, exact_name)

    candidates: list[str] = []
    for player in sorted(players, key=score)[:3]:
        url = str(player.get("strThumb", "")).strip()
        if url and url not in candidates:
            candidates.append(url)

    return candidates


async def _build_sportsdb_team_roster_candidates(name: str, team_name: str = "") -> list[str]:
    clean_name = name.strip()
    clean_team = team_name.strip()
    if not clean_name or not clean_team:
        return []

    team_data = await _fetch_cached(
        f"{THESPORTSDB_BASE}/searchteams.php?t={quote(clean_team)}",
        timeout=8.0,
    )
    if not isinstance(team_data, dict):
        return []

    teams = team_data.get("teams", []) or []
    normalized_target_team = _normalize_team_name(clean_team)
    normalized_target_name = _normalize_team_name(clean_name)
    team_id = ""
    for team in teams:
        if not isinstance(team, dict):
            continue
        team_name_candidate = str(team.get("strTeam", "")).strip()
        if _normalize_team_name(team_name_candidate) == normalized_target_team:
            team_id = str(team.get("idTeam", "")).strip()
            break

    if not team_id:
        return []

    roster_data = await _fetch_cached(
        f"{THESPORTSDB_BASE}/lookup_all_players.php?id={quote(team_id)}",
        timeout=8.0,
    )
    if not isinstance(roster_data, dict):
        return []

    candidates: list[str] = []
    for player in roster_data.get("player", []) or []:
        if not isinstance(player, dict):
            continue
        player_name = str(player.get("strPlayer", "")).strip()
        normalized_player_name = _normalize_team_name(player_name)
        if normalized_player_name != normalized_target_name and normalized_target_name not in normalized_player_name:
            continue
        url = str(player.get("strThumb", "")).strip()
        if url and url not in candidates:
            candidates.append(url)

    return candidates


async def _build_epl_headshot_candidates(name: str, team_name: str = "") -> list[str]:
    clean_name = _clean_person_name(name)
    if not clean_name:
        return []

    data = await _fetch_cached(FPL_BOOTSTRAP_URL, timeout=10.0)
    if not isinstance(data, dict):
        return []

    normalized_target_name = _normalize_person_lookup(clean_name)
    target_team_keys = _candidate_team_keys(team_name)
    teams_by_id: dict[int, set[str]] = {}
    for team in data.get("teams", []) or []:
        if not isinstance(team, dict):
            continue
        team_id = team.get("id")
        if not isinstance(team_id, int):
            continue
        keys = set()
        for raw_name in (team.get("name", ""), team.get("short_name", "")):
            keys.update(_candidate_team_keys(str(raw_name)))
        teams_by_id[team_id] = keys

    def _name_keys(player: dict) -> set[str]:
        raw_names = {
            str(player.get("first_name", "")).strip(),
            str(player.get("second_name", "")).strip(),
            str(player.get("web_name", "")).strip(),
            str(player.get("known_name", "")).strip(),
            f"{str(player.get('first_name', '')).strip()} {str(player.get('second_name', '')).strip()}".strip(),
        }
        return {
            normalized
            for raw_name in raw_names
            if raw_name and (normalized := _normalize_person_lookup(raw_name))
        }

    def _photo_candidates(photo_code: str) -> list[str]:
        if not photo_code:
            return []
        season_anchor_year = datetime.now().year if datetime.now().month >= 7 else datetime.now().year - 1
        season_code = f"{season_anchor_year % 100:02d}"
        return [
            f"https://resources.premierleague.com/premierleague{season_code}/photos/players/110x140/{photo_code}.png",
            f"https://resources.premierleague.com/premierleague/photos/players/250x250/p{photo_code}.png",
        ]

    exact_matches: list[str] = []
    loose_matches: list[str] = []
    for player in data.get("elements", []) or []:
        if not isinstance(player, dict):
            continue
        player_team_id = player.get("team")
        player_team_keys = teams_by_id.get(player_team_id, set()) if isinstance(player_team_id, int) else set()
        if target_team_keys and player_team_keys and target_team_keys.isdisjoint(player_team_keys):
            continue

        player_name_keys = _name_keys(player)
        if normalized_target_name in player_name_keys:
            photo = str(player.get("photo", "")).strip()
            photo_code = _re.sub(r"\D", "", photo or str(player.get("code", "")))
            if photo_code:
                exact_matches.extend(_photo_candidates(photo_code))
        elif normalized_target_name and any(
            normalized_target_name in key or key in normalized_target_name for key in player_name_keys
        ):
            photo = str(player.get("photo", "")).strip()
            photo_code = _re.sub(r"\D", "", photo or str(player.get("code", "")))
            if photo_code:
                loose_matches.extend(_photo_candidates(photo_code))

    return list(dict.fromkeys(exact_matches or loose_matches))


async def _build_nfl_headshot_candidates(name: str, team_name: str = "") -> list[str]:
    clean_name = _clean_person_name(name)
    if not clean_name or not team_name:
        return []

    teams_data = await _fetch_cached(
        "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams",
        timeout=10.0,
    )
    if not isinstance(teams_data, dict):
        return []

    normalized_team_keys = _candidate_team_keys(team_name)
    team_id = ""
    for sport_block in teams_data.get("sports", []) or []:
        for league_block in sport_block.get("leagues", []) or []:
            for team_entry in league_block.get("teams", []) or []:
                team = team_entry.get("team", {}) if isinstance(team_entry, dict) else {}
                entry_keys = set()
                for raw_name in (
                    team.get("displayName", ""),
                    team.get("shortDisplayName", ""),
                    team.get("abbreviation", ""),
                    team.get("name", ""),
                    team.get("location", ""),
                ):
                    entry_keys.update(_candidate_team_keys(str(raw_name)))
                if normalized_team_keys and not normalized_team_keys.isdisjoint(entry_keys):
                    team_id = str(team.get("id", "")).strip()
                    break
            if team_id:
                break
        if team_id:
            break

    if not team_id:
        return []

    roster_data = await _fetch_cached(
        f"https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/{team_id}/roster",
        timeout=10.0,
    )
    if not isinstance(roster_data, dict):
        return []

    normalized_target_name = _normalize_person_lookup(clean_name)
    candidates: list[str] = []
    for section in roster_data.get("athletes", []) or []:
        for player in section.get("items", []) or []:
            if not isinstance(player, dict):
                continue
            raw_names = {
                str(player.get("fullName", "")).strip(),
                str(player.get("displayName", "")).strip(),
                str(player.get("shortName", "")).strip(),
            }
            name_keys = {
                normalized
                for raw_name in raw_names
                if raw_name and (normalized := _normalize_person_lookup(raw_name))
            }
            if normalized_target_name not in name_keys and not any(
                normalized_target_name in key or key in normalized_target_name for key in name_keys
            ):
                continue
            athlete_id = str(player.get("id", "")).strip()
            if athlete_id:
                url = _build_espn_headshot_url(athlete_id, "nfl")
                if url and url not in candidates:
                    candidates.append(url)

    return candidates

def _extract_headshot(value, athlete_id: str = "", sport: str = "") -> str:
    """Safely extract headshot URL from ESPN data (can be str, dict, or None).
    If no headshot is found but an athlete_id is available, construct the
    standard ESPN CDN headshot URL."""
    url = ""
    if not value:
        url = ""
    elif isinstance(value, str):
        url = value
    elif isinstance(value, dict):
        url = value.get("href", value.get("url", ""))
    # If still no URL, construct from athlete ID + sport
    if not url and athlete_id:
        # Map our sport keys to ESPN headshot path segments
        sport_map = {
            "football": "nfl",
            "basketball": "nba",
            "baseball": "mlb",
            "hockey": "nhl",
            "soccer": "soccer",
        }
        sport_slug = sport_map.get(sport, "")
        if sport_slug:
            url = f"https://a.espncdn.com/i/headshots/{sport_slug}/players/full/{athlete_id}.png"
        elif sport:
            # Generic ESPN combiner fallback for any sport
            url = f"https://a.espncdn.com/combiner/i?img=/i/headshots/{sport}/players/full/{athlete_id}.png&w=160&h=160"
    return url


def _clean_news_text(value: object) -> str:
    """Collapse line breaks and trim surrounding whitespace in news strings."""
    if not isinstance(value, str):
        return ""
    return " ".join(value.split())


def _extract_description_image(description: str) -> str | None:
    """Try to pull an image URL from HTML stored inside an RSS description."""
    if not description:
        return None

    match = _re.search(r'<img[^>]+src=["\']([^"\']+)["\']', description, _re.IGNORECASE)
    if not match:
        return None

    return html.unescape(match.group(1).strip())


def _extract_rss_image(item_el, description: str) -> str | None:
    """Extract a thumbnail from RSS media fields with HTML fallback."""
    media_ns = {"media": "http://search.yahoo.com/mrss/"}

    for tag_name in ("media:content", "media:thumbnail"):
        media_el = item_el.find(tag_name, media_ns)
        if media_el is not None:
            image_url = media_el.get("url")
            if image_url:
                return image_url.strip()

    enclosure_el = item_el.find("enclosure")
    if enclosure_el is not None:
        image_url = enclosure_el.get("url")
        if image_url:
            return image_url.strip()

    return _extract_description_image(description)


def _upgrade_espn_highlight_image(url: str, width: int, height: int) -> str:
    """Request a higher-quality ESPN CDN cut for highlight thumbnails."""
    clean_url = _clean_news_text(url)
    if not clean_url:
        return ""

    parsed = urlparse(clean_url)
    host = parsed.netloc.lower()
    if "espncdn.com" not in host and "video-cdn.espn.com" not in host:
        return clean_url

    normalized_path = parsed.path or clean_url
    normalized_path = _re.sub(
        r"_(?:default|1x1|5x2|9x16|16x9|3x4|4x3|2x1|square|wide|vertical|verticalfirstframe)(?=\.(?:jpg|jpeg|png|webp)$)",
        "",
        normalized_path,
        flags=_re.IGNORECASE,
    )

    normalized_source = f"{parsed.scheme or 'https'}://{parsed.netloc}{normalized_path}"

    if host.endswith("video-cdn.espn.com") or host.endswith("media.video-cdn.espn.com"):
        return normalized_source

    encoded_source = quote(normalized_source, safe="")
    return f"https://a.espncdn.com/combiner/i?img={encoded_source}&w={width}&h={height}"


def _is_allowed_highlight_image_host(host: str) -> bool:
    clean_host = (host or "").strip().lower()
    if not clean_host:
        return False
    return any(clean_host == allowed or clean_host.endswith(f".{allowed}") for allowed in HIGHLIGHT_IMAGE_ALLOWED_HOSTS)


def _build_highlight_image_proxy_url(url: str) -> str:
    clean_url = _clean_news_text(url)
    if not clean_url:
        return ""

    parsed = urlparse(clean_url)
    if parsed.scheme not in {"http", "https"} or not _is_allowed_highlight_image_host(parsed.netloc):
        return clean_url

    host = parsed.netloc.lower()
    if "espncdn.com" not in host and "video-cdn.espn.com" not in host:
        return clean_url

    return f"/api/sports/highlights/image?{urlencode({'src': clean_url})}"


def _extract_article_image(article: dict) -> str | None:
    """Choose the strongest usable image from an ESPN article payload."""
    images = article.get("images", [])
    if not isinstance(images, list):
        return None

    ranked_images: list[tuple[int, str]] = []
    for image in images:
        if not isinstance(image, dict):
            continue

        image_url = image.get("url") or image.get("href")
        if isinstance(image_url, str) and image_url.strip():
            try:
                width = int(image.get("width") or 0)
            except (TypeError, ValueError):
                width = 0

            try:
                height = int(image.get("height") or 0)
            except (TypeError, ValueError):
                height = 0

            rel = image.get("rel") or []
            rel_bonus = 0
            if isinstance(rel, list):
                rel_lower = {str(item).lower() for item in rel}
                if {"full", "default"} & rel_lower:
                    rel_bonus += 10_000
                if "wide" in rel_lower:
                    rel_bonus += 6_000

            ranked_images.append(((width * height) + rel_bonus, image_url.strip()))

    ranked_images.sort(key=lambda item: item[0], reverse=True)
    return ranked_images[0][1] if ranked_images else None


def _extract_meta_content(page_html: str, meta_key: str) -> str | None:
    """Extract a meta tag value from fetched HTML."""
    if not page_html or not meta_key:
        return None

    escaped_key = _re.escape(meta_key)
    patterns = (
        rf'<meta[^>]+property=["\']{escaped_key}["\'][^>]+content=["\']([^"\']+)["\']',
        rf'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']{escaped_key}["\']',
        rf'<meta[^>]+name=["\']{escaped_key}["\'][^>]+content=["\']([^"\']+)["\']',
        rf'<meta[^>]+content=["\']([^"\']+)["\'][^>]+name=["\']{escaped_key}["\']',
    )
    for pattern in patterns:
        match = _re.search(pattern, page_html, _re.IGNORECASE)
        if match:
            content = html.unescape(match.group(1).strip())
            if content:
                return content
    return None


def _extract_nested_href(value: object) -> str:
    """Resolve a usable href from ESPN link blobs that can be strings or dicts."""
    if isinstance(value, str):
        return value.strip()
    if not isinstance(value, dict):
        return ""

    direct_href = value.get("href")
    if isinstance(direct_href, str) and direct_href.strip():
        return direct_href.strip()

    for nested_key in ("full", "HD", "default", "wide", "square", "vertical", "verticalFirstFrame", "self", "short"):
        nested_value = value.get(nested_key)
        nested_href = _extract_nested_href(nested_value)
        if nested_href:
            return nested_href

    return ""


def _infer_highlight_variant_height(url: str) -> int:
    clean_url = _clean_news_text(url)
    if not clean_url:
        return 0

    match = _re.search(r"_(\d{3,4})p(?:\d+)?(?:[_./-]|$)", clean_url, _re.IGNORECASE)
    if not match:
        return 0

    try:
        return int(match.group(1))
    except (TypeError, ValueError):
        return 0


def _infer_highlight_variant_bitrate(url: str) -> int:
    clean_url = _clean_news_text(url)
    if not clean_url:
        return 0

    match = _re.search(r"_(\d{3,5})k(?:[_./-]|$)", clean_url, _re.IGNORECASE)
    if not match:
        return 0

    try:
        return int(match.group(1))
    except (TypeError, ValueError):
        return 0


def _build_highlight_variant_label(source_key: str, url: str) -> str:
    height = _infer_highlight_variant_height(url)
    if height > 0:
        return f"{height}p"

    normalized_key = str(source_key or "").strip().lower()
    if normalized_key in {"mezzanine", "mobile_source"}:
        return "Source"
    if normalized_key == "hd":
        return "HD"
    return "Standard"


def _collect_progressive_highlight_variants(source_links: object, mobile_links: object) -> list[dict]:
    seen_urls: set[str] = set()
    ranked_variants: list[tuple[int, dict]] = []

    def add_variant(raw_value: object, source_key: str, priority: int) -> None:
        url = _extract_nested_href(raw_value)
        clean_url = _clean_news_text(url)
        if (
            not clean_url
            or clean_url in seen_urls
            or clean_url.endswith(".m3u8")
            or clean_url.endswith(".smil")
            or clean_url.endswith(".f4m")
        ):
            return

        seen_urls.add(clean_url)
        height = _infer_highlight_variant_height(clean_url)
        bitrate = _infer_highlight_variant_bitrate(clean_url)
        ranked_variants.append(
            (
                (height * 1000) + bitrate + priority,
                {
                    "id": f"{source_key}:{len(ranked_variants)}",
                    "label": _build_highlight_variant_label(source_key, clean_url),
                    "url": clean_url,
                    "height": height or None,
                    "bitrate": bitrate or None,
                },
            )
        )

    if isinstance(source_links, dict):
        add_variant(source_links.get("mezzanine"), "mezzanine", 3_000_000)
        add_variant(source_links.get("HD"), "hd", 2_000_000)
        add_variant(source_links.get("full"), "full", 1_000_000)
        add_variant(source_links.get("href"), "href", 500_000)

    if isinstance(mobile_links, dict):
        add_variant(mobile_links.get("source"), "mobile_source", 100_000)

    ranked_variants.sort(key=lambda item: item[0], reverse=True)
    return [variant for _, variant in ranked_variants]


def _extract_iframe_src(embed_html: str) -> str:
    """Pull an iframe src out of provider embed HTML."""
    if not embed_html:
        return ""

    match = _re.search(r'src=["\']([^"\']+)["\']', embed_html, _re.IGNORECASE)
    if not match:
        return ""

    return html.unescape(match.group(1).strip())


def _build_nhl_brightcove_embed_url(page_html: str, video_id: str) -> str:
    """Build a Brightcove iframe URL from NHL share-page HTML."""
    clean_video_id = str(video_id or "").strip()
    if not page_html or not clean_video_id:
        return ""

    match = _re.search(
        r"players\.brightcove\.net/(\d+)/([^\"'/]+)/index(?:\.min)?\.js",
        page_html,
        _re.IGNORECASE,
    )
    if not match:
        return ""

    account_id = match.group(1).strip()
    player_id = match.group(2).strip()
    if not account_id or not player_id:
        return ""

    return f"https://players.brightcove.net/{account_id}/{player_id}/index.html?videoId={clean_video_id}"


def _parse_duration_seconds(value: object) -> int:
    """Normalize integer or clock-style clip durations into seconds."""
    if isinstance(value, (int, float)):
        return max(0, int(value))

    raw = str(value or "").strip()
    if not raw:
        return 0

    if raw.isdigit():
        return max(0, int(raw))

    parts = raw.split(":")
    if len(parts) not in {2, 3}:
        return 0

    try:
        numeric_parts = [int(float(part)) for part in parts]
    except ValueError:
        return 0

    if len(numeric_parts) == 2:
        minutes, seconds = numeric_parts
        return max(0, minutes * 60 + seconds)

    hours, minutes, seconds = numeric_parts
    return max(0, hours * 3600 + minutes * 60 + seconds)


def _format_duration_label(seconds: object) -> str:
    """Format a clip duration in seconds into M:SS."""
    total_seconds = _parse_duration_seconds(seconds)

    if total_seconds <= 0:
        return ""

    minutes, remainder = divmod(total_seconds, 60)
    if minutes >= 60:
        hours, minutes = divmod(minutes, 60)
        return f"{hours}:{minutes:02d}:{remainder:02d}"
    return f"{minutes}:{remainder:02d}"


def _parse_sortable_timestamp(value: object) -> float:
    """Turn common ESPN date formats into a sortable unix timestamp."""
    if not isinstance(value, str) or not value.strip():
        return 0.0

    raw = value.strip()
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).timestamp()
    except Exception:
        pass

    try:
        from email.utils import parsedate_to_datetime
        return parsedate_to_datetime(raw).timestamp()
    except Exception:
        return 0.0


def _extract_article_team_tags(article: dict) -> list[str]:
    """Collect team names attached to an ESPN article or clip summary."""
    team_tags: list[str] = []
    for category in article.get("categories") or []:
        if not isinstance(category, dict):
            continue
        if str(category.get("type") or "").lower() != "team":
            continue
        description = _clean_news_text(category.get("description", ""))
        if description and description not in team_tags:
            team_tags.append(description)
    return team_tags


def _build_team_text_keys(value: str) -> set[str]:
    """Create text-matchable aliases for a team name, including short nickname forms."""
    clean_value = _clean_news_text(value)
    aliases = {alias for alias in _candidate_team_keys(clean_value) if alias}
    parts = [part for part in _re.split(r"\s+", clean_value) if part]
    normalized_parts = [_normalize_team_name(part) for part in parts if _normalize_team_name(part)]
    if normalized_parts:
        aliases.add(normalized_parts[-1])
    if len(normalized_parts) >= 2:
        aliases.add("".join(normalized_parts[-2:]))
    return {alias for alias in aliases if len(alias) >= 3}


def _resolve_espn_highlight_team_tags(
    article: dict,
    *,
    title: str,
    description: str,
    page_url: str = "",
    story_url: str = "",
    event_id: str = "",
) -> list[str]:
    """
    Prefer ESPN article team tags, but drop unsupported single-team tags for studio/news clips.

    ESPN sometimes attaches the broader story's team category to a clip even when the clip text
    clearly points at a different team. We keep matchup/event tags intact, but a lone team tag
    must be supported by the clip copy before it is shown.
    """
    team_tags = _extract_article_team_tags(article)
    if not team_tags:
        return []

    if event_id or len(team_tags) > 1:
        return team_tags

    support_text = _normalize_team_name(" ".join(
        part for part in (title, description, page_url, story_url) if part
    ))
    if not support_text:
        return []

    supported_tags = []
    for team_name in team_tags:
        aliases = _build_team_text_keys(team_name)
        if any(alias in support_text for alias in aliases):
            supported_tags.append(team_name)

    return supported_tags


def _extract_article_event_id(article: dict) -> str:
    """Pull the first linked event id off an ESPN article, if present."""
    for category in article.get("categories") or []:
        if not isinstance(category, dict):
            continue
        event_id = str(
            category.get("eventId")
            or ((category.get("event") or {}).get("id") if isinstance(category.get("event"), dict) else "")
            or ""
        ).strip()
        if event_id:
            return event_id
    return ""


def _classify_highlight_title(title: str) -> str:
    """Attach a simple label that feels closer to a sports highlight feed."""
    lowered = (title or "").lower()
    if "best plays" in lowered or ("top" in lowered and "plays" in lowered):
        return "Top Plays"
    if "game highlights" in lowered or "highlights" in lowered:
        return "Game Highlights"
    if "recap" in lowered:
        return "Recap"
    if "buzzer" in lowered or "walk-off" in lowered or "winner" in lowered:
        return "Clutch Moment"
    return "Latest Clip"


def _calculate_highlight_popularity_score(
    title: str,
    type_label: str,
    published_at: str,
    duration_seconds: int,
    team_tags: list[str],
    event_id: str,
) -> float:
    """Estimate clip popularity from freshness and sports-friendly editorial signals."""
    now_ts = datetime.now(timezone.utc).timestamp()
    published_ts = _parse_sortable_timestamp(published_at)
    hours_old = max(0.0, (now_ts - published_ts) / 3600.0) if published_ts else 96.0

    recency_score = max(0.0, 132.0 - min(hours_old, 168.0) * 2.4)
    if hours_old <= 6.0:
        recency_score += 20.0
    elif hours_old <= 24.0:
        recency_score += 10.0
    elif hours_old > 168.0:
        recency_score -= 56.0
    elif hours_old > 72.0:
        recency_score -= 22.0

    type_bonus = {
        "Top Plays": 28.0,
        "Game Highlights": 22.0,
        "Clutch Moment": 20.0,
        "Latest Clip": 14.0,
        "Recap": 6.0,
    }.get(type_label, 10.0)
    duration_bonus = 6.0 if 20 <= duration_seconds <= 150 else 3.0 if duration_seconds > 0 else 0.0
    team_bonus = min(12.0, float(len(team_tags or [])) * 4.0)
    event_bonus = 12.0 if event_id else 0.0

    lowered_title = (title or "").lower()
    keyword_bonus = 0.0
    for keyword, weight in (
        ("game winner", 9.0),
        ("game-winning", 9.0),
        ("walk-off", 9.0),
        ("buzzer", 9.0),
        ("overtime winner", 8.0),
        ("shootout winner", 8.0),
        ("dagger", 7.0),
        ("go-ahead", 7.0),
        ("game-tying", 6.0),
        ("poster", 6.0),
        ("dunk", 5.0),
        ("slam", 5.0),
        ("touchdown", 5.0),
        ("pick-six", 5.0),
        ("interception", 4.5),
        ("home run", 5.0),
        ("grand slam", 7.0),
        ("hat trick", 7.0),
        ("goal", 4.0),
        ("lights the lamp", 6.0),
        ("equalizer", 5.0),
        ("top plays", 5.0),
        ("best plays", 5.0),
        ("game highlights", 4.0),
    ):
        if keyword in lowered_title:
            keyword_bonus += weight

    penalty = 0.0
    for phrase in (
        "what have been the keys",
        "reacts",
        "react to",
        "breaks down",
        "analysis",
        "pregame",
        "postgame",
        "preview",
        "press conference",
        "interview",
        "discusses",
        "speaks after",
        "storylines",
        "availability",
        "bullpen availability",
    ):
        if phrase in lowered_title:
            penalty += 12.0

    return round(recency_score + type_bonus + duration_bonus + team_bonus + event_bonus + keyword_bonus - penalty, 2)


def _normalize_highlight_dedupe_text(value: str) -> str:
    """Collapse clip titles into a stable fingerprint for cross-provider dedupe."""
    normalized = _strip_diacritics(_clean_news_text(value or "")).lower().replace("&", "and")
    normalized = _re.sub(
        r"\b(video|clip|official|highlights?|recap|condensed|extended|full game|best plays|top plays)\b",
        " ",
        normalized,
    )
    normalized = _re.sub(r"[^a-z0-9]+", " ", normalized)
    return _re.sub(r"\s+", " ", normalized).strip()


def _normalize_highlight_url_key(value: str) -> str:
    clean_value = _clean_news_text(value or "")
    if not clean_value:
        return ""

    parsed = urlparse(clean_value)
    host = parsed.netloc.lower().removeprefix("www.")
    path = parsed.path.rstrip("/")
    if not host and not path:
        return clean_value
    return f"{host}{path}"


def _build_highlight_dedupe_keys(item: dict) -> set[str]:
    keys: set[str] = set()

    item_id = _clean_news_text(str(item.get("id") or ""))
    if item_id:
        keys.add(f"id:{item_id}")

    playable_url = _normalize_highlight_url_key(
        str(
            item.get("videoUrl")
            or item.get("hlsUrl")
            or item.get("embedUrl")
            or item.get("pageUrl")
            or ""
        )
    )
    if playable_url:
        keys.add(f"url:{playable_url}")

    league_key = _clean_news_text(str(item.get("league") or "")).upper()
    event_id = _clean_news_text(str(item.get("eventId") or ""))
    title_key = _normalize_highlight_dedupe_text(str(item.get("title") or ""))
    type_key = _normalize_highlight_dedupe_text(str(item.get("typeLabel") or ""))
    duration_bucket = int(round(float(item.get("durationSeconds") or 0) / 5.0) * 5)

    team_keys = sorted(
        {
            _normalize_team_name(str(team))
            for team in (item.get("teamTags") or [])
            if _normalize_team_name(str(team))
        }
    )
    matchup_key = "|".join(team_keys[:2])

    if title_key:
        keys.add(f"title:{league_key}:{title_key}")
        if matchup_key:
            keys.add(f"matchup-title:{league_key}:{matchup_key}:{title_key}")
        if event_id:
            keys.add(f"event-title:{league_key}:{event_id}:{title_key}")
        if duration_bucket > 0:
            keys.add(f"title-duration:{league_key}:{title_key}:{duration_bucket}")

    if title_key and matchup_key and type_key:
        keys.add(f"matchup-type:{league_key}:{matchup_key}:{type_key}")

    if event_id and matchup_key and duration_bucket > 0:
        keys.add(f"event-match:{league_key}:{event_id}:{matchup_key}:{duration_bucket}")

    return {key for key in keys if key}


def _highlight_quality_score(item: dict) -> float:
    """Prefer richer assets when multiple providers surface the same moment."""
    score = float(item.get("popularityScore") or 0.0)
    if item.get("videoUrl"):
        score += 24
    if item.get("hlsUrl"):
        score += 20
    if item.get("embedUrl"):
        score += 12
    if item.get("pageUrl"):
        score += 6
    if item.get("widePosterUrl"):
        score += 4
    if item.get("verticalPosterUrl"):
        score += 3

    source = _clean_news_text(str(item.get("source") or "")).upper()
    source_boost = {
        "MLB": 8,
        "NHL": 7,
        "ESPN": 6,
        "SCOREBAT": 4,
    }.get(source, 0)
    return score + source_boost


def _highlight_age_hours(item: dict) -> float:
    published_ts = float(item.get("publishedTs") or 0.0)
    if published_ts <= 0:
        return 10_000.0
    return max(0.0, (datetime.now(timezone.utc).timestamp() - published_ts) / 3600.0)


def _normalize_highlights_request_date(value: str | None) -> tuple[str, str, bool]:
    local_now = datetime.now().astimezone()
    today_iso = local_now.strftime("%Y-%m-%d")
    cleaned = _clean_news_text(str(value or ""))

    if not cleaned:
        return today_iso, today_iso.replace("-", ""), False

    parsed_target: datetime | None = None
    for pattern in ("%Y%m%d", "%Y-%m-%d"):
        try:
            parsed_target = datetime.strptime(cleaned, pattern)
            break
        except ValueError:
            continue

    if parsed_target is None:
        return today_iso, today_iso.replace("-", ""), False

    target_iso = parsed_target.strftime("%Y-%m-%d")
    return target_iso, parsed_target.strftime("%Y%m%d"), target_iso > today_iso


def _highlight_matches_local_date(item: dict, target_iso: str, local_tz) -> bool:
    published_ts = float(item.get("publishedTs") or 0.0)
    if published_ts > 0:
        local_date = datetime.fromtimestamp(published_ts, timezone.utc).astimezone(local_tz).strftime("%Y-%m-%d")
        return local_date == target_iso

    published_at = _clean_news_text(str(item.get("publishedAt") or ""))
    parsed_dt = _parse_iso_datetime(published_at)
    if parsed_dt:
        return parsed_dt.astimezone(local_tz).strftime("%Y-%m-%d") == target_iso

    if len(published_at) >= 10 and published_at[4:5] == "-" and published_at[7:8] == "-":
        return published_at[:10] == target_iso

    return False


def _is_noise_highlight_title(item: dict) -> bool:
    """Filter non-highlight filler that some providers surface in clip feeds."""
    title = _clean_news_text(str(item.get("title") or "")).lower()
    description = _clean_news_text(str(item.get("description") or "")).lower()
    if not title:
        return True

    blocked_phrases = (
        "starting lineups",
        "bench availability",
        "bullpen availability",
        "fielding alignment",
        "probable pitchers",
        "projected lineup",
        "lineup notes",
        "injury report",
        "what have been the keys",
        "reacts to",
        "react to",
        "breaks down",
        "press conference",
        "postgame interview",
        "pregame interview",
        "storylines",
        "bullpen game",
        "availability update",
        "on adjusting to",
        "still in search of",
        "targeting",
        "breaking down",
        "amid increasing",
        "increasing relegation fears",
        "hurts a lot",
        "statcast analysis",
        "measuring the stats",
        "distance behind",
        "couldn't handle",
    )
    if any(phrase in title for phrase in blocked_phrases):
        return True

    blocked_description_phrases = (
        "reacts to",
        "breaks down",
        "puts the blame",
        "speaks after",
        "discusses",
        "reports on",
        "mindset at the plate",
        "what area",
        "relegation fears",
        "primary offseason need",
    )
    if any(phrase in description for phrase in blocked_description_phrases):
        return True

    league = str(item.get("league") or "").upper()
    if league == "NBA":
        blocked_basketball_phrases = (
            "iowa state",
            "cyclones",
            "wildcats",
            "ncaa",
            "college basketball",
            "march madness",
            "final four",
            "sweet 16",
            "elite eight",
        )
        if any(phrase in title or phrase in description for phrase in blocked_basketball_phrases):
            return True

    if league == "MLB":
        blocked_baseball_phrases = (
            "river cats",
            "triple-a",
            "minor league",
            "spring breakout",
        )
        if any(phrase in title or phrase in description for phrase in blocked_baseball_phrases):
            return True

    if "?" in title:
        action_keywords = (
            "highlight",
            "goal",
            "home run",
            "touchdown",
            "dunk",
            "winner",
            "walk-off",
            "slam",
            "lights the lamp",
            "interception",
            "pick-six",
        )
        if not any(keyword in title or keyword in description for keyword in action_keywords):
            return True

    return False


def _extract_video_clip_payload(detail_payload: dict) -> dict | None:
    """Support both ESPN article-with-video and direct video clip responses."""
    if not isinstance(detail_payload, dict):
        return None

    videos = detail_payload.get("videos")
    if isinstance(videos, list) and videos:
        clip = videos[0]
        return clip if isinstance(clip, dict) else None

    headlines = detail_payload.get("headlines")
    if isinstance(headlines, list) and headlines:
        headline = headlines[0] if isinstance(headlines[0], dict) else {}
        attached_videos = headline.get("video") or []
        if isinstance(attached_videos, list) and attached_videos:
            clip = attached_videos[0]
            return clip if isinstance(clip, dict) else None

    return None


def _classify_highlight_content_format(
    video_ratio: str,
    vertical_poster_url: str,
    wide_poster_url: str,
) -> str:
    """Classify an ESPN clip as a reel-like vertical asset or a standard video."""
    ratio_text = (video_ratio or "").strip().lower()

    if "vertical" in ratio_text or "portrait" in ratio_text:
        return "REEL"

    ratio_match = _re.search(r"(\d+(?:\.\d+)?)\s*[:/x]\s*(\d+(?:\.\d+)?)", ratio_text)
    if ratio_match:
        width = float(ratio_match.group(1))
        height = float(ratio_match.group(2))
        if height > 0 and (width / height) < 0.92:
            return "REEL"

    if vertical_poster_url and not wide_poster_url:
        return "REEL"

    return "VIDEO"


def _build_highlight_payload(
    *,
    highlight_id: str,
    league_label: str,
    title: str,
    description: str,
    source: str,
    published_at: str,
    duration_seconds: int,
    poster_url: str = "",
    wide_poster_url: str = "",
    square_poster_url: str = "",
    vertical_poster_url: str = "",
    video_url: str = "",
    hls_url: str = "",
    video_variants: list[dict] | None = None,
    embed_url: str = "",
    page_url: str = "",
    story_url: str = "",
    type_label: str = "Latest Clip",
    popularity_score: float = 0.0,
    content_format: str = "VIDEO",
    team_tags: list[str] | None = None,
    event_id: str = "",
    video_ratio: str = "",
) -> dict:
    resolved_poster_url = _build_highlight_image_proxy_url(poster_url) or None
    resolved_wide_poster_url = _build_highlight_image_proxy_url(wide_poster_url or poster_url) or resolved_poster_url
    resolved_square_poster_url = _build_highlight_image_proxy_url(square_poster_url or poster_url) or resolved_poster_url
    resolved_vertical_poster_url = _build_highlight_image_proxy_url(vertical_poster_url or poster_url) or resolved_poster_url

    return {
        "id": highlight_id,
        "league": league_label,
        "title": title,
        "description": description,
        "source": source,
        "publishedAt": published_at,
        "publishedTs": _parse_sortable_timestamp(published_at),
        "durationSeconds": duration_seconds,
        "durationLabel": _format_duration_label(duration_seconds),
        "posterUrl": resolved_poster_url,
        "widePosterUrl": resolved_wide_poster_url,
        "squarePosterUrl": resolved_square_poster_url,
        "verticalPosterUrl": resolved_vertical_poster_url,
        "videoUrl": video_url or None,
        "hlsUrl": hls_url or None,
        "videoVariants": video_variants or [],
        "embedUrl": embed_url or None,
        "pageUrl": page_url or None,
        "storyUrl": story_url or None,
        "typeLabel": type_label,
        "popularityScore": popularity_score,
        "contentFormat": content_format,
        "teamTags": team_tags or [],
        "eventId": event_id or None,
        "videoRatio": video_ratio,
    }


def _normalize_espn_highlight_item(league_key: str, article: dict, detail_payload: dict) -> dict | None:
    """Turn ESPN article/video payloads into one frontend-friendly highlight card."""
    clip = _extract_video_clip_payload(detail_payload)
    if not clip:
        return None

    links = clip.get("links") or {}
    source_links = links.get("source") or {}
    mobile_links = links.get("mobile") or {}
    poster_images = clip.get("posterImages") or {}
    video_variants = _collect_progressive_highlight_variants(source_links, mobile_links)

    primary_progressive_url = str((video_variants[0] or {}).get("url") or "").strip() if video_variants else ""
    video_url = (
        primary_progressive_url
        or _extract_nested_href((source_links.get("mezzanine") if isinstance(source_links, dict) else ""))
        or _extract_nested_href((source_links.get("HD") if isinstance(source_links, dict) else ""))
        or _extract_nested_href((source_links.get("full") if isinstance(source_links, dict) else ""))
        or _extract_nested_href((source_links.get("href") if isinstance(source_links, dict) else ""))
        or _extract_nested_href((mobile_links.get("source") if isinstance(mobile_links, dict) else ""))
    )
    if video_url.endswith(".m3u8"):
        video_url = ""

    hls_url = ""
    if isinstance(source_links, dict):
        hls_url = _extract_nested_href(source_links.get("HLS"))

    if not video_url and not hls_url:
        return None

    base_poster_url = (
        _extract_nested_href((poster_images.get("default") if isinstance(poster_images, dict) else ""))
        or _extract_nested_href((poster_images.get("full") if isinstance(poster_images, dict) else ""))
        or _clean_news_text(str(clip.get("thumbnail") or ""))
        or _extract_article_image(article)
        or ""
    )
    base_wide_poster_url = (
        _extract_nested_href((poster_images.get("wide") if isinstance(poster_images, dict) else ""))
        or _extract_nested_href((poster_images.get("full") if isinstance(poster_images, dict) else ""))
        or base_poster_url
    )
    base_square_poster_url = (
        _extract_nested_href((poster_images.get("square") if isinstance(poster_images, dict) else ""))
        or base_poster_url
    )
    base_vertical_poster_url = (
        _extract_nested_href((poster_images.get("vertical") if isinstance(poster_images, dict) else ""))
        or _extract_nested_href((poster_images.get("verticalFirstFrame") if isinstance(poster_images, dict) else ""))
        or base_poster_url
    )
    poster_url = _upgrade_espn_highlight_image(base_poster_url, 1280, 720) or base_poster_url
    wide_poster_url = _upgrade_espn_highlight_image(base_wide_poster_url, 1920, 1080) or base_wide_poster_url
    square_poster_url = _upgrade_espn_highlight_image(base_square_poster_url, 1080, 1080) or base_square_poster_url
    vertical_poster_url = _upgrade_espn_highlight_image(base_vertical_poster_url, 1080, 1920) or base_vertical_poster_url

    published_at = (
        _clean_news_text(str(clip.get("originalPublishDate") or ""))
        or _clean_news_text(str(clip.get("published") or ""))
        or _clean_news_text(str(clip.get("lastModified") or ""))
        or _clean_news_text(str(article.get("published") or ""))
    )
    title = _clean_news_text(
        str(clip.get("headline") or clip.get("title") or article.get("headline") or article.get("title") or "")
    )
    description = _clean_news_text(
        str(clip.get("description") or clip.get("caption") or article.get("description") or "")
    )
    event_id = str(clip.get("gameId") or _extract_article_event_id(article) or "").strip()
    highlight_id = str(clip.get("id") or article.get("id") or article.get("dataSourceIdentifier") or "").strip()
    page_url = (
        _extract_nested_href((links.get("web") if isinstance(links, dict) else ""))
        or _clean_news_text(str(((article.get("links") or {}).get("web") or {}).get("href") or ""))
    )
    story_url = _clean_news_text(str(((article.get("links") or {}).get("web") or {}).get("href") or ""))
    team_tags = _resolve_espn_highlight_team_tags(
        article,
        title=title,
        description=description,
        page_url=page_url,
        story_url=story_url,
        event_id=event_id,
    )
    league_label = str(article.get("league") or league_key or "").upper().strip()

    if not title or not highlight_id or not league_label:
        return None

    type_label = _classify_highlight_title(title)
    video_ratio = _clean_news_text(str(clip.get("videoRatio") or ""))
    duration_seconds = _parse_duration_seconds(clip.get("duration"))
    popularity_score = _calculate_highlight_popularity_score(
        title=title,
        type_label=type_label,
        published_at=published_at,
        duration_seconds=duration_seconds,
        team_tags=team_tags,
        event_id=event_id,
    )
    content_format = _classify_highlight_content_format(
        video_ratio=video_ratio,
        vertical_poster_url=vertical_poster_url,
        wide_poster_url=wide_poster_url,
    )

    return _build_highlight_payload(
        highlight_id=highlight_id,
        league_label=league_label,
        title=title,
        description=description,
        source="ESPN",
        published_at=published_at,
        duration_seconds=duration_seconds,
        poster_url=poster_url,
        wide_poster_url=wide_poster_url,
        square_poster_url=square_poster_url,
        vertical_poster_url=vertical_poster_url,
        video_url=video_url,
        hls_url=hls_url,
        video_variants=video_variants,
        page_url=page_url,
        story_url=story_url,
        type_label=type_label,
        popularity_score=popularity_score,
        content_format=content_format,
        team_tags=team_tags,
        event_id=event_id,
        video_ratio=video_ratio,
    )


def _build_event_video_article(event: dict, league_key: str) -> dict:
    """Create an article-like wrapper so event video clips normalize cleanly."""
    competition = ((event or {}).get("competitions") or [None])[0] or {}
    competitors = [team for team in (competition.get("competitors") or []) if isinstance(team, dict)]
    categories: list[dict] = []
    for competitor in competitors:
        team_blob = competitor.get("team") or {}
        team_name = _clean_news_text(str(team_blob.get("displayName") or team_blob.get("shortDisplayName") or ""))
        if team_name:
            categories.append({"type": "team", "description": team_name})

    event_id = str((event or {}).get("id") or "").strip()
    if event_id:
        categories.append({"type": "event", "eventId": event_id})

    links = (event or {}).get("links") or []
    event_url = ""
    if isinstance(links, list):
        for link in links:
            if not isinstance(link, dict):
                continue
            href = _clean_news_text(str(link.get("href") or ""))
            if href:
                event_url = href
                break

    return {
        "id": event_id,
        "headline": _clean_news_text(str((event or {}).get("name") or (event or {}).get("shortName") or "")),
        "description": _clean_news_text(str((event or {}).get("shortName") or (event or {}).get("name") or "")),
        "league": league_key,
        "published": _clean_news_text(str((event or {}).get("date") or "")),
        "categories": categories,
        "links": {"web": {"href": event_url}},
    }


def _extract_mlb_image_url(image_blob: dict) -> str:
    cuts = image_blob.get("cuts") or []
    if not isinstance(cuts, list):
        return ""

    ranked_cuts: list[tuple[int, str]] = []
    for cut in cuts:
        if not isinstance(cut, dict):
            continue
        src = _clean_news_text(str(cut.get("src") or cut.get("url") or ""))
        if not src:
            continue
        try:
            width = int(cut.get("width") or 0)
        except (TypeError, ValueError):
            width = 0
        ranked_cuts.append((width, src))

    ranked_cuts.sort(key=lambda item: item[0], reverse=True)
    return ranked_cuts[0][1] if ranked_cuts else ""


def _pick_mlb_playback_urls(playbacks: list[dict] | None) -> tuple[str, str]:
    video_candidates: list[tuple[int, str]] = []
    hls_url = ""

    for playback in playbacks or []:
        if not isinstance(playback, dict):
            continue
        url = _clean_news_text(str(playback.get("url") or ""))
        if not url:
            continue

        name = _clean_news_text(str(playback.get("name") or "")).lower()
        if ".m3u8" in url and not hls_url:
            hls_url = url

        if ".mp4" in url:
            priority = 0
            if "mp4avc" in name:
                priority = 4
            elif "highbit" in name:
                priority = 3
            elif "1280x720" in url:
                priority = 2
            video_candidates.append((priority, url))

    video_candidates.sort(key=lambda item: item[0], reverse=True)
    video_url = video_candidates[0][1] if video_candidates else ""
    return video_url, hls_url


def _normalize_mlb_highlight_item(game: dict, clip: dict) -> dict | None:
    highlight_id = _clean_news_text(str(clip.get("id") or clip.get("mediaPlaybackId") or ""))
    title = _clean_news_text(str(clip.get("headline") or clip.get("title") or ""))
    if not highlight_id or not title:
        return None

    teams = game.get("teams") or {}
    team_tags = []
    for side in ("away", "home"):
        team_blob = ((teams.get(side) or {}).get("team") or {})
        team_name = _clean_news_text(str(team_blob.get("name") or ""))
        if team_name:
            team_tags.append(team_name)
    team_tags = [team for team in team_tags if team]
    event_id = _clean_news_text(str(game.get("gamePk") or ""))
    published_at = _clean_news_text(str(clip.get("date") or game.get("gameDate") or game.get("officialDate") or ""))
    description = _clean_news_text(str(clip.get("description") or clip.get("blurb") or title))
    duration_seconds = _parse_duration_seconds(clip.get("duration"))
    video_url, hls_url = _pick_mlb_playback_urls(clip.get("playbacks") or [])
    if not video_url and not hls_url:
        return None

    poster_url = _extract_mlb_image_url(clip.get("image") or {})
    slug = _clean_news_text(str(clip.get("slug") or ""))
    page_url = f"https://www.mlb.com/video/{slug}" if slug else ""
    type_label = _classify_highlight_title(title)
    popularity_score = _calculate_highlight_popularity_score(
        title=title,
        type_label=type_label,
        published_at=published_at,
        duration_seconds=duration_seconds,
        team_tags=team_tags,
        event_id=event_id,
    )

    return _build_highlight_payload(
        highlight_id=highlight_id,
        league_label="MLB",
        title=title,
        description=description,
        source="MLB",
        published_at=published_at,
        duration_seconds=duration_seconds,
        poster_url=poster_url,
        wide_poster_url=poster_url,
        square_poster_url=poster_url,
        vertical_poster_url=poster_url,
        video_url=video_url,
        hls_url=hls_url,
        page_url=page_url,
        story_url=page_url,
        type_label=type_label,
        popularity_score=popularity_score,
        content_format="VIDEO",
        team_tags=team_tags,
        event_id=event_id,
        video_ratio="16:9",
    )


def _format_nhl_team_name(team_blob: dict) -> str:
    place_name = _clean_news_text(str(((team_blob.get("placeName") or {}).get("default") or "")))
    common_name = _clean_news_text(str(((team_blob.get("commonName") or {}).get("default") or "")))
    short_name = _clean_news_text(str(((team_blob.get("name") or {}).get("default") or "")))
    abbrev = _clean_news_text(str(team_blob.get("abbrev") or ""))

    if place_name and common_name:
        return f"{place_name} {common_name}"
    if place_name and short_name:
        return f"{place_name} {short_name}"
    return place_name or common_name or short_name or abbrev


def _normalize_nhl_highlight_item(
    *,
    page_url: str,
    page_html: str,
    fallback_title: str,
    fallback_description: str,
    published_at: str,
    duration_seconds: int,
    team_tags: list[str],
    event_id: str,
    video_id: str,
    type_label: str,
) -> dict | None:
    clean_page_url = _clean_news_text(page_url)
    clean_video_id = _clean_news_text(video_id)
    if not clean_page_url or not clean_video_id:
        return None

    embed_url = _build_nhl_brightcove_embed_url(page_html, clean_video_id)
    if not embed_url:
        return None

    poster_url = (
        _extract_meta_content(page_html, "og:image")
        or _extract_meta_content(page_html, "twitter:image")
        or ""
    )
    title = _clean_news_text(
        _extract_meta_content(page_html, "og:title")
        or fallback_title
    )
    description = _clean_news_text(
        _extract_meta_content(page_html, "og:description")
        or fallback_description
        or title
    )
    highlight_id = clean_video_id
    popularity_score = _calculate_highlight_popularity_score(
        title=title,
        type_label=type_label,
        published_at=published_at,
        duration_seconds=duration_seconds,
        team_tags=team_tags,
        event_id=event_id,
    )

    return _build_highlight_payload(
        highlight_id=highlight_id,
        league_label="NHL",
        title=title,
        description=description,
        source="NHL",
        published_at=published_at,
        duration_seconds=duration_seconds,
        poster_url=poster_url,
        wide_poster_url=poster_url,
        square_poster_url=poster_url,
        vertical_poster_url=poster_url,
        embed_url=embed_url,
        page_url=clean_page_url,
        story_url=clean_page_url,
        type_label=type_label,
        popularity_score=popularity_score,
        content_format="VIDEO",
        team_tags=team_tags,
        event_id=event_id,
        video_ratio="16:9",
    )


def _parse_scorebat_team_tags(title: str) -> list[str]:
    clean_title = _clean_news_text(title)
    if not clean_title:
        return []

    for separator in (" - ", " vs ", " vs. "):
        if separator in clean_title:
            parts = [part.strip() for part in clean_title.split(separator, 1)]
            return [part for part in parts if part]

    return [clean_title]


async def _load_epl_team_keyset() -> set[str]:
    data = await _fetch_cached(FPL_BOOTSTRAP_URL, timeout=10.0)
    if not isinstance(data, dict):
        return set()

    keys: set[str] = set()
    for team in data.get("teams", []) or []:
        if not isinstance(team, dict):
            continue
        for raw_name in (team.get("name", ""), team.get("short_name", "")):
            keys.update(_candidate_team_keys(str(raw_name)))
    return keys


def _is_scorebat_epl_related(item: dict, epl_team_keys: set[str]) -> bool:
    competition = _clean_news_text(str(item.get("competition") or "")).lower()
    if "premier league" in competition or "england" in competition:
        return True

    title = _clean_news_text(str(item.get("title") or ""))
    team_tags = _parse_scorebat_team_tags(title)
    scorebat_keys: set[str] = set()
    for team_name in team_tags:
        scorebat_keys.update(_candidate_team_keys(team_name))

    return bool(scorebat_keys and not scorebat_keys.isdisjoint(epl_team_keys))


def _normalize_scorebat_highlight_item(item: dict) -> dict | None:
    title = _clean_news_text(str(item.get("title") or ""))
    if not title:
        return None

    videos = item.get("videos") or []
    if not isinstance(videos, list) or not videos:
        return None

    first_video = videos[0] if isinstance(videos[0], dict) else {}
    highlight_id = _clean_news_text(str(first_video.get("id") or ""))
    embed_url = _extract_iframe_src(str(first_video.get("embed") or ""))
    if not highlight_id or not embed_url:
        return None

    competition = _clean_news_text(str(item.get("competition") or ""))
    page_url = _clean_news_text(str(item.get("matchviewUrl") or ""))
    story_url = _clean_news_text(str(item.get("competitionUrl") or ""))
    published_at = _clean_news_text(str(item.get("date") or ""))
    duration_seconds = 0
    type_label = _classify_highlight_title(_clean_news_text(str(first_video.get("title") or "Highlights")))
    team_tags = _parse_scorebat_team_tags(title)
    popularity_score = _calculate_highlight_popularity_score(
        title=title,
        type_label=type_label,
        published_at=published_at,
        duration_seconds=duration_seconds,
        team_tags=team_tags,
        event_id="",
    )

    return _build_highlight_payload(
        highlight_id=highlight_id,
        league_label="EPL",
        title=title,
        description=competition or title,
        source="ScoreBat",
        published_at=published_at,
        duration_seconds=duration_seconds,
        poster_url=_clean_news_text(str(item.get("thumbnail") or "")),
        wide_poster_url=_clean_news_text(str(item.get("thumbnail") or "")),
        square_poster_url=_clean_news_text(str(item.get("thumbnail") or "")),
        vertical_poster_url=_clean_news_text(str(item.get("thumbnail") or "")),
        embed_url=embed_url,
        page_url=page_url,
        story_url=story_url,
        type_label=type_label,
        popularity_score=popularity_score,
        content_format="VIDEO",
        team_tags=team_tags,
        event_id="",
        video_ratio="16:9",
    )


async def _fetch_mlb_official_highlights(target_dates: list[str]) -> list[dict]:
    games: list[dict] = []
    schedule_urls = [
        f"https://statsapi.mlb.com/api/v1/schedule?sportId=1&date={target_date}"
        for target_date in target_dates
        if target_date
    ]
    if not schedule_urls:
        return []

    schedule_payloads = await asyncio.gather(
        *[_fetch_cached(url, timeout=10.0) for url in schedule_urls]
    )
    for payload in schedule_payloads:
        if not isinstance(payload, dict):
            continue
        for date_block in payload.get("dates", []) or []:
            if not isinstance(date_block, dict):
                continue
            for game in date_block.get("games", []) or []:
                if isinstance(game, dict):
                    games.append(game)

    if not games:
        return []

    games.sort(key=lambda game: str(game.get("gameDate") or ""), reverse=True)
    selected_games = games[:18]
    content_payloads = await asyncio.gather(
        *[
            _fetch_cached(
                f"https://statsapi.mlb.com/api/v1/game/{game.get('gamePk')}/content",
                timeout=10.0,
            )
            for game in selected_games
            if game.get("gamePk")
        ]
    )

    highlights: list[dict] = []
    seen_ids: set[str] = set()
    for game, payload in zip(selected_games, content_payloads):
        if not isinstance(payload, dict):
            continue
        items = (((payload.get("highlights") or {}).get("highlights") or {}).get("items") or [])
        for clip in items[:10]:
            if not isinstance(clip, dict):
                continue
            normalized = _normalize_mlb_highlight_item(game, clip)
            if not normalized:
                continue
            item_id = str(normalized.get("id") or "")
            if not item_id or item_id in seen_ids:
                continue
            seen_ids.add(item_id)
            highlights.append(normalized)

    return highlights


async def _fetch_nhl_official_highlights(target_date: str) -> list[dict]:
    if not target_date:
        return []

    score_payload = await _fetch_cached(f"https://api-web.nhle.com/v1/score/{target_date}", timeout=10.0)
    if not isinstance(score_payload, dict):
        return []

    raw_games = [
        game for game in (score_payload.get("games") or [])
        if isinstance(game, dict)
        and (
            str(game.get("threeMinRecap") or "").strip()
            or str(game.get("condensedGame") or "").strip()
            or bool(game.get("goals"))
        )
    ]
    if not raw_games:
        return []

    raw_games.sort(key=lambda game: str(game.get("startTimeUTC") or ""), reverse=True)
    selected_games = raw_games[:12]

    landing_payloads = await asyncio.gather(
        *[
            _fetch_cached(
                f"https://api-web.nhle.com/v1/gamecenter/{game.get('id')}/landing",
                timeout=10.0,
            )
            for game in selected_games
            if game.get("id")
        ]
    )

    request_specs: list[dict] = []
    page_requests: list[object] = []

    for score_game, landing_payload in zip(selected_games, landing_payloads):
        if not isinstance(landing_payload, dict):
            continue

        away_team = landing_payload.get("awayTeam") or score_game.get("awayTeam") or {}
        home_team = landing_payload.get("homeTeam") or score_game.get("homeTeam") or {}
        team_tags = [
            team_name
            for team_name in (
                _format_nhl_team_name(away_team),
                _format_nhl_team_name(home_team),
            )
            if team_name
        ]
        event_id = _clean_news_text(str(score_game.get("id") or landing_payload.get("id") or ""))
        published_at = _clean_news_text(
            str(score_game.get("startTimeUTC") or landing_payload.get("startTimeUTC") or target_date)
        )

        for page_key, type_label in (("threeMinRecap", "Recap"), ("condensedGame", "Game Highlights")):
            raw_path = _clean_news_text(str(score_game.get(page_key) or ""))
            if not raw_path:
                continue
            page_url = raw_path if raw_path.startswith("http") else f"https://www.nhl.com{raw_path}"
            video_match = _re.search(r"-(\d+)$", page_url)
            video_id = video_match.group(1) if video_match else ""
            request_specs.append(
                {
                    "page_url": page_url,
                    "fallback_title": f"{team_tags[0] if team_tags else 'NHL'} at {team_tags[1] if len(team_tags) > 1 else 'NHL'} {type_label}".strip(),
                    "fallback_description": f"{type_label} from {team_tags[0] if team_tags else 'the game'}",
                    "published_at": published_at,
                    "duration_seconds": 0,
                    "team_tags": team_tags,
                    "event_id": event_id,
                    "video_id": video_id,
                    "type_label": type_label,
                }
            )
            page_requests.append(_fetch_text_cached(page_url, timeout=10.0))

        scoring_periods = ((landing_payload.get("summary") or {}).get("scoring") or [])
        goal_events: list[dict] = []
        for period in scoring_periods:
            if not isinstance(period, dict):
                continue
            for goal in period.get("goals", []) or []:
                if isinstance(goal, dict):
                    goal_events.append(goal)

        for goal in goal_events[-4:]:
            page_url = _clean_news_text(str(goal.get("highlightClipSharingUrl") or ""))
            video_id = _clean_news_text(str(goal.get("highlightClip") or ""))
            if not page_url or not video_id:
                continue

            scorer_name = _clean_news_text(str(((goal.get("firstName") or {}).get("default") or "")))
            scorer_last = _clean_news_text(str(((goal.get("lastName") or {}).get("default") or "")))
            scorer_display = f"{scorer_name} {scorer_last}".strip()
            request_specs.append(
                {
                    "page_url": page_url,
                    "fallback_title": f"{scorer_display or 'NHL goal'} | NHL.com",
                    "fallback_description": f"{scorer_display or 'A skater'} scored for {goal.get('teamAbbrev') or 'NHL'}.",
                    "published_at": published_at,
                    "duration_seconds": 0,
                    "team_tags": team_tags,
                    "event_id": event_id,
                    "video_id": video_id,
                    "type_label": "Latest Clip",
                }
            )
            page_requests.append(_fetch_text_cached(page_url, timeout=10.0))

    if not request_specs:
        return []

    page_html_payloads = await asyncio.gather(*page_requests)
    highlights: list[dict] = []
    seen_ids: set[str] = set()
    for spec, page_html in zip(request_specs, page_html_payloads):
        normalized = _normalize_nhl_highlight_item(
            page_url=spec["page_url"],
            page_html=page_html or "",
            fallback_title=spec["fallback_title"],
            fallback_description=spec["fallback_description"],
            published_at=spec["published_at"],
            duration_seconds=spec["duration_seconds"],
            team_tags=spec["team_tags"],
            event_id=spec["event_id"],
            video_id=spec["video_id"],
            type_label=spec["type_label"],
        )
        if not normalized:
            continue
        item_id = str(normalized.get("id") or "")
        if not item_id or item_id in seen_ids:
            continue
        seen_ids.add(item_id)
        highlights.append(normalized)

    return highlights


async def _fetch_scorebat_epl_highlights(limit: int = 16, target_date: str | None = None) -> list[dict]:
    payload = await _fetch_cached("https://www.scorebat.com/video-api/v3/", timeout=10.0)
    if not isinstance(payload, dict):
        return []

    response = payload.get("response") or []
    if not isinstance(response, list):
        return []

    epl_team_keys = await _load_epl_team_keyset()
    highlights: list[dict] = []
    seen_ids: set[str] = set()
    local_tz = datetime.now().astimezone().tzinfo or timezone.utc

    for item in response:
        if not isinstance(item, dict) or not _is_scorebat_epl_related(item, epl_team_keys):
            continue
        normalized = _normalize_scorebat_highlight_item(item)
        if not normalized:
            continue
        if target_date and not _highlight_matches_local_date(normalized, target_date, local_tz):
            continue
        item_id = str(normalized.get("id") or "")
        if not item_id or item_id in seen_ids:
            continue
        seen_ids.add(item_id)
        highlights.append(normalized)
        if len(highlights) >= limit:
            break

    return highlights


def _extract_meta_image(page_html: str) -> str | None:
    """Pull a best-effort preview image from an article HTML page."""
    if not page_html:
        return None

    patterns = (
        r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']',
        r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image["\']',
        r'<meta[^>]+name=["\']twitter:image["\'][^>]+content=["\']([^"\']+)["\']',
        r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+name=["\']twitter:image["\']',
    )
    for pattern in patterns:
        match = _re.search(pattern, page_html, _re.IGNORECASE)
        if match:
            image_url = match.group(1).strip()
            if image_url:
                return html.unescape(image_url)
    return None


async def _resolve_rss_image(
    source_name: str,
    link: str,
    item_el,
    description: str,
) -> str | None:
    """Resolve a thumbnail for RSS items with a Yahoo-specific article fallback."""
    image_url = _extract_rss_image(item_el, description)
    if image_url:
        return image_url

    source_key = (source_name or "").lower()
    if "yahoo" not in source_key or not link:
        return None

    article_html = await _fetch_text_cached(link, timeout=6.0)
    return _extract_meta_image(article_html or "")


_TEAM_NAME_PATTERN = _re.compile(
    r'<span class="hide-mobile"><a [^>]*>([^<]+)</a></span>'
)
_SUBGROUP_PATTERN = _re.compile(
    r'<tr class="subgroup-headers[^"]*"[^>]*>.*?<span[^>]*>([^<]+)</span>.*?</tr>([\s\S]*?)(?=<tr class="subgroup-headers|</tbody>)',
    _re.IGNORECASE,
)
_TABLE_TITLE_PATTERN = _re.compile(
    r'<div class="Table__Title">([^<]+)</div>[\s\S]*?<tbody class="Table__TBODY">([\s\S]*?)</tbody>',
    _re.IGNORECASE,
)

STANDINGS_PAGE_URLS = {
    "NFL": "https://www.espn.com/nfl/standings",
    "NBA": "https://www.espn.com/nba/standings",
    "MLB": "https://www.espn.com/mlb/standings",
    "NHL": "https://www.espn.com/nhl/standings",
    "EPL": "https://www.espn.com/soccer/standings/_/league/eng.1",
}

TEAM_SEARCH_LEAGUES = {
    "NFL": "NFL",
    "NBA": "NBA",
    "MLB": "MLB",
    "NHL": "NHL",
    "EPL": "English Premier League",
}

FPL_BOOTSTRAP_URL = "https://fantasy.premierleague.com/api/bootstrap-static/"
_EPL_TEAM_ALIAS_MAP = {
    "wolverhamptonwanderers": {"wolves"},
    "tottenhamhotspur": {"spurs", "tottenham"},
    "manchestercity": {"mancity"},
    "manchesterunited": {"manutd", "manchesterutd", "manunited"},
    "newcastleunited": {"newcastle"},
    "brightonandhovealbion": {"brighton"},
    "westhamunited": {"westham"},
    "ipswichtown": {"ipswich"},
    "afcbournemouth": {"bournemouth"},
    "nottinghamforest": {"nottmforest", "forest"},
    "leicestercity": {"leicester"},
    "crystalpalace": {"palace"},
}


def _normalize_team_name(value: str) -> str:
    """Normalize team names so different APIs can be matched consistently."""
    normalized = html.unescape(value or "").lower().replace("&", "and")
    return _re.sub(r"[^a-z0-9]+", "", normalized)


def _normalize_person_lookup(value: str) -> str:
    return _normalize_team_name(_strip_diacritics(_clean_person_name(value)))


def _candidate_team_keys(value: str) -> set[str]:
    normalized = _normalize_person_lookup(value)
    if not normalized:
        return set()
    aliases = {normalized}
    for canonical, extras in _EPL_TEAM_ALIAS_MAP.items():
        if normalized == canonical or normalized in extras:
            aliases.add(canonical)
            aliases.update(extras)
    return aliases


def _resolve_league_key(league: str) -> str | None:
    """Resolve either a league key or a display name into our internal key."""
    candidate = (league or "").strip()
    if not candidate:
        return None

    upper = candidate.upper()
    if upper in LEAGUES:
        return upper

    lower = candidate.lower()
    for key, name in TEAM_SEARCH_LEAGUES.items():
        if lower == name.lower():
            return key

    return None


def _activity_cache_scope(league: str | None) -> str:
    """Return the disk-cache scope for an activity request."""
    return league.upper() if league and league.upper() in LEAGUES else "ALL"


def _activity_cache_file(target_date: str, league: str | None) -> Path:
    """Resolve the canonical cache file path for an activity payload."""
    return ACTIVITY_CACHE_DIR / f"activity_{ACTIVITY_CACHE_VERSION}_{target_date}_{_activity_cache_scope(league)}.json"


def _activity_cache_candidates(target_date: str, league: str | None) -> list[Path]:
    """Return canonical cache file locations for the current cache version."""
    return [_activity_cache_file(target_date, league)]


def _activity_boundary_rank(play: dict) -> int:
    text = str(play.get("text", "")).lower()
    play_type = str(play.get("playType", "")).lower()
    combined = f"{play_type} {text}"
    if "start of" in combined or "period start" in combined or "quarter start" in combined or "half begins" in combined:
        return 0
    if (
        "end of" in combined
        or "period end" in combined
        or "quarter end" in combined
        or "half ends" in combined
        or "game end" in combined
        or "match ends" in combined
    ):
        return 2
    return 1


def _activity_sequence_value(play: dict) -> int:
    sequence_number = str(play.get("sequenceNumber", "")).strip()
    if sequence_number:
        try:
            return int(sequence_number)
        except ValueError:
            pass

    play_id = str(play.get("id", ""))
    match = _re.search(r"_(\d+)$", play_id)
    if match:
        try:
            return int(match.group(1))
        except ValueError:
            return 0
    return 0


def _activity_status_rank(play: dict) -> int:
    status = str(play.get("status", "")).strip().lower()
    if status == "live":
        return 2
    if status == "final":
        return 1
    return 0


def _activity_recency_rank(play: dict) -> tuple[int, float]:
    league = str(play.get("league", "")).upper()
    detail = str(play.get("statusDetail", "")).strip().upper()
    text = str(play.get("text", "")).strip().lower()
    play_type = str(play.get("playType", "")).strip().lower()
    combined = f"{play_type} {text}"

    if league in {"NBA", "NFL", "MLB"}:
        ot_match = _re.search(r"\bOT(\d+)\s+(\d+):(\d+(?:\.\d+)?)", detail)
        if ot_match:
            period = 10 + int(ot_match.group(1))
            seconds = float(ot_match.group(2)) * 60 + float(ot_match.group(3))
            return (period, -seconds)

        ot_seconds_only_match = _re.search(r"\bOT(\d+)\s+(\d+(?:\.\d+)?)", detail)
        if ot_seconds_only_match:
            period = 10 + int(ot_seconds_only_match.group(1))
            seconds = float(ot_seconds_only_match.group(2))
            return (period, -seconds)

        period_match = _re.search(r"\b(?:P|Q)(\d+)\s+(\d+):(\d+(?:\.\d+)?)", detail)
        if period_match:
            period = int(period_match.group(1))
            seconds = float(period_match.group(2)) * 60 + float(period_match.group(3))
            return (period, -seconds)

        period_seconds_only_match = _re.search(r"\b(?:P|Q)(\d+)\s+(\d+(?:\.\d+)?)", detail)
        if period_seconds_only_match:
            period = int(period_seconds_only_match.group(1))
            seconds = float(period_seconds_only_match.group(2))
            return (period, -seconds)

    if league == "NHL":
        ot_match = _re.search(r"\bOT(\d+)\s+(\d+):(\d+(?:\.\d+)?)", detail)
        if ot_match:
            period = 10 + int(ot_match.group(1))
            seconds = float(ot_match.group(2)) * 60 + float(ot_match.group(3))
            return (period, seconds)

        ot_seconds_only_match = _re.search(r"\bOT(\d+)\s+(\d+(?:\.\d+)?)", detail)
        if ot_seconds_only_match:
            period = 10 + int(ot_seconds_only_match.group(1))
            seconds = float(ot_seconds_only_match.group(2))
            return (period, seconds)

        period_match = _re.search(r"\bP(\d+)\s+(\d+):(\d+(?:\.\d+)?)", detail)
        if period_match:
            period = int(period_match.group(1))
            seconds = float(period_match.group(2)) * 60 + float(period_match.group(3))
            return (period, seconds)

        period_seconds_only_match = _re.search(r"\bP(\d+)\s+(\d+(?:\.\d+)?)", detail)
        if period_seconds_only_match:
            period = int(period_seconds_only_match.group(1))
            seconds = float(period_seconds_only_match.group(2))
            return (period, seconds)

    if league == "EPL":
        if "match ends" in combined or "game end" in combined:
            return (99, 999.0)
        if "second half ends" in combined:
            return (2, 999.0)
        if "first half ends" in combined:
            return (1, 999.0)
        if "second half begins" in combined:
            return (2, 45.0)
        if "first half begins" in combined:
            return (1, 0.0)
        soccer_match = _re.search(r"(?:(\d)H\s+)?(\d+)(?:\+(\d+))?'", detail)
        if soccer_match:
            half = int(soccer_match.group(1) or 1)
            minute = int(soccer_match.group(2))
            stoppage = int(soccer_match.group(3) or 0)
            return (half, float(minute + stoppage / 100.0))

    return (0, 0.0)


def _activity_sort_key(play: dict) -> tuple[int, str, int, float, int, int, int]:
    status_rank = _activity_status_rank(play)
    wallclock = str(play.get("_wallclock") or play.get("wallclock") or "")
    period_rank, progress_rank = _activity_recency_rank(play)
    boundary_rank = _activity_boundary_rank(play)
    sequence = _activity_sequence_value(play)
    score_value = int(play.get("scoreValue", 0) or 0)
    return (
        status_rank,
        wallclock,
        period_rank,
        boundary_rank,
        progress_rank,
        score_value,
        sequence,
    )


def _compare_activities_for_display(left: dict, right: dict) -> int:
    left_game = str(left.get("gameId") or left.get("id") or "")
    right_game = str(right.get("gameId") or right.get("id") or "")
    left_wallclock = str(left.get("_wallclock") or left.get("sortWallclock") or left.get("wallclock") or "")
    right_wallclock = str(right.get("_wallclock") or right.get("sortWallclock") or right.get("wallclock") or "")

    # If ESPN gives us true wallclock timestamps, treat the feed like a real
    # global ticker across every active game: newest actual play first,
    # regardless of which game thread it came from.
    if left_wallclock and right_wallclock and left_wallclock != right_wallclock:
        return -1 if left_wallclock > right_wallclock else 1

    if left_game and left_game == right_game:
        left_period, left_progress = _activity_recency_rank(left)
        right_period, right_progress = _activity_recency_rank(right)
        if left_period != right_period:
            return -1 if left_period > right_period else 1

        left_boundary = _activity_boundary_rank(left)
        right_boundary = _activity_boundary_rank(right)
        if left_boundary != right_boundary:
            return -1 if left_boundary > right_boundary else 1

        if left_progress != right_progress:
            return -1 if left_progress > right_progress else 1

        left_sequence = _activity_sequence_value(left)
        right_sequence = _activity_sequence_value(right)
        if left_sequence != right_sequence:
            return -1 if left_sequence > right_sequence else 1
        return 0

    left_status = _activity_status_rank(left)
    right_status = _activity_status_rank(right)
    if left_status != right_status:
        return -1 if left_status > right_status else 1

    left_key = _activity_sort_key(left)
    right_key = _activity_sort_key(right)
    if left_key > right_key:
        return -1
    if left_key < right_key:
        return 1
    return 0


def _strip_activity_fields(play: dict) -> dict:
    stripped = {
        key: value
        for key, value in play.items()
        if key not in {"sequenceNumber", "_wallclock", "scoringPlay", "scoreValue"}
    }
    stripped["sortWallclock"] = str(play.get("_wallclock") or play.get("sortWallclock") or "")
    return stripped


def _normalize_cached_activity_payload(payload: list[dict]) -> list[dict]:
    return sorted(payload, key=cmp_to_key(_compare_activities_for_display))


def _parse_soccer_score_snapshot(text: str, home_team: str, away_team: str) -> tuple[int | None, int | None]:
    clean_text = str(text or "").strip()
    clean_home = str(home_team or "").strip()
    clean_away = str(away_team or "").strip()
    if not clean_text or not clean_home or not clean_away:
        return (None, None)

    match = _re.search(
        rf"{_re.escape(clean_home)}\s+(\d+),\s+{_re.escape(clean_away)}\s+(\d+)",
        clean_text,
        _re.IGNORECASE,
    )
    if not match:
        return (None, None)

    try:
        return (int(match.group(1)), int(match.group(2)))
    except ValueError:
        return (None, None)


def _load_cached_activity_payload(target_date: str, league: str | None) -> list[dict] | None:
    """Load cached activity data from the current cache version."""
    for cache_file in _activity_cache_candidates(target_date, league):
        if not cache_file.exists():
            continue
        try:
            with cache_file.open("r", encoding="utf-8") as handle:
                cached = _json.load(handle)
                if isinstance(cached, list):
                    return _normalize_cached_activity_payload(cached)
                return cached
        except Exception:
            continue
    return None


def _latest_cached_activity_date(league: str | None) -> str | None:
    """Find the newest cached activity date for a league by scanning disk."""
    scope = _activity_cache_scope(league)
    today = datetime.now().strftime("%Y%m%d")
    seen_dates: set[str] = set()

    if not ACTIVITY_CACHE_DIR.exists():
        return None

    for cache_file in sorted(ACTIVITY_CACHE_DIR.glob(f"activity_{ACTIVITY_CACHE_VERSION}_*_{scope}.json"), reverse=True):
        match = _re.match(
            rf"^activity_{ACTIVITY_CACHE_VERSION}_(?P<date>\d{{8}})_{scope}$",
            cache_file.stem,
            _re.IGNORECASE,
        )
        if not match:
            continue

        candidate = match.group("date")
        if len(candidate) != 8 or not candidate.isdigit() or candidate >= today or candidate in seen_dates:
            continue

        seen_dates.add(candidate)
        try:
            with cache_file.open("r", encoding="utf-8") as handle:
                cached = _json.load(handle)
        except Exception:
            continue

        if isinstance(cached, list) and cached:
            return candidate

    return None


def _extract_team_groups_from_html(html_text: str, league_key: str) -> list[dict]:
    """Parse standings page HTML into group -> team-name mappings."""
    pattern = _TABLE_TITLE_PATTERN if league_key == "NBA" else _SUBGROUP_PATTERN
    groups: list[dict] = []
    seen: set[str] = set()

    for raw_name, block in pattern.findall(html_text):
        group_name = html.unescape(raw_name).strip()
        if not group_name or group_name in seen:
            continue

        team_names = []
        for raw_team_name in _TEAM_NAME_PATTERN.findall(block):
            team_name = html.unescape(raw_team_name).strip()
            if team_name and team_name not in team_names:
                team_names.append(team_name)

        if not team_names:
            continue

        if league_key == "EPL":
            return []

        seen.add(group_name)
        groups.append({
            "name": group_name,
            "teams": team_names,
        })

    return groups


def _attach_team_ids_to_groups(groups: list[dict], teams: list[dict]) -> list[dict]:
    """Attach TheSportsDB team IDs/names to standings groups using normalized names."""
    if not teams:
        return [
            {
                "name": group["name"],
                "teams": group.get("teams", []),
                "teamIds": [],
            }
            for group in groups
        ]

    team_lookup: dict[str, dict] = {}
    for team in teams:
        if not isinstance(team, dict):
            continue

        team_name = str(team.get("strTeam", "")).strip()
        team_short_name = str(team.get("strTeamShort", "")).strip()
        team_id = str(team.get("idTeam", "")).strip()
        if not team_name or not team_id:
            continue

        for key in {_normalize_team_name(team_name), _normalize_team_name(team_short_name)}:
            if key and key not in team_lookup:
                team_lookup[key] = {
                    "id": team_id,
                    "name": team_name,
                }

    enriched_groups: list[dict] = []
    for group in groups:
        matched_names: list[str] = []
        matched_ids: list[str] = []
        seen_ids: set[str] = set()

        for raw_team_name in group.get("teams", []):
            normalized_name = _normalize_team_name(str(raw_team_name))
            match = team_lookup.get(normalized_name)

            if match is None and normalized_name:
                for key, candidate in team_lookup.items():
                    if normalized_name in key or key in normalized_name:
                        match = candidate
                        break

            if match is None:
                continue

            team_id = match["id"]
            if team_id in seen_ids:
                continue

            seen_ids.add(team_id)
            matched_ids.append(team_id)
            matched_names.append(match["name"])

        enriched_groups.append(
            {
                "name": group["name"],
                "teams": matched_names or group.get("teams", []),
                "teamIds": matched_ids,
            }
        )

    return enriched_groups


def _parse_espn_event(event: dict, league_key: str) -> dict:
    """Parse an ESPN event into our standard game format."""
    competition = event.get("competitions", [{}])[0]
    competitors = competition.get("competitors", [])

    def _extract_team_logo(team_data: dict) -> str:
        logo = str(team_data.get("logo", "") or "").strip()
        if logo:
            return logo

        logos = team_data.get("logos", []) or []
        for item in logos:
            if not isinstance(item, dict):
                continue
            rel = item.get("rel", []) or []
            href = str(item.get("href", "") or "").strip()
            if href and "scoreboard" in rel:
                return href

        for item in logos:
            if not isinstance(item, dict):
                continue
            href = str(item.get("href", "") or "").strip()
            if href:
                return href

        return ""

    def _extract_score(value) -> int:
        if isinstance(value, dict):
            display_value = str(value.get("displayValue", "") or "").strip()
            numeric_value = value.get("value")
            if display_value.lstrip("-").isdigit():
                return int(display_value)
            if isinstance(numeric_value, (int, float)):
                return int(numeric_value)
            return 0

        if isinstance(value, (int, float)):
            return int(value)

        text_value = str(value or "").strip()
        if text_value.lstrip("-").isdigit():
            return int(text_value)
        return 0

    home = {}
    away = {}
    for c in competitors:
        team_data = c.get("team", {})
        team_info = {
            "name": team_data.get("displayName", team_data.get("shortDisplayName", "")),
            "abbreviation": team_data.get("abbreviation", ""),
            "logo": _extract_team_logo(team_data),
            "color": team_data.get("color", ""),
            "score": c.get("score", "0"),
        }
        if c.get("homeAway") == "home":
            home = team_info
        else:
            away = team_info

    # Status
    status_obj = event.get("status", {}) or competition.get("status", {}) or {}
    status_type = status_obj.get("type", {})
    status_name = status_type.get("name", "")  # STATUS_SCHEDULED, STATUS_IN_PROGRESS, STATUS_FINAL
    status_detail = status_type.get("shortDetail", status_type.get("detail", ""))
    status_state = status_type.get("state", "")  # "pre", "in", "post"

    # Use ESPN's state field as primary (most reliable), fall back to name
    if status_state == "in" or status_name == "STATUS_IN_PROGRESS":
        status = "live"
    elif status_state == "post" or status_name in ("STATUS_FINAL", "STATUS_END"):
        status = "final"
    elif status_state == "pre" or status_name == "STATUS_SCHEDULED":
        status = "upcoming"
    else:
        # Fallback: check statusDetail for common indicators
        detail_lower = status_detail.lower()
        if "ft" in detail_lower or "final" in detail_lower or "end" in detail_lower:
            status = "final"
        elif "'" in status_detail or "half" in detail_lower or "ot" in detail_lower:
            status = "live"
        else:
            status = "upcoming"

    # Venue
    venue = competition.get("venue", {})
    venue_name = venue.get("fullName", "")

    # Headline from notes
    notes = competition.get("notes", [])
    headline = notes[0].get("headline", "") if notes else ""

    # Game time
    date_str = event.get("date", "")

    return {
        "id": event.get("id", ""),
        "homeTeam": home.get("name", ""),
        "awayTeam": away.get("name", ""),
        "homeAbbr": home.get("abbreviation", ""),
        "awayAbbr": away.get("abbreviation", ""),
        "homeScore": _extract_score(home.get("score", 0)),
        "awayScore": _extract_score(away.get("score", 0)),
        "homeBadge": home.get("logo", ""),
        "awayBadge": away.get("logo", ""),
        "homeColor": home.get("color", ""),
        "awayColor": away.get("color", ""),
        "status": status,
        "statusDetail": status_detail,
        "league": league_key,
        "dateEvent": date_str[:10] if len(date_str) >= 10 else date_str,
        "scheduledAt": date_str,
        "strTime": status_detail,
        "strEvent": f"{away.get('name', '')} at {home.get('name', '')}",
        "strVenue": venue_name,
        "headline": headline,
    }


def _parse_espn_event_as_news(event: dict, league_key: str) -> dict:
    """Turn an ESPN event into a news headline card."""
    parsed = _parse_espn_event(event, league_key)

    if parsed["status"] == "final":
        hs = parsed["homeScore"]
        aws = parsed["awayScore"]
        diff = abs(hs - aws)
        winner = parsed["homeTeam"] if hs > aws else parsed["awayTeam"]
        loser = parsed["awayTeam"] if hs > aws else parsed["homeTeam"]

        if diff <= 3:
            headline = f"Thriller: {winner} edges {loser} {max(hs,aws)}-{min(hs,aws)}"
        elif diff >= 20:
            headline = f"Blowout: {winner} dominates {loser} {max(hs,aws)}-{min(hs,aws)}"
        else:
            headline = f"{winner} defeats {loser} {max(hs,aws)}-{min(hs,aws)}"
    elif parsed["status"] == "live":
        headline = f"LIVE: {parsed['awayTeam']} at {parsed['homeTeam']} — {parsed['statusDetail']}"
    else:
        headline = f"Upcoming: {parsed['awayTeam']} at {parsed['homeTeam']}"

    return {
        "id": parsed["id"],
        "headline": headline,
        "source": league_key,
        "imageUrl": parsed["homeBadge"],
        "publishedAt": parsed["dateEvent"],
        "url": None,
        "league": league_key,
    }


def _parse_espn_event_as_activity(event: dict, league_key: str) -> dict:
    """Turn an ESPN event into a live activity feed item with player/team context."""
    parsed = _parse_espn_event(event, league_key)
    competition = event.get("competitions", [{}])[0]
    competitors = competition.get("competitors", [])

    # ── Build athlete lookup from leaders + roster ────────────────────
    # name → {id, headshot, teamName, teamAbbr, teamLogo, stats: {cat: val}}
    sport_type = LEAGUES.get(league_key, ("", "", 0))[0]
    athlete_lookup: dict[str, dict] = {}
    # Also build id → stats mapping for fallback
    athlete_stats_by_id: dict[str, dict[str, str]] = {}

    for comp in competitors:
        comp_team = comp.get("team", {})
        team_name = comp_team.get("displayName", "")
        team_abbr = comp_team.get("abbreviation", "")
        team_logo = comp_team.get("logo", "")
        home_away = comp.get("homeAway", "")

        # Scan leaders (primary source of athlete data + stats on scoreboard)
        for leader_cat in (comp.get("leaders") or []):
            cat_name = leader_cat.get("name", "")  # e.g. "points", "rebounds", "assists"
            cat_display = leader_cat.get("displayName", cat_name)  # e.g. "Points"
            for leader in (leader_cat.get("leaders") or []):
                ath = leader.get("athlete") or {}
                name = ath.get("displayName", ath.get("shortName", ""))
                if not name:
                    continue
                aid = str(ath.get("id", ""))
                hs = _extract_headshot(ath.get("headshot"), aid, sport_type)
                stat_val = leader.get("displayValue", leader.get("value", ""))
                name_lower = name.lower()
                if name_lower not in athlete_lookup:
                    athlete_lookup[name_lower] = {
                        "id": aid,
                        "headshot": hs,
                        "teamName": team_name,
                        "teamAbbr": team_abbr,
                        "teamLogo": team_logo,
                        "homeAway": home_away,
                        "stats": {},
                    }
                elif not athlete_lookup[name_lower].get("headshot") and hs:
                    athlete_lookup[name_lower]["headshot"] = hs
                # Accumulate stats per category
                if stat_val and cat_name:
                    athlete_lookup[name_lower].setdefault("stats", {})[cat_name] = str(stat_val)
                    if aid:
                        athlete_stats_by_id.setdefault(aid, {})[cat_name] = str(stat_val)

        # Scan roster/statistics for additional athletes
        for stat_cat in (comp.get("statistics") or []):
            for ath_stat in (stat_cat.get("athletes") or []):
                ath = ath_stat.get("athlete") or ath_stat
                name = ath.get("displayName", ath.get("shortName", ""))
                if not name:
                    continue
                aid = str(ath.get("id", ""))
                hs = _extract_headshot(ath.get("headshot"), aid, sport_type)
                name_lower = name.lower()
                if name_lower not in athlete_lookup:
                    athlete_lookup[name_lower] = {
                        "id": aid,
                        "headshot": hs,
                        "teamName": team_name,
                        "teamAbbr": team_abbr,
                        "teamLogo": team_logo,
                        "homeAway": home_away,
                        "stats": {},
                    }

    # ── Get situation/latest play info ────────────────────────────────
    situation = competition.get("situation", {})
    last_play = situation.get("lastPlay", {})
    play_text = last_play.get("text", "")
    play_type = last_play.get("type", {}).get("text", "")

    # ── Extract athlete info from multiple sources ────────────────────
    athlete_name = ""
    athlete_headshot = ""
    athlete_team_info: dict | None = None

    # Source 1: lastPlay.athlete
    athlete_obj = last_play.get("athlete") or {}
    if isinstance(athlete_obj, dict) and athlete_obj:
        athlete_name = athlete_obj.get("displayName", athlete_obj.get("shortName", ""))
        aid = str(athlete_obj.get("id", ""))
        athlete_headshot = _extract_headshot(athlete_obj.get("headshot"), aid, sport_type)

    # Source 2: lastPlay.athletesInvolved[]
    if not athlete_name:
        for inv in (last_play.get("athletesInvolved") or []):
            if isinstance(inv, dict):
                athlete_name = inv.get("displayName", inv.get("shortName", ""))
                aid = str(inv.get("id", ""))
                athlete_headshot = _extract_headshot(inv.get("headshot"), aid, sport_type)
                if athlete_name:
                    break

    # Source 3: lastPlay.participants[]
    if not athlete_name:
        for p in (last_play.get("participants") or []):
            if isinstance(p, dict):
                ath = p.get("athlete") or {}
                if isinstance(ath, dict) and ath:
                    athlete_name = ath.get("displayName", "")
                    aid = str(ath.get("id", ""))
                    athlete_headshot = _extract_headshot(ath.get("headshot"), aid, sport_type)
                    if athlete_name:
                        break

    # ── Cross-reference athlete against leaders lookup ────────────────
    if athlete_name:
        lookup_entry = athlete_lookup.get(athlete_name.lower())
        if lookup_entry:
            # Get headshot from leaders if we don't have one
            if not athlete_headshot:
                athlete_headshot = lookup_entry["headshot"]
            # Get the athlete's ACTUAL team
            athlete_team_info = lookup_entry

    # If no athlete name from structured data, try parsing from play text
    if not athlete_name and play_text:
        # Check if any known athlete name appears in the play text
        play_lower = play_text.lower()
        for name_lower, info in athlete_lookup.items():
            # Match last name (more reliable than full name in play text)
            parts = name_lower.split()
            last_name = parts[-1] if parts else ""
            if last_name and len(last_name) > 2 and last_name in play_lower:
                athlete_name = name_lower.title()
                if not athlete_headshot:
                    athlete_headshot = info["headshot"]
                athlete_team_info = info
                break

    # ── Determine play team ───────────────────────────────────────────
    play_team = last_play.get("team", {}) or {}
    play_team_id = play_team.get("id", "")
    play_team_name = play_team.get("displayName", "")
    play_team_abbr = play_team.get("abbreviation", "")
    play_team_logo = play_team.get("logo", "")

    # If lastPlay.team has an abbreviation but no logo, find logo from competitors
    if play_team_abbr and not play_team_logo:
        for comp in competitors:
            ct = comp.get("team", {})
            if ct.get("abbreviation", "") == play_team_abbr:
                play_team_logo = ct.get("logo", "")
                if not play_team_name:
                    play_team_name = ct.get("displayName", "")
                break

    # If lastPlay.team has an id but no name
    if play_team_id and not play_team_name:
        for comp in competitors:
            ct = comp.get("team", {})
            if str(ct.get("id", "")) == str(play_team_id):
                play_team_name = ct.get("displayName", "")
                play_team_abbr = ct.get("abbreviation", "")
                play_team_logo = ct.get("logo", "")
                break

    # If still no team info from lastPlay.team, use the athlete's team
    if not play_team_name and athlete_team_info:
        play_team_name = athlete_team_info["teamName"]
        play_team_abbr = athlete_team_info["teamAbbr"]
        play_team_logo = athlete_team_info["teamLogo"]

    # ── Extract second athlete (for baseball pitcher→batter, assists, etc.) ──
    athlete2_name = ""
    athlete2_headshot = ""
    # For baseball "pitches to" plays, the second participant is the batter
    participants = last_play.get("participants") or []
    if len(participants) >= 2:
        p2 = participants[1] if isinstance(participants[1], dict) else {}
        ath2 = p2.get("athlete") or {}
        if isinstance(ath2, dict) and ath2:
            athlete2_name = ath2.get("displayName", "")
            a2id = str(ath2.get("id", ""))
            athlete2_headshot = _extract_headshot(ath2.get("headshot"), a2id, sport_type)
            # Cross-ref leaders for headshot
            if not athlete2_headshot and athlete2_name:
                lookup2 = athlete_lookup.get(athlete2_name.lower())
                if lookup2:
                    athlete2_headshot = lookup2["headshot"]

    # ── Enrich play text with athlete name if missing ─────────────────
    if athlete_name and play_text:
        # If the play text doesn't contain the athlete's last name, prepend it
        name_parts = athlete_name.split()
        last_name_lower = name_parts[-1].lower() if name_parts else ""
        if last_name_lower and len(last_name_lower) > 1 and last_name_lower not in play_text.lower():
            play_text = f"{athlete_name} {play_text}"

    # ── Extract assist info from situation ─────────────────────────────
    assist_text = ""
    involved = last_play.get("athletesInvolved") or []
    if len(involved) > 1:
        assister = involved[1] if isinstance(involved[1], dict) else {}
        assist_name = assister.get("displayName", "")
        if assist_name:
            assist_text = f"({assist_name} assists)"
    if not assist_text and "assists" in play_text.lower():
        pass

    # If no play text, generate from status
    if not play_text:
        if parsed["status"] == "live":
            play_text = f"{parsed['statusDetail']} — {parsed['awayAbbr']} {parsed['awayScore']}, {parsed['homeAbbr']} {parsed['homeScore']}"
        elif parsed["status"] == "final":
            play_text = f"Final: {parsed['awayTeam']} {parsed['awayScore']}, {parsed['homeTeam']} {parsed['homeScore']}"
        else:
            play_text = f"{parsed['awayTeam']} at {parsed['homeTeam']} — {parsed['statusDetail']}"

    # Append assist text if not already in the play
    if assist_text and assist_text.lower() not in play_text.lower():
        play_text = f"{play_text} {assist_text}"

    # ── Build athlete stats line ──────────────────────────────────────
    athlete_stats = ""
    if athlete_name:
        lookup_entry = athlete_lookup.get(athlete_name.lower())
        raw_stats = {}
        if lookup_entry:
            raw_stats = lookup_entry.get("stats", {})
        # Fallback: try by athlete ID
        if not raw_stats and athlete_obj and isinstance(athlete_obj, dict):
            aid_check = str(athlete_obj.get("id", ""))
            if aid_check and aid_check in athlete_stats_by_id:
                raw_stats = athlete_stats_by_id[aid_check]

        if raw_stats:
            # Format based on sport — show cumulative game stats
            if league_key == "NBA":
                parts = []
                if raw_stats.get("points"): parts.append(f"{raw_stats['points']} PTS")
                if raw_stats.get("rebounds"): parts.append(f"{raw_stats['rebounds']} REB")
                if raw_stats.get("assists"): parts.append(f"{raw_stats['assists']} AST")
                if raw_stats.get("steals"): parts.append(f"{raw_stats['steals']} STL")
                athlete_stats = " | ".join(parts)
            elif league_key == "NHL":
                parts = []
                if raw_stats.get("goals"): parts.append(f"{raw_stats['goals']} G")
                if raw_stats.get("assists"): parts.append(f"{raw_stats['assists']} A")
                if raw_stats.get("points"): parts.append(f"{raw_stats['points']} PTS")
                if raw_stats.get("saves"): parts.append(f"{raw_stats['saves']} SV")
                athlete_stats = " | ".join(parts)
            elif league_key == "MLB":
                parts = []
                if raw_stats.get("avg"): parts.append(f".{raw_stats['avg'].lstrip('0.')} AVG")
                if raw_stats.get("homeRuns"): parts.append(f"{raw_stats['homeRuns']} HR")
                if raw_stats.get("RBIs"): parts.append(f"{raw_stats['RBIs']} RBI")
                if raw_stats.get("innings"): parts.append(f"{raw_stats['innings']} IP")
                if raw_stats.get("strikeouts"): parts.append(f"{raw_stats['strikeouts']} K")
                athlete_stats = " | ".join(parts)
            elif league_key == "NFL":
                parts = []
                if raw_stats.get("passingYards"): parts.append(f"{raw_stats['passingYards']} YDS")
                if raw_stats.get("rushingYards"): parts.append(f"{raw_stats['rushingYards']} RUSH")
                if raw_stats.get("receivingYards"): parts.append(f"{raw_stats['receivingYards']} REC")
                if raw_stats.get("totalTackles"): parts.append(f"{raw_stats['totalTackles']} TKL")
                athlete_stats = " | ".join(parts)
            else:
                parts = [f"{v} {k.upper()[:3]}" for k, v in list(raw_stats.items())[:3]]
                athlete_stats = " | ".join(parts)

        # If no stats from leaders (player isn't a leader), infer from play text
        if not athlete_stats and play_text:
            play_lower = play_text.lower()
            inferred = []
            # Scoring plays
            if "makes" in play_lower:
                if "three point" in play_lower or "3-point" in play_lower:
                    inferred.append("+3 PTS")
                elif "free throw" in play_lower:
                    inferred.append("+1 FT")
                else:
                    inferred.append("+2 PTS")
            elif "misses" in play_lower:
                if "free throw" in play_lower:
                    inferred.append("FT MISS")
                else:
                    inferred.append("MISS")
            # Other play types
            if "block" in play_lower and "blocked" not in play_lower:
                inferred.append("BLK")
            if "steal" in play_lower:
                inferred.append("STL")
            if inferred:
                athlete_stats = " | ".join(inferred)

    # ── Build game matchup label for visual differentiation ────────────
    game_matchup = f"{parsed['awayAbbr']} vs {parsed['homeAbbr']}"

    return {
        "id": parsed["id"],
        "text": play_text,
        "playType": play_type,
        "athleteName": athlete_name,
        "athleteHeadshot": athlete_headshot,
        "athleteStats": athlete_stats,
        "athlete2Name": athlete2_name,
        "athlete2Headshot": athlete2_headshot,
        "playTeamName": play_team_name,
        "playTeamAbbr": play_team_abbr,
        "playTeamLogo": play_team_logo,
        "league": league_key,
        "status": parsed["status"],
        "statusDetail": parsed["statusDetail"],
        "homeTeam": parsed["homeTeam"],
        "awayTeam": parsed["awayTeam"],
        "homeAbbr": parsed["homeAbbr"],
        "awayAbbr": parsed["awayAbbr"],
        "homeScore": parsed["homeScore"],
        "awayScore": parsed["awayScore"],
        "homeBadge": parsed["homeBadge"],
        "awayBadge": parsed["awayBadge"],
        "gameMatchup": game_matchup,
        "timestamp": parsed["dateEvent"],
    }


# ─── ESPN Endpoints ───────────────────────────────────────────────────


@router.get("/espn/scoreboard", response_model=dict[str, Any])
async def espn_scoreboard(
    league: str = Query(description="League key: NFL, NBA, MLB, NHL, EPL"),
    d: str = Query(default=None, description="Date: YYYYMMDD format"),
):
    """
    Fetch ESPN scoreboard data for a league on a specific date.
    Returns parsed game items ready for frontend display.
    """
    league_upper = league.upper()
    if league_upper not in LEAGUES:
        return {"games": [], "error": f"Unknown league: {league}"}

    sport, espn_league, _ = LEAGUES[league_upper]
    normalized_date = str(d or "").strip().replace("-", "")
    if normalized_date and len(normalized_date) != 8:
        normalized_date = ""
    url = f"{ESPN_BASE}/{sport}/{espn_league}/scoreboard"
    if normalized_date:
        url += f"?dates={normalized_date}"

    data = await _fetch_cached(url)
    if not data:
        return {"games": []}

    events = data.get("events", [])
    games = [_parse_espn_event(ev, league_upper) for ev in events]
    _emit_live_score_updates(games)
    return {"games": games}


@router.get("/espn/all", response_model=dict[str, Any])
async def espn_all_leagues(
    d: str = Query(default=None, description="Date: YYYYMMDD format"),
):
    """
    Fetch ESPN scoreboard data for ALL supported leagues on a date.
    Returns games grouped by league, ordered: NFL, NBA, MLB, NHL, EPL.
    Uses parallel fetching for performance.
    """
    normalized_date = str(d or "").strip().replace("-", "")
    date_param = normalized_date if len(normalized_date) == 8 else datetime.now().strftime("%Y%m%d")
    cached = _espn_all_cache.get(date_param)
    if cached and time.time() - cached[0] < ESPN_ALL_CACHE_TTL:
        cached_payload = cached[1]
        if cached_payload.get("games"):
            return cached_payload
        _espn_all_cache.pop(date_param, None)

    all_games: list[dict] = []
    league_keys = ["NFL", "NBA", "MLB", "NHL", "EPL"]

    async def fetch_league(key: str):
        sport, espn_league, _ = LEAGUES[key]
        url = f"{ESPN_BASE}/{sport}/{espn_league}/scoreboard?dates={date_param}"
        return key, await _fetch_cached(url, timeout=4.0)

    results = await asyncio.gather(*[fetch_league(k) for k in league_keys])
    unresolved_leagues: list[str] = []
    for key, data in results:
        events = data.get("events", []) if isinstance(data, dict) else []
        if events:
            for ev in events:
                all_games.append(_parse_espn_event(ev, key))
            continue

        unresolved_leagues.append(key)

    async def fetch_league_fallback(key: str):
        sport, espn_league, _ = LEAGUES[key]
        url = f"{ESPN_BASE}/{sport}/{espn_league}/scoreboard?dates={date_param}"
        fresh_data = await _fetch_fresh(url, timeout=8.0)
        events = fresh_data.get("events", []) if isinstance(fresh_data, dict) else []
        return key, events

    if unresolved_leagues:
        fallback_results = await asyncio.gather(
            *[fetch_league_fallback(key) for key in unresolved_leagues],
            return_exceptions=True,
        )
        for result in fallback_results:
            if isinstance(result, Exception):
                continue

            key, events = result
            for ev in events:
                all_games.append(_parse_espn_event(ev, key))

    _emit_live_score_updates(all_games)
    payload = {"games": all_games}
    _espn_all_cache[date_param] = (time.time(), payload)
    return payload


@router.get("/espn/featured", response_model=dict[str, Any])
async def espn_featured():
    """
    Return featured events for the hero carousel.
    Prioritizes: live games > recent close finishes > upcoming marquee.
    Randomizes within each tier for visual variety.
    """
    import random

    live_items: list[dict] = []
    final_items: list[dict] = []
    upcoming_items: list[dict] = []

    today = datetime.now().strftime("%Y%m%d")
    league_keys = ["NBA", "NHL", "NFL", "MLB", "EPL"]

    async def fetch_league(key: str):
        sport, espn_league, _ = LEAGUES[key]
        url = f"{ESPN_BASE}/{sport}/{espn_league}/scoreboard?dates={today}"
        return key, await _fetch_cached(url)

    results = await asyncio.gather(*[fetch_league(k) for k in league_keys])
    for key, data in results:
        if not data:
            continue
        for ev in data.get("events", []):
            item = _parse_espn_event(ev, key)
            if item["status"] == "live":
                live_items.append(item)
            elif item["status"] == "final":
                final_items.append(item)
            else:
                upcoming_items.append(item)

    # Shuffle within each tier for variety
    random.shuffle(live_items)
    random.shuffle(upcoming_items)

    # Sort finals by closeness (most exciting first), then shuffle ties
    final_items.sort(key=lambda x: abs(x["homeScore"] - x["awayScore"]))

    featured = live_items[:6] + final_items[:6] + upcoming_items[:6]
    return {"featured": featured[:12]}


@router.get("/espn/news", response_model=dict[str, Any])
async def espn_news(
    league: str = Query(default=None, description="Optional league key, e.g. NFL or NBA"),
):
    """
    Build a fast ESPN-first news feed with RSS fallback only when ESPN doesn't
    produce enough headlines for the requested scope.
    """
    import xml.etree.ElementTree as ET

    requested_league = league.upper() if league else None
    cache_key = requested_league or "ALL"

    if requested_league and requested_league not in LEAGUES:
        return {"news": []}

    cached = _news_feed_cache.get(cache_key)
    if cached and time.time() - cached[0] < NEWS_FEED_CACHE_TTL:
        cached_payload = cached[1]
        if cached_payload.get("news"):
            return cached_payload
        _news_feed_cache.pop(cache_key, None)

    all_news: list[dict] = []

    # ── ESPN news (JSON API) ───────────────────────────────────────────
    espn_endpoints = {
        "NFL": "football/nfl",
        "NBA": "basketball/nba",
        "MLB": "baseball/mlb",
        "NHL": "hockey/nhl",
        "EPL": "soccer/eng.1",
    }

    async def fetch_espn_news(league_key: str, path: str):
        url = f"https://site.api.espn.com/apis/site/v2/sports/{path}/news"
        return league_key, "ESPN", await _fetch_cached(url, timeout=8.0)

    # ── RSS feeds from other sources ───────────────────────────────────
    rss_feeds = [
        ("CBS Sports", "https://www.cbssports.com/rss/headlines/", None),
        ("Yahoo Sports", "https://sports.yahoo.com/rss/", None),
        ("Bleacher Report", "https://bleacherreport.com/articles/feed", None),
        ("CBS NFL", "https://www.cbssports.com/rss/headlines/nfl/", "NFL"),
        ("CBS NBA", "https://www.cbssports.com/rss/headlines/nba/", "NBA"),
        ("CBS MLB", "https://www.cbssports.com/rss/headlines/mlb/", "MLB"),
        ("CBS NHL", "https://www.cbssports.com/rss/headlines/nhl/", "NHL"),
    ]

    async def fetch_rss(source_name: str, url: str, league: str | None):
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                resp = await client.get(url)
                if resp.status_code != 200:
                    return []

                items = []
                root = ET.fromstring(resp.text)
                for item_el in root.iter("item"):
                    title_el = item_el.find("title")
                    link_el = item_el.find("link")
                    desc_el = item_el.find("description")
                    pub_el = item_el.find("pubDate")

                    title = _clean_news_text(title_el.text if title_el is not None and title_el.text else "")
                    if not title:
                        continue

                    link = _clean_news_text(link_el.text if link_el is not None and link_el.text else "")
                    raw_desc = desc_el.text if desc_el is not None and desc_el.text else ""
                    desc = _clean_news_text(raw_desc)
                    pub = _clean_news_text(pub_el.text if pub_el is not None and pub_el.text else "")
                    image_url = _extract_rss_image(item_el, raw_desc)

                    detected_league = league
                    if not detected_league:
                        title_lower = title.lower()
                        for tag, keywords in [("NFL", ["nfl", "football"]), ("NBA", ["nba", "basketball"]),
                                              ("MLB", ["mlb", "baseball"]), ("NHL", ["nhl", "hockey"]),
                                              ("EPL", ["premier league", "epl", "soccer"])]:
                            if any(kw in title_lower for kw in keywords):
                                detected_league = tag
                                break

                    pub_date = ""
                    if pub:
                        try:
                            from email.utils import parsedate_to_datetime
                            pub_date = parsedate_to_datetime(pub).strftime("%Y-%m-%d")
                        except Exception:
                            pub_date = pub[:10]

                    clean_source = _clean_news_text(
                        source_name.replace(" NFL", "").replace(" NBA", "").replace(" MLB", "").replace(" NHL", "")
                    )
                    items.append({
                        "id": f"{clean_source}_{hash(title) % 100000}",
                        "headline": title,
                        "source": clean_source,
                        "imageUrl": image_url,
                        "publishedAt": pub_date,
                        "url": link,
                        "league": detected_league or "",
                        "description": desc[:200] if desc else "",
                    })

                return items[:5]
        except Exception:
            return []

    def _build_payload(news_items: list[dict]) -> dict[str, list[dict]]:
        scoped_news = news_items
        if requested_league:
            scoped_news = [item for item in news_items if item.get("league") == requested_league]

        league_priority = {
            "NFL": 0,
            "NBA": 1,
            "MLB": 2,
            "NHL": 3,
            "EPL": 4,
            "": 9,
        }

        def _news_timestamp(item: dict) -> float:
            raw = str(item.get("publishedAt", "")).strip()
            if not raw:
                return 0.0

            try:
                if len(raw) == 10 and raw[4] == "-" and raw[7] == "-":
                    return datetime.fromisoformat(raw).timestamp()
            except Exception:
                pass

            try:
                return datetime.fromisoformat(raw.replace("Z", "+00:00")).timestamp()
            except Exception:
                pass

            try:
                from email.utils import parsedate_to_datetime
                return parsedate_to_datetime(raw).timestamp()
            except Exception:
                return 0.0

        scoped_news.sort(
            key=lambda item: (
                -_news_timestamp(item),
                league_priority.get(str(item.get("league", "")).upper(), 8),
                str(item.get("source", "")).lower(),
                str(item.get("headline", "")).lower(),
                str(item.get("id", "")),
            )
        )

        if requested_league:
            return {"news": scoped_news[:30]}

        dashboard_leagues = ["NFL", "NBA", "MLB", "NHL", "EPL"]
        balanced_news: list[dict] = []
        seen_ids: set[str] = set()

        # Guarantee dashboard coverage so league tabs never look empty just
        # because an earlier sport consumed the global top-N slice.
        for league_key in dashboard_leagues:
            league_items = [item for item in scoped_news if str(item.get("league", "")).upper() == league_key]
            for item in league_items[:6]:
                item_id = str(item.get("id", ""))
                if item_id and item_id in seen_ids:
                    continue
                balanced_news.append(item)
                if item_id:
                    seen_ids.add(item_id)

        for item in scoped_news:
            if len(balanced_news) >= 36:
                break
            item_id = str(item.get("id", ""))
            if item_id and item_id in seen_ids:
                continue
            balanced_news.append(item)
            if item_id:
                seen_ids.add(item_id)

        return {"news": balanced_news}

    selected_endpoints = (
        [(requested_league, espn_endpoints[requested_league])]
        if requested_league
        else list(espn_endpoints.items())
    )

    try:
        espn_tasks = [fetch_espn_news(lk, path) for lk, path in selected_endpoints]
        espn_results = await asyncio.gather(*espn_tasks)

        for league_key, _source, data in espn_results:
            if not data:
                continue
            articles = data.get("articles", [])
            for article in articles[:6]:
                headline = _clean_news_text(article.get("headline", ""))
                if not headline:
                    continue

                image_url = _extract_article_image(article)
                raw_source = article.get("source", "")
                source_name = _clean_news_text(raw_source) if isinstance(raw_source, str) else ""
                all_news.append({
                    "id": str(article.get("dataSourceIdentifier", headline[:20])),
                    "headline": headline,
                    "source": source_name or "ESPN",
                    "imageUrl": image_url,
                    "publishedAt": article.get("published", "")[:10],
                    "url": _clean_news_text(article.get("links", {}).get("web", {}).get("href") if article.get("links") else ""),
                    "league": league_key,
                    "description": _clean_news_text(article.get("description", "")),
                })

        enough_items = len(all_news) >= (6 if requested_league else 24)
        if not enough_items:
            selected_rss_feeds = (
                [feed for feed in rss_feeds if feed[2] in {None, requested_league}]
                if requested_league
                else rss_feeds
            )
            rss_tasks = [fetch_rss(name, url, league_key) for name, url, league_key in selected_rss_feeds]
            rss_results = await asyncio.gather(*rss_tasks)
            for rss_items in rss_results:
                all_news.extend(rss_items)

        payload = _build_payload(all_news)
        if payload.get("news"):
            _news_feed_cache[cache_key] = (time.time(), payload)
            return payload
    except Exception:
        logger.debug("Dashboard news build failed for %s", cache_key, exc_info=True)

    if cached:
        return cached[1]
    return {"news": []}


@router.get("/espn/highlights", response_model=dict[str, Any])
async def espn_highlights(
    league: str = Query(default=None, description="Optional league key, e.g. NFL or NBA"),
    limit: int = Query(default=30, ge=6, le=120, description="Maximum number of highlight clips to return"),
    date: str = Query(default=None, description="Optional local date in YYYYMMDD or YYYY-MM-DD"),
):
    """
    Build a latest-first multi-source highlights feed with cross-provider dedupe.
    """
    requested_league = league.upper() if league else None
    local_now = datetime.now().astimezone()
    local_tz = local_now.tzinfo or timezone.utc
    today_iso = local_now.strftime("%Y-%m-%d")
    target_iso, target_compact, is_future = _normalize_highlights_request_date(date)
    cache_key = f"{requested_league or 'ALL'}:{target_iso}:{limit}"
    generated_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    supported_highlight_leagues = {
        "NFL": "football/nfl",
        "NBA": "basketball/nba",
        "MLB": "baseball/mlb",
        "NHL": "hockey/nhl",
        "EPL": "soccer/eng.1",
    }

    if requested_league and requested_league not in supported_highlight_leagues:
        return {"generatedAt": generated_at, "date": target_iso, "highlights": []}

    if is_future:
        return {"generatedAt": generated_at, "date": target_iso, "highlights": []}

    cached = _highlights_feed_cache.get(cache_key)
    if cached and time.time() - cached[0] < HIGHLIGHTS_FEED_CACHE_TTL:
        cached_payload = cached[1]
        if cached_payload.get("highlights"):
            return cached_payload
        _highlights_feed_cache.pop(cache_key, None)

    selected_endpoints = (
        [(requested_league, supported_highlight_leagues[requested_league])]
        if requested_league
        else list(supported_highlight_leagues.items())
    )

    async def fetch_league_highlights(league_key: str, path: str) -> list[dict]:
        league_items: list[dict] = []

        sport_tuple = LEAGUES.get(league_key)
        if sport_tuple:
            sport_name, espn_league, _ = sport_tuple
            scoreboard_url = (
                f"{ESPN_BASE}/{sport_name}/{espn_league}/scoreboard"
                f"?dates={target_compact}&limit=50"
            )
            scoreboard_data = await _fetch_cached(scoreboard_url, timeout=8.0)
            if isinstance(scoreboard_data, dict):
                raw_events = [event for event in (scoreboard_data.get("events") or []) if isinstance(event, dict)]
                filtered_events = []
                for event in raw_events:
                    status_type = ((event.get("status") or {}).get("type") or {})
                    if status_type.get("completed") or str(status_type.get("state") or "").lower() == "in":
                        filtered_events.append(event)

                filtered_events.sort(key=lambda event: str(event.get("date") or ""), reverse=True)
                event_requests: list[tuple[dict, str]] = []
                for event in filtered_events[:10]:
                    event_id = str(event.get("id") or "").strip()
                    if not event_id:
                        continue
                    event_article = _build_event_video_article(event, league_key)
                    event_requests.append(
                        (
                            event_article,
                            f"https://site.api.espn.com/apis/site/v2/sports/{path}/videos?event={event_id}",
                        )
                    )

                if event_requests:
                    event_payloads = await asyncio.gather(
                        *[_fetch_cached(video_url, timeout=8.0) for _, video_url in event_requests]
                    )
                    for (event_article, _video_url), event_payload in zip(event_requests, event_payloads):
                        videos = (event_payload or {}).get("videos") if isinstance(event_payload, dict) else []
                        if not isinstance(videos, list):
                            continue
                        for clip in videos[:8]:
                            if not isinstance(clip, dict):
                                continue
                            normalized = _normalize_espn_highlight_item(
                                league_key,
                                event_article,
                                {"videos": [clip]},
                            )
                            if normalized:
                                league_items.append(normalized)

        news_url = f"https://site.api.espn.com/apis/site/v2/sports/{path}/news"
        data = await _fetch_cached(news_url, timeout=8.0)
        if isinstance(data, dict):
            articles = [article for article in (data.get("articles") or []) if isinstance(article, dict)]
            detail_requests: list[tuple[dict, str]] = []
            for article in articles[:12]:
                api_self = _clean_news_text(
                    str((((article.get("links") or {}).get("api") or {}).get("self") or {}).get("href") or "")
                )
                if not api_self:
                    continue

                article_with_league = dict(article)
                article_with_league["league"] = league_key
                detail_requests.append((article_with_league, api_self))

            if detail_requests:
                detail_payloads = await asyncio.gather(
                    *[_fetch_cached(detail_url, timeout=8.0) for _, detail_url in detail_requests]
                )
                for (article_payload, _detail_url), detail_payload in zip(detail_requests, detail_payloads):
                    if not isinstance(detail_payload, dict):
                        continue
                    normalized = _normalize_espn_highlight_item(league_key, article_payload, detail_payload)
                    if normalized:
                        league_items.append(normalized)

        try:
            if league_key == "MLB":
                league_items.extend(await _fetch_mlb_official_highlights([target_iso]))
            elif league_key == "NHL":
                league_items.extend(await _fetch_nhl_official_highlights(target_iso))
            elif league_key == "EPL":
                league_items.extend(await _fetch_scorebat_epl_highlights(target_date=target_iso))
        except Exception:
            logger.debug("Supplemental highlights fetch failed for %s", league_key, exc_info=True)

        return league_items

    try:
        league_results = await asyncio.gather(
            *[fetch_league_highlights(league_key, path) for league_key, path in selected_endpoints]
        )

        flattened_items = [
            item
            for league_items in league_results
            for item in league_items
            if isinstance(item, dict)
        ]
        flattened_items.sort(
            key=lambda item: (
                -_highlight_quality_score(item),
                -float(item.get("publishedTs") or 0.0),
                str(item.get("title") or "").lower(),
                str(item.get("id") or ""),
            )
        )
        flattened_items = [
            item for item in flattened_items
            if _highlight_matches_local_date(item, target_iso, local_tz)
        ]

        highlights: list[dict] = []
        seen_keys: set[str] = set()

        for item in flattened_items:
            playable_url = str(
                item.get("videoUrl")
                or item.get("hlsUrl")
                or item.get("embedUrl")
                or item.get("pageUrl")
                or ""
            ).strip()
            if not playable_url or _is_noise_highlight_title(item):
                continue

            dedupe_keys = _build_highlight_dedupe_keys(item)
            if not dedupe_keys or dedupe_keys & seen_keys:
                continue

            seen_keys.update(dedupe_keys)
            highlights.append(item)

        league_priority = {"NFL": 0, "NBA": 1, "MLB": 2, "NHL": 3, "EPL": 4}
        highlights.sort(
            key=lambda item: (
                -_highlight_quality_score(item),
                -float(item.get("publishedTs") or 0.0),
                league_priority.get(str(item.get("league") or "").upper(), 8),
                str(item.get("title") or "").lower(),
                str(item.get("id") or ""),
            )
        )

        if not requested_league:
            balanced_selection: list[dict] = []
            selected_ids: set[str] = set()
            guaranteed_leagues = ["NFL", "NBA", "MLB", "NHL", "EPL"]

            for league_name in guaranteed_leagues:
                league_items = [
                    item for item in highlights
                    if str(item.get("league") or "").upper() == league_name
                ]
                for item in league_items[:4]:
                    item_id = str(item.get("id") or "").strip()
                    if not item_id or item_id in selected_ids:
                        continue
                    balanced_selection.append(item)
                    selected_ids.add(item_id)

            for item in highlights:
                if len(balanced_selection) >= limit:
                    break
                item_id = str(item.get("id") or "").strip()
                if not item_id or item_id in selected_ids:
                    continue
                balanced_selection.append(item)
                selected_ids.add(item_id)

            balanced_selection.sort(
                key=lambda item: (
                    -_highlight_quality_score(item),
                    -float(item.get("publishedTs") or 0.0),
                    league_priority.get(str(item.get("league") or "").upper(), 8),
                    str(item.get("title") or "").lower(),
                    str(item.get("id") or ""),
                )
            )
            highlights = balanced_selection

        payload = {
            "generatedAt": generated_at,
            "date": target_iso,
            "highlights": highlights[:limit],
        }
        if payload["highlights"]:
            _highlights_feed_cache[cache_key] = (time.time(), payload)
            return payload
    except Exception:
        logger.debug("Highlights feed build failed for %s", cache_key, exc_info=True)

    if cached:
        return cached[1]
    return {"generatedAt": generated_at, "date": target_iso, "highlights": []}


# ── Per-game play-by-play constants ───────────────────────────────────
# (Legacy cap removed — now returns all plays)

# Junk plays that should NOT appear in the timeline
_JUNK_EXACT = {
    "goalie stopped", "icing", "shot clock turnover",
    "timeout", "official timeout", "tv timeout", "full timeout",
    "jump ball", "goalie", "stoppage", "period start",
    "period official", "period ready", "game official",
    "foul",
}
_JUNK_CONTAINS = [
    "enters the game for",  # substitution
    "delay of game",
    "puck frozen",           # NHL generic
    "puck in netting",       # NHL generic
    "tv timeout",
    "commercial break",
    "period start",
    "warming up",
    "lineup change",
    "team rebound",          # anonymous team rebounds with no player name
    " hit for ",
    " pinch-ran for ",
    " pinch ran for ",
    " pinch-hit for ",
    " pinch hit for ",
    " now pitching",
]
# Plays that are just labels with no player context
_JUNK_STARTSWITH = [
    "beginning of ",
    "official",
    "stoppage",
]


def _is_junk_play(text: str) -> bool:
    """Return True if this play text is too generic to show in the feed."""
    t = text.strip().lower()
    if not t:
        return True
    if t in _JUNK_EXACT:
        return True
    for phrase in _JUNK_CONTAINS:
        if phrase in t:
            return True
    for prefix in _JUNK_STARTSWITH:
        if t.startswith(prefix):
            return True
# Soccer score-only lines
    import re
    if _re.search(r"\b(first|second)\s+half\s+begins[.!]?$", t):
        return False
    if _re.search(r"\b(kick-?off|kickoff|half[- ]time|full[- ]time|full time)\b", t):
        return False
    if re.match(r"^\d+['′]?\s*[—\-]", t):
        return True
    if _re.search(r"\bin\s+(left|center|right)\s+field[.!]?$", t):
        return True
    if _re.search(r"\bat\s+(first|second|third)\s+base[.!]?$", t):
        return True
    if _re.search(r"\bat\s+(shortstop|pitcher|catcher)[.!]?$", t):
        return True
    if _re.search(r"\bas designated hitter[.!]?$", t):
        return True
    if _re.search(r"\b(hit for|pinch[- ]hit for|pinch[- ]ran for|replaces|substitutes for)\b", t):
        return True
    if _re.search(r"\bran for\b", t):
        return True
    if _re.search(r"\b(catching|pitching|batting)\.?$", t):
        return True
    if _re.search(r"\bfourth official has announced\b", t):
        return True
    if _re.search(r"^delay in match because\b", t):
        return True
    if _re.search(r"^delay over\b", t):
        return True
    if _re.search(r"\bwins a free kick\b", t):
        return True
    if _re.search(r"^corner,\s*", t):
        return True
    # Plays with no recognizable player name or action (too short and generic)
    words = t.split()
    if len(words) <= 3:
        action_keywords = [
            "makes", "misses", "scores", "shot", "dunk", "layup",
            "three", "goal", "assist", "steal", "block", "turnover",
            "faceoff", "won", "final", "end", "penalty", "free",
            "pass", "run", "catch", "kick", "save", "header",
            "corner", "offside", "card", "foul", "flagrant",
            "giveaway", "blocked", "rebound", "sack", "tackle",
            "rush", "punt", "field goal", "touchdown", "interception",
            "fumble", "reception", "completion", "incomplete",
            "strikeout", "home run", "fly out", "ground out",
            "single", "double", "triple", "walk", "hit",
        ]
        if not any(kw in t for kw in action_keywords):
            return True
    # Reject plays that are purely positional markers (e.g. "Goalie", "Faceoff - Zone")
    # or contain only a generic label and a dash with no player name
    if re.match(r"^[a-z\s]+-\s*(goalie|zone|center|left|right|neutral)$", t):
        return True
    return False


# ESPN headshot URL uses league abbr, not sport name
_HEADSHOT_SPORT = {
    "NBA": "nba", "NHL": "nhl", "NFL": "nfl",
    "MLB": "mlb", "EPL": "soccer",
}

def _build_espn_headshot_url(athlete_id: str, hs_sport: str) -> str:
    athlete_id = str(athlete_id or "").strip()
    hs_sport = (hs_sport or "").strip()
    if not athlete_id or not hs_sport:
        return ""
    if hs_sport == "soccer":
        return ""
    return f"https://a.espncdn.com/i/headshots/{hs_sport}/players/full/{athlete_id}.png"


async def _resolve_activity_headshot(
    league_key: str,
    athlete_id: str,
    athlete_name: str,
    team_name: str,
    raw_headshot,
    sport: str,
    hs_sport: str,
) -> str:
    if league_key == "EPL":
        candidates = await _build_epl_headshot_candidates(athlete_name, team_name)
        if candidates:
            return candidates[0]
    direct = _extract_headshot(raw_headshot, athlete_id, sport)
    if direct:
        return direct
    return _build_espn_headshot_url(athlete_id, hs_sport)


def _clean_person_name(value: str) -> str:
    cleaned = html.unescape((value or "").strip())
    cleaned = cleaned.replace("’", "'").replace("`", "'")
    cleaned = _re.sub(r"\s+", " ", cleaned)
    return cleaned


def _strip_diacritics(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value or "")
    return "".join(char for char in normalized if not unicodedata.combining(char))


def _strip_nfl_matching_prefix(text: str) -> str:
    """Remove NFL eligibility preambles before athlete matching."""
    return _re.sub(
        r"^(?:[A-Z]\.[A-Za-z'’-]+(?:\s+and\s+[A-Z]\.[A-Za-z'’-]+)*\s+reported in as eligible\.\s*)+",
        "",
        text,
        flags=_re.IGNORECASE,
    ).strip()


def _strip_person_suffix(value: str) -> str:
    return _re.sub(r"\s+\b(jr|sr|ii|iii|iv|v)\.?$", "", value, flags=_re.IGNORECASE).strip()


def _alias_keys(value: str) -> set[str]:
    cleaned = _clean_person_name(value).lower()
    if not cleaned:
        return set()
    variants = {cleaned, _strip_diacritics(cleaned)}
    keys: set[str] = set()
    for variant in variants:
        if not variant:
            continue
        collapsed = _re.sub(r"\b([a-z])\.\s+(?=[a-z])", r"\1.", variant)
        keys.update({collapsed, collapsed.replace(" ", "")})
        no_period = collapsed.replace(".", "")
        keys.update({no_period, no_period.replace(" ", "")})
    return {key for key in keys if key}


def _player_aliases(name: str, short_name: str = "") -> set[str]:
    aliases: set[str] = set()
    clean_name = _clean_person_name(name)
    clean_short = _clean_person_name(short_name)
    for candidate in {clean_name, _strip_person_suffix(clean_name), clean_short, _strip_person_suffix(clean_short)}:
        if not candidate:
            continue
        aliases.add(candidate)
        parts = [part for part in candidate.split(" ") if part]
        if len(parts) >= 2:
            first = parts[0]
            last = parts[-1]
            aliases.add(last)
            aliases.add(f"{first[0]}.{last}")
            aliases.add(f"{first[0]}. {last}")
            aliases.add(f"{first[0]} {last}")
            if len(parts) >= 3:
                aliases.add(f"{first} {last}")
    return {alias for alias in aliases if alias}


async def _fetch_game_plays(event_id: str, league_key: str) -> list[dict]:
    """Fetch full play-by-play + boxscore for a single game via ESPN summary API.
    Returns a list of formatted play dicts, newest first."""
    cache_key = (ACTIVITY_CACHE_VERSION, league_key, str(event_id))
    cached_event = _event_activity_cache.get(cache_key)
    if cached_event and time.time() - cached_event[0] < EVENT_ACTIVITY_CACHE_TTL:
        return cached_event[1]

    sport, espn_league, _ = LEAGUES[league_key]
    hs_sport = _HEADSHOT_SPORT.get(league_key, sport)
    url = f"{ESPN_BASE}/{sport}/{espn_league}/summary?event={event_id}"
    data = await _fetch_cached(url, timeout=8.0)
    if not data:
        return []

    plays_raw = data.get("plays", [])

    if not plays_raw:
        drives = data.get("drives", {})
        drive_plays = []
        if isinstance(drives, dict):
            for bucket_key in ("previous", "current"):
                bucket = drives.get(bucket_key, [])
                if isinstance(bucket, list):
                    for drive in bucket:
                        if isinstance(drive, dict):
                            drive_plays.extend(drive.get("plays", []) or [])
                elif isinstance(bucket, dict):
                    drive_plays.extend(bucket.get("plays", []) or [])
        if drive_plays:
            plays_raw = drive_plays

    if league_key == "EPL" and not plays_raw:
        key_events = data.get("keyEvents", [])
        commentary = data.get("commentary", [])
        key_event_map = {
            str(ke.get("id", "")): ke
            for ke in key_events
            if isinstance(ke, dict) and ke.get("id")
        }
        synthesized = []
        for entry in commentary:
            text = entry.get("text", "")
            play = entry.get("play", {})
            commentary_sequence = entry.get("sequence", len(synthesized))
            if isinstance(play, dict) and play.get("id"):
                merged_play = dict(play)
                play_id = str(merged_play.get("id", ""))
                key_event = key_event_map.get(play_id, {})
                if text and not merged_play.get("text"):
                    merged_play["text"] = text
                if not merged_play.get("type"):
                    merged_play["type"] = {"text": "Commentary"}
                if not merged_play.get("clock"):
                    merged_play["clock"] = entry.get("time", {})
                if key_event:
                    merged_play["scoringPlay"] = key_event.get(
                        "scoringPlay",
                        merged_play.get("scoringPlay", False),
                    )
                    merged_play["wallclock"] = key_event.get(
                        "wallclock",
                        merged_play.get("wallclock", ""),
                    )
                else:
                    merged_play.setdefault("scoringPlay", False)
                    merged_play.setdefault("wallclock", "")
                # ESPN's soccer commentary-linked play objects often carry the
                # final score instead of the score at the moment of the play.
                # Let the running-score builder derive snapshots chronologically
                # from score text and prior events instead of trusting these.
                merged_play["homeScore"] = ""
                merged_play["awayScore"] = ""
                merged_play["sequenceNumber"] = str(
                    merged_play.get("sequenceNumber") or commentary_sequence
                )
                merged_play.setdefault("participants", play.get("participants", []))
                merged_play.setdefault("team", play.get("team", {}))
                synthesized.append(merged_play)
            elif text:
                text_lower = text.lower()
                period_num = 2 if "second half" in text_lower else 1 if "first half" in text_lower else 0
                synthesized.append({
                    "id": f"commentary_{commentary_sequence}",
                    "text": text,
                    "type": {"text": "Commentary"},
                    "period": {"number": period_num},
                    "clock": entry.get("time", {}),
                    "scoringPlay": False,
                    "wallclock": "",
                    "sequenceNumber": str(commentary_sequence),
                    "team": {},
                    "participants": [],
                })
        if synthesized:
            synthesized.sort(key=lambda play: _activity_sequence_value(play))
            plays_raw = synthesized

    # ── Soccer uses keyEvents + commentary instead of plays ──────────
    if league_key == "EPL" and not plays_raw:
        key_events = data.get("keyEvents", [])
        commentary = data.get("commentary", [])

        # Get team info from header
        header = data.get("header", {})
        header_comps = []
        for comp_block in header.get("competitions", [{}]):
            header_comps = comp_block.get("competitors", [])
        away_info = {"abbr": "", "name": "", "logo": "", "score": "0"}
        home_info = {"abbr": "", "name": "", "logo": "", "score": "0"}
        status_detail = ""
        game_status = "live"
        for hc in header_comps:
            team = hc.get("team", {})
            team_logo = team.get("logo", "")
            if not team_logo:
                logos = team.get("logos", [])
                if logos and isinstance(logos, list):
                    first = logos[0]
                    if isinstance(first, dict):
                        team_logo = first.get("href", "")
                    elif isinstance(first, str):
                        team_logo = first
            abbr = team.get("abbreviation", "")
            if not team_logo and abbr:
                team_logo = f"https://a.espncdn.com/i/teamlogos/soccer/500/{abbr.lower()}.png"
            info = {
                "abbr": abbr,
                "name": team.get("displayName", ""),
                "logo": team_logo,
                "score": hc.get("score", "0"),
            }
            if hc.get("homeAway", "") == "home":
                home_info = info
            else:
                away_info = info
        for comp_block in header.get("competitions", [{}]):
            st = comp_block.get("status", {})
            status_detail = st.get("type", {}).get("shortDetail", "")
            st_name = st.get("type", {}).get("name", "")
            if st_name in ("STATUS_FINAL", "STATUS_FULL_TIME"):
                game_status = "final"
            elif st_name == "STATUS_SCHEDULED":
                game_status = "scheduled"

        home_score = home_info["score"]
        away_score = away_info["score"]

        formatted = []
        current_home_score = 0
        current_away_score = 0
        # Use keyEvents as primary source — they have wallclock timestamps
        if key_events:
            for ke in key_events:
                ke_id = ke.get("id", "")
                text = ke.get("text", "")
                if not text:
                    continue
                ke_type = ke.get("type", {})
                type_text = ke_type.get("text", "")
                scoring = ke.get("scoringPlay", False)
                period = ke.get("period", {}).get("number", 1)
                clock_val = ke.get("clock", {}).get("displayValue", "")
                wallclock = ke.get("wallclock", "")

                # Format minute display (e.g. "45'")
                minute_display = clock_val if clock_val else ""
                if minute_display:
                    minute_display = f"{minute_display}'"

                event_home_score = current_home_score
                event_away_score = current_away_score
                ke_home_score = ke.get("homeScore")
                ke_away_score = ke.get("awayScore")
                if ke_home_score not in (None, "") and ke_away_score not in (None, ""):
                    try:
                        event_home_score = int(ke_home_score)
                        event_away_score = int(ke_away_score)
                        current_home_score = event_home_score
                        current_away_score = event_away_score
                    except (TypeError, ValueError):
                        pass
                else:
                    parsed_home_score, parsed_away_score = _parse_soccer_score_snapshot(
                        text,
                        home_info["name"],
                        away_info["name"],
                    )
                    if parsed_home_score is not None and parsed_away_score is not None:
                        event_home_score = parsed_home_score
                        event_away_score = parsed_away_score
                        current_home_score = event_home_score
                        current_away_score = event_away_score

                # Play team — for scoring plays try to identify from text
                play_team_name = ""
                play_team_abbr = ""
                play_team_logo = ""
                # Check if any team name is in the text
                if home_info["name"] and home_info["name"].lower().split()[-1] in text.lower():
                    play_team_name = home_info["name"]
                    play_team_abbr = home_info["abbr"]
                    play_team_logo = home_info["logo"]
                elif away_info["name"] and away_info["name"].lower().split()[-1] in text.lower():
                    play_team_name = away_info["name"]
                    play_team_abbr = away_info["abbr"]
                    play_team_logo = away_info["logo"]

                half_label = "1H" if period == 1 else "2H" if period == 2 else f"ET{period-2}"
                detail = f"{half_label} {minute_display}" if minute_display else status_detail

                formatted.append({
                    "id": f"{event_id}_{ke_id}",
                    "gameId": event_id,
                    "text": text,
                    "playType": type_text,
                    "athleteName": "",
                    "athleteHeadshot": "",
                    "athleteStats": "",
                    "athlete2Name": "",
                    "athlete2Headshot": "",
                    "playTeamName": play_team_name,
                    "playTeamAbbr": play_team_abbr,
                    "playTeamLogo": play_team_logo,
                    "league": league_key,
                    "status": game_status,
                    "statusDetail": detail,
                    "homeTeam": home_info["name"],
                    "awayTeam": away_info["name"],
                    "homeAbbr": home_info["abbr"],
                    "awayAbbr": away_info["abbr"],
                    "homeScore": event_home_score,
                    "awayScore": event_away_score,
                    "homeBadge": home_info["logo"],
                    "awayBadge": away_info["logo"],
                    "gameMatchup": f"{away_info['abbr']} vs {home_info['abbr']}",
                    "scoringPlay": scoring,
                    "scoreValue": 1 if scoring else 0,
                    "sequenceNumber": ke_id,
                    "_wallclock": wallclock,
                })
        elif commentary:
            # Fallback: use commentary (text-only, no wallclock — use sequence for ordering)
            for c in commentary:
                seq = c.get("sequence", 0)
                text = c.get("text", "")
                if not text:
                    continue
                clock_val = c.get("time", {}).get("displayValue", "")
                event_home_score = current_home_score
                event_away_score = current_away_score
                parsed_home_score, parsed_away_score = _parse_soccer_score_snapshot(
                    text,
                    home_info["name"],
                    away_info["name"],
                )
                if parsed_home_score is not None and parsed_away_score is not None:
                    event_home_score = parsed_home_score
                    event_away_score = parsed_away_score
                    current_home_score = event_home_score
                    current_away_score = event_away_score
                formatted.append({
                    "id": f"{event_id}_c{seq}",
                    "gameId": event_id,
                    "text": text,
                    "playType": "commentary",
                    "athleteName": "",
                    "athleteHeadshot": "",
                    "athleteStats": "",
                    "athlete2Name": "",
                    "athlete2Headshot": "",
                    "playTeamName": "",
                    "playTeamAbbr": "",
                    "playTeamLogo": "",
                    "league": league_key,
                    "status": game_status,
                    "statusDetail": f"{clock_val}'" if clock_val else status_detail,
                    "homeTeam": home_info["name"],
                    "awayTeam": away_info["name"],
                    "homeAbbr": home_info["abbr"],
                    "awayAbbr": away_info["abbr"],
                    "homeScore": event_home_score,
                    "awayScore": event_away_score,
                    "homeBadge": home_info["logo"],
                    "awayBadge": away_info["logo"],
                    "gameMatchup": f"{away_info['abbr']} vs {home_info['abbr']}",
                    "scoringPlay": False,
                    "scoreValue": 0,
                    "sequenceNumber": str(seq),
                    "_wallclock": "",
                })

        _event_activity_cache[cache_key] = (time.time(), formatted)
        return formatted

    if not plays_raw:
        return []

    # ── Build per-player stats from boxscore ──────────────────────────
    # athlete_id → {PTS: ..., FG: ..., 3PT: ..., REB: ..., AST: ..., ...}
    boxscore = data.get("boxscore", {})
    player_stats: dict[str, dict[str, str]] = {}  # athlete_id → stat dict
    player_names: dict[str, str] = {}   # athlete_id → display name
    player_short_names: dict[str, str] = {}  # athlete_id → short display name
    player_headshots: dict[str, str] = {}  # athlete_id → official ESPN mugshot
    player_teams: dict[str, dict] = {}  # athlete_id → team info
    player_aliases: dict[str, set[str]] = {}  # alias key → athlete ids

    for team_block in boxscore.get("players", []):
        team_info = team_block.get("team", {})
        team_name = team_info.get("displayName", "")
        team_abbr = team_info.get("abbreviation", "")
        team_logo = team_info.get("logo", "")
        for stat_section in team_block.get("statistics", []):
            section_labels = stat_section.get("labels", []) or []
            section_name = str(stat_section.get("name", "") or stat_section.get("displayName", "")).strip().lower()
            for ath_entry in stat_section.get("athletes", []):
                ath = ath_entry.get("athlete", {})
                aid = str(ath.get("id", ""))
                name = ath.get("displayName", "")
                short_name = ath.get("shortName", "")
                if not aid or not name:
                    continue
                stats_vals = ath_entry.get("stats", [])
                stat_dict = {}
                for i, label in enumerate(section_labels):
                    if i < len(stats_vals):
                        clean_label = str(label).strip()
                        clean_value = str(stats_vals[i]).strip()
                        if not clean_label or not clean_value:
                            continue
                        stat_dict.setdefault(clean_label, clean_value)
                        if section_name:
                            stat_dict[f"{section_name}:{clean_label}"] = clean_value
                stat_map = player_stats.setdefault(aid, {})
                for key, value in stat_dict.items():
                    stat_map.setdefault(key, value)
                player_names[aid] = _clean_person_name(name)
                player_short_names[aid] = _clean_person_name(short_name)
                player_headshots[aid] = await _resolve_activity_headshot(
                    league_key,
                    aid,
                    name,
                    team_name,
                    ath.get("headshot"),
                    sport,
                    hs_sport,
                )
                player_teams[aid] = {
                    "name": team_name, "abbr": team_abbr, "logo": team_logo,
                }

    for roster_block in data.get("rosters", []):
        team_info = roster_block.get("team", {})
        team_abbr = team_info.get("abbreviation", "")
        team_name = team_info.get("displayName", "")
        team_logo = ""
        team_logos = team_info.get("logos", [])
        if isinstance(team_logos, list) and team_logos:
            first_logo = team_logos[0]
            if isinstance(first_logo, dict):
                team_logo = first_logo.get("href", "")
            elif isinstance(first_logo, str):
                team_logo = first_logo
        if not team_logo and team_abbr:
            team_logo = f"https://a.espncdn.com/i/teamlogos/{sport}/500/{team_abbr.lower()}.png"

        for roster_entry in roster_block.get("roster", []):
            athlete = roster_entry.get("athlete", {})
            aid = str(athlete.get("id", ""))
            name = athlete.get("displayName", "") or athlete.get("fullName", "")
            short_name = athlete.get("shortName", "")
            if not aid or not name:
                continue
            player_names.setdefault(aid, _clean_person_name(name))
            player_short_names.setdefault(aid, _clean_person_name(short_name))
            if not player_headshots.get(aid):
                player_headshots[aid] = await _resolve_activity_headshot(
                    league_key,
                    aid,
                    name,
                    team_name,
                    athlete.get("headshot"),
                    sport,
                    hs_sport,
                )
            player_teams.setdefault(aid, {
                "name": team_name,
                "abbr": team_abbr,
                "logo": team_logo,
            })
            roster_stats = roster_entry.get("stats", []) or []
            if isinstance(roster_stats, list):
                stat_map = player_stats.setdefault(aid, {})
                for stat in roster_stats:
                    if not isinstance(stat, dict):
                        continue
                    abbr = str(stat.get("abbreviation", "")).strip()
                    name_key = str(stat.get("name", "")).strip()
                    display_value = str(stat.get("displayValue", "")).strip()
                    if not display_value:
                        continue
                    if abbr:
                        stat_map[abbr] = display_value
                    if name_key:
                        stat_map[name_key] = display_value

    for aid, name in player_names.items():
        short_name = player_short_names.get(aid, "")
        for alias in _player_aliases(name, short_name):
            for key in _alias_keys(alias):
                player_aliases.setdefault(key, set()).add(aid)

    resolved_player_cache: dict[tuple[str, str, tuple[str, ...]], dict] = {}

    def _resolve_player(candidate_name: str, preferred_team_abbr: str = "", excluded_ids: set[str] | None = None) -> dict:
        excluded = excluded_ids or set()
        candidate = _clean_person_name(candidate_name)
        candidate = candidate.strip("[]() ")
        candidate = _re.sub(r"^[A-Z]{2,4}-", "", candidate)
        if not candidate:
            return {}

        cache_lookup_key = (
            candidate.lower(),
            preferred_team_abbr.lower(),
            tuple(sorted(excluded)),
        )
        cached_player = resolved_player_cache.get(cache_lookup_key)
        if cached_player is not None:
            return cached_player

        def _candidate_payload(aid: str) -> dict:
            team_info = player_teams.get(aid, {})
            return {
                "id": aid,
                "name": player_names.get(aid, candidate),
                "headshot": player_headshots.get(aid, "") or _build_espn_headshot_url(aid, hs_sport),
                "teamName": team_info.get("name", ""),
                "teamAbbr": team_info.get("abbr", ""),
                "teamLogo": team_info.get("logo", ""),
            }

        def _pick_ids(ids: list[str]) -> list[str]:
            filtered = [aid for aid in ids if aid and aid not in excluded]
            if preferred_team_abbr:
                preferred = [
                    aid for aid in filtered
                    if player_teams.get(aid, {}).get("abbr", "").lower() == preferred_team_abbr.lower()
                ]
                if preferred:
                    filtered = preferred
            return list(dict.fromkeys(filtered))

        candidate_ids: list[str] = []
        for key in _alias_keys(candidate):
            candidate_ids.extend(sorted(player_aliases.get(key, set())))

        picked_ids = _pick_ids(candidate_ids)
        if len(picked_ids) == 1:
            payload = _candidate_payload(picked_ids[0])
            resolved_player_cache[cache_lookup_key] = payload
            return payload

        abbrev_match = _re.match(r"^([A-Za-z])\.?\s*([A-Za-z'’-]+)$", candidate)
        if abbrev_match:
            initial = abbrev_match.group(1).lower()
            last = abbrev_match.group(2).lower().replace("’", "'")
            initial_ids = []
            for aid, full_name in player_names.items():
                parts = [part for part in _strip_person_suffix(_clean_person_name(full_name)).split(" ") if part]
                if len(parts) >= 2 and parts[0][0].lower() == initial and parts[-1].lower().replace("’", "'") == last:
                    initial_ids.append(aid)
            picked_ids = _pick_ids(initial_ids)
            if len(picked_ids) == 1:
                payload = _candidate_payload(picked_ids[0])
                resolved_player_cache[cache_lookup_key] = payload
                return payload
            if preferred_team_abbr:
                last_name_ids = []
                for aid, full_name in player_names.items():
                    if player_teams.get(aid, {}).get("abbr", "").lower() != preferred_team_abbr.lower():
                        continue
                    parts = [part for part in _strip_person_suffix(_clean_person_name(full_name)).split(" ") if part]
                    if len(parts) >= 2 and parts[-1].lower().replace("â€™", "'") == last:
                        last_name_ids.append(aid)
                picked_ids = _pick_ids(last_name_ids)
                if len(picked_ids) == 1:
                    payload = _candidate_payload(picked_ids[0])
                    resolved_player_cache[cache_lookup_key] = payload
                    return payload
            global_last_name_ids = []
            for aid, full_name in player_names.items():
                if aid in excluded:
                    continue
                parts = [part for part in _strip_person_suffix(_clean_person_name(full_name)).split(" ") if part]
                if len(parts) >= 2 and parts[-1].lower().replace("Ã¢â‚¬â„¢", "'") == last:
                    global_last_name_ids.append(aid)
            picked_ids = _pick_ids(global_last_name_ids)
            if len(picked_ids) == 1:
                payload = _candidate_payload(picked_ids[0])
                resolved_player_cache[cache_lookup_key] = payload
                return payload

        fuzzy_ids = []
        candidate_lower = candidate.lower()
        for aid, full_name in player_names.items():
            normalized_name = _clean_person_name(full_name).lower()
            if normalized_name == candidate_lower:
                fuzzy_ids.append(aid)
            elif candidate_lower and (candidate_lower in normalized_name or normalized_name in candidate_lower):
                fuzzy_ids.append(aid)
        picked_ids = _pick_ids(fuzzy_ids)
        if len(picked_ids) == 1:
            payload = _candidate_payload(picked_ids[0])
            resolved_player_cache[cache_lookup_key] = payload
            return payload

        payload = _candidate_payload(picked_ids[0]) if picked_ids else {}
        resolved_player_cache[cache_lookup_key] = payload
        return payload

    # ── Get team info from header ───────────────────────────────────
    header = data.get("header", {})
    header_comps = []
    for comp_block in header.get("competitions", [{}]):
        header_comps = comp_block.get("competitors", [])
    away_info = {"abbr": "", "name": "", "logo": "", "score": "0"}
    home_info = {"abbr": "", "name": "", "logo": "", "score": "0"}
    status_detail = ""
    game_status = "live"
    for hc in header_comps:
        team = hc.get("team", {})
        # ESPN header may have "logo" as string OR "logos" as array
        team_logo = team.get("logo", "")
        if not team_logo:
            logos = team.get("logos", [])
            if logos and isinstance(logos, list):
                first = logos[0]
                if isinstance(first, dict):
                    team_logo = first.get("href", "")
                elif isinstance(first, str):
                    team_logo = first
        abbr = team.get("abbreviation", "")
        # Fallback: construct ESPN logo URL from abbreviation
        if not team_logo and abbr:
            team_logo = f"https://a.espncdn.com/i/teamlogos/{sport}/500/{abbr.lower()}.png"
        info = {
            "abbr": abbr,
            "name": team.get("displayName", ""),
            "logo": team_logo,
            "score": hc.get("score", "0"),
        }
        if hc.get("homeAway", "") == "home":
            home_info = info
        else:
            away_info = info
    # Status
    for comp_block in header.get("competitions", [{}]):
        st = comp_block.get("status", {})
        status_detail = st.get("type", {}).get("shortDetail", "")
        st_name = st.get("type", {}).get("name", "")
        if st_name in ("STATUS_FINAL", "STATUS_FULL_TIME"):
            game_status = "final"
        elif st_name == "STATUS_SCHEDULED":
            game_status = "scheduled"

    # ── Sort plays chronologically ──────────────────────────────────────
    # Clock counts DOWN in basketball/hockey, so: period ASC, clock DESC, seq ASC.
    def _clock_secs(p) -> float:
        """Convert clock display (e.g. '5:35', '0.1') to seconds for sorting."""
        raw = p.get("clock", {}).get("displayValue", "0")
        try:
            if ":" in raw:
                parts = raw.split(":")
                return float(parts[0]) * 60 + float(parts[1])
            return float(raw)
        except (ValueError, IndexError):
            return 0.0

    def _boundary_rank(p) -> int:
        text = str(p.get("text", "")).lower()
        type_text = str((p.get("type") or {}).get("text", "")).lower()
        combined = f"{type_text} {text}"
        if (
            "start of" in combined
            or "period start" in combined
            or "quarter start" in combined
            or "half begins" in combined
        ):
            return 0
        if (
            "end of" in combined
            or "period end" in combined
            or "quarter end" in combined
            or "half ends" in combined
            or "game end" in combined
            or "match ends" in combined
        ):
            return 2
        return 1

    def _chronological_period(p) -> int:
        explicit_period = int(p.get("period", {}).get("number", 0) or 0)
        if explicit_period:
            return explicit_period

        combined = f"{str((p.get('type') or {}).get('text', '')).lower()} {str(p.get('text', '')).lower()}"
        if "first half" in combined:
            return 1
        if "second half" in combined:
            return 2
        if "match ends" in combined or "game end" in combined:
            return 99
        return 0

    def _chronological_clock_progress(p) -> float:
        seconds = _clock_secs(p)
        if league_key == "NHL" or league_key == "EPL":
            return seconds
        return -seconds

    plays_raw.sort(key=lambda p: (
        int(p.get("period", {}).get("number", 0)),   # period 1 → 2 → 3
        -_clock_secs(p),                              # 12:00 → 0:00 (descending clock = chronological)
        int(p.get("sequenceNumber", 0)),               # tiebreaker
    ))
    plays_raw.sort(key=lambda p: (
        int(p.get("period", {}).get("number", 0)),
        _boundary_rank(p),
    ))
    plays_raw.sort(key=lambda p: (
        _chronological_period(p),
        _boundary_rank(p),
        _chronological_clock_progress(p),
        _activity_sequence_value(p),
    ))

    # ── Helper categories from ESPN type.text for running stat tracking ──
    _FG_MADE_TYPES = {
        "jump shot", "layup shot", "dunk shot", "hook shot", "tip shot",
        "floating jump shot", "driving layup shot", "driving dunk shot",
        "turnaround jump shot", "fade away jump shot", "pullup jump shot",
        "step back jump shot", "running layup shot", "running dunk shot",
        "cutting layup shot", "cutting dunk shot", "driving hook shot",
        "turnaround hook shot", "bank jump shot", "turnaround fade away jump shot",
        "driving floating jump shot", "driving finger roll layup",
        "running jump shot", "driving reverse dunk shot",
        "turnaround bank jump shot", "floating bank jump shot",
        "driving floating bank jump shot", "layup shot putback",
        "driving reverse layup shot", "alley oop dunk shot", "alley oop layup shot",
        "tip dunk shot", "putback dunk shot", "putback layup shot",
    }

    def _is_fg_type(play_type_text: str) -> bool:
        """Return True if this play type represents a field goal attempt."""
        t = play_type_text.lower().strip()
        # Free throws and non-shot plays
        if "free throw" in t:
            return False
        # Check for shot-like type
        return any(kw in t for kw in (
            "shot", "dunk", "layup", "jumper", "hook", "tip",
            "alley oop", "putback",
        ))

    def _is_three(play_text: str) -> bool:
        """Return True if this play involved a three-pointer based on the play text."""
        t = play_text.lower()
        return "three point" in t or "3-point" in t or "3pt" in t

    def _is_ft_type(play_type_text: str) -> bool:
        """Return True if this play type is a free throw."""
        return "free throw" in play_type_text.lower()

    def _is_rebound_type(play_type_text: str) -> bool:
        return "rebound" in play_type_text.lower()

    def _is_turnover_type(play_type_text: str) -> bool:
        t = play_type_text.lower()
        return "turnover" in t or "traveling" in t

    def _is_steal_type(play_type_text: str, play_text: str) -> bool:
        return "steal" in play_type_text.lower() or "steals)" in play_text.lower()

    def _is_block_type(play_type_text: str, play_text: str) -> bool:
        return "block" in play_type_text.lower() or "blocks" in play_text.lower()

    def _is_assist(play_text: str) -> bool:
        return "assists)" in play_text.lower() or "assist)" in play_text.lower()

    def _is_foul_type(play_type_text: str) -> bool:
        return "foul" in play_type_text.lower()

    # ── Running stats accumulator ──────────────────────────────────────
    # Track per-player running totals as we process plays chronologically
    running: dict[str, dict[str, int]] = {}  # aid → stat counters

    def _init_runner(aid: str):
        if aid not in running:
            running[aid] = {
                "PTS": 0, "FGM": 0, "FGA": 0, "3PM": 0, "3PA": 0,
                "FTM": 0, "FTA": 0, "REB": 0, "AST": 0, "STL": 0,
                "BLK": 0, "TO": 0,
            }

    def _format_running(aid: str) -> str:
        """Format the running stat line for display."""
        if aid not in running:
            return ""
        r = running[aid]
        parts = []
        if r["PTS"]:
            parts.append(f"{r['PTS']} PTS")
        parts.append(f"{r['FGM']}-{r['FGA']} FG")
        if r["3PA"]:
            parts.append(f"{r['3PM']}-{r['3PA']} 3PT")
        if r["FTA"]:
            parts.append(f"{r['FTM']}-{r['FTA']} FT")
        if r["REB"]:
            parts.append(f"{r['REB']} REB")
        if r["AST"]:
            parts.append(f"{r['AST']} AST")
        if r["STL"]:
            parts.append(f"{r['STL']} STL")
        if r["BLK"]:
            parts.append(f"{r['BLK']} BLK")
        if r["TO"]:
            parts.append(f"{r['TO']} TO")
        return " | ".join(parts)

    def _nonzero_stat(ps: dict[str, str], *keys: str) -> str:
        for key in keys:
            value = str(ps.get(key, "")).strip()
            if not value:
                continue
            if value in {"-", "--", "---", "?", "??", "???"}:
                continue
            if "---" in value or "??" in value:
                continue
            if value not in {"0", "0.0", "0-0", "0/0", "0-0-0"}:
                return value
        return ""

    def _format_nfl_stats(ps: dict[str, str], play_text: str) -> str:
        if not ps:
            return ""

        lower_text = play_text.lower()
        parts: list[str] = []

        if _nonzero_stat(ps, "C/ATT"):
            parts.append(f"{_nonzero_stat(ps, 'C/ATT')} C/ATT")
            if yds := _nonzero_stat(ps, "YDS"):
                parts.append(f"{yds} YDS")
            if td := _nonzero_stat(ps, "TD"):
                parts.append(f"{td} TD")
            if interceptions := _nonzero_stat(ps, "INT"):
                parts.append(f"{interceptions} INT")
            return " | ".join(parts[:4])

        if _nonzero_stat(ps, "CAR"):
            parts.append(f"{_nonzero_stat(ps, 'CAR')} CAR")
            if yds := _nonzero_stat(ps, "YDS"):
                parts.append(f"{yds} YDS")
            if avg := _nonzero_stat(ps, "AVG"):
                parts.append(f"{avg} AVG")
            if td := _nonzero_stat(ps, "TD"):
                parts.append(f"{td} TD")
            return " | ".join(parts[:4])

        if _nonzero_stat(ps, "REC"):
            parts.append(f"{_nonzero_stat(ps, 'REC')} REC")
            if yds := _nonzero_stat(ps, "YDS"):
                parts.append(f"{yds} YDS")
            if tgts := _nonzero_stat(ps, "TGTS"):
                parts.append(f"{tgts} TGTS")
            if td := _nonzero_stat(ps, "TD"):
                parts.append(f"{td} TD")
            return " | ".join(parts[:4])

        if _nonzero_stat(ps, "TOT", "SOLO", "SACKS", "TFL", "PD", "INT"):
            if tot := _nonzero_stat(ps, "TOT"):
                parts.append(f"{tot} TOT")
            if solo := _nonzero_stat(ps, "SOLO"):
                parts.append(f"{solo} SOLO")
            if sacks := _nonzero_stat(ps, "SACKS"):
                parts.append(f"{sacks} SACKS")
            if tfl := _nonzero_stat(ps, "TFL"):
                parts.append(f"{tfl} TFL")
            if pd := _nonzero_stat(ps, "PD"):
                parts.append(f"{pd} PD")
            if ints := _nonzero_stat(ps, "INT"):
                parts.append(f"{ints} INT")
            return " | ".join(parts[:4])

        if "punt" in lower_text and _nonzero_stat(ps, "NO", "YDS", "AVG"):
            if no := _nonzero_stat(ps, "NO"):
                parts.append(f"{no} PUNTS")
            if yds := _nonzero_stat(ps, "YDS"):
                parts.append(f"{yds} YDS")
            if avg := _nonzero_stat(ps, "AVG"):
                parts.append(f"{avg} AVG")
            if in20 := _nonzero_stat(ps, "In 20"):
                parts.append(f"{in20} IN20")
            return " | ".join(parts[:4])

        if _nonzero_stat(ps, "FG", "XP", "PTS"):
            if fg := _nonzero_stat(ps, "FG"):
                parts.append(f"{fg} FG")
            if xp := _nonzero_stat(ps, "XP"):
                parts.append(f"{xp} XP")
            if pts := _nonzero_stat(ps, "PTS"):
                parts.append(f"{pts} PTS")
            if long := _nonzero_stat(ps, "LONG"):
                parts.append(f"{long} LONG")
            return " | ".join(parts[:4])

        for key in ("YDS", "TD", "INT", "AVG", "LONG", "NO"):
            if value := _nonzero_stat(ps, key):
                parts.append(f"{value} {key}")
            return " | ".join(parts[:4])

    def _format_nfl_stats_precise(ps: dict[str, str], play_text: str) -> str:
        if not ps:
            return ""

        lower_text = play_text.lower()
        fallback = _format_nfl_stats(ps, play_text)

        def _section_nonzero(section: str, *keys: str) -> str:
            return _nonzero_stat(ps, *(f"{section}:{key}" for key in keys))

        def _join(parts_in: list[str]) -> str:
            return " | ".join(parts_in[:4])

        def _passing() -> str:
            local_parts: list[str] = []
            if comp_att := _section_nonzero("passing", "C/ATT"):
                local_parts.append(f"{comp_att} C/ATT")
            if yds := _section_nonzero("passing", "YDS"):
                local_parts.append(f"{yds} YDS")
            if td := _section_nonzero("passing", "TD"):
                local_parts.append(f"{td} TD")
            if interceptions := _section_nonzero("passing", "INT"):
                local_parts.append(f"{interceptions} INT")
            return _join(local_parts)

        def _rushing() -> str:
            local_parts: list[str] = []
            if car := _section_nonzero("rushing", "CAR"):
                local_parts.append(f"{car} CAR")
            if yds := _section_nonzero("rushing", "YDS"):
                local_parts.append(f"{yds} YDS")
            if avg := _section_nonzero("rushing", "AVG"):
                local_parts.append(f"{avg} AVG")
            if td := _section_nonzero("rushing", "TD"):
                local_parts.append(f"{td} TD")
            return _join(local_parts)

        def _receiving() -> str:
            local_parts: list[str] = []
            if rec := _section_nonzero("receiving", "REC"):
                local_parts.append(f"{rec} REC")
            if yds := _section_nonzero("receiving", "YDS"):
                local_parts.append(f"{yds} YDS")
            if tgts := _section_nonzero("receiving", "TGTS"):
                local_parts.append(f"{tgts} TGTS")
            if td := _section_nonzero("receiving", "TD"):
                local_parts.append(f"{td} TD")
            return _join(local_parts)

        def _defense() -> str:
            local_parts: list[str] = []
            if tot := _section_nonzero("defensive", "TOT"):
                local_parts.append(f"{tot} TOT")
            if solo := _section_nonzero("defensive", "SOLO"):
                local_parts.append(f"{solo} SOLO")
            if sacks := _section_nonzero("defensive", "SACKS"):
                local_parts.append(f"{sacks} SACKS")
            if tfl := _section_nonzero("defensive", "TFL"):
                local_parts.append(f"{tfl} TFL")
            if pd := _section_nonzero("defensive", "PD"):
                local_parts.append(f"{pd} PD")
            if ints := _section_nonzero("interceptions", "INT"):
                local_parts.append(f"{ints} INT")
            return _join(local_parts)

        def _punting() -> str:
            local_parts: list[str] = []
            if no := _section_nonzero("punting", "NO"):
                local_parts.append(f"{no} PUNTS")
            if yds := _section_nonzero("punting", "YDS"):
                local_parts.append(f"{yds} YDS")
            if avg := _section_nonzero("punting", "AVG"):
                local_parts.append(f"{avg} AVG")
            if in20 := _section_nonzero("punting", "In 20"):
                local_parts.append(f"{in20} IN20")
            return _join(local_parts)

        def _kicking() -> str:
            local_parts: list[str] = []
            if fg := _section_nonzero("kicking", "FG"):
                local_parts.append(f"{fg} FG")
            if xp := _section_nonzero("kicking", "XP"):
                local_parts.append(f"{xp} XP")
            if pts := _section_nonzero("kicking", "PTS"):
                local_parts.append(f"{pts} PTS")
            if long := _section_nonzero("kicking", "LONG"):
                local_parts.append(f"{long} LONG")
            return _join(local_parts)

        def _returns(section: str, label: str) -> str:
            local_parts: list[str] = []
            if no := _section_nonzero(section, "NO"):
                local_parts.append(f"{no} {label}")
            if yds := _section_nonzero(section, "YDS"):
                local_parts.append(f"{yds} YDS")
            if avg := _section_nonzero(section, "AVG"):
                local_parts.append(f"{avg} AVG")
            if long := _section_nonzero(section, "LONG"):
                local_parts.append(f"{long} LONG")
            return _join(local_parts)

        if any(token in lower_text for token in ("pass", "sacked", "scramble", "spike", "kneel")):
            if value := _passing():
                return value
        if "punt" in lower_text:
            if value := _punting():
                return value
        if any(token in lower_text for token in ("field goal", "extra point", "onside")):
            if value := _kicking():
                return value
        if any(token in lower_text for token in ("left end", "right end", "left tackle", "right tackle", "left guard", "right guard", "up the middle")):
            if value := _rushing():
                return value
        if any(token in lower_text for token in (" to ", "intended for", "touchdown", "incomplete")):
            if value := _receiving():
                return value
        if any(token in lower_text for token in ("tackle", "intercepted", "penalty")):
            if value := _defense():
                return value

        for builder in (_passing, _rushing, _receiving, _defense, _punting, _kicking):
            if value := builder():
                return value
        for value in (_returns("kickreturns", "KR"), _returns("puntreturns", "PR")):
            if value:
                return value
        return fallback

    def _format_epl_stats(ps: dict[str, str]) -> str:
        if not ps:
            return ""

        parts: list[str] = []
        if goals := _nonzero_stat(ps, "G", "totalGoals"):
            parts.append(f"{goals} G")
        if assists := _nonzero_stat(ps, "A", "goalAssists"):
            parts.append(f"{assists} A")
        if shots_on_target := _nonzero_stat(ps, "ST", "shotsOnTarget"):
            parts.append(f"{shots_on_target} ST")
        if shots := _nonzero_stat(ps, "SH", "totalShots"):
            parts.append(f"{shots} SH")
        if saves := _nonzero_stat(ps, "SV", "saves"):
            parts.append(f"{saves} SV")
        if yellows := _nonzero_stat(ps, "YC", "yellowCards"):
            parts.append(f"{yellows} YC")
        if reds := _nonzero_stat(ps, "RC", "redCards"):
            parts.append(f"{reds} RC")
        if offsides := _nonzero_stat(ps, "OF", "offsides"):
            parts.append(f"{offsides} OF")
        if fouls_committed := _nonzero_stat(ps, "FC", "foulsCommitted"):
            parts.append(f"{fouls_committed} FC")
        if fouls_suffered := _nonzero_stat(ps, "FA", "foulsSuffered"):
            parts.append(f"{fouls_suffered} FA")
        if parts:
            return " | ".join(parts[:4])
        return ""

    def _coerce_activity_score(value) -> int | None:
        if value in (None, ""):
            return None
        try:
            return int(value)
        except (TypeError, ValueError):
            return None

    formatted = []
    mlb_current_detail = ""
    at_bat_tracker: dict[str, dict] = {}  # event_id → {pitcher_name, pitcher_id, batter_name, batter_id}
    soccer_running_home_score = 0 if league_key == "EPL" else None
    soccer_running_away_score = 0 if league_key == "EPL" else None
    for play in plays_raw:
        play_id = str(play.get("id", ""))
        text = play.get("text", "")
        if not text or not play_id:
            continue
        if _is_junk_play(text):
            continue

        clock = play.get("clock", {}).get("displayValue", "")
        period = play.get("period", {}).get("number", 0)
        scoring = play.get("scoringPlay", False)
        score_val = play.get("scoreValue", 0)
        explicit_away_score = _coerce_activity_score(play.get("awayScore"))
        explicit_home_score = _coerce_activity_score(play.get("homeScore"))
        if league_key == "EPL":
            if explicit_home_score is not None and explicit_away_score is not None:
                soccer_running_home_score = explicit_home_score
                soccer_running_away_score = explicit_away_score
            else:
                parsed_home_score, parsed_away_score = _parse_soccer_score_snapshot(
                    text,
                    home_info["name"],
                    away_info["name"],
                )
                if parsed_home_score is not None and parsed_away_score is not None:
                    soccer_running_home_score = parsed_home_score
                    soccer_running_away_score = parsed_away_score
            away_score = (
                soccer_running_away_score
                if soccer_running_away_score is not None
                else _coerce_activity_score(away_info["score"]) or 0
            )
            home_score = (
                soccer_running_home_score
                if soccer_running_home_score is not None
                else _coerce_activity_score(home_info["score"]) or 0
            )
        else:
            away_score = explicit_away_score if explicit_away_score is not None else (_coerce_activity_score(away_info["score"]) or 0)
            home_score = explicit_home_score if explicit_home_score is not None else (_coerce_activity_score(home_info["score"]) or 0)

        # Play team
        play_team = play.get("team", {}) or {}
        play_team_name = ""
        play_team_abbr = ""
        play_team_logo = ""
        if play_team:
            play_team_name = play_team.get("displayName", "")
            play_team_abbr = play_team.get("abbreviation", "")
            play_team_logo = play_team.get("logo", "")
            if not play_team_logo:
                if play_team_abbr == away_info["abbr"]:
                    play_team_logo = away_info["logo"]
                elif play_team_abbr == home_info["abbr"]:
                    play_team_logo = home_info["logo"]
            if not play_team_name:
                if play_team_abbr == away_info["abbr"]:
                    play_team_name = away_info["name"]
                elif play_team_abbr == home_info["abbr"]:
                    play_team_name = home_info["name"]

        # If still no team logo, try to match from team abbr/name in text
        if not play_team_logo:
            text_lower = text.lower()
            # Match by abbreviation
            if away_info["abbr"] and away_info["abbr"].lower() in text_lower:
                play_team_logo = away_info["logo"]
                play_team_name = play_team_name or away_info["name"]
                play_team_abbr = play_team_abbr or away_info["abbr"]
            elif home_info["abbr"] and home_info["abbr"].lower() in text_lower:
                play_team_logo = home_info["logo"]
                play_team_name = play_team_name or home_info["name"]
                play_team_abbr = play_team_abbr or home_info["abbr"]
            else:
                # Match by short team name (e.g., "Jazz" in "Jazz offensive team rebound")
                away_short = away_info["name"].split()[-1].lower() if away_info["name"] else ""
                home_short = home_info["name"].split()[-1].lower() if home_info["name"] else ""
                if away_short and away_short in text_lower:
                    play_team_logo = away_info["logo"]
                    play_team_name = play_team_name or away_info["name"]
                    play_team_abbr = play_team_abbr or away_info["abbr"]
                elif home_short and home_short in text_lower:
                    play_team_logo = home_info["logo"]
                    play_team_name = play_team_name or home_info["name"]
                    play_team_abbr = play_team_abbr or home_info["abbr"]

        # Participants
        participants = play.get("participants", [])
        athlete_name = ""
        athlete_headshot = ""
        athlete_stats_str = ""
        athlete2_name = ""
        athlete2_headshot = ""
        aid1 = ""

        # ── Determine the REAL primary actor from play text ──────────
        # ESPN's participants[0] is UNRELIABLE — for assist plays,
        # the assister can be listed as participants[0] instead of the scorer.
        # The play text is always reliable: "[Player] makes/misses ..."

        real_actor_name = ""
        real_actor_id = ""
        assister_name_from_text = ""
        assister_id_from_text = ""
        secondary_name_from_text = ""
        secondary_id_from_text = ""

        def _set_play_team_from_name(candidate_team_name: str):
            nonlocal play_team_name, play_team_abbr, play_team_logo
            candidate = _clean_person_name(candidate_team_name).lower()
            if not candidate:
                return
            for team_info in (home_info, away_info):
                team_name = _clean_person_name(team_info.get("name", "")).lower()
                if not team_name:
                    continue
                if candidate == team_name or candidate in team_name or team_name in candidate:
                    play_team_name = play_team_name or team_info.get("name", "")
                    play_team_abbr = play_team_abbr or team_info.get("abbr", "")
                    play_team_logo = play_team_logo or team_info.get("logo", "")
                    return

        # Extract the name before action verbs (NBA + MLB + NHL + Soccer)
        text_for_matching = _re.sub(r"^(?:\([^)]*\)\s*)+", "", text.strip())
        if league_key == "NFL":
            text_for_matching = _strip_nfl_matching_prefix(text_for_matching)
        text_lower_match = text_for_matching.lower()
        actor_match = _re.match(
            r"^(.+?)\s+(?:"
            # NBA verbs
            r"makes?|misses?|blocks?|lost ball|out of bounds|bad pass|"
            r"offensive foul|traveling|shooting foul|personal foul|"
            r"loose ball foul|offensive charge|defensive 3|"
            # MLB verbs
            r"pitches?\s|struck out|singled|doubled|tripled|homered|"
            r"grounded\s|flied\s|lined\s|popped\s|walked|hit by pitch|"
            r"reached\s|stole\s|caught stealing|advanced\s|scored|"
            r"fouled\s|bunted|sacrificed|tagged\s|picked off|"
            r"in\s+(?:left|right|center)\s+field|"
            r"to\s+(?:first|second|third|short|pitcher|catcher)|"
            # NHL verbs
            r"shot |wrist shot|slap shot|snap shot|backhand|"
            r"won faceoff|lost faceoff|"
            # NFL verbs
            r"pass(?:es|ed)?|scrambles?|sacked|punts?|kicks?|kneels?|spikes?|"
            r"right end|left end|right tackle|left tackle|right guard|left guard|"
            r"up the middle|touchdown|field goal|extra point|timeout|"
            # Soccer verbs
            r"goal\s|corner kick|yellow card|red card|substitution"
            r")",
            text_for_matching, _re.IGNORECASE
        )

        # Also try matching "X pitches to Y" for at-bat tracking
        pitches_match = _re.match(
            r"^(.+?)\s+pitches?\s+to\s+(.+?)$",
            text_for_matching, _re.IGNORECASE
        )

        if league_key == "EPL":
            soccer_goal_match = _re.match(
                r"^Goal!\s+[^.]+\.\s+(.+?)\s+\((.+?)\)\b",
                text_for_matching,
                _re.IGNORECASE,
            )
            soccer_sub_match = _re.match(
                r"^Substitution,\s+(.+?)\.\s+(.+?)\s+replaces\s+(.+?)(?:\.| because| due to|$)",
                text_for_matching,
                _re.IGNORECASE,
            )
            soccer_card_match = _re.match(
                r"^(.+?)\s+\((.+?)\)\s+is shown the (?:yellow|red) card",
                text_for_matching,
                _re.IGNORECASE,
            )
            soccer_attempt_match = _re.match(
                r"^(?:Attempt [^.]+\.\s+)?(.+?)\s+\((.+?)\)\b",
                text_for_matching,
                _re.IGNORECASE,
            )
            soccer_offside_match = _re.match(
                r"^Offside,\s+(.+?)\.\s+(.+?)\s+is caught offside",
                text_for_matching,
                _re.IGNORECASE,
            )
            soccer_foul_match = _re.match(
                r"^(.+?)\s+\((.+?)\)\s+(?:wins a free kick|commits a foul|concedes a free kick)\b",
                text_for_matching,
                _re.IGNORECASE,
            )
            soccer_named_team_match = _re.match(
                r"^(.+?)\s+\((.+?)\)\s+",
                text_for_matching,
                _re.IGNORECASE,
            )
            if soccer_goal_match:
                _set_play_team_from_name(soccer_goal_match.group(2))
                primary = _resolve_player(soccer_goal_match.group(1), preferred_team_abbr=play_team_abbr)
                if primary:
                    real_actor_name = primary["name"]
                    real_actor_id = primary["id"]
            elif soccer_sub_match:
                _set_play_team_from_name(soccer_sub_match.group(1))
                primary = _resolve_player(soccer_sub_match.group(2), preferred_team_abbr=play_team_abbr)
                secondary = _resolve_player(
                    soccer_sub_match.group(3),
                    preferred_team_abbr=play_team_abbr,
                    excluded_ids={primary.get("id", "")} if primary.get("id") else set(),
                )
                if primary:
                    real_actor_name = primary["name"]
                    real_actor_id = primary["id"]
                if secondary:
                    secondary_name_from_text = secondary["name"]
                    secondary_id_from_text = secondary["id"]
            elif soccer_card_match:
                _set_play_team_from_name(soccer_card_match.group(2))
                primary = _resolve_player(soccer_card_match.group(1), preferred_team_abbr=play_team_abbr)
                if primary:
                    real_actor_name = primary["name"]
                    real_actor_id = primary["id"]
            elif soccer_offside_match:
                _set_play_team_from_name(soccer_offside_match.group(1))
                primary = _resolve_player(soccer_offside_match.group(2), preferred_team_abbr=play_team_abbr)
                if primary:
                    real_actor_name = primary["name"]
                    real_actor_id = primary["id"]
            elif soccer_foul_match:
                _set_play_team_from_name(soccer_foul_match.group(2))
                primary = _resolve_player(soccer_foul_match.group(1), preferred_team_abbr=play_team_abbr)
                if primary:
                    real_actor_name = primary["name"]
                    real_actor_id = primary["id"]
            elif soccer_attempt_match:
                _set_play_team_from_name(soccer_attempt_match.group(2))
                primary = _resolve_player(soccer_attempt_match.group(1), preferred_team_abbr=play_team_abbr)
                if primary:
                    real_actor_name = primary["name"]
                    real_actor_id = primary["id"]
            elif soccer_named_team_match:
                _set_play_team_from_name(soccer_named_team_match.group(2))
                primary = _resolve_player(soccer_named_team_match.group(1), preferred_team_abbr=play_team_abbr)
                if primary:
                    real_actor_name = primary["name"]
                    real_actor_id = primary["id"]

        if league_key == "NFL":
            pass_match = _re.match(
                r"^([A-Z]\.[A-Za-z'’-]+)\s+pass\b.*?\b(?:intended for|to)\s+([A-Z]\.[A-Za-z'’-]+)",
                text_for_matching,
                _re.IGNORECASE,
            )
            sack_match = _re.match(
                r"^([A-Z]\.[A-Za-z'’-]+)\s+sacked\b.*\(([A-Z]\.[A-Za-z'’-]+)",
                text_for_matching,
                _re.IGNORECASE,
            )
            rush_match = _re.match(
                r"^([A-Z]\.[A-Za-z'’-]+)\s+(?:scrambles?|right end|left end|right tackle|left tackle|right guard|left guard|up the middle|kneels?|spikes?)\b",
                text_for_matching,
                _re.IGNORECASE,
            )
            kick_match = _re.match(
                r"^([A-Z]\.[A-Za-z'’-]+)\s+(?:punts?|kicks?)\b",
                text_for_matching,
                _re.IGNORECASE,
            )
            scoring_kick_match = _re.match(
                r"^([A-Z]\.[A-Za-z'’-]+)\s+(?:\d+\s+yard field goal|extra point)\b",
                text_for_matching,
                _re.IGNORECASE,
            )

            if pass_match:
                primary = _resolve_player(pass_match.group(1), preferred_team_abbr=play_team_abbr)
                secondary = _resolve_player(
                    pass_match.group(2),
                    preferred_team_abbr=primary.get("teamAbbr", "") or play_team_abbr,
                    excluded_ids={primary.get("id", "")} if primary.get("id") else set(),
                )
                if primary:
                    real_actor_name = primary["name"]
                    real_actor_id = primary["id"]
                if secondary:
                    secondary_name_from_text = secondary["name"]
                    secondary_id_from_text = secondary["id"]
            elif sack_match:
                primary = _resolve_player(sack_match.group(1), preferred_team_abbr=play_team_abbr)
                secondary = _resolve_player(
                    sack_match.group(2),
                    excluded_ids={primary.get("id", "")} if primary.get("id") else set(),
                )
                if primary:
                    real_actor_name = primary["name"]
                    real_actor_id = primary["id"]
                if secondary:
                    secondary_name_from_text = secondary["name"]
                    secondary_id_from_text = secondary["id"]
            elif rush_match:
                primary = _resolve_player(rush_match.group(1), preferred_team_abbr=play_team_abbr)
                if primary:
                    real_actor_name = primary["name"]
                    real_actor_id = primary["id"]
                tackle_match = _re.search(r"\(([A-Z]\.[A-Za-z'’-]+)", text_for_matching, _re.IGNORECASE)
                if tackle_match:
                    defending_team_abbr = away_info["abbr"] if play_team_abbr == home_info["abbr"] else home_info["abbr"]
                    secondary = _resolve_player(
                        tackle_match.group(1),
                        preferred_team_abbr=defending_team_abbr,
                        excluded_ids={primary.get("id", "")} if primary.get("id") else set(),
                    )
                    if secondary:
                        secondary_name_from_text = secondary["name"]
                        secondary_id_from_text = secondary["id"]
            elif kick_match:
                primary = _resolve_player(kick_match.group(1), preferred_team_abbr=play_team_abbr)
                if primary:
                    real_actor_name = primary["name"]
                    real_actor_id = primary["id"]
                returner_match = _re.search(r"\.\s*([A-Z]\.[A-Za-z'’-]+)\b", text_for_matching, _re.IGNORECASE)
                if returner_match:
                    secondary = _resolve_player(
                        returner_match.group(1),
                        excluded_ids={primary.get("id", "")} if primary.get("id") else set(),
                    )
                    if secondary:
                        secondary_name_from_text = secondary["name"]
                        secondary_id_from_text = secondary["id"]
            elif scoring_kick_match:
                primary = _resolve_player(scoring_kick_match.group(1), preferred_team_abbr=play_team_abbr)
                if primary:
                    real_actor_name = primary["name"]
                    real_actor_id = primary["id"]

        if pitches_match:
            # "Raisel Iglesias pitches to Taylor Walls"
            pitcher_name = pitches_match.group(1).strip()
            batter_name = pitches_match.group(2).strip()
            resolved_pitcher = _resolve_player(pitcher_name, preferred_team_abbr=play_team_abbr)
            resolved_batter = _resolve_player(
                batter_name,
                preferred_team_abbr=resolved_pitcher.get("teamAbbr", "") or play_team_abbr,
                excluded_ids={resolved_pitcher.get("id", "")} if resolved_pitcher.get("id") else set(),
            )
            if resolved_pitcher:
                real_actor_name = resolved_pitcher["name"]
                real_actor_id = resolved_pitcher["id"]
            if resolved_batter:
                assister_name_from_text = resolved_batter["name"]  # reuse for display
                assister_id_from_text = resolved_batter["id"]
            # Track this at-bat for subsequent pitch-count plays
            at_bat_tracker[event_id] = {
                "pitcher_name": real_actor_name or pitcher_name,
                "pitcher_id": real_actor_id,
                "batter_name": assister_name_from_text or batter_name,
                "batter_id": assister_id_from_text,
            }
        elif actor_match:
            candidate_name = actor_match.group(1).strip()
            resolved_actor = _resolve_player(candidate_name, preferred_team_abbr=play_team_abbr)
            if resolved_actor:
                real_actor_name = resolved_actor["name"]
                real_actor_id = resolved_actor["id"]

        # Extract assister from "(PlayerName assists)" pattern
        assist_match = _re.search(r"\((.+?)\s+assists?\)", text, _re.IGNORECASE)
        if assist_match:
            assist_candidate = assist_match.group(1).strip()
            resolved_assister = _resolve_player(
                assist_candidate,
                preferred_team_abbr=play_team_abbr,
                excluded_ids={real_actor_id} if real_actor_id else set(),
            )
            if resolved_assister:
                assister_name_from_text = resolved_assister["name"]
                assister_id_from_text = resolved_assister["id"]
        if league_key == "EPL":
            soccer_assist_match = _re.search(r"\bAssisted by (.+?)(?:\.|$)", text, _re.IGNORECASE)
            if soccer_assist_match:
                assist_candidate = soccer_assist_match.group(1).strip()
                resolved_assister = _resolve_player(
                    assist_candidate,
                    preferred_team_abbr=play_team_abbr,
                    excluded_ids={real_actor_id} if real_actor_id else set(),
                )
                if resolved_assister:
                    assister_name_from_text = resolved_assister["name"]
                    assister_id_from_text = resolved_assister["id"]

        # Extract stealer from "(PlayerName steals)" pattern
        steal_match = _re.search(r"\((.+?)\s+steals?\)", text, _re.IGNORECASE)
        stealer_name_from_text = ""
        stealer_id_from_text = ""
        if steal_match:
            steal_candidate = steal_match.group(1).strip()
            resolved_stealer = _resolve_player(
                steal_candidate,
                preferred_team_abbr=play_team_abbr,
                excluded_ids={real_actor_id} if real_actor_id else set(),
            )
            if resolved_stealer:
                stealer_name_from_text = resolved_stealer["name"]
                stealer_id_from_text = resolved_stealer["id"]

        # Use our text-derived actor if found, otherwise fall back to participants[0]
        if real_actor_id:
            aid1 = real_actor_id
            athlete_name = real_actor_name
            athlete_headshot = player_headshots.get(aid1, "") or _build_espn_headshot_url(aid1, hs_sport)
        elif participants:
            p1 = participants[0] if isinstance(participants[0], dict) else {}
            ath1 = p1.get("athlete", {})
            aid1 = str(ath1.get("id", ""))
            athlete_name = ath1.get("displayName", "")
            ath1_hs = ath1.get("headshot", "")
            if isinstance(ath1_hs, dict):
                athlete_headshot = ath1_hs.get("href", "")
            elif isinstance(ath1_hs, str):
                athlete_headshot = ath1_hs
            if not athlete_headshot and aid1:
                athlete_headshot = player_headshots.get(aid1, "") or _build_espn_headshot_url(aid1, hs_sport)
        if athlete_name and (not aid1 or not athlete_headshot):
            resolved_primary = _resolve_player(athlete_name, preferred_team_abbr=play_team_abbr)
            if resolved_primary:
                aid1 = aid1 or resolved_primary["id"]
                athlete_name = resolved_primary["name"] or athlete_name
                athlete_headshot = athlete_headshot or resolved_primary["headshot"]
                play_team_name = play_team_name or resolved_primary["teamName"]
                play_team_abbr = play_team_abbr or resolved_primary["teamAbbr"]
                play_team_logo = play_team_logo or resolved_primary["teamLogo"]

        # Pitch-count fallback: "Pitch 2 : Strike 2 Foul" → use tracked batter/pitcher pairing
        pitch_tracker_applied = False
        if text_lower_match.startswith("pitch") and event_id in at_bat_tracker:
            ab = at_bat_tracker[event_id]
            batter_name = ab.get("batter_name", "")
            batter_id = ab.get("batter_id", "")
            pitcher_name = ab.get("pitcher_name", "")
            pitcher_id = ab.get("pitcher_id", "")

            # Show the batter as main, pitcher as secondary for pitch-by-pitch events.
            if batter_name:
                athlete_name = batter_name
                if batter_id:
                    aid1 = batter_id
                    athlete_headshot = player_headshots.get(batter_id, "") or _build_espn_headshot_url(batter_id, hs_sport)

            if pitcher_name and pitcher_name != athlete_name:
                athlete2_name = pitcher_name
                if pitcher_id:
                    athlete2_headshot = player_headshots.get(pitcher_id, "") or _build_espn_headshot_url(pitcher_id, hs_sport)

            pitch_tracker_applied = bool(athlete_name or athlete2_name)

            # Enrich text with batter/pitcher names for clarity
            batter_disp = ab.get("batter_name", "")
            pitcher_disp = ab.get("pitcher_name", "")
            if batter_disp and pitcher_disp and " vs " not in text:
                text = f"{text}  —  {batter_disp} vs {pitcher_disp}"
            elif batter_disp:
                text = f"{batter_disp}: {text}"

        # Some MLB pitch-tracker rows already include "Batter vs Pitcher" text but do not
        # have the at-bat tracker primed yet. Parse the display text directly as a fallback.
        if text_lower_match.startswith("pitch") and " vs " in text.lower():
            versus_match = _re.search(r"[—-]\s*(.+?)\s+vs\s+(.+)$", text)
            if versus_match:
                batter_candidate = versus_match.group(1).strip()
                pitcher_candidate = versus_match.group(2).strip()

                resolved_batter_name = ""
                resolved_batter_id = ""
                resolved_pitcher_name = ""
                resolved_pitcher_id = ""

                for pid, pname in player_names.items():
                    if pname.lower() == batter_candidate.lower():
                        resolved_batter_name = pname
                        resolved_batter_id = pid
                        break
                if not resolved_batter_id:
                    for pid, pname in player_names.items():
                        if pname.lower() in batter_candidate.lower() or batter_candidate.lower() in pname.lower():
                            if len(pname) > len(resolved_batter_name):
                                resolved_batter_name = pname
                                resolved_batter_id = pid

                for pid, pname in player_names.items():
                    if pname.lower() == pitcher_candidate.lower():
                        resolved_pitcher_name = pname
                        resolved_pitcher_id = pid
                        break
                if not resolved_pitcher_id:
                    for pid, pname in player_names.items():
                        if pname.lower() in pitcher_candidate.lower() or pitcher_candidate.lower() in pname.lower():
                            if len(pname) > len(resolved_pitcher_name):
                                resolved_pitcher_name = pname
                                resolved_pitcher_id = pid

                if resolved_batter_name:
                    athlete_name = resolved_batter_name
                    if resolved_batter_id:
                        aid1 = resolved_batter_id
                        athlete_headshot = player_headshots.get(resolved_batter_id, "") or _build_espn_headshot_url(resolved_batter_id, hs_sport)

                if resolved_pitcher_name and resolved_pitcher_name != athlete_name:
                    athlete2_name = resolved_pitcher_name
                    if resolved_pitcher_id:
                        athlete2_headshot = player_headshots.get(resolved_pitcher_id, "") or _build_espn_headshot_url(resolved_pitcher_id, hs_sport)

        # Set athlete2 (assister/secondary) for display
        if not athlete2_name and assister_name_from_text and assister_id_from_text:
            athlete2_name = assister_name_from_text
            athlete2_headshot = player_headshots.get(assister_id_from_text, "") or _build_espn_headshot_url(assister_id_from_text, hs_sport)
        elif not athlete2_name and secondary_name_from_text and secondary_id_from_text:
            athlete2_name = secondary_name_from_text
            athlete2_headshot = player_headshots.get(secondary_id_from_text, "") or _build_espn_headshot_url(secondary_id_from_text, hs_sport)
        elif not athlete2_name and stealer_name_from_text and stealer_id_from_text:
            athlete2_name = stealer_name_from_text
            athlete2_headshot = player_headshots.get(stealer_id_from_text, "") or _build_espn_headshot_url(stealer_id_from_text, hs_sport)
        elif not athlete2_name and not pitch_tracker_applied and participants and len(participants) > 1:
            p2 = participants[1] if isinstance(participants[1], dict) else {}
            ath2 = p2.get("athlete", {})
            athlete2_name = ath2.get("displayName", "")
            ath2_hs = ath2.get("headshot", "")
            if isinstance(ath2_hs, dict):
                athlete2_headshot = ath2_hs.get("href", "")
            elif isinstance(ath2_hs, str):
                athlete2_headshot = ath2_hs
            aid2 = str(ath2.get("id", ""))
            if not athlete2_headshot and aid2:
                athlete2_headshot = player_headshots.get(aid2, "") or _build_espn_headshot_url(aid2, hs_sport)
        if athlete2_name and not athlete2_headshot:
            resolved_secondary = _resolve_player(
                athlete2_name,
                preferred_team_abbr=play_team_abbr,
                excluded_ids={aid1} if aid1 else set(),
            )
            if resolved_secondary:
                athlete2_name = resolved_secondary["name"] or athlete2_name
                athlete2_headshot = athlete2_headshot or resolved_secondary["headshot"]

        # Fallback: match player name from text if still no athlete
        if not athlete_name and player_names:
            text_lower = text.lower()
            best_match = ""
            best_id = ""
            for pid, pname in player_names.items():
                if pname.lower() in text_lower:
                    if len(pname) > len(best_match):
                        best_match = pname
                        best_id = pid
            if best_match and best_id:
                athlete_name = best_match
                aid1 = best_id
                athlete_headshot = player_headshots.get(best_id, "") or _build_espn_headshot_url(best_id, hs_sport)
                if best_id in player_teams and not play_team_logo:
                    pt = player_teams[best_id]
                    play_team_name = play_team_name or pt.get("name", "")
                    play_team_abbr = play_team_abbr or pt.get("abbr", "")
                    play_team_logo = play_team_logo or pt.get("logo", "")

        # Set team info from actor's team if still missing
        if aid1 and aid1 in player_teams and (not play_team_logo or league_key in ("NFL", "EPL")):
            pt = player_teams[aid1]
            if league_key in ("NFL", "EPL"):
                play_team_name = pt.get("name", "") or play_team_name
                play_team_abbr = pt.get("abbr", "") or play_team_abbr
                play_team_logo = pt.get("logo", "") or play_team_logo
            else:
                play_team_name = play_team_name or pt.get("name", "")
                play_team_abbr = play_team_abbr or pt.get("abbr", "")
                play_team_logo = play_team_logo or pt.get("logo", "")

        # ── Update running stats based on this play's structured type ──
        play_type_text = play.get("type", {}).get("text", "")
        text_lower_stat = text.lower()
        clear_at_bat_after_play = (
            league_key == "MLB" and play_type_text in {"Play Result", "Start Inning", "End Inning"}
        )

        if league_key == "NBA" and aid1:
            _init_runner(aid1)
            is_made = "makes" in text_lower_stat or "made" in text_lower_stat
            is_miss = "misses" in text_lower_stat or "missed" in text_lower_stat

            if _is_ft_type(play_type_text):
                # Free throw attempt
                running[aid1]["FTA"] += 1
                if is_made:
                    running[aid1]["FTM"] += 1
                    running[aid1]["PTS"] += 1
            elif _is_fg_type(play_type_text):
                # Field goal attempt
                running[aid1]["FGA"] += 1
                three = _is_three(text)
                if three:
                    running[aid1]["3PA"] += 1
                if is_made:
                    running[aid1]["FGM"] += 1
                    if three:
                        running[aid1]["3PM"] += 1
                        running[aid1]["PTS"] += 3
                    else:
                        running[aid1]["PTS"] += 2
            elif _is_rebound_type(play_type_text):
                running[aid1]["REB"] += 1
            elif _is_turnover_type(play_type_text):
                running[aid1]["TO"] += 1
            elif _is_block_type(play_type_text, text):
                # For block plays, the text says "X blocks Y's shot"
                # X is the blocker (aid1 from text parsing) — credit BLK
                running[aid1]["BLK"] += 1
                # Also credit the BLOCKED player with an FGA
                # "X blocks Y's Z-foot shot" — the blocked player is in the text after "blocks"
                block_victim = _re.search(r"blocks?\s+(.+?)(?:'s|\s's)", text, _re.IGNORECASE)
                if block_victim:
                    victim_name = block_victim.group(1).strip()
                    for pid, pname in player_names.items():
                        if pname.lower() == victim_name.lower():
                            _init_runner(pid)
                            running[pid]["FGA"] += 1
                            if _is_three(text):
                                running[pid]["3PA"] += 1
                            break
            elif _is_steal_type(play_type_text, text):
                # For "X lost ball turnover" — aid1 is the player who turned it over
                # The stealer is in parentheses
                running[aid1]["TO"] += 1
            elif _is_foul_type(play_type_text):
                pass  # Fouls don't get counted in running stats shown

            # Credit the assister
            if assister_id_from_text:
                _init_runner(assister_id_from_text)
                running[assister_id_from_text]["AST"] += 1

            # Credit the stealer
            if stealer_id_from_text:
                _init_runner(stealer_id_from_text)
                running[stealer_id_from_text]["STL"] += 1

            athlete_stats_str = _format_running(aid1)
        elif aid1:
            # For non-NBA sports, show box score stats (MLB, NHL, etc.)
            if aid1 in player_stats:
                ps = player_stats[aid1]
                if league_key == "NFL":
                    athlete_stats_str = _format_nfl_stats_precise(ps, text)
                elif league_key == "EPL":
                    athlete_stats_str = _format_epl_stats(ps)
                elif league_key == "MLB":
                    parts = []
                    for key in ("H-AB", "AB", "R", "H", "RBI", "HR", "BB", "K", "IP", "ERA", "PC-ST"):
                        if value := _nonzero_stat(ps, key):
                            parts.append(f"{value} {key}")
                    athlete_stats_str = " | ".join(parts[:5])
                else:
                    parts = []
                    for k, v in list(ps.items())[:8]:
                        if v and v != "0" and v != "0-0":
                            parts.append(f"{v} {k}")
                    athlete_stats_str = " | ".join(parts)

        # Period label
        if league_key == "NBA":
            period_label = f"Q{period}" if period <= 4 else f"OT{period - 4}"
        elif league_key == "NHL":
            period_label = f"P{period}" if period <= 3 else f"OT{period - 3}"
        elif league_key == "EPL":
            period_label = clock if clock.endswith("'") else f"{clock}'" if clock else ""
        else:
            period_label = f"Q{period}"

        if league_key == "EPL":
            if period_label:
                detail = period_label
            else:
                text_lower_detail = text.lower()
                if "first half begins" in text_lower_detail:
                    detail = "0'"
                elif "second half begins" in text_lower_detail:
                    detail = "45'"
                elif "match ends" in text_lower_detail or "game end" in text_lower_detail:
                    detail = "FT"
                else:
                    detail = status_detail
        elif league_key == "MLB":
            detail = (
                _normalize_mlb_inning_detail(clock)
                or _normalize_mlb_inning_detail(text)
                or mlb_current_detail
                or status_detail
            )
        else:
            detail = f"{period_label} {clock}" if clock else status_detail

        if league_key == "MLB" and detail:
            mlb_current_detail = detail

        # Skip anonymous shot plays ("makes 2-foot shot" with no player resolved)
        text_lower_anon = text.lower()
        if not athlete_name and ("makes" in text_lower_anon or "misses" in text_lower_anon):
            continue

        if athlete2_name and athlete2_name == athlete_name:
            athlete2_name = ""
            athlete2_headshot = ""

        if not athlete2_name:
            athlete2_headshot = ""

        # MLB pitch counter rows without a resolved batter/pitcher pairing read as
        # tracker noise ("Pitch 4 : Ball 2") instead of an actual play.
        if league_key == "MLB":
            text_lower_final = text.lower()
            if text_lower_final.startswith("pitch") and " vs " not in text_lower_final and not athlete2_name:
                continue

        formatted.append({
            "id": f"{event_id}_{play_id}",
            "gameId": event_id,
            "text": text,
            "playType": play.get("type", {}).get("text", ""),
            "athleteName": athlete_name,
            "athleteHeadshot": athlete_headshot,
            "athleteStats": athlete_stats_str,
            "athlete2Name": athlete2_name,
            "athlete2Headshot": athlete2_headshot,
            "playTeamName": play_team_name,
            "playTeamAbbr": play_team_abbr,
            "playTeamLogo": play_team_logo,
            "league": league_key,
            "status": game_status,
            "statusDetail": detail,
            "homeTeam": home_info["name"],
            "awayTeam": away_info["name"],
            "homeAbbr": home_info["abbr"],
            "awayAbbr": away_info["abbr"],
            "homeScore": int(home_score) if home_score else 0,
            "awayScore": int(away_score) if away_score else 0,
            "homeBadge": home_info["logo"],
            "awayBadge": away_info["logo"],
            "gameMatchup": f"{away_info['abbr']} vs {home_info['abbr']}",
            "scoringPlay": scoring,
            "scoreValue": score_val,
            "sequenceNumber": play.get("sequenceNumber", "0"),
            "_wallclock": play.get("wallclock", ""),
        })

        if clear_at_bat_after_play:
            at_bat_tracker.pop(event_id, None)

    deduped = []
    seen_keys: set[tuple[str, str, str, str, str, str, int, int, str]] = set()
    for entry in reversed(formatted):
        key = (
            str(entry.get("gameMatchup", "")),
            str(entry.get("statusDetail", "")),
            str(entry.get("text", "")),
            str(entry.get("playTeamAbbr", "")),
            str(entry.get("athleteName", "")),
            str(entry.get("athlete2Name", "")),
            int(entry.get("homeScore", 0) or 0),
            int(entry.get("awayScore", 0) or 0),
            str(entry.get("playType", "")),
        )
        if key in seen_keys:
            continue
        seen_keys.add(key)
        deduped.append(entry)
    deduped.reverse()
    ordered = sorted(deduped, key=cmp_to_key(_compare_activities_for_display))
    _event_activity_cache[cache_key] = (time.time(), ordered)
    return ordered


@router.get("/espn/headshot", response_model=None)
async def espn_headshot(
    src: str = Query(default="", description="Original ESPN CDN headshot URL"),
    name: str = Query(default="", description="Athlete name for fallback lookups"),
    league: str = Query(default="", description="League key for fallback lookups"),
    team: str = Query(default="", description="Team name for fallback lookups"),
    placeholder: bool = Query(default=True, description="Whether to return a generated placeholder image when no headshot is found"),
):
    """Proxy headshots through the backend and retry ESPN, MLB, and SportsDB candidates."""
    candidates: list[str] = []

    def add(url: str):
        clean_url = (url or "").strip()
        if clean_url and clean_url not in candidates:
            candidates.append(clean_url)

    for candidate in _build_espn_image_candidates(src):
        add(candidate)

    clean_name = name.strip()
    clean_team = team.strip()
    clean_league = league.strip().upper()

    if clean_name and clean_league == "MLB":
        for candidate in await _build_mlb_headshot_candidates(clean_name, clean_team):
            add(candidate)
        for candidate in await _build_mlb_roster_headshot_candidates(clean_name, clean_team):
            add(candidate)
        for candidate in await _build_mlb_directory_headshot_candidates(clean_name, clean_team):
            add(candidate)

    if clean_name and clean_league == "NFL":
        for candidate in await _build_nfl_headshot_candidates(clean_name, clean_team):
            add(candidate)

    if clean_name and clean_league == "EPL":
        for candidate in await _build_epl_headshot_candidates(clean_name, clean_team):
            add(candidate)

    if clean_name and clean_league not in {"NFL", "NBA", "NHL", "MLB", "EPL"}:
        for candidate in await _build_sportsdb_image_candidates(clean_name, clean_team, clean_league):
            add(candidate)
        for candidate in await _build_sportsdb_team_roster_candidates(clean_name, clean_team):
            add(candidate)

    for candidate in candidates:
        fetched = await _fetch_bytes_cached(candidate, timeout=8.0)
        if fetched:
            data, content_type = fetched
            return Response(
                content=data,
                media_type=content_type,
                headers={"Cache-Control": "public, max-age=3600"},
            )
    if not placeholder:
        return Response(status_code=404)
    placeholder_label = clean_name or clean_team or "Player"
    return Response(
        content=_build_headshot_placeholder_svg(placeholder_label),
        media_type="image/svg+xml",
        headers={"Cache-Control": "public, max-age=3600"},
    )


@router.get("/espn/nba/athlete-stats/{season_year}/{season_type}/{athlete_id}", response_model=dict[str, Any])
async def espn_nba_athlete_stats(
    season_year: int,
    season_type: int,
    athlete_id: str,
):
    clean_athlete_id = str(athlete_id or "").strip()
    if not clean_athlete_id or season_year <= 0 or season_type <= 0:
        return {"available": False}

    url = (
        "https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/"
        f"seasons/{season_year}/types/{season_type}/athletes/{quote(clean_athlete_id)}/statistics/0"
        "?lang=en&region=us"
    )
    payload = await _fetch_cached(url, timeout=8.0)
    if not isinstance(payload, dict) or payload.get("error"):
        return {"available": False}

    return {"available": True, "data": payload}


@router.get("/espn/nba/roster/{team_id}", response_model=dict[str, Any])
async def espn_nba_roster(team_id: str):
    clean_team_id = str(team_id or "").strip()
    if not clean_team_id:
        return {"available": False, "athletes": []}

    url = (
        "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/"
        f"teams/{quote(clean_team_id)}/roster"
    )
    payload = await _fetch_cached(url, timeout=8.0)
    if not isinstance(payload, dict) or payload.get("error"):
        return {"available": False, "athletes": []}

    athletes = payload.get("athletes") or []
    if not isinstance(athletes, list):
        athletes = []

    return {"available": True, "athletes": athletes}


@router.get("/espn/activity", response_model=dict[str, Any])
async def espn_activity(
    date: str = Query(default=None, description="Date in YYYYMMDD format (defaults to today)"),
    offset: int = Query(default=0, description="Offset for pagination (0-based)"),
    limit: int = Query(default=500, description="Max plays per response"),
    league: str = Query(default=None, description="Filter by league key (e.g. NBA, EPL)"),
    status_filter: str = Query(default="all", description="Filter plays by status: all, live, or final"),
    live_day: bool = Query(default=False, description="Treat the requested date as the current live day even after server midnight"),
):
    """
    Activity feed — full play-by-play timeline using ESPN summary API.
    Supports historical dates via `?date=YYYYMMDD`.
    Past dates are cached to disk; today is always live.
    Use `?offset=N` for pagination (load-more).
    """
    today = datetime.now().strftime("%Y%m%d")
    target_date = date or today
    is_today = live_day or (target_date == today)
    is_future = target_date > today
    scope = _activity_cache_scope(league)
    normalized_status_filter = (status_filter or "all").strip().lower()
    if normalized_status_filter not in {"all", "live", "final"}:
        normalized_status_filter = "all"

    def apply_status_filter(plays: list[dict[str, Any]]) -> list[dict[str, Any]]:
        if normalized_status_filter == "all":
            return plays
        return [play for play in plays if str(play.get("status") or "").lower() == normalized_status_filter]

    if is_future:
        return {
            "activities": [],
            "total": 0,
            "offset": offset,
            "hasMore": False,
            "date": target_date,
            "cached": False,
        }

    cache_file = _activity_cache_file(target_date, league)

    if is_today:
        cached_today = _today_activity_cache.get((ACTIVITY_CACHE_VERSION, target_date, scope))
        if cached_today and time.time() - cached_today[0] < TODAY_ACTIVITY_CACHE_TTL:
            today_plays = apply_status_filter(cached_today[1])
            page = today_plays[offset : offset + limit]
            return {
                "activities": [_strip_activity_fields(play) for play in page],
                "total": len(today_plays),
                "offset": offset,
                "hasMore": (offset + limit) < len(today_plays),
                "date": target_date,
                "cached": True,
            }

    if not is_today:
        all_plays = _load_cached_activity_payload(target_date, league)
        if all_plays is not None:
            if league:
                all_plays = [p for p in all_plays if p.get("league") == league.upper()]
            all_plays = apply_status_filter(all_plays)
            page = all_plays[offset : offset + limit]
            return {
                "activities": [_strip_activity_fields(play) for play in page],
                "total": len(all_plays),
                "offset": offset,
                "hasMore": (offset + limit) < len(all_plays),
                "date": target_date,
                "cached": True,
            }

    # ── Fetch from ESPN ─────────────────────────────────────────────
    league_keys = [league.upper()] if league and league.upper() in LEAGUES else ["NBA", "NHL", "NFL", "MLB", "EPL"]

    # Step 1: Get scoreboard to find game IDs for the target date
    async def fetch_scoreboard(key: str):
        sport, espn_league, _ = LEAGUES[key]
        url = f"{ESPN_BASE}/{sport}/{espn_league}/scoreboard?dates={target_date}"
        fetcher = _fetch_fresh if is_today else _fetch_cached
        return key, await fetcher(url, timeout=4.0 if is_today else 6.0)

    sb_results = await asyncio.gather(*[fetch_scoreboard(k) for k in league_keys])

    # Collect game IDs to fetch play-by-play for
    game_tasks = []
    for key, data in sb_results:
        if not data:
            continue
        for ev in data.get("events", []):
            eid = ev.get("id", "")
            comp = ev.get("competitions", [{}])[0]
            status_name = comp.get("status", {}).get("type", {}).get("name", "")
            if is_today:
                valid = {
                    "STATUS_IN_PROGRESS",
                    "STATUS_END_PERIOD",
                    "STATUS_HALFTIME",
                    "STATUS_FINAL",
                    "STATUS_FULL_TIME",
                }
            else:
                valid = {"STATUS_FINAL", "STATUS_FULL_TIME"}
            if status_name in valid:
                game_tasks.append((eid, key))

    # -- Midnight-crossing: check previous day scoreboard too --
    # Only for historical dates, NOT today's live feed.
    if not is_today:
        try:
            prev_date = (datetime.strptime(target_date, "%Y%m%d") - timedelta(days=1)).strftime("%Y%m%d")

            async def fetch_prev_sb(key):
                sport, espn_league, _ = LEAGUES[key]
                url = f"{ESPN_BASE}/{sport}/{espn_league}/scoreboard?dates={prev_date}"
                return key, await _fetch_cached(url, timeout=6.0)

            prev_sb = await asyncio.gather(*[fetch_prev_sb(k) for k in league_keys])
            seen_ids = {eid for eid, _ in game_tasks}
            for key, data in prev_sb:
                if not data:
                    continue
                for ev in data.get("events", []):
                    eid = ev.get("id", "")
                    if eid in seen_ids:
                        continue
                    comp = ev.get("competitions", [{}])[0]
                    sn = comp.get("status", {}).get("type", {}).get("name", "")
                    if sn not in {"STATUS_FINAL", "STATUS_FULL_TIME"}:
                        continue
                    gd = comp.get("date", "") or ev.get("date", "")
                    if gd:
                        try:
                            gdt = datetime.fromisoformat(gd.replace("Z", "+00:00"))
                            ts = datetime.strptime(target_date, "%Y%m%d").replace(tzinfo=gdt.tzinfo)
                            hrs = (ts - gdt).total_seconds() / 3600
                            if 0 < hrs <= 12:
                                game_tasks.append((eid, key))
                                seen_ids.add(eid)
                        except (ValueError, TypeError):
                            pass
        except Exception:
            pass

    if not game_tasks:
        return {"activities": [], "total": 0, "offset": 0, "hasMore": False, "date": target_date, "cached": False}

    # Step 2: Fetch play-by-play for each game. A slightly higher cap keeps the
    # first dashboard paint snappy without hammering ESPN too hard.
    sem = asyncio.Semaphore(8)

    async def fetch_pbp(event_id: str, league_key: str):
        async with sem:
            try:
                return await _fetch_game_plays(event_id, league_key)
            except Exception:
                return []

    pbp_results = await asyncio.gather(*[fetch_pbp(eid, lk) for eid, lk in game_tasks])

    # Step 3: Merge all plays
    all_plays = []
    for plays in pbp_results:
        all_plays.extend(plays)

    # Show the newest play first across the entire feed so "All" behaves like
    # a true live ticker across every game and sport.
    all_plays.sort(key=cmp_to_key(_compare_activities_for_display))

    # ── Cache past dates to disk ────────────────────────────────────
    # Only cache to disk when ALL scoreboard games are final.
    # This prevents stale caches when late games (e.g. West Coast)
    # are still in progress while other games are final.
    all_scoreboard_final = True
    for _sb_key, _sb_data in sb_results:
        if not _sb_data:
            continue
        for _sb_ev in _sb_data.get("events", []):
            _sb_status = _sb_ev.get("competitions", [{}])[0].get("status", {}).get("type", {}).get("name", "")
            if _sb_status not in {"STATUS_FINAL", "STATUS_FULL_TIME", "STATUS_POSTPONED", "STATUS_CANCELED", "STATUS_SUSPENDED", "STATUS_SCHEDULED"}:
                all_scoreboard_final = False
                break
    if not is_today and all_plays and all_scoreboard_final:
        ACTIVITY_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        with cache_file.open("w", encoding="utf-8") as handle:
            _json.dump(all_plays, handle, ensure_ascii=False)
    elif is_today:
        _today_activity_cache[(ACTIVITY_CACHE_VERSION, target_date, scope)] = (time.time(), all_plays)

    # Apply league filter for live fetches (when we fetched all leagues)
    if league and not (league.upper() in LEAGUES and len(league_keys) == 1):
        all_plays = [p for p in all_plays if p.get("league") == league.upper()]

    all_plays = apply_status_filter(all_plays)

    # Apply pagination
    total = len(all_plays)
    page = all_plays[offset : offset + limit]

    return {
        "activities": [_strip_activity_fields(play) for play in page],
        "total": total,
        "offset": offset,
        "hasMore": (offset + limit) < total,
        "date": target_date,
        "cached": False,
    }


@router.get("/espn/activity/latest-date", response_model=dict[str, Any])
async def espn_activity_latest_date(
    league: str = Query(default=None, description="Filter by league key (e.g. NFL, NBA, NHL)"),
    max_days_back: int = Query(default=400, ge=1, le=730, description="How far back to search for historical activity"),
):
    """Return the newest historical date with activity for the requested league."""
    league_scope = _activity_cache_scope(league)
    cache_key = (league_scope, max_days_back)
    now = time.time()

    cached_entry = _latest_activity_date_cache.get(cache_key)
    if cached_entry and now - cached_entry[0] < LATEST_ACTIVITY_DATE_TTL:
        return {"date": cached_entry[1], "cached": True}

    requested_league = league_scope if league_scope != "ALL" else None
    cached_date = _latest_cached_activity_date(league_scope)
    cached_cutoff = cached_date if cached_date and _re.fullmatch(r"\d{8}", cached_date or "") else None

    for day_offset in range(1, max_days_back + 1):
        candidate = (datetime.now() - timedelta(days=day_offset)).strftime("%Y%m%d")
        if cached_cutoff and candidate <= cached_cutoff:
            break
        resp = await espn_activity(date=candidate, offset=0, limit=1, league=requested_league)
        total = int(resp.get("total") or 0)
        activities = resp.get("activities") or []
        if total > 0 or activities:
            _latest_activity_date_cache[cache_key] = (time.time(), candidate)
            return {"date": candidate, "cached": False}

    if cached_date:
        _latest_activity_date_cache[cache_key] = (now, cached_date)
        return {"date": cached_date, "cached": True}

    _latest_activity_date_cache[cache_key] = (time.time(), None)
    return {"date": None, "cached": False}


def _game_detail_clean_text(value) -> str:
    return _clean_news_text(str(value or ""))


def _game_detail_stat_number(value) -> float:
    cleaned = _game_detail_clean_text(value)
    if not cleaned:
        return 0.0

    match = _re.search(r"-?\d+(?:\.\d+)?", cleaned)
    return float(match.group(0)) if match else 0.0


def _game_detail_baseball_outs(value) -> int:
    cleaned = _game_detail_clean_text(value)
    if not cleaned:
        return 0

    match = _re.fullmatch(r"(\d+)(?:\.(\d))?", cleaned)
    if not match:
        return int(round(_game_detail_stat_number(cleaned) * 3))

    whole = int(match.group(1) or 0)
    partial = int(match.group(2) or 0)
    return whole * 3 + partial


def _game_detail_register_team_leaders(target: dict[str, list[dict]], team_info: dict, leaders: list[dict]) -> None:
    if not leaders:
        return

    for raw_key in (
        team_info.get("abbreviation"),
        team_info.get("displayName"),
        team_info.get("shortDisplayName"),
    ):
        clean_key = _game_detail_clean_text(raw_key)
        if clean_key:
            target[clean_key] = leaders


def _game_detail_merge_team_leaders(primary: list[dict], fallback: list[dict]) -> list[dict]:
    if not fallback:
        return primary

    merged = list(primary)
    seen = {
        _game_detail_clean_text(item.get("category")).upper()
        for item in primary
        if _game_detail_clean_text(item.get("category"))
    }

    for item in fallback:
        category_key = _game_detail_clean_text(item.get("category")).upper()
        if not category_key or category_key in seen:
            continue
        seen.add(category_key)
        merged.append(item)

    return merged


def _game_detail_merge_leaders(primary: list[dict], fallback: list[dict]) -> list[dict]:
    if not fallback:
        return primary

    merged = list(primary)
    seen = {
        (
            _game_detail_clean_text(item.get("teamAbbr") or item.get("team")).upper(),
            _game_detail_clean_text(item.get("category")).upper(),
        )
        for item in primary
    }

    for item in fallback:
        key = (
            _game_detail_clean_text(item.get("teamAbbr") or item.get("team")).upper(),
            _game_detail_clean_text(item.get("category")).upper(),
        )
        if key in seen:
            continue
        seen.add(key)
        merged.append(item)

    return merged


def _game_detail_is_mlb_batting_section(labels: list[str]) -> bool:
    normalized = {_game_detail_clean_text(label).upper() for label in labels}
    return {"H-AB", "RBI", "HR"}.issubset(normalized)


def _game_detail_is_mlb_pitching_section(labels: list[str]) -> bool:
    normalized = {_game_detail_clean_text(label).upper() for label in labels}
    return {"IP", "ER", "K"}.issubset(normalized)


def _game_detail_labeled_stat(labels: list[str], stats: list[str], target_label: str) -> str:
    target_key = _game_detail_clean_text(target_label).upper()
    for index, label in enumerate(labels):
        if _game_detail_clean_text(label).upper() == target_key:
            return stats[index] if index < len(stats) else ""
    return ""


def _build_game_detail_player_box_score(team_box: dict, sport: str) -> dict:
    team_info = team_box.get("team", {}) or {}
    team_stats = team_box.get("statistics", []) or []
    players = []
    labels: list[str] = []

    for stat_group in team_stats:
        group_labels = [_game_detail_clean_text(label) for label in (stat_group.get("labels", []) or [])]
        for label in group_labels:
            if label and label not in labels:
                labels.append(label)

        for athlete in stat_group.get("athletes", []) or []:
            player = athlete.get("athlete", {}) or {}
            player_stats_raw = athlete.get("stats", []) or []
            athlete_id = str(player.get("id", ""))
            stat_dict = {}
            for index, label in enumerate(group_labels):
                if label and index < len(player_stats_raw):
                    stat_dict[label] = player_stats_raw[index]

            players.append({
                "name": player.get("displayName", ""),
                "shortName": player.get("shortName", ""),
                "headshot": _extract_headshot(player.get("headshot"), athlete_id, sport),
                "position": player.get("position", {}).get("abbreviation", ""),
                "stats": stat_dict,
            })

    return {
        "teamName": team_info.get("displayName", ""),
        "teamAbbr": team_info.get("abbreviation", ""),
        "teamLogo": team_info.get("logo", ""),
        "players": players,
        "labels": labels,
    }


def _build_game_detail_team_stat_box_scores(summary_data: dict) -> list[dict]:
    entries: list[dict] = []
    for team_box in (summary_data.get("boxscore", {}) or {}).get("teams", []) or []:
        team_info = team_box.get("team", {}) or {}
        stat_map = {}
        labels: list[str] = []

        for stat in team_box.get("statistics", []) or []:
            label = _game_detail_clean_text(
                stat.get("label")
                or stat.get("shortDisplayName")
                or stat.get("displayName")
                or stat.get("abbreviation")
                or stat.get("name")
            )
            value = _game_detail_clean_text(stat.get("displayValue") or stat.get("value"))
            if not label or not value:
                continue
            stat_map[label] = value
            if label not in labels:
                labels.append(label)

        if not stat_map:
            continue

        entries.append({
            "teamName": team_info.get("displayName", ""),
            "teamAbbr": team_info.get("abbreviation", ""),
            "teamLogo": team_info.get("logo", ""),
            "players": [{
                "name": "Team Totals",
                "shortName": "Team Totals",
                "headshot": team_info.get("logo", ""),
                "position": "",
                "stats": stat_map,
            }],
            "labels": labels,
        })

    return entries


def _derive_mlb_game_detail_leaders(summary_data: dict, sport: str) -> tuple[list[dict], dict[str, list[dict]]]:
    leaders: list[dict] = []
    by_team_key: dict[str, list[dict]] = {}

    for team_box in (summary_data.get("boxscore", {}) or {}).get("players", []) or []:
        team_info = team_box.get("team", {}) or {}
        sections = team_box.get("statistics", []) or []
        team_leaders: list[dict] = []

        batting_section = next(
            (
                section for section in sections
                if _game_detail_is_mlb_batting_section(section.get("labels", []) or [])
            ),
            None,
        )
        pitching_section = next(
            (
                section for section in sections
                if _game_detail_is_mlb_pitching_section(section.get("labels", []) or [])
            ),
            None,
        )

        for category_name, section in (("Batting", batting_section), ("Pitching", pitching_section)):
            if not isinstance(section, dict):
                continue

            labels = [_game_detail_clean_text(label) for label in (section.get("labels", []) or [])]
            athletes = section.get("athletes", []) or []
            best_entry = None
            best_score = float("-inf")

            for athlete_entry in athletes:
                stats = [_game_detail_clean_text(value) for value in (athlete_entry.get("stats", []) or [])]
                if category_name == "Batting":
                    rbi = _game_detail_stat_number(_game_detail_labeled_stat(labels, stats, "RBI"))
                    hr = _game_detail_stat_number(_game_detail_labeled_stat(labels, stats, "HR"))
                    hits = _game_detail_stat_number(_game_detail_labeled_stat(labels, stats, "H"))
                    runs = _game_detail_stat_number(_game_detail_labeled_stat(labels, stats, "R"))
                    walks = _game_detail_stat_number(_game_detail_labeled_stat(labels, stats, "BB"))
                    strikeouts = _game_detail_stat_number(_game_detail_labeled_stat(labels, stats, "K"))
                    score = rbi * 8 + hr * 7 + hits * 4 + runs * 3 + walks - strikeouts * 0.15
                else:
                    outs = _game_detail_baseball_outs(_game_detail_labeled_stat(labels, stats, "IP"))
                    strikeouts = _game_detail_stat_number(_game_detail_labeled_stat(labels, stats, "K"))
                    earned_runs = _game_detail_stat_number(_game_detail_labeled_stat(labels, stats, "ER"))
                    walks = _game_detail_stat_number(_game_detail_labeled_stat(labels, stats, "BB"))
                    hits_allowed = _game_detail_stat_number(_game_detail_labeled_stat(labels, stats, "H"))
                    score = strikeouts * 4 + outs * 1.75 - earned_runs * 6 - walks * 1.5 - hits_allowed * 0.75

                if score > best_score:
                    best_score = score
                    best_entry = athlete_entry

            if not isinstance(best_entry, dict):
                continue

            athlete = best_entry.get("athlete", {}) or {}
            athlete_id = str(athlete.get("id", ""))
            stats = [_game_detail_clean_text(value) for value in (best_entry.get("stats", []) or [])]
            name = athlete.get("displayName", "") or athlete.get("shortName", "")
            headshot = _extract_headshot(athlete.get("headshot"), athlete_id, sport)

            if category_name == "Batting":
                parts = [
                    _game_detail_labeled_stat(labels, stats, "H-AB"),
                ]
                hr = int(_game_detail_stat_number(_game_detail_labeled_stat(labels, stats, "HR")))
                rbi = int(_game_detail_stat_number(_game_detail_labeled_stat(labels, stats, "RBI")))
                hits = int(_game_detail_stat_number(_game_detail_labeled_stat(labels, stats, "H")))
                runs = int(_game_detail_stat_number(_game_detail_labeled_stat(labels, stats, "R")))
                if hr > 0:
                    parts.append(f"{hr} HR")
                if rbi > 0:
                    parts.append(f"{rbi} RBI")
                if hits > 0 and not any("H" in part for part in parts):
                    parts.append(f"{hits} H")
                if runs > 0:
                    parts.append(f"{runs} R")
            else:
                innings_pitched = _game_detail_labeled_stat(labels, stats, "IP")
                strikeouts = int(_game_detail_stat_number(_game_detail_labeled_stat(labels, stats, "K")))
                earned_runs = int(_game_detail_stat_number(_game_detail_labeled_stat(labels, stats, "ER")))
                hits_allowed = int(_game_detail_stat_number(_game_detail_labeled_stat(labels, stats, "H")))
                parts = []
                if innings_pitched:
                    parts.append(f"{innings_pitched} IP")
                if strikeouts > 0:
                    parts.append(f"{strikeouts} K")
                parts.append(f"{earned_runs} ER")
                if hits_allowed > 0:
                    parts.append(f"{hits_allowed} H")

            value = " | ".join(part for part in parts if part) or "Top performance"
            leader = {
                "team": team_info.get("displayName", ""),
                "teamAbbr": team_info.get("abbreviation", ""),
                "category": category_name,
                "name": name,
                "value": value,
                "headshot": headshot,
            }
            leaders.append(leader)
            team_leaders.append({
                "category": category_name,
                "name": name,
                "value": value,
                "headshot": headshot,
            })

        _game_detail_register_team_leaders(by_team_key, team_info, team_leaders)

    return leaders, by_team_key


def _derive_soccer_game_detail_team_stat_leaders(summary_data: dict) -> tuple[list[dict], dict[str, list[dict]]]:
    leaders: list[dict] = []
    by_team_key: dict[str, list[dict]] = {}
    tracked_stats = [
        ("possessionPct", "Possession", True),
        ("totalShots", "Shots", False),
        ("shotsOnTarget", "On Goal", False),
        ("saves", "Saves", False),
    ]

    for team_box in (summary_data.get("boxscore", {}) or {}).get("teams", []) or []:
        team_info = team_box.get("team", {}) or {}
        stats_by_name = {
            _game_detail_clean_text(stat.get("name")).lower(): stat
            for stat in (team_box.get("statistics", []) or [])
            if _game_detail_clean_text(stat.get("name"))
        }
        team_leaders: list[dict] = []

        for stat_name, category_name, is_percent in tracked_stats:
            stat = stats_by_name.get(stat_name.lower())
            if not isinstance(stat, dict):
                continue
            display_value = _game_detail_clean_text(stat.get("displayValue") or stat.get("value"))
            if not display_value:
                continue
            if is_percent and "%" not in display_value:
                display_value = f"{display_value}%"

            leader = {
                "team": team_info.get("displayName", ""),
                "teamAbbr": team_info.get("abbreviation", ""),
                "category": category_name,
                "name": team_info.get("displayName", ""),
                "value": display_value,
                "headshot": team_info.get("logo", ""),
            }
            leaders.append(leader)
            team_leaders.append({
                "category": category_name,
                "name": team_info.get("displayName", ""),
                "value": display_value,
                "headshot": team_info.get("logo", ""),
            })

        _game_detail_register_team_leaders(by_team_key, team_info, team_leaders)

    return leaders, by_team_key


@router.get("/espn/game/{event_id}", response_model=dict[str, Any])
async def espn_game_detail(
    event_id: str,
    league: str | None = Query(default=None, description="Optional league key, e.g. NHL or EPL"),
):
    """
    Fetch full game detail from ESPN including:
    - Game info (teams, scores, venue, status)
    - Play-by-play (real plays from ESPN)
    - Box score / team stats
    - Team records and leaders
    """
    event_id = str(event_id)
    summary_data = None
    league_key = None

    requested_league = _resolve_league_key(league) if league else None
    league_candidates = [requested_league] if requested_league else []
    league_candidates.extend([
        key for key in ["NBA", "NHL", "NFL", "MLB", "EPL"] if key not in league_candidates
    ])

    for key in league_candidates:
        sport, espn_league, _ = LEAGUES[key]
        summary_url = f"{ESPN_BASE}/{sport}/{espn_league}/summary?event={event_id}"
        candidate = await _fetch_cached(summary_url, timeout=10.0)
        if not isinstance(candidate, dict):
            continue
        header = candidate.get("header", {}) or {}
        competitions = header.get("competitions", []) or []
        competition = competitions[0] if competitions else {}
        competition_id = str(competition.get("id") or header.get("id") or "")
        competitors = competition.get("competitors", []) or []
        if competition_id == event_id and competitors:
            summary_data = candidate
            league_key = key
            break

    if not summary_data or not league_key:
        return {"error": "Game not found", "game": None}

    header = summary_data.get("header", {}) or {}
    competitions = header.get("competitions", []) or []
    competition = competitions[0] if competitions else {}
    if not competition:
        return {"error": "Game not found", "game": None}

    synthetic_event = {
        "id": event_id,
        "date": competition.get("date", ""),
        "status": competition.get("status", {}),
        "competitions": [competition],
    }

    # Parse basic game info
    parsed = _parse_espn_event(synthetic_event, league_key)

    # ── Team details with records ──
    competitors = competition.get("competitors", [])
    home_detail = {}
    away_detail = {}
    sport, _, _ = LEAGUES[league_key]
    for c in competitors:
        team = c.get("team", {})
        records = c.get("records", [])
        record_str = records[0].get("summary", "") if records else ""
        leaders_raw = c.get("leaders", [])
        leaders = []
        for leader_cat in leaders_raw:
            cat_name = leader_cat.get("displayName", "")
            cat_leaders = leader_cat.get("leaders", [])
            if cat_leaders:
                top = cat_leaders[0]
                athlete = top.get("athlete", {})
                athlete_id = str(athlete.get("id", ""))
                leaders.append({
                    "category": cat_name,
                    "name": athlete.get("displayName", ""),
                    "value": top.get("displayValue", ""),
                    "headshot": _extract_headshot(athlete.get("headshot"), athlete_id, sport),
                })

        # Team stats from statistics array
        stats_raw = c.get("statistics", [])
        stats = []
        for s in stats_raw:
            stats.append({
                "name": s.get("displayValue", s.get("name", "")),
                "label": s.get("name", ""),
                "abbreviation": s.get("abbreviation", ""),
            })

        detail = {
            "id": team.get("id", ""),
            "name": team.get("displayName", ""),
            "abbreviation": team.get("abbreviation", ""),
            "logo": team.get("logo", ""),
            "color": team.get("color", ""),
            "record": record_str,
            "score": c.get("score", "0"),
            "leaders": leaders,
            "stats": stats,
            "linescores": [_parse_linescore_value(ls) for ls in c.get("linescores", [])],
        }
        if c.get("homeAway") == "home":
            home_detail = detail
        else:
            away_detail = detail

    # ── Play-by-play from ESPN ──
    pbp_data = summary_data

    plays = await _fetch_game_plays(event_id, league_key)
    box_score = []
    game_leaders = []
    derived_team_leaders: dict[str, list[dict]] = {}

    if pbp_data:
        # Box score from summary
        box_players = pbp_data.get("boxscore", {}).get("players", [])
        for team_box in box_players:
            box_score.append(_build_game_detail_player_box_score(team_box, sport))

        if not box_score:
            box_score = _build_game_detail_team_stat_box_scores(pbp_data)

        # Game leaders
        leaders_raw = pbp_data.get("leaders", [])
        for leader_group in leaders_raw:
            team_info = leader_group.get("team", {})
            for leader_cat in leader_group.get("leaders", []):
                cat_name = leader_cat.get("displayName", "")
                cat_leaders = leader_cat.get("leaders", [])
                if cat_leaders:
                    top = cat_leaders[0]
                    athlete = top.get("athlete", {})
                    athlete_id = str(athlete.get("id", ""))
                    game_leaders.append({
                        "team": team_info.get("displayName", ""),
                        "teamAbbr": team_info.get("abbreviation", ""),
                        "category": cat_name,
                        "name": athlete.get("displayName", ""),
                        "value": top.get("displayValue", ""),
                        "headshot": _extract_headshot(athlete.get("headshot"), athlete_id, sport),
                    })

        derived_game_leaders = []
        if league_key == "MLB":
            derived_game_leaders, derived_team_leaders = _derive_mlb_game_detail_leaders(pbp_data, sport)
        elif league_key == "EPL":
            derived_game_leaders, derived_team_leaders = _derive_soccer_game_detail_team_stat_leaders(pbp_data)

        game_leaders = _game_detail_merge_leaders(game_leaders, derived_game_leaders)

        home_detail["leaders"] = _game_detail_merge_team_leaders(
            home_detail.get("leaders", []),
            derived_team_leaders.get(_game_detail_clean_text(home_detail.get("abbreviation")))
            or derived_team_leaders.get(_game_detail_clean_text(home_detail.get("name")))
            or [],
        )
        away_detail["leaders"] = _game_detail_merge_team_leaders(
            away_detail.get("leaders", []),
            derived_team_leaders.get(_game_detail_clean_text(away_detail.get("abbreviation")))
            or derived_team_leaders.get(_game_detail_clean_text(away_detail.get("name")))
            or [],
        )

    # ── Venue info ──
    venue = competition.get("venue", {})
    venue_info = {
        "name": venue.get("fullName", ""),
        "city": venue.get("address", {}).get("city", ""),
        "state": venue.get("address", {}).get("state", ""),
    }

    # ── Odds / Broadcasts ──
    odds = competition.get("odds", [])
    odds_info = None
    if odds:
        o = odds[0]
        odds_info = {
            "details": o.get("details", ""),
            "overUnder": o.get("overUnder", 0),
            "spread": o.get("spread", 0),
        }

    broadcasts_raw = competition.get("broadcasts", [])
    broadcasts = []
    for b in broadcasts_raw:
        for name in b.get("names", []):
            broadcasts.append(name)

    return {
        "game": {
            **parsed,
            "homeDetail": home_detail,
            "awayDetail": away_detail,
            "venue": venue_info,
            "odds": odds_info,
            "broadcasts": broadcasts,
        },
        "plays": plays,
        "boxScore": box_score,
        "leaders": game_leaders,
    }


# ─── Legacy TheSportsDB Endpoints (kept for team logos/search) ─────────


@router.get("/events/day", response_model=dict[str, Any])
async def events_by_day(
    d: str = Query(default=None, description="Date YYYY-MM-DD"),
    league_id: int = Query(default=None, description="TheSportsDB league ID"),
):
    """Fetch events for a specific day from TheSportsDB (legacy)."""
    date_str = d or datetime.now().strftime("%Y-%m-%d")
    if league_id:
        url = f"{THESPORTSDB_BASE}/eventsday.php?d={date_str}&l={league_id}"
    else:
        url = f"{THESPORTSDB_BASE}/eventsday.php?d={date_str}"
    data = await _fetch_cached(url)
    return data or {"events": None}


@router.get("/events/past", response_model=dict[str, Any])
async def events_past(
    league_id: int = Query(description="TheSportsDB league ID"),
):
    """Fetch last 15 events for a league from TheSportsDB (legacy)."""
    url = f"{THESPORTSDB_BASE}/eventspastleague.php?id={league_id}"
    data = await _fetch_cached(url)
    return data or {"events": None}


@router.get("/events/next", response_model=dict[str, Any])
async def events_next(
    league_id: int = Query(description="TheSportsDB league ID"),
):
    """Fetch next 15 events for a league from TheSportsDB (legacy)."""
    url = f"{THESPORTSDB_BASE}/eventsnextleague.php?id={league_id}"
    data = await _fetch_cached(url)
    return data or {"events": None}


@router.get("/league", response_model=dict[str, Any])
async def lookup_league(
    league_id: int = Query(description="TheSportsDB league ID"),
):
    """Look up league details by ID."""
    url = f"{THESPORTSDB_BASE}/lookupleague.php?id={league_id}"
    data = await _fetch_cached(url)
    return data or {}


@router.get("/teams", response_model=dict[str, Any])
async def search_teams(
    league: str = Query(description="League name to search, e.g. 'NBA'"),
):
    """Search teams by league name (TheSportsDB)."""
    league_key = _resolve_league_key(league)
    search_league = TEAM_SEARCH_LEAGUES.get(league_key, league)
    url = f"{THESPORTSDB_BASE}/search_all_teams.php?l={quote(search_league)}"
    data = await _fetch_cached(url)
    return data or {"teams": []}


@router.get("/team-groups", response_model=dict[str, Any])
async def team_groups(
    league: str = Query(description="League key or display name, e.g. 'NFL'"),
):
    """
    Return live standings groups for a league and map them to TheSportsDB team IDs.
    This keeps onboarding filters API-driven without hardcoded team-to-division lists.
    """
    league_key = _resolve_league_key(league)
    if not league_key or league_key not in STANDINGS_PAGE_URLS:
        return {"league": league, "groups": []}

    standings_url = STANDINGS_PAGE_URLS[league_key]
    search_league = TEAM_SEARCH_LEAGUES.get(league_key)
    team_url = (
        f"{THESPORTSDB_BASE}/search_all_teams.php?l={quote(search_league)}"
        if search_league
        else None
    )

    html_task = _fetch_text_cached(standings_url)
    teams_task = _fetch_cached(team_url) if team_url else asyncio.sleep(0, result=None)
    standings_html, teams_data = await asyncio.gather(html_task, teams_task)

    if not standings_html:
        return {"league": league_key, "groups": []}

    groups = _extract_team_groups_from_html(standings_html, league_key)
    if not groups:
        return {"league": league_key, "groups": []}

    teams = teams_data.get("teams", []) if isinstance(teams_data, dict) else []
    return {
        "league": league_key,
        "groups": _attach_team_ids_to_groups(groups, teams),
    }


@router.get("/espn/standings", response_model=dict[str, Any])
async def espn_standings(
    league: str = Query(description="League key, e.g. NBA"),
    season: str | None = Query(default=None, description="Optional ESPN season year, e.g. 2023"),
):
    """Return normalized ESPN standings for one supported league."""
    league_key = _resolve_league_key(league)
    standings_url = ESPN_STANDINGS_URLS.get(league_key)
    if not standings_url:
        return {"league": league, "season": "", "seasons": [], "groups": []}

    query_params = {}
    cleaned_season = str(season or "").strip()
    if cleaned_season:
        query_params["season"] = cleaned_season

    if query_params:
        standings_url = f"{standings_url}?{urlencode(query_params)}"

    data = await _fetch_cached(standings_url, timeout=12.0)
    if not isinstance(data, dict):
        return {"league": league_key, "season": "", "seasons": [], "groups": []}

    groups: list[dict] = []
    for child in data.get("children") or []:
        _collect_standings_groups(child, groups)

    if not groups and (data.get("standings") or {}).get("entries"):
        _collect_standings_groups(data, groups)

    season_blob = data.get("season") or {}
    season_label = str(
        season_blob.get("displayName")
        or season_blob.get("name")
        or (((data.get("children") or [None])[0] or {}).get("standings") or {}).get("seasonDisplayName")
        or ""
    ).strip()
    selected_season_blob = _resolve_selected_standings_season(data, cleaned_season)
    champion = await _resolve_standings_champion(league_key, data, groups, selected_season_blob)
    if champion:
        _mark_champion_entries(groups, champion.get("team_id") or "")

    return {
        "league": league_key,
        "season": season_label,
        "seasons": _normalize_standings_seasons(data.get("seasons")),
        "champion": champion,
        "groups": groups,
    }


@router.get("/news", response_model=dict[str, Any])
async def sports_news(
    league: str = Query(default=None, description="Optional league key, e.g. NFL or NBA"),
):
    """
    Build a news feed from recent game results across all leagues.
    Uses ESPN as primary source now.
    """
    return await espn_news(league=league)


@router.get("/highlights", response_model=dict[str, Any])
async def sports_highlights(
    league: str = Query(default=None, description="Optional league key, e.g. NFL or NBA"),
    limit: int = Query(default=30, ge=6, le=120, description="Maximum number of highlight clips to return"),
    date: str = Query(default=None, description="Optional local date in YYYYMMDD or YYYY-MM-DD"),
):
    """
    Return the multi-source highlights feed for the highlights page.
    """
    return await espn_highlights(league=league, limit=limit, date=date)


@router.get("/featured", response_model=dict[str, Any])
async def sports_featured():
    """
    Return featured events for the hero carousel.
    Uses ESPN as primary source now.
    """
    return await espn_featured()
