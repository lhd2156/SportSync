"""
SportSync - ML prediction service.

Loads the trained model bundle lazily, syncs ESPN-backed games/history into the
local database on demand, and returns home/away win probabilities.

Enhanced with:
- Real-time injury impact adjustments
- Vegas odds blending
- Confidence scoring
- Factor explanations
"""
from __future__ import annotations

import asyncio
import logging
import re
import time
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import joblib
import numpy as np
import pandas as pd
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ml.pipeline import FEATURE_COLUMNS, build_matchup_features
from models.game import Game
from models.team import Team
from routers.sports import ESPN_BASE, LEAGUES, _fetch_cached, _parse_espn_event

logger = logging.getLogger(__name__)

MODEL_PATH = Path(__file__).resolve().parent / "model.pkl"
_MODEL_BUNDLE: dict[str, Any] | None = None
_MODEL_MTIME: float | None = None
_LEAGUE_GAMES_CACHE: dict[str, tuple[float, pd.DataFrame]] = {}
LEAGUE_GAMES_CACHE_TTL = 30
_TEAM_INJURY_CACHE: dict[tuple[str, str], tuple[float, list[dict[str, Any]]]] = {}
TEAM_INJURY_CACHE_TTL = 300
_TEAM_ROSTER_CACHE: dict[tuple[str, str, str], tuple[float, list[dict[str, Any]]]] = {}
TEAM_ROSTER_CACHE_TTL = 900
_OFFICIAL_TENDENCY_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
OFFICIAL_TENDENCY_CACHE_TTL = 21600

LEAGUE_EXPECTED_TOTALS: dict[str, float] = {
    "NFL": 44.0,
    "NBA": 225.0,
    "MLB": 9.0,
    "NHL": 6.2,
    "EPL": 2.7,
}
LEAGUE_MARGIN_SCALES: dict[str, float] = {
    "NFL": 9.0,
    "NBA": 12.0,
    "MLB": 2.2,
    "NHL": 1.6,
    "EPL": 1.0,
}

# Injury severity weights (higher = more impactful).
_INJURY_STATUS_WEIGHTS: dict[str, float] = {
    "out": 1.0,
    "injured reserve": 1.0,
    "suspension": 1.0,
    "doubtful": 0.75,
    "questionable": 0.35,
    "probable": 0.10,
    "day-to-day": 0.25,
}

# Max probability shift from injuries (per team).
_MAX_INJURY_SHIFT = 0.12
_MAX_DEPTH_SHIFT = 0.05
_MAX_TRAVEL_SHIFT = 0.045
_MAX_MARKET_MOVEMENT_SHIFT = 0.04
_MAX_WEATHER_SHIFT = 0.02
_MAX_WEATHER_REVERSION = 0.16
_MAX_OFFICIAL_SHIFT = 0.025
_MAX_OFFICIAL_REVERSION = 0.08

# Weight given to Vegas odds when blending (0 = ignore, 1 = fully trust odds).
# Vegas lines are the most accurate public signal, so lean on them heavily.
_ODDS_BLEND_WEIGHT_PREGAME = 0.60
_ODDS_BLEND_WEIGHT_LIVE = 0.15
_ODDS_BLEND_WEIGHT_PREGAME_BY_LEAGUE: dict[str, float] = {
    "NFL": 0.64,
    "NBA": 0.58,
    "MLB": 0.76,
    "NHL": 0.72,
    "EPL": 0.66,
}
_ODDS_BLEND_WEIGHT_LIVE_BY_LEAGUE: dict[str, float] = {
    "NFL": 0.18,
    "NBA": 0.14,
    "MLB": 0.28,
    "NHL": 0.25,
    "EPL": 0.18,
}

# Pre-game probability clamp range, wider to allow strong pregame edges.
_PREGAME_PROB_FLOOR = 0.02
_PREGAME_PROB_CEILING = 0.98
_INFERENCE_VERSION = "pred_v4"
_FINAL_BASELINE_WIN_PROB: dict[str, float] = {
    "NFL": 0.88,
    "NBA": 0.89,
    "MLB": 0.90,
    "NHL": 0.87,
    "EPL": 0.86,
}
_FINAL_MAX_WIN_PROB: dict[str, float] = {
    "NFL": 0.985,
    "NBA": 0.985,
    "MLB": 0.975,
    "NHL": 0.97,
    "EPL": 0.965,
}
_FINAL_MARGIN_SCALES: dict[str, float] = {
    "NFL": 7.0,
    "NBA": 10.0,
    "MLB": 1.9,
    "NHL": 1.4,
    "EPL": 1.1,
}
_LIVE_WINPROB_BLEND_BY_LEAGUE: dict[str, float] = {
    "NFL": 0.46,
    "NBA": 0.42,
    "MLB": 0.34,
    "NHL": 0.36,
    "EPL": 0.28,
}
_LIVE_BOXSCORE_BLEND_BY_LEAGUE: dict[str, float] = {
    "NFL": 0.22,
    "NBA": 0.18,
    "MLB": 0.14,
    "NHL": 0.18,
    "EPL": 0.16,
}

_US_STATE_TIMEZONES: dict[str, str] = {
    "AL": "America/Chicago",
    "AK": "America/Anchorage",
    "AZ": "America/Phoenix",
    "AR": "America/Chicago",
    "CA": "America/Los_Angeles",
    "CO": "America/Denver",
    "CT": "America/New_York",
    "DC": "America/New_York",
    "DE": "America/New_York",
    "FL": "America/New_York",
    "GA": "America/New_York",
    "HI": "Pacific/Honolulu",
    "IA": "America/Chicago",
    "ID": "America/Denver",
    "IL": "America/Chicago",
    "IN": "America/Indiana/Indianapolis",
    "KS": "America/Chicago",
    "KY": "America/New_York",
    "LA": "America/Chicago",
    "MA": "America/New_York",
    "MD": "America/New_York",
    "ME": "America/New_York",
    "MI": "America/New_York",
    "MN": "America/Chicago",
    "MO": "America/Chicago",
    "MS": "America/Chicago",
    "MT": "America/Denver",
    "NC": "America/New_York",
    "ND": "America/Chicago",
    "NE": "America/Chicago",
    "NH": "America/New_York",
    "NJ": "America/New_York",
    "NM": "America/Denver",
    "NV": "America/Los_Angeles",
    "NY": "America/New_York",
    "OH": "America/New_York",
    "OK": "America/Chicago",
    "OR": "America/Los_Angeles",
    "PA": "America/New_York",
    "RI": "America/New_York",
    "SC": "America/New_York",
    "SD": "America/Chicago",
    "TN": "America/Chicago",
    "TX": "America/Chicago",
    "UT": "America/Denver",
    "VA": "America/New_York",
    "VT": "America/New_York",
    "WA": "America/Los_Angeles",
    "WI": "America/Chicago",
    "WV": "America/New_York",
    "WY": "America/Denver",
    "ONTARIO": "America/Toronto",
    "QUEBEC": "America/Toronto",
    "QC": "America/Toronto",
    "MANITOBA": "America/Winnipeg",
    "MB": "America/Winnipeg",
    "ALBERTA": "America/Edmonton",
    "AB": "America/Edmonton",
    "BRITISH COLUMBIA": "America/Vancouver",
    "BC": "America/Vancouver",
    "NOVA SCOTIA": "America/Halifax",
    "NS": "America/Halifax",
}
_US_STATE_ALIASES: dict[str, str] = {
    "ALABAMA": "AL",
    "ALASKA": "AK",
    "ARIZONA": "AZ",
    "ARKANSAS": "AR",
    "CALIFORNIA": "CA",
    "COLORADO": "CO",
    "CONNECTICUT": "CT",
    "DELAWARE": "DE",
    "DISTRICT OF COLUMBIA": "DC",
    "FLORIDA": "FL",
    "GEORGIA": "GA",
    "HAWAII": "HI",
    "IDAHO": "ID",
    "ILLINOIS": "IL",
    "INDIANA": "IN",
    "IOWA": "IA",
    "KANSAS": "KS",
    "KENTUCKY": "KY",
    "LOUISIANA": "LA",
    "MAINE": "ME",
    "MARYLAND": "MD",
    "MASSACHUSETTS": "MA",
    "MICHIGAN": "MI",
    "MINNESOTA": "MN",
    "MISSISSIPPI": "MS",
    "MISSOURI": "MO",
    "MONTANA": "MT",
    "NEBRASKA": "NE",
    "NEVADA": "NV",
    "NEW HAMPSHIRE": "NH",
    "NEW JERSEY": "NJ",
    "NEW MEXICO": "NM",
    "NEW YORK": "NY",
    "NORTH CAROLINA": "NC",
    "NORTH DAKOTA": "ND",
    "OHIO": "OH",
    "OKLAHOMA": "OK",
    "OREGON": "OR",
    "PENNSYLVANIA": "PA",
    "RHODE ISLAND": "RI",
    "SOUTH CAROLINA": "SC",
    "SOUTH DAKOTA": "SD",
    "TENNESSEE": "TN",
    "TEXAS": "TX",
    "UTAH": "UT",
    "VERMONT": "VT",
    "VIRGINIA": "VA",
    "WASHINGTON": "WA",
    "WEST VIRGINIA": "WV",
    "WISCONSIN": "WI",
    "WYOMING": "WY",
}
_CITY_TIMEZONES: dict[str, str] = {
    "brooklyn": "America/New_York",
    "new york": "America/New_York",
    "boston": "America/New_York",
    "miami": "America/New_York",
    "charlotte": "America/New_York",
    "orlando": "America/New_York",
    "atlanta": "America/New_York",
    "washington": "America/New_York",
    "philadelphia": "America/New_York",
    "cleveland": "America/New_York",
    "detroit": "America/New_York",
    "toronto": "America/Toronto",
    "montreal": "America/Toronto",
    "ottawa": "America/Toronto",
    "tampa": "America/New_York",
    "pittsburgh": "America/New_York",
    "cincinnati": "America/New_York",
    "indianapolis": "America/Indiana/Indianapolis",
    "nashville": "America/Chicago",
    "chicago": "America/Chicago",
    "milwaukee": "America/Chicago",
    "minneapolis": "America/Chicago",
    "st. paul": "America/Chicago",
    "st louis": "America/Chicago",
    "st. louis": "America/Chicago",
    "kansas city": "America/Chicago",
    "houston": "America/Chicago",
    "dallas": "America/Chicago",
    "arlington": "America/Chicago",
    "san antonio": "America/Chicago",
    "denver": "America/Denver",
    "salt lake city": "America/Denver",
    "phoenix": "America/Phoenix",
    "glendale": "America/Phoenix",
    "edmonton": "America/Edmonton",
    "calgary": "America/Edmonton",
    "winnipeg": "America/Winnipeg",
    "vancouver": "America/Vancouver",
    "seattle": "America/Los_Angeles",
    "portland": "America/Los_Angeles",
    "san francisco": "America/Los_Angeles",
    "oakland": "America/Los_Angeles",
    "san jose": "America/Los_Angeles",
    "san diego": "America/Los_Angeles",
    "sacramento": "America/Los_Angeles",
    "los angeles": "America/Los_Angeles",
    "anaheim": "America/Los_Angeles",
    "las vegas": "America/Los_Angeles",
    "london": "Europe/London",
    "liverpool": "Europe/London",
    "manchester": "Europe/London",
    "birmingham": "Europe/London",
    "newcastle": "Europe/London",
    "brighton": "Europe/London",
    "southampton": "Europe/London",
    "leicester": "Europe/London",
    "nottingham": "Europe/London",
    "bournemouth": "Europe/London",
    "ipswich": "Europe/London",
    "wolverhampton": "Europe/London",
}


# ─────────────────────────────────────────────────────────────────────────
# Model loading
# ─────────────────────────────────────────────────────────────────────────

def _league_candidates(league_hint: str | None = None) -> list[str]:
    requested = str(league_hint or "").upper().strip()
    ordered = ["NFL", "NBA", "MLB", "NHL", "EPL"]
    if requested and requested in ordered:
        return [requested, *[league for league in ordered if league != requested]]
    return ordered


def load_model_bundle() -> dict[str, Any]:
    """Load the trained model bundle, reloading only if the file changes."""
    global _MODEL_BUNDLE, _MODEL_MTIME

    if not MODEL_PATH.exists():
        raise FileNotFoundError(
            f"Prediction model not found at {MODEL_PATH}. Run backend/ml/train.py before serving predictions."
        )

    model_mtime = MODEL_PATH.stat().st_mtime
    if _MODEL_BUNDLE is not None and _MODEL_MTIME == model_mtime:
        return _MODEL_BUNDLE

    try:
        bundle = joblib.load(MODEL_PATH)
    except Exception as exc:
        logger.exception("Failed to load prediction model bundle from %s", MODEL_PATH)
        raise RuntimeError(
            "Prediction model bundle could not be loaded in the current environment. Retrain the model."
        ) from exc
    if not isinstance(bundle, dict) or "models" not in bundle:
        raise RuntimeError("Prediction model bundle is invalid.")

    _MODEL_BUNDLE = bundle
    _MODEL_MTIME = model_mtime
    return bundle


def get_prediction_model_version() -> str:
    bundle = load_model_bundle()
    base_version = str(bundle.get("model_version", "model_unknown"))
    return f"{base_version}:{_INFERENCE_VERSION}"


# ─────────────────────────────────────────────────────────────────────────
# ESPN data helpers
# ─────────────────────────────────────────────────────────────────────────

def _parse_dt(value: Any) -> datetime:
    ts = pd.to_datetime(value, errors="coerce", utc=True)
    if pd.isna(ts):
        return datetime.utcnow()
    return ts.to_pydatetime().replace(tzinfo=None)


def _safe_float(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)) and not pd.isna(value):
        return float(value)

    text = str(value or "").strip()
    if not text or text in {"-", "--", "N/A"}:
        return None
    if re.fullmatch(r"\d+:\d+(?::\d+)?", text):
        parts = [float(part) for part in text.split(":")]
        total = 0.0
        for part in parts:
            total = (total * 60.0) + part
        if len(parts) >= 2:
            total /= 60.0
        return total
    normalized = text.replace("%", "").replace(",", "").replace("+", "")
    if re.fullmatch(r"-?\d+(?:\.\d+)?", normalized):
        try:
            return float(normalized)
        except ValueError:
            return None
    return None


def _normalize_rate(value: Any) -> float | None:
    numeric = _safe_float(value)
    if numeric is None:
        return None
    if numeric > 1.0:
        numeric /= 100.0
    return float(max(0.0, min(1.0, numeric)))


def _normalize_name_key(value: Any) -> str:
    text = str(value or "").strip().lower()
    return re.sub(r"[^a-z0-9]+", "", text)


def _season_for_game_date(league_key: str, when: datetime | None) -> str:
    reference = when or datetime.utcnow()
    month = int(reference.month)
    year = int(reference.year)
    if league_key in {"NFL", "NBA", "NHL"}:
        return str(year if month >= 8 else year - 1)
    if league_key == "EPL":
        return str(year if month >= 7 else year - 1)
    return str(year)


async def _fetch_summary_for_known_league(league_key: str, event_id: str) -> dict[str, Any] | None:
    sport_name, espn_league, _ = LEAGUES[league_key]
    url = f"{ESPN_BASE}/{sport_name}/{espn_league}/summary?event={event_id}"
    try:
        candidate = await _fetch_cached(url, timeout=12.0)
    except Exception:
        return None
    return candidate if isinstance(candidate, dict) else None


async def _fetch_team_roster(league_key: str, espn_team_id: str | None, season_year: str) -> list[dict[str, Any]]:
    if not espn_team_id:
        return []

    cache_key = (league_key, str(espn_team_id), str(season_year))
    cached = _TEAM_ROSTER_CACHE.get(cache_key)
    now = time.time()
    if cached and now - cached[0] < TEAM_ROSTER_CACHE_TTL:
        return list(cached[1])

    sport_name, espn_league, _ = LEAGUES[league_key]
    url = f"{ESPN_BASE}/{sport_name}/{espn_league}/teams/{espn_team_id}?enable=roster&season={season_year}"
    try:
        data = await _fetch_cached(url, timeout=12.0)
    except Exception:
        return []
    if not isinstance(data, dict):
        return []

    athletes = ((data.get("team") or {}).get("athletes") or [])
    roster: list[dict[str, Any]] = []
    for athlete in athletes:
        experience = athlete.get("experience", {}) or {}
        roster.append(
            {
                "name": athlete.get("displayName", ""),
                "position": (athlete.get("position", {}) or {}).get("abbreviation", ""),
                "status": ((athlete.get("status", {}) or {}).get("type") or athlete.get("status") or ""),
                "starter": bool(athlete.get("starter", False)),
                "experience_years": _safe_float(experience.get("years")) or 0.0,
            }
        )

    _TEAM_ROSTER_CACHE[cache_key] = (now, roster)
    return list(roster)


def _extract_summary_competition(summary_data: dict[str, Any] | None) -> dict[str, Any]:
    header = summary_data.get("header", {}) if isinstance(summary_data, dict) else {}
    competitions = header.get("competitions", []) or []
    return competitions[0] if competitions else {}


def _extract_game_info(summary_data: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(summary_data, dict):
        return {}
    return summary_data.get("gameInfo", {}) or {}


def _guess_timezone_from_address(address: dict[str, Any] | None) -> str | None:
    if not isinstance(address, dict):
        return None

    city = str(address.get("city") or "").strip().lower()
    if city and city in _CITY_TIMEZONES:
        return _CITY_TIMEZONES[city]

    state_raw = str(address.get("state") or address.get("province") or "").strip().upper()
    if state_raw in _US_STATE_TIMEZONES:
        return _US_STATE_TIMEZONES[state_raw]
    if state_raw in _US_STATE_ALIASES:
        return _US_STATE_TIMEZONES.get(_US_STATE_ALIASES[state_raw])

    country = str(address.get("country") or "").strip().lower()
    if country in {"england", "uk", "united kingdom", "great britain"}:
        return "Europe/London"
    return None


def _extract_venue_timezone(summary_data: dict[str, Any] | None) -> str | None:
    venue = (_extract_game_info(summary_data).get("venue") or {})
    return _guess_timezone_from_address(venue.get("address") or {})


def _utc_offset_hours(timezone_name: str | None, when: datetime | None) -> float | None:
    if not timezone_name:
        return None
    reference = (when or datetime.utcnow()).replace(tzinfo=ZoneInfo("UTC"))
    try:
        offset = reference.astimezone(ZoneInfo(timezone_name)).utcoffset()
    except Exception:
        return None
    if offset is None:
        return None
    return float(offset.total_seconds() / 3600.0)


def _stat_numeric_value(item: dict[str, Any]) -> float | None:
    if not isinstance(item, dict):
        return None
    numeric = _safe_float(item.get("value"))
    if numeric is not None:
        return numeric
    return _safe_float(item.get("displayValue"))


def _flatten_team_boxscore_stats(team_entry: dict[str, Any]) -> dict[str, float]:
    flattened: dict[str, float] = {}
    for item in team_entry.get("statistics", []) or []:
        nested_stats = item.get("stats")
        if isinstance(nested_stats, list):
            for nested in nested_stats:
                name = str(nested.get("name") or "")
                numeric = _stat_numeric_value(nested)
                if name and numeric is not None:
                    flattened[name] = numeric
            continue
        name = str(item.get("name") or "")
        numeric = _stat_numeric_value(item)
        if name and numeric is not None:
            flattened[name] = numeric
    return flattened


def _boxscore_team_stat_maps(summary_data: dict[str, Any] | None) -> tuple[dict[str, float], dict[str, float]]:
    if not isinstance(summary_data, dict):
        return {}, {}
    teams = ((summary_data.get("boxscore") or {}).get("teams") or [])
    competition = _extract_summary_competition(summary_data)
    competitors = competition.get("competitors", []) or []
    if len(teams) < 2 or len(competitors) < 2:
        return {}, {}

    stat_maps_by_id: dict[str, dict[str, float]] = {}
    for team_entry in teams:
        team_payload = team_entry.get("team", {}) or {}
        team_id = str(team_payload.get("id") or "")
        if team_id:
            stat_maps_by_id[team_id] = _flatten_team_boxscore_stats(team_entry)

    home_id = ""
    away_id = ""
    for competitor in competitors:
        team_payload = competitor.get("team", {}) or {}
        team_id = str(team_payload.get("id") or competitor.get("id") or "")
        if competitor.get("homeAway") == "home":
            home_id = team_id
        elif competitor.get("homeAway") == "away":
            away_id = team_id

    if home_id or away_id:
        return stat_maps_by_id.get(home_id, {}), stat_maps_by_id.get(away_id, {})

    return _flatten_team_boxscore_stats(teams[0]), _flatten_team_boxscore_stats(teams[1])


def _stat_value(stats: dict[str, float], *names: str) -> float | None:
    for name in names:
        if name in stats:
            return stats[name]
    return None


def _team_logo(team_payload: dict[str, Any]) -> str:
    logo = team_payload.get("logo")
    if logo:
        return str(logo)
    logos = team_payload.get("logos") or []
    for item in logos:
        rel = item.get("rel") or []
        if "scoreboard" in rel and item.get("href"):
            return str(item["href"])
    if logos and logos[0].get("href"):
        return str(logos[0]["href"])
    return ""


def _lookup_team(
    db: Session,
    *,
    external_id: str,
    league_key: str,
    team_name: str,
    team_abbr: str,
) -> Team | None:
    team = db.query(Team).filter(Team.external_id == external_id).first()
    if team:
        return team
    return (
        db.query(Team)
        .filter(Team.league == league_key)
        .filter(
            or_(
                func.lower(Team.name) == team_name.lower(),
                func.lower(func.coalesce(Team.short_name, "")) == team_abbr.lower(),
            )
        )
        .first()
    )


def _upsert_team_from_competitor(db: Session, competitor: dict[str, Any], league_key: str) -> Team:
    sport_name, _, _ = LEAGUES[league_key]
    team_payload = competitor.get("team", {}) or {}
    team_id = str(team_payload.get("id") or competitor.get("id") or "")
    team_name = str(team_payload.get("displayName") or team_payload.get("shortDisplayName") or "")
    team_abbr = str(team_payload.get("abbreviation") or "")
    external_id = f"espn:{league_key}:{team_id}"
    team = _lookup_team(
        db,
        external_id=external_id,
        league_key=league_key,
        team_name=team_name,
        team_abbr=team_abbr,
    )

    if not team:
        team = Team(
            external_id=external_id,
            name=team_name,
            short_name=team_abbr,
            sport=sport_name,
            league=league_key,
            logo_url=_team_logo(team_payload),
            city=str(team_payload.get("location") or ""),
        )
        db.add(team)
        db.flush()
        return team

    team.name = team_name or team.name
    team.short_name = team_abbr or team.short_name
    team.sport = sport_name
    team.league = league_key
    team.logo_url = _team_logo(team_payload) or team.logo_url
    team.city = str(team_payload.get("location") or team.city or "")
    if not team.external_id:
        team.external_id = external_id
    db.flush()
    return team


def _upsert_game_from_event(db: Session, event: dict[str, Any], league_key: str) -> Game | None:
    event_id = str(event.get("id") or "")
    competition = (event.get("competitions") or [{}])[0] or {}
    competitors = competition.get("competitors") or []
    if not event_id or len(competitors) < 2:
        return None

    home_comp = next((comp for comp in competitors if comp.get("homeAway") == "home"), competitors[0])
    away_comp = next((comp for comp in competitors if comp.get("homeAway") == "away"), competitors[-1])
    home_team = _upsert_team_from_competitor(db, home_comp, league_key)
    away_team = _upsert_team_from_competitor(db, away_comp, league_key)
    parsed = _parse_espn_event(event, league_key)
    sport_name, _, _ = LEAGUES[league_key]
    scheduled_at = _parse_dt(event.get("date") or competition.get("date"))

    game = db.query(Game).filter(Game.id == event_id).first()
    if not game:
        game = Game(
            id=event_id,
            home_team_id=home_team.id,
            away_team_id=away_team.id,
            sport=sport_name,
            league=league_key,
            scheduled_at=scheduled_at,
            status=parsed["status"],
            home_score=int(parsed["homeScore"]),
            away_score=int(parsed["awayScore"]),
        )
        db.add(game)
    else:
        game.home_team_id = home_team.id
        game.away_team_id = away_team.id
        game.sport = sport_name
        game.league = league_key
        game.scheduled_at = scheduled_at
        game.status = parsed["status"]
        game.home_score = int(parsed["homeScore"])
        game.away_score = int(parsed["awayScore"])

    setattr(game, "_prediction_status_detail", str(parsed.get("statusDetail") or ""))
    db.flush()
    return game


async def _fetch_summary_for_event(event_id: str, league_hint: str | None = None) -> tuple[str | None, dict[str, Any] | None, dict[str, Any] | None]:
    for league_key in _league_candidates(league_hint):
        sport_name, espn_league, _ = LEAGUES[league_key]
        url = f"{ESPN_BASE}/{sport_name}/{espn_league}/summary?event={event_id}"
        candidate = await _fetch_cached(url, timeout=12.0)
        if not isinstance(candidate, dict):
            continue
        header = candidate.get("header", {}) or {}
        competitions = header.get("competitions", []) or []
        competition = competitions[0] if competitions else {}
        competition_id = str(competition.get("id") or header.get("id") or "")
        competitors = competition.get("competitors", []) or []
        if competition_id == str(event_id) and competitors:
            return league_key, candidate, competition
    return None, None, None


async def _sync_team_schedule_history(db: Session, league_key: str, team_id: str, season: int) -> None:
    sport_name, espn_league, _ = LEAGUES[league_key]
    schedule_url = f"{ESPN_BASE}/{sport_name}/{espn_league}/teams/{team_id}/schedule?season={season}"
    data = await _fetch_cached(schedule_url, timeout=20.0)
    if not isinstance(data, dict):
        return
    for event in data.get("events", []) or []:
        try:
            _upsert_game_from_event(db, event, league_key)
        except Exception:
            continue
    db.commit()


def _team_final_game_count(db: Session, league_key: str, team_db_id: str, cutoff: datetime) -> int:
    return (
        db.query(Game)
        .filter(Game.league == league_key)
        .filter(Game.status == "final")
        .filter(Game.scheduled_at < cutoff)
        .filter(or_(Game.home_team_id == team_db_id, Game.away_team_id == team_db_id))
        .count()
    )


def _load_league_games_dataframe(db: Session, league_key: str) -> pd.DataFrame:
    cached = _LEAGUE_GAMES_CACHE.get(league_key)
    now = time.time()
    if cached and now - cached[0] < LEAGUE_GAMES_CACHE_TTL:
        return cached[1].copy()

    query = select(
        Game.id,
        Game.home_team_id,
        Game.away_team_id,
        Game.sport,
        Game.league,
        Game.scheduled_at,
        Game.status,
        Game.home_score,
        Game.away_score,
    ).where(
        Game.league == league_key,
    ).order_by(
        Game.scheduled_at.asc(),
        Game.id.asc(),
    )
    dataframe = pd.read_sql(query, db.get_bind())
    _LEAGUE_GAMES_CACHE[league_key] = (now, dataframe)
    return dataframe.copy()


# ─────────────────────────────────────────────────────────────────────────
# Injury impact
# ─────────────────────────────────────────────────────────────────────────

async def _fetch_team_injuries(league_key: str, espn_team_id: str) -> list[dict[str, Any]]:
    """Fetch injury report for a team from ESPN."""
    cache_key = (league_key, str(espn_team_id))
    cached = _TEAM_INJURY_CACHE.get(cache_key)
    now = time.time()
    if cached and now - cached[0] < TEAM_INJURY_CACHE_TTL:
        return list(cached[1])

    sport_name, espn_league, _ = LEAGUES[league_key]
    url = f"{ESPN_BASE}/{sport_name}/{espn_league}/teams/{espn_team_id}/injuries"
    try:
        data = await _fetch_cached(url, timeout=8.0)
    except Exception:
        return []
    if not isinstance(data, dict):
        return []

    injuries: list[dict[str, Any]] = []
    for section in data.get("injuries", []) or []:
        for item in section.get("injuries", []) or []:
            athlete = item.get("athlete", {}) or {}
            status_str = str(item.get("status", "") or "").lower().strip()
            injuries.append({
                "name": athlete.get("displayName", ""),
                "position": athlete.get("position", {}).get("abbreviation", ""),
                "status": status_str,
                "description": item.get("longComment", "") or item.get("shortComment", ""),
                "is_starter": bool(athlete.get("starter", False)),
            })
    _TEAM_INJURY_CACHE[cache_key] = (now, injuries)
    return list(injuries)


def _injury_impact_score(injuries: list[dict[str, Any]], league_key: str) -> tuple[float, list[str]]:
    """
    Compute a 0–1 injury impact score for a team.
    Returns (impact_score, list_of_factor_strings).
    """
    if not injuries:
        return 0.0, []

    # Weights: starters are worth 2x more than bench players
    total_impact = 0.0
    factors: list[str] = []
    significant_injuries: list[tuple[float, str]] = []

    for inj in injuries:
        status = inj.get("status", "")
        weight = _INJURY_STATUS_WEIGHTS.get(status, 0.0)
        if weight <= 0:
            continue

        # Starters are more impactful
        starter_mult = 1.8 if inj.get("is_starter") else 1.0

        # Key positions are more impactful
        pos = str(inj.get("position", "")).upper()
        position_mult = 1.0
        if league_key == "NBA" and pos in ("PG", "C"):
            position_mult = 1.3
        elif league_key == "NFL" and pos in ("QB",):
            position_mult = 2.5
        elif league_key == "NHL" and pos in ("G",):
            position_mult = 2.0
        elif league_key == "MLB" and pos in ("SP", "P"):
            position_mult = 1.5

        player_impact = weight * starter_mult * position_mult
        total_impact += player_impact
        if weight >= 0.5:
            name = inj.get("name", "Unknown")
            significant_injuries.append((player_impact, f"{name} ({status})"))

    # Normalize: ~5 impact points = max shift
    normalized = min(1.0, total_impact / 5.0)

    # Build factor strings for the top injuries
    significant_injuries.sort(key=lambda x: x[0], reverse=True)
    for _, desc in significant_injuries[:3]:
        factors.append(desc)

    return normalized, factors


def _depth_chart_impact_score(
    injuries: list[dict[str, Any]],
    roster: list[dict[str, Any]],
    league_key: str,
) -> tuple[float, list[str]]:
    """Estimate how thin the active rotation is beyond the base injury report."""
    if not injuries or not roster:
        return 0.0, []

    injured_lookup = {
        _normalize_name_key(item.get("name")): item
        for item in injuries
        if _INJURY_STATUS_WEIGHTS.get(str(item.get("status", "")).lower().strip(), 0.0) > 0
    }
    if not injured_lookup:
        return 0.0, []

    by_position: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for athlete in roster:
        position = str(athlete.get("position") or "UNK").upper().strip() or "UNK"
        by_position[position].append(athlete)

    total_pressure = 0.0
    position_impacts: list[tuple[float, str]] = []
    for injury in injuries:
        status = str(injury.get("status", "")).lower().strip()
        severity = _INJURY_STATUS_WEIGHTS.get(status, 0.0)
        if severity <= 0:
            continue

        position = str(injury.get("position") or "UNK").upper().strip() or "UNK"
        room = by_position.get(position) or by_position.get("UNK") or []
        injured_names = set(injured_lookup)
        healthy_room = [
            athlete for athlete in room if _normalize_name_key(athlete.get("name")) not in injured_names
        ]
        healthy_count = len(healthy_room)
        experience_avg = float(
            np.mean([float(player.get("experience_years", 0.0) or 0.0) for player in healthy_room])
        ) if healthy_room else 0.0

        scarcity_pressure = max(0.0, 2.5 - healthy_count) * 0.22
        experience_pressure = max(0.0, 0.18 - min(0.18, experience_avg / 30.0))
        starter_pressure = 0.14 if injury.get("is_starter") else 0.0

        position_weight = 1.0
        if league_key == "NBA" and position in {"PG", "G", "C"}:
            position_weight = 1.12
        elif league_key == "NFL" and position in {"QB", "LT", "CB"}:
            position_weight = 1.18
        elif league_key == "MLB" and position in {"SP", "P", "C"}:
            position_weight = 1.12
        elif league_key == "NHL" and position in {"G", "C"}:
            position_weight = 1.14

        extra_impact = severity * position_weight * (scarcity_pressure + experience_pressure + starter_pressure)
        if extra_impact <= 0:
            continue
        total_pressure += extra_impact

        if extra_impact >= 0.12:
            name = str(injury.get("name") or "Unknown")
            room_desc = f"{healthy_count} healthy {position}" if position != "UNK" else f"{healthy_count} healthy depth pieces"
            position_impacts.append((extra_impact, f"{name} leaves only {room_desc}"))

    position_impacts.sort(key=lambda item: item[0], reverse=True)
    normalized = min(1.0, total_pressure / 2.1)
    return normalized, [desc for _, desc in position_impacts[:2]]


def _latest_prior_team_game(db: Session, league_key: str, team_db_id: str, cutoff: datetime) -> Game | None:
    return (
        db.query(Game)
        .filter(Game.league == league_key)
        .filter(Game.scheduled_at < cutoff)
        .filter(Game.status.in_(["final", "live"]))
        .filter(or_(Game.home_team_id == team_db_id, Game.away_team_id == team_db_id))
        .order_by(Game.scheduled_at.desc(), Game.id.desc())
        .first()
    )


# ─────────────────────────────────────────────────────────────────────────
# Vegas odds
# ─────────────────────────────────────────────────────────────────────────

def _spread_to_home_probability(spread: float) -> float:
    """
    Convert a point spread to implied home win probability.
    Negative spread = home favorite (e.g. -7 means home favored by 7).
    Uses a logistic function calibrated to empirical NFL data.
    """
    # Logistic: P(home win) = 1 / (1 + exp(k * spread))
    # k ≈ 0.14 fits well for NFL/NBA spreads
    k = 0.14
    return float(1.0 / (1.0 + np.exp(k * spread)))


def _american_odds_to_probability(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        odds = int(value)
    else:
        text = str(value or "").strip().upper().replace("−", "-")
        if not text:
            return None
        if text in {"EVEN", "EV"}:
            odds = 100
        else:
            if text.startswith("+"):
                text = text[1:]
            if not re.fullmatch(r"-?\d+", text):
                return None
            odds = int(text)

    if odds == 0:
        return None
    if odds > 0:
        return float(100.0 / (odds + 100.0))
    return float(abs(odds) / (abs(odds) + 100.0))


def _normalize_market_probabilities(*probabilities: float | None) -> tuple[float, ...] | None:
    cleaned = [float(prob) for prob in probabilities if prob is not None]
    total = sum(cleaned)
    if total <= 0:
        return None
    normalized: list[float] = []
    cleaned_iter = iter(cleaned)
    for prob in probabilities:
        if prob is None:
            normalized.append(0.0)
        else:
            normalized.append(float(next(cleaned_iter) / total))
    return tuple(normalized)


def _pickcenter_market_odds(market: dict[str, Any], states: list[str]) -> tuple[str | None, str | None]:
    home_market = market.get("home", {}) if isinstance(market, dict) else {}
    away_market = market.get("away", {}) if isinstance(market, dict) else {}
    for state in states:
        home_candidate = home_market.get(state, {}) if isinstance(home_market, dict) else {}
        away_candidate = away_market.get(state, {}) if isinstance(away_market, dict) else {}
        home_odds = home_candidate.get("odds") if isinstance(home_candidate, dict) else None
        away_odds = away_candidate.get("odds") if isinstance(away_candidate, dict) else None
        if home_odds is not None and away_odds is not None:
            return str(home_odds), str(away_odds)
    return None, None


def _extract_odds_signal(summary_data: dict[str, Any] | None) -> tuple[float | None, list[str]]:
    """Extract spread-implied probability from ESPN summary data."""
    if not summary_data:
        return None, []

    # Try pickcenter or odds from the summary
    odds_list = summary_data.get("odds", []) or []
    if not odds_list:
        # Try from header → competitions → odds
        header = summary_data.get("header", {}) or {}
        competitions = header.get("competitions", []) or []
        if competitions:
            odds_list = competitions[0].get("odds", []) or []

    if not odds_list:
        return None, []

    odds = odds_list[0] if isinstance(odds_list, list) else {}
    spread = odds.get("spread")
    details = odds.get("details", "")
    over_under = odds.get("overUnder")

    factors: list[str] = []

    if spread is not None:
        try:
            spread_val = float(spread)
            implied_prob = _spread_to_home_probability(spread_val)
            if details:
                factors.append(f"Line: {details}")
            if over_under:
                factors.append(f"O/U: {over_under}")
            return implied_prob, factors
        except (ValueError, TypeError):
            pass

    return None, []


def _extract_market_odds_signal(
    summary_data: dict[str, Any] | None,
    *,
    game_status: str,
) -> tuple[float | None, float | None, list[str]]:
    """Extract sportsbook home-win signal and optional draw pressure."""
    if not summary_data:
        return None, None, []

    market_states = ["live", "close", "open"] if game_status == "live" else ["close", "open", "live"]
    factors: list[str] = []

    pickcenter = summary_data.get("pickcenter", []) or []
    if isinstance(pickcenter, list) and pickcenter:
        home_odds, away_odds = _pickcenter_market_odds(pickcenter[0].get("moneyline", {}) or {}, market_states)
        home_prob_raw = _american_odds_to_probability(home_odds)
        away_prob_raw = _american_odds_to_probability(away_odds)
        normalized = _normalize_market_probabilities(home_prob_raw, away_prob_raw)
        if normalized is not None:
            home_prob, away_prob = normalized
            factors.append(f"Moneyline: home {home_odds} / away {away_odds}")
            return float(home_prob / max(home_prob + away_prob, 1e-9)), None, factors

    header = summary_data.get("header", {}) or {}
    competitions = header.get("competitions", []) or []
    odds_list = summary_data.get("odds", []) or []
    if not odds_list and competitions:
        odds_list = competitions[0].get("odds", []) or []

    if not odds_list:
        return None, None, []

    odds = odds_list[0] if isinstance(odds_list, list) else {}
    home_moneyline = ((odds.get("homeTeamOdds") or {}).get("moneyLine"))
    away_moneyline = ((odds.get("awayTeamOdds") or {}).get("moneyLine"))
    draw_moneyline = ((odds.get("drawOdds") or {}).get("moneyLine"))
    home_prob_raw = _american_odds_to_probability(home_moneyline)
    away_prob_raw = _american_odds_to_probability(away_moneyline)
    draw_prob_raw = _american_odds_to_probability(draw_moneyline)

    if home_prob_raw is not None and away_prob_raw is not None:
        if draw_prob_raw is not None:
            normalized = _normalize_market_probabilities(home_prob_raw, away_prob_raw, draw_prob_raw)
            if normalized is not None:
                home_prob, away_prob, draw_prob = normalized
                factors.append(
                    f"Moneyline: home {home_moneyline} / away {away_moneyline} / draw {draw_moneyline}"
                )
                no_draw_total = max(home_prob + away_prob, 1e-9)
                return float(home_prob / no_draw_total), float(draw_prob), factors
        normalized = _normalize_market_probabilities(home_prob_raw, away_prob_raw)
        if normalized is not None:
            home_prob, away_prob = normalized
            factors.append(f"Moneyline: home {home_moneyline} / away {away_moneyline}")
            return float(home_prob / max(home_prob + away_prob, 1e-9)), None, factors

    spread = odds.get("spread")
    details = odds.get("details", "")
    over_under = odds.get("overUnder")
    if spread is not None:
        try:
            spread_val = float(spread)
            implied_prob = _spread_to_home_probability(spread_val)
            if details:
                factors.append(f"Line: {details}")
            if over_under:
                factors.append(f"O/U: {over_under}")
            return implied_prob, None, factors
        except (ValueError, TypeError):
            return None, None, []

    return None, None, []


def _pickcenter_state_probability(market: dict[str, Any], state: str) -> float | None:
    home_market = (market.get("home") or {}) if isinstance(market, dict) else {}
    away_market = (market.get("away") or {}) if isinstance(market, dict) else {}
    home_odds = ((home_market.get(state) or {}).get("odds")) if isinstance(home_market, dict) else None
    away_odds = ((away_market.get(state) or {}).get("odds")) if isinstance(away_market, dict) else None
    home_prob_raw = _american_odds_to_probability(home_odds)
    away_prob_raw = _american_odds_to_probability(away_odds)
    normalized = _normalize_market_probabilities(home_prob_raw, away_prob_raw)
    if normalized is None:
        return None
    home_prob, away_prob = normalized
    return float(home_prob / max(home_prob + away_prob, 1e-9))


def _market_movement_signal(summary_data: dict[str, Any] | None, *, game_status: str) -> tuple[float, float, list[str]]:
    """Capture open-to-close or close-to-live market movement."""
    if not summary_data:
        return 0.0, 0.0, []

    pickcenter = summary_data.get("pickcenter", []) or []
    if not isinstance(pickcenter, list) or not pickcenter:
        return 0.0, 0.0, []

    market = pickcenter[0].get("moneyline", {}) or {}
    open_prob = _pickcenter_state_probability(market, "open")
    close_prob = _pickcenter_state_probability(market, "close")
    live_prob = _pickcenter_state_probability(market, "live")

    target_prob = live_prob if game_status == "live" and live_prob is not None else close_prob
    source_prob = open_prob if open_prob is not None else close_prob
    if source_prob is None or target_prob is None:
        return 0.0, 0.0, []

    market_delta = float(target_prob - source_prob)
    if abs(market_delta) < 0.01:
        return 0.0, 0.0, []

    shift = float(max(-_MAX_MARKET_MOVEMENT_SHIFT, min(_MAX_MARKET_MOVEMENT_SHIFT, market_delta * 0.25)))
    confidence_delta = min(0.035, abs(market_delta) * 0.09)
    direction = "home" if market_delta > 0 else "away"
    factors = [
        f"Market movement toward {direction}: {source_prob:.0%} -> {target_prob:.0%}",
    ]
    return shift, confidence_delta, factors


def _weather_signal(summary_data: dict[str, Any] | None) -> tuple[float, float, float, list[str]]:
    """Model outdoor weather as a small home familiarity boost with volatility damping."""
    weather = (_extract_game_info(summary_data).get("weather") or {})
    if not isinstance(weather, dict) or not weather:
        return 0.0, 0.0, 0.0, []

    temperature = _safe_float(weather.get("temperature"))
    gust = _safe_float(weather.get("gust"))
    precipitation = _safe_float(weather.get("precipitation"))

    severity = 0.0
    if temperature is not None:
        severity += min(0.42, abs(temperature - 67.0) / 65.0)
    if gust is not None:
        severity += min(0.36, max(0.0, gust - 14.0) / 35.0)
    if precipitation is not None:
        precip_rate = precipitation / 100.0 if precipitation > 1.0 else precipitation
        severity += min(0.38, max(0.0, precip_rate))

    severity = min(1.0, severity)
    if severity < 0.12:
        return 0.0, 0.0, 0.0, []

    shift = min(_MAX_WEATHER_SHIFT, severity * 0.018)
    reversion = min(_MAX_WEATHER_REVERSION, severity * 0.11)
    confidence_delta = -min(0.10, severity * 0.09)

    details: list[str] = []
    if temperature is not None:
        details.append(f"{temperature:.0f}F")
    if gust is not None and gust > 0:
        details.append(f"{gust:.0f} mph gusts")
    if precipitation is not None and precipitation > 0:
        precip_label = precipitation if precipitation > 1.0 else precipitation * 100.0
        details.append(f"{precip_label:.0f}% precip")
    factors = [f"Weather pressure: {', '.join(details)}"] if details else []
    return shift, reversion, confidence_delta, factors


async def _travel_signal(
    db: Session,
    *,
    league_key: str,
    game: Game,
    summary_data: dict[str, Any] | None,
    home_name: str,
    away_name: str,
) -> tuple[float, float, list[str]]:
    current_timezone = _extract_venue_timezone(summary_data)
    if not current_timezone:
        return 0.0, 0.0, []

    async def _team_burden(team_id: str, team_name: str, current_is_home: bool) -> tuple[float, str | None]:
        previous_game = _latest_prior_team_game(db, league_key, team_id, game.scheduled_at or datetime.utcnow())
        if not previous_game:
            return 0.0, None

        previous_summary = await _fetch_summary_for_known_league(league_key, str(previous_game.id))
        previous_timezone = _extract_venue_timezone(previous_summary)
        if not previous_timezone:
            return 0.0, None

        previous_offset = _utc_offset_hours(previous_timezone, previous_game.scheduled_at)
        current_offset = _utc_offset_hours(current_timezone, game.scheduled_at)
        timezone_shift = abs((current_offset or 0.0) - (previous_offset or 0.0))
        rest_days = max(
            0.0,
            ((game.scheduled_at or datetime.utcnow()) - (previous_game.scheduled_at or datetime.utcnow())).total_seconds()
            / 86400.0,
        )
        previous_was_away = str(previous_game.away_team_id) == str(team_id)
        burden = 0.0
        burden += max(0.0, (3.5 - rest_days) / 3.5) * 0.70
        burden += min(1.0, timezone_shift / 3.0) * (0.78 if rest_days < 4.0 else 0.42)
        if previous_was_away and not current_is_home:
            burden += 0.18
        elif previous_was_away != (not current_is_home):
            burden += 0.09

        normalized = min(1.0, burden / 1.55)
        if normalized < 0.16:
            return 0.0, None
        return normalized, (
            f"{team_name} travel spot: {timezone_shift:.0f} time-zone shift on {rest_days:.1f} days rest"
        )

    home_burden, home_factor = await _team_burden(str(game.home_team_id), home_name, True)
    away_burden, away_factor = await _team_burden(str(game.away_team_id), away_name, False)
    shift = float(max(-_MAX_TRAVEL_SHIFT, min(_MAX_TRAVEL_SHIFT, (away_burden - home_burden) * _MAX_TRAVEL_SHIFT)))
    confidence_delta = -min(0.06, (home_burden + away_burden) * 0.025)
    factors = [factor for factor in [home_factor, away_factor] if factor]
    return shift, confidence_delta, factors


# ─────────────────────────────────────────────────────────────────────────
# Game sync
# ─────────────────────────────────────────────────────────────────────────

async def ensure_prediction_game(db: Session, game_id: str, league_hint: str | None = None) -> Game:
    """
    Ensure the requested ESPN event exists locally and that enough recent history
    is synced for feature generation.
    """
    existing = db.query(Game).filter(Game.id == str(game_id)).first()
    preferred_league = league_hint or (existing.league.upper() if existing else None)
    status = str(existing.status or "").lower() if existing else ""
    scheduled_at = existing.scheduled_at if existing else None
    now = datetime.utcnow()
    hours_to_game = None
    if scheduled_at:
        try:
            hours_to_game = (scheduled_at - now).total_seconds() / 3600.0
        except Exception:
            hours_to_game = None
    should_refresh_from_espn = (
        existing is None
        or status == "live"
        or status == "upcoming"
        or (hours_to_game is not None and hours_to_game <= 36.0)
    )

    league_key: str | None = None
    summary_data: dict[str, Any] | None = None
    competition: dict[str, Any] | None = None
    if should_refresh_from_espn:
        league_key, summary_data, competition = await _fetch_summary_for_event(str(game_id), preferred_league)

    if league_key and summary_data and competition:
        synthetic_event = {
            "id": str(game_id),
            "date": competition.get("date", ""),
            "status": competition.get("status", {}),
            "competitions": [competition],
        }
        game = _upsert_game_from_event(db, synthetic_event, league_key)
        db.commit()
        if not game:
            raise ValueError("Game could not be synced for prediction.")
        # Stash summary data for odds/injury extraction
        setattr(game, "_summary_data", summary_data)
    elif existing:
        game = existing
        league_key = existing.league.upper()
        setattr(game, "_summary_data", None)
    else:
        raise ValueError("Game not found in ESPN data.")

    home_team = db.query(Team).filter(Team.id == game.home_team_id).first()
    away_team = db.query(Team).filter(Team.id == game.away_team_id).first()
    if not home_team or not away_team:
        raise ValueError("Prediction teams could not be resolved.")

    # Stash team objects for injury lookups
    setattr(game, "_home_team", home_team)
    setattr(game, "_away_team", away_team)

    cutoff = game.scheduled_at
    home_count = _team_final_game_count(db, league_key, home_team.id, cutoff)
    away_count = _team_final_game_count(db, league_key, away_team.id, cutoff)

    if min(home_count, away_count) < 8:
        home_external = (home_team.external_id or "").split(":")[-1]
        away_external = (away_team.external_id or "").split(":")[-1]
        seasons = [cutoff.year, cutoff.year - 1]
        for season in seasons:
            if home_external:
                await _sync_team_schedule_history(db, league_key, home_external, season)
            if away_external:
                await _sync_team_schedule_history(db, league_key, away_external, season)
        game = db.query(Game).filter(Game.id == str(game_id)).first() or game

    return game


# ─────────────────────────────────────────────────────────────────────────
# Feature vector
# ─────────────────────────────────────────────────────────────────────────

def build_feature_vector(db: Session, game: Game) -> dict[str, float]:
    league_key = game.league.upper()
    league_games_df = _load_league_games_dataframe(db, league_key)
    scheduled_at = game.scheduled_at or datetime.utcnow()
    features = build_matchup_features(
        league_games_df,
        home_team_id=str(game.home_team_id),
        away_team_id=str(game.away_team_id),
        league=league_key,
        scheduled_at=scheduled_at,
    )
    return features


# ─────────────────────────────────────────────────────────────────────────
# Live game state
# ─────────────────────────────────────────────────────────────────────────

def _extract_live_progress(league_key: str, status_detail: str) -> float:
    """Compute 0.0–1.0 game completion from ESPN ``statusDetail``.

    ESPN sends status details in human-readable forms:
      NBA:  "2:27 - 3rd",  "Halftime",  "End of 3rd",  "OT 4:20"
      NFL:  "8:30 - 2nd",  "Halftime",  "End of 3rd",  "OT 9:00"
      MLB:  "Top 8th",  "Bot 9th",  "Mid 8th",  "End 7th"
      NHL:  "1:41 - 2nd",  "End of 2nd",  "OT 3:15"
      EPL:  "45'+2",  "HT",  "65'"
    """
    detail = str(status_detail or "").upper().strip()
    if not detail:
        return 0.0

    # ── Halftime / intermission markers ──
    if "HALFTIME" in detail or detail == "HT":
        if league_key in ("NBA", "NFL"):
            return 0.50
        if league_key == "EPL":
            return 0.50
        return 0.50

    # ── NBA (4 × 12-min quarters, OT = 5 min) ──
    if league_key == "NBA":
        # "End of 3rd" → end of Q3
        end_match = re.search(r"END\s+(?:OF\s+)?(\d+)(?:ST|ND|RD|TH)", detail)
        if end_match:
            period = max(1, int(end_match.group(1)))
            return min(1.0, period / 4.0)

        overtime = "OT" in detail
        minutes_per_period = 5.0 if overtime else 12.0
        total_periods = 5 if overtime else 4

        # ESPN format: "2:27 - 3rd" or "OT 4:20" or "Q3 2:27"
        clock_match = re.search(r"(\d+):(\d+(?:\.\d+)?)", detail)
        period_num = None

        # Format A: "Q3 2:27" or "OT1 4:20"
        q_match = re.search(r"\b(?:Q|OT)(\d+)", detail)
        if q_match:
            period_num = max(1, int(q_match.group(1)))
            if "OT" in detail:
                period_num = 4 + period_num

        # Format B: "2:27 - 3rd" or "4:20 - OT"
        if period_num is None:
            ordinal_match = re.search(r"(\d+)(?:ST|ND|RD|TH)", detail)
            if ordinal_match:
                period_num = max(1, int(ordinal_match.group(1)))
            elif overtime:
                period_num = 5  # single OT

        if clock_match and period_num:
            minutes_left = int(clock_match.group(1)) + float(clock_match.group(2)) / 60.0
            if period_num <= 4:
                elapsed = (period_num - 1) * 12.0 + max(0.0, 12.0 - minutes_left)
                return min(1.0, max(0.0, elapsed / 48.0))
            else:
                ot_index = period_num - 4
                elapsed = 48.0 + (ot_index - 1) * 5.0 + max(0.0, 5.0 - minutes_left)
                total_ot = 48.0 + ot_index * 5.0
                return min(1.0, max(0.0, elapsed / total_ot))

    # ── NFL (4 × 15-min quarters, OT = 10 min) ──
    if league_key == "NFL":
        end_match = re.search(r"END\s+(?:OF\s+)?(\d+)(?:ST|ND|RD|TH)", detail)
        if end_match:
            quarter = max(1, int(end_match.group(1)))
            return min(1.0, quarter / 4.0)

        overtime = "OT" in detail
        clock_match = re.search(r"(\d+):(\d+(?:\.\d+)?)", detail)
        period_num = None

        q_match = re.search(r"\bQ(\d+)", detail)
        if q_match:
            period_num = max(1, int(q_match.group(1)))

        if period_num is None:
            ordinal_match = re.search(r"(\d+)(?:ST|ND|RD|TH)", detail)
            if ordinal_match:
                period_num = max(1, int(ordinal_match.group(1)))
            elif overtime:
                period_num = 5

        if clock_match and period_num:
            minutes_left = int(clock_match.group(1)) + float(clock_match.group(2)) / 60.0
            if period_num <= 4:
                elapsed = (period_num - 1) * 15.0 + max(0.0, 15.0 - minutes_left)
                return min(1.0, max(0.0, elapsed / 60.0))
            else:
                elapsed = 60.0 + max(0.0, 10.0 - minutes_left)
                return min(1.0, max(0.0, elapsed / 70.0))

    # ── MLB (9 innings with top/mid/bot/end) ──
    if league_key == "MLB":
        inning_match = re.search(r"\b(TOP|BOT|MID|END)\s+(?:OF\s+)?(\d+)(?:ST|ND|RD|TH)?\b", detail)
        if inning_match:
            half = inning_match.group(1)
            inning = max(1, int(inning_match.group(2)))
            completed_halves = (inning - 1) * 2
            if half in ("BOT", "MID"):
                completed_halves += 1
            elif half == "END":
                completed_halves += 2
            return min(1.0, max(0.0, completed_halves / 18.0))

    # ── NHL (3 × 20-min periods, OT = 5 min) ──
    if league_key == "NHL":
        end_match = re.search(r"END\s+(?:OF\s+)?(\d+)(?:ST|ND|RD|TH)", detail)
        if end_match:
            period = max(1, int(end_match.group(1)))
            return min(1.0, period / 3.0)

        overtime = "OT" in detail
        clock_match = re.search(r"(\d+):(\d+(?:\.\d+)?)", detail)
        period_num = None

        p_match = re.search(r"\bP(\d+)", detail)
        if p_match:
            period_num = max(1, int(p_match.group(1)))

        if period_num is None:
            ordinal_match = re.search(r"(\d+)(?:ST|ND|RD|TH)", detail)
            if ordinal_match:
                period_num = max(1, int(ordinal_match.group(1)))
            elif overtime:
                period_num = 4

        if clock_match and period_num:
            minutes_left = int(clock_match.group(1)) + float(clock_match.group(2)) / 60.0
            if period_num <= 3:
                elapsed = (period_num - 1) * 20.0 + max(0.0, 20.0 - minutes_left)
                return min(1.0, max(0.0, elapsed / 60.0))
            else:
                elapsed = 60.0 + max(0.0, 5.0 - minutes_left)
                return min(1.0, max(0.0, elapsed / 65.0))

    # ── EPL / Soccer (90 min + stoppage) ──
    if league_key == "EPL":
        minute_match = re.search(r"(\d+)(?:\+(\d+))?'", detail)
        if minute_match:
            minute = int(minute_match.group(1))
            stoppage = int(minute_match.group(2) or 0)
            return min(1.0, max(0.0, (minute + stoppage) / 90.0))

    return 0.0


def _apply_final_result_confidence(
    *,
    league_key: str,
    game: Game,
    base_home_win_prob: float,
    base_away_win_prob: float,
) -> tuple[float, float]:
    home_score = float(game.home_score or 0)
    away_score = float(game.away_score or 0)
    score_diff = home_score - away_score
    if score_diff == 0:
        return 0.5, 0.5

    winner_is_home = score_diff > 0
    winner_base_prob = float(base_home_win_prob if winner_is_home else base_away_win_prob)
    winner_base_prob = max(0.5, min(0.95, winner_base_prob))

    baseline = _FINAL_BASELINE_WIN_PROB.get(league_key, 0.83)
    ceiling = _FINAL_MAX_WIN_PROB.get(league_key, 0.975)
    margin_scale = _FINAL_MARGIN_SCALES.get(league_key, 2.0)
    margin_strength = 1.0 - float(np.exp(-(abs(score_diff) / max(margin_scale, 0.1))))

    winner_prob = baseline + (ceiling - baseline) * margin_strength
    winner_prob = (winner_prob * 0.95) + (winner_base_prob * 0.05)

    status_detail = str(getattr(game, "_prediction_status_detail", "") or "").upper()
    if any(tag in status_detail for tag in ("OT", "AET", "EXTRA TIME", "PEN")):
        winner_prob -= 0.035

    winner_prob = float(max(0.78, min(ceiling, winner_prob)))
    loser_prob = 1.0 - winner_prob
    if winner_is_home:
        return winner_prob, loser_prob
    return loser_prob, winner_prob


def _apply_live_game_state(
    *,
    league_key: str,
    game: Game,
    base_home_win_prob: float,
    base_away_win_prob: float,
) -> tuple[float, float]:
    """Blend the base ML probability with the live score state.

    The further into the game and the larger the margin, the more
    the actual score dominates over the pre-game model.
    """
    status = str(game.status or "").lower()
    if status == "final":
        return _apply_final_result_confidence(
            league_key=league_key,
            game=game,
            base_home_win_prob=base_home_win_prob,
            base_away_win_prob=base_away_win_prob,
        )

    if status != "live":
        return base_home_win_prob, base_away_win_prob

    score_diff = float(game.home_score - game.away_score)
    score_total = float(max(0, game.home_score) + max(0, game.away_score))
    margin_scale = LEAGUE_MARGIN_SCALES.get(league_key, 10.0)
    expected_total = LEAGUE_EXPECTED_TOTALS.get(league_key, 1.0)

    status_detail = str(getattr(game, "_prediction_status_detail", "") or "")
    progress = _extract_live_progress(league_key, status_detail)
    score_weight = min(1.0, score_total / max(expected_total, 1.0))
    effective_margin_scale = margin_scale * (0.28 + (1.0 - progress) * 0.72)
    effective_margin_scale *= max(0.82, min(1.08, 1.02 - ((1.0 - score_weight) * 0.12)))
    effective_margin_scale = max(margin_scale * 0.22, effective_margin_scale)

    # Late leads in low-scoring sports should matter far more than the same lead early.
    score_state_home = float(1.0 / (1.0 + np.exp(-(score_diff / max(effective_margin_scale, 0.1)))))

    margin_pressure = min(1.0, abs(score_diff) / max(margin_scale * 1.75, 1.0))
    blend_weight = min(0.985, max(0.20, 0.16 + progress * 0.56 + score_weight * 0.10 + margin_pressure * 0.18))

    if progress >= 0.85 and abs(score_diff) >= margin_scale * 1.35:
        blend_weight = max(blend_weight, 0.96)
    if progress >= 0.94 and abs(score_diff) >= max(1.0, margin_scale * 0.65):
        blend_weight = max(blend_weight, 0.985)

    adjusted_home = (base_home_win_prob * (1.0 - blend_weight)) + (score_state_home * blend_weight)
    adjusted_away = 1.0 - adjusted_home
    return adjusted_home, adjusted_away


def _apply_structured_pregame_context(
    *,
    league_key: str,
    base_home_win_prob: float,
    features: dict[str, float],
) -> float:
    margin_scale = LEAGUE_MARGIN_SCALES.get(league_key, 10.0)
    sample_strength = min(
        1.0,
        (features.get("home_games_played", 0.0) + features.get("away_games_played", 0.0)) / 40.0,
    )
    structured_signal = 0.0
    structured_signal += features.get("win_pct_gap", 0.0) * 1.45
    structured_signal += features.get("pythag_gap", 0.0) * 1.15
    structured_signal += features.get("split_win_rate_gap", 0.0) * 0.65
    structured_signal += (features.get("home_recent_win_rate", 0.5) - features.get("away_recent_win_rate", 0.5)) * 0.55
    structured_signal += features.get("last3_margin_gap", 0.0) / max(margin_scale * 2.8, 1.0) * 0.52
    structured_signal += features.get("avg_margin_gap", 0.0) / max(margin_scale * 3.2, 1.0) * 0.34
    structured_signal += features.get("rest_advantage", 0.0) / 5.0 * 0.08
    structured_signal += features.get("opp_win_rate_gap", 0.0) * 0.22
    structured_signal += features.get("recent_vs_season_gap", 0.0) * 0.42
    structured_signal += features.get("h2h_home_avg_margin", 0.0) / max(margin_scale * 4.0, 1.0) * 0.25

    structured_home = float(1.0 / (1.0 + np.exp(-(structured_signal * 2.4))))
    blend_weight = 0.18 + (sample_strength * 0.16)
    return (1.0 - blend_weight) * base_home_win_prob + blend_weight * structured_home


def _extract_live_winprobability_signal(
    summary_data: dict[str, Any] | None,
) -> tuple[float | None, float | None, list[str]]:
    if not summary_data:
        return None, None, []

    winprobability = summary_data.get("winprobability", []) or []
    if not isinstance(winprobability, list) or not winprobability:
        return None, None, []

    latest = winprobability[-1] or {}
    home_prob = _normalize_rate(latest.get("homeWinPercentage"))
    tie_prob = _normalize_rate(latest.get("tiePercentage"))
    if home_prob is None:
        return None, None, []

    if tie_prob is not None:
        away_prob = max(0.0, 1.0 - home_prob - tie_prob)
        no_draw_total = max(home_prob + away_prob, 1e-9)
        return float(home_prob / no_draw_total), float(tie_prob), [f"Live win probability: {home_prob:.0%} home"]

    return float(home_prob), None, [f"Live win probability: {home_prob:.0%} home"]


def _live_boxscore_signal(summary_data: dict[str, Any] | None, league_key: str) -> tuple[float | None, list[str]]:
    home_stats, away_stats = _boxscore_team_stat_maps(summary_data)
    if not home_stats or not away_stats:
        return None, []

    if league_key == "NBA":
        score = 0.0
        fg_gap = (_normalize_rate(_stat_value(home_stats, "fieldGoalPct")) or 0.0) - (
            _normalize_rate(_stat_value(away_stats, "fieldGoalPct")) or 0.0
        )
        three_gap = (_normalize_rate(_stat_value(home_stats, "threePointFieldGoalPct")) or 0.0) - (
            _normalize_rate(_stat_value(away_stats, "threePointFieldGoalPct")) or 0.0
        )
        ft_gap = (_normalize_rate(_stat_value(home_stats, "freeThrowPct")) or 0.0) - (
            _normalize_rate(_stat_value(away_stats, "freeThrowPct")) or 0.0
        )
        reb_gap = (_stat_value(home_stats, "totalRebounds") or 0.0) - (_stat_value(away_stats, "totalRebounds") or 0.0)
        oreb_gap = (_stat_value(home_stats, "offensiveRebounds") or 0.0) - (
            _stat_value(away_stats, "offensiveRebounds") or 0.0
        )
        turnover_gap = (_stat_value(home_stats, "totalTurnovers", "turnovers") or 0.0) - (
            _stat_value(away_stats, "totalTurnovers", "turnovers") or 0.0
        )
        fast_break_gap = (_stat_value(home_stats, "fastBreakPoints") or 0.0) - (
            _stat_value(away_stats, "fastBreakPoints") or 0.0
        )
        score += fg_gap * 4.0 + three_gap * 2.1 + ft_gap * 1.1
        score += reb_gap / 18.0 + oreb_gap / 10.0 + fast_break_gap / 30.0
        score -= turnover_gap / 12.0
    elif league_key == "NFL":
        home_plays = max(1.0, _stat_value(home_stats, "totalOffensivePlays") or 1.0)
        away_plays = max(1.0, _stat_value(away_stats, "totalOffensivePlays") or 1.0)
        ypp_gap = ((_stat_value(home_stats, "yardsPerPlay") or (_stat_value(home_stats, "totalYards") or 0.0) / home_plays))
        ypp_gap -= ((_stat_value(away_stats, "yardsPerPlay") or (_stat_value(away_stats, "totalYards") or 0.0) / away_plays))
        third_gap = (_normalize_rate(_stat_value(home_stats, "thirdDownEff")) or 0.0) - (
            _normalize_rate(_stat_value(away_stats, "thirdDownEff")) or 0.0
        )
        redzone_gap = (_stat_value(home_stats, "redZoneAttempts") or 0.0) - (
            _stat_value(away_stats, "redZoneAttempts") or 0.0
        )
        turnover_gap = (_stat_value(home_stats, "turnovers") or 0.0) - (_stat_value(away_stats, "turnovers") or 0.0)
        penalty_gap = (_stat_value(home_stats, "totalPenaltiesYards") or 0.0) - (
            _stat_value(away_stats, "totalPenaltiesYards") or 0.0
        )
        possession_gap = (_stat_value(home_stats, "possessionTime") or 0.0) - (
            _stat_value(away_stats, "possessionTime") or 0.0
        )
        score = ypp_gap * 0.85 + third_gap * 1.8 + redzone_gap / 5.0 + possession_gap / 10.0
        score -= turnover_gap * 0.8
        score -= penalty_gap / 90.0
    elif league_key == "MLB":
        hits_gap = (_stat_value(home_stats, "hits") or 0.0) - (_stat_value(away_stats, "hits") or 0.0)
        walks_gap = (_stat_value(home_stats, "walks") or 0.0) - (_stat_value(away_stats, "walks") or 0.0)
        strikeout_gap = (_stat_value(home_stats, "strikeouts") or 0.0) - (_stat_value(away_stats, "strikeouts") or 0.0)
        error_gap = (_stat_value(home_stats, "errors") or 0.0) - (_stat_value(away_stats, "errors") or 0.0)
        stolen_base_gap = (_stat_value(home_stats, "stolenBases") or 0.0) - (_stat_value(away_stats, "stolenBases") or 0.0)
        score = hits_gap * 0.26 + walks_gap * 0.22 - strikeout_gap * 0.10 - error_gap * 0.30 + stolen_base_gap * 0.12
    elif league_key == "NHL":
        shots_gap = (_stat_value(home_stats, "avgShots", "shots") or 0.0) - (_stat_value(away_stats, "avgShots", "shots") or 0.0)
        pp_gap = (_normalize_rate(_stat_value(home_stats, "powerPlayPct")) or 0.0) - (
            _normalize_rate(_stat_value(away_stats, "powerPlayPct")) or 0.0
        )
        pim_gap = (_stat_value(home_stats, "penaltyMinutes") or 0.0) - (
            _stat_value(away_stats, "penaltyMinutes") or 0.0
        )
        goals_against_gap = (_stat_value(home_stats, "avgGoalsAgainst") or 0.0) - (
            _stat_value(away_stats, "avgGoalsAgainst") or 0.0
        )
        score = shots_gap / 14.0 + pp_gap * 1.6 - pim_gap / 12.0 - goals_against_gap * 0.35
    elif league_key == "EPL":
        possession_gap = (_normalize_rate(_stat_value(home_stats, "possessionPct")) or 0.0) - (
            _normalize_rate(_stat_value(away_stats, "possessionPct")) or 0.0
        )
        shots_gap = (_stat_value(home_stats, "totalShots") or 0.0) - (_stat_value(away_stats, "totalShots") or 0.0)
        sot_gap = (_stat_value(home_stats, "shotsOnTarget") or 0.0) - (
            _stat_value(away_stats, "shotsOnTarget") or 0.0
        )
        pass_gap = (_normalize_rate(_stat_value(home_stats, "passPct")) or 0.0) - (
            _normalize_rate(_stat_value(away_stats, "passPct")) or 0.0
        )
        card_gap = ((_stat_value(home_stats, "yellowCards") or 0.0) + ((_stat_value(home_stats, "redCards") or 0.0) * 1.6))
        card_gap -= ((_stat_value(away_stats, "yellowCards") or 0.0) + ((_stat_value(away_stats, "redCards") or 0.0) * 1.6))
        score = possession_gap * 1.1 + shots_gap / 15.0 + sot_gap / 8.0 + pass_gap * 0.85 - card_gap / 5.0
    else:
        return None, []

    home_prob = float(1.0 / (1.0 + np.exp(-(score * 1.7))))
    return home_prob, ["Live box score edge"]


def _extract_official_names(summary_data: dict[str, Any] | None) -> list[str]:
    officials = (_extract_game_info(summary_data).get("officials") or [])
    names: list[str] = []
    for official in officials:
        name = str((official or {}).get("displayName") or (official or {}).get("fullName") or "").strip()
        if name:
            names.append(name)
    return names


def _whistle_metric_from_summary(summary_data: dict[str, Any] | None, league_key: str) -> float | None:
    home_stats, away_stats = _boxscore_team_stat_maps(summary_data)
    if not home_stats or not away_stats:
        return None

    if league_key == "NBA":
        return float((_stat_value(home_stats, "fouls") or 0.0) + (_stat_value(away_stats, "fouls") or 0.0))
    if league_key == "NFL":
        return float((_stat_value(home_stats, "totalPenaltiesYards") or 0.0) + (_stat_value(away_stats, "totalPenaltiesYards") or 0.0))
    if league_key == "NHL":
        return float((_stat_value(home_stats, "penaltyMinutes") or 0.0) + (_stat_value(away_stats, "penaltyMinutes") or 0.0))
    if league_key == "EPL":
        return float(
            (_stat_value(home_stats, "foulsCommitted") or 0.0)
            + (_stat_value(away_stats, "foulsCommitted") or 0.0)
            + ((_stat_value(home_stats, "yellowCards") or 0.0) * 1.4)
            + ((_stat_value(away_stats, "yellowCards") or 0.0) * 1.4)
            + ((_stat_value(home_stats, "redCards") or 0.0) * 3.5)
            + ((_stat_value(away_stats, "redCards") or 0.0) * 3.5)
        )
    if league_key == "MLB":
        return float(
            (_stat_value(home_stats, "walks") or 0.0)
            + (_stat_value(away_stats, "walks") or 0.0)
            + ((_stat_value(home_stats, "hitByPitch") or 0.0) * 1.25)
            + ((_stat_value(away_stats, "hitByPitch") or 0.0) * 1.25)
        )
    return None


async def _build_league_official_tendencies(db: Session, league_key: str) -> dict[str, Any]:
    cached = _OFFICIAL_TENDENCY_CACHE.get(league_key)
    now = time.time()
    if cached and now - cached[0] < OFFICIAL_TENDENCY_CACHE_TTL:
        return cached[1]

    recent_games = (
        db.query(Game)
        .filter(Game.league == league_key)
        .filter(Game.status == "final")
        .order_by(Game.scheduled_at.desc(), Game.id.desc())
        .limit(28)
        .all()
    )
    official_stats: dict[str, dict[str, float]] = defaultdict(lambda: {"games": 0.0, "home_wins": 0.0, "whistle_total": 0.0, "whistle_games": 0.0})
    league_whistle_values: list[float] = []

    summaries = await asyncio.gather(
        *[_fetch_summary_for_known_league(league_key, str(game.id)) for game in recent_games],
        return_exceptions=True,
    )
    for game, summary in zip(recent_games, summaries):
        if isinstance(summary, Exception) or not isinstance(summary, dict):
            continue
        names = _extract_official_names(summary)
        if not names:
            continue
        whistle_metric = _whistle_metric_from_summary(summary, league_key)
        home_win = 1.0 if float(game.home_score or 0) > float(game.away_score or 0) else 0.0
        for name in names:
            official_stats[name]["games"] += 1.0
            official_stats[name]["home_wins"] += home_win
            if whistle_metric is not None:
                official_stats[name]["whistle_total"] += whistle_metric
                official_stats[name]["whistle_games"] += 1.0
        if whistle_metric is not None:
            league_whistle_values.append(float(whistle_metric))

    result = {
        "officials": dict(official_stats),
        "league_whistle_mean": float(np.mean(league_whistle_values)) if league_whistle_values else None,
    }
    _OFFICIAL_TENDENCY_CACHE[league_key] = (now, result)
    return result


async def _official_tendency_signal(
    db: Session,
    *,
    league_key: str,
    summary_data: dict[str, Any] | None,
) -> tuple[float, float, float, list[str]]:
    officials = _extract_official_names(summary_data)
    if not officials:
        return 0.0, 0.0, 0.0, []

    tendencies = await _build_league_official_tendencies(db, league_key)
    official_stats = tendencies.get("officials", {}) or {}
    current_whistle_metric = _whistle_metric_from_summary(summary_data, league_key)
    league_whistle_mean = _safe_float(tendencies.get("league_whistle_mean"))

    sample_rates: list[float] = []
    whistle_deltas: list[float] = []
    for name in officials:
        stats = official_stats.get(name) or {}
        games = float(stats.get("games", 0.0) or 0.0)
        if games < 4.0:
            continue
        sample_rates.append(float(stats.get("home_wins", 0.0) / max(games, 1.0)))
        whistle_games = float(stats.get("whistle_games", 0.0) or 0.0)
        if whistle_games >= 3.0 and league_whistle_mean is not None:
            official_whistle = float(stats.get("whistle_total", 0.0) / max(whistle_games, 1.0))
            whistle_deltas.append(official_whistle - league_whistle_mean)

    if not sample_rates and not whistle_deltas:
        return 0.0, 0.0, 0.0, []

    shift = 0.0
    reversion = 0.0
    confidence_delta = 0.0
    factors: list[str] = []

    if sample_rates:
        home_bias = float(np.mean(sample_rates) - 0.5)
        shift = max(-_MAX_OFFICIAL_SHIFT, min(_MAX_OFFICIAL_SHIFT, home_bias * 0.09))
        if abs(home_bias) >= 0.08:
            factors.append(
                f"Officials lean {'home' if home_bias > 0 else 'away'} side historically"
            )
            confidence_delta += 0.01

    if whistle_deltas and current_whistle_metric is not None and league_whistle_mean is not None:
        whistle_delta = float(np.mean(whistle_deltas))
        if abs(whistle_delta) >= max(1.0, league_whistle_mean * 0.08):
            reversion = min(_MAX_OFFICIAL_REVERSION, abs(whistle_delta) / max(league_whistle_mean, 1.0) * 0.09)
            confidence_delta -= min(0.025, reversion * 0.22)
            factors.append("Officiating crew skews higher-variance than league average")

    return shift, reversion, confidence_delta, factors


# ─────────────────────────────────────────────────────────────────────────
# Factor explanation builder
# ─────────────────────────────────────────────────────────────────────────

def _build_factor_explanations(
    features: dict[str, float],
    league_key: str,
    home_name: str,
    away_name: str,
) -> list[str]:
    """Generate human-readable factor explanations from features."""
    factors: list[str] = []

    # Win rate gap
    home_wr = features.get("home_season_win_pct", 0.5)
    away_wr = features.get("away_season_win_pct", 0.5)
    gap = abs(home_wr - away_wr)
    if gap > 0.15:
        better = home_name if home_wr > away_wr else away_name
        factors.append(f"{better} has a significantly better record ({max(home_wr, away_wr):.0%} vs {min(home_wr, away_wr):.0%})")

    # Back-to-back
    if features.get("home_is_back_to_back", 0) > 0:
        factors.append(f"{home_name} playing on a back-to-back")
    if features.get("away_is_back_to_back", 0) > 0:
        factors.append(f"{away_name} playing on a back-to-back")

    # Streaks
    home_streak = features.get("home_streak", 0)
    away_streak = features.get("away_streak", 0)
    if abs(home_streak) >= 4:
        streak_type = "win" if home_streak > 0 else "loss"
        factors.append(f"{home_name} on {abs(int(home_streak))}-game {streak_type} streak")
    if abs(away_streak) >= 4:
        streak_type = "win" if away_streak > 0 else "loss"
        factors.append(f"{away_name} on {abs(int(away_streak))}-game {streak_type} streak")

    # Recent form (last 3 margin)
    home_m3 = features.get("home_last3_avg_margin", 0)
    away_m3 = features.get("away_last3_avg_margin", 0)
    if home_m3 > 10:
        factors.append(f"{home_name} averaging +{home_m3:.0f} margin in last 3 games")
    elif home_m3 < -10:
        factors.append(f"{home_name} averaging {home_m3:.0f} margin in last 3 games")
    if away_m3 > 10:
        factors.append(f"{away_name} averaging +{away_m3:.0f} margin in last 3 games")
    elif away_m3 < -10:
        factors.append(f"{away_name} averaging {away_m3:.0f} margin in last 3 games")

    # Strength of schedule
    home_sos = features.get("home_avg_opp_win_rate", 0.5)
    away_sos = features.get("away_avg_opp_win_rate", 0.5)
    if abs(home_sos - away_sos) > 0.08:
        harder = home_name if home_sos > away_sos else away_name
        factors.append(f"{harder} has faced tougher opponents")

    # Rest edge
    rest_advantage = features.get("rest_advantage", 0.0)
    if abs(rest_advantage) >= 1.5:
        rested = home_name if rest_advantage > 0 else away_name
        factors.append(f"{rested} has the rest advantage")

    # H2H history
    h2h_games = features.get("head_to_head_games", 0)
    h2h_wr = features.get("head_to_head_home_win_rate", 0.5)
    if h2h_games >= 3 and abs(h2h_wr - 0.5) > 0.2:
        dominant = home_name if h2h_wr > 0.5 else away_name
        factors.append(f"{dominant} dominates the head-to-head series")

    avg_margin_gap = features.get("avg_margin_gap", 0.0)
    margin_threshold = max(1.0, LEAGUE_MARGIN_SCALES.get(league_key, 10.0) * 0.55)
    if abs(avg_margin_gap) >= margin_threshold:
        stronger = home_name if avg_margin_gap > 0 else away_name
        factors.append(f"{stronger} has carried the stronger average scoring margin")

    # Home advantage (home record)
    home_home_wr = features.get("home_home_win_rate", 0.5)
    if home_home_wr > 0.7:
        factors.append(f"{home_name} is {home_home_wr:.0%} at home this season")

    return factors[:6]  # Cap at 6 factors


# ─────────────────────────────────────────────────────────────────────────
# Main prediction function
# ─────────────────────────────────────────────────────────────────────────

async def predict_game_probabilities(db: Session, game: Game) -> dict[str, Any]:
    """
    Generate home/away win probabilities for a synced game.
    Enhanced with injury adjustments, odds blending, confidence scores, and factors.
    """
    return await _predict_game_probabilities_v4(db, game)

    bundle = load_model_bundle()
    league_key = game.league.upper()
    model = bundle.get("models", {}).get(league_key)
    if model is None:
        raise RuntimeError(f"No trained model available for league {league_key}.")

    features = build_feature_vector(db, game)
    vector = np.array([[features[column] for column in FEATURE_COLUMNS]], dtype=float)
    probabilities = model.predict_proba(vector)[0]
    class_map = {int(label): float(prob) for label, prob in zip(model.classes_, probabilities)}

    home_win_prob = class_map.get(1, 0.5)
    away_win_prob = class_map.get(0, 1.0 - home_win_prob)
    total = home_win_prob + away_win_prob
    if total <= 0:
        home_win_prob = away_win_prob = 0.5
    else:
        home_win_prob /= total
        away_win_prob /= total

    game_status = str(game.status or "").lower()
    if game_status not in {"live", "final"}:
        home_win_prob = _apply_structured_pregame_context(
            league_key=league_key,
            base_home_win_prob=float(home_win_prob),
            features=features,
        )
        away_win_prob = 1.0 - home_win_prob

    # Collect all factor explanations
    home_team = getattr(game, "_home_team", None)
    away_team = getattr(game, "_away_team", None)
    home_name = home_team.short_name or home_team.name if home_team else "Home"
    away_name = away_team.short_name or away_team.name if away_team else "Away"

    all_factors: list[str] = _build_factor_explanations(features, league_key, home_name, away_name)

    # ── Injury adjustments (fetch both teams concurrently for speed) ──
    home_injury_shift = 0.0
    away_injury_shift = 0.0
    try:
        import asyncio as _aio
        home_espn_id = home_team.external_id.split(":")[-1] if home_team and home_team.external_id else None
        away_espn_id = away_team.external_id.split(":")[-1] if away_team and away_team.external_id else None

        home_injuries_coro = _fetch_team_injuries(league_key, home_espn_id) if home_espn_id else _aio.sleep(0, result=[])
        away_injuries_coro = _fetch_team_injuries(league_key, away_espn_id) if away_espn_id else _aio.sleep(0, result=[])
        home_injuries, away_injuries = await _aio.gather(home_injuries_coro, away_injuries_coro)

        if home_injuries:
            home_impact, home_inj_factors = _injury_impact_score(home_injuries, league_key)
            home_injury_shift = -home_impact * _MAX_INJURY_SHIFT
            for f in home_inj_factors:
                all_factors.append(f"{home_name}: {f}")
        if away_injuries:
            away_impact, away_inj_factors = _injury_impact_score(away_injuries, league_key)
            away_injury_shift = -away_impact * _MAX_INJURY_SHIFT
            for f in away_inj_factors:
                all_factors.append(f"{away_name}: {f}")
    except Exception as exc:
        logger.debug("Injury fetch failed: %s", exc)

    # Apply injury shifts
    home_win_prob = home_win_prob + home_injury_shift - away_injury_shift
    away_win_prob = 1.0 - home_win_prob

    # Use injuries much more cautiously once the game is live.
    if game_status == "live":
        live_injury_damping = 0.35
        home_win_prob = home_win_prob - (home_injury_shift * (1.0 - live_injury_damping)) + (away_injury_shift * (1.0 - live_injury_damping))
        away_win_prob = 1.0 - home_win_prob

    # Vegas odds should matter a lot pregame and only lightly once the game starts.
    summary_data = getattr(game, "_summary_data", None)
    odds_prob, draw_prob, odds_factors = _extract_market_odds_signal(summary_data, game_status=game_status)
    if odds_prob is not None:
        if game_status == "live":
            odds_blend_weight = _ODDS_BLEND_WEIGHT_LIVE_BY_LEAGUE.get(league_key, _ODDS_BLEND_WEIGHT_LIVE)
        else:
            odds_blend_weight = _ODDS_BLEND_WEIGHT_PREGAME_BY_LEAGUE.get(league_key, _ODDS_BLEND_WEIGHT_PREGAME)
        home_win_prob = (1.0 - odds_blend_weight) * home_win_prob + odds_blend_weight * odds_prob
        away_win_prob = 1.0 - home_win_prob
        all_factors.extend(odds_factors)
    else:
        draw_prob = None

    if draw_prob is not None and game_status != "final":
        draw_damping = min(0.22, max(0.0, draw_prob) * 0.65)
        home_win_prob = 0.5 + ((home_win_prob - 0.5) * (1.0 - draw_damping))
        away_win_prob = 1.0 - home_win_prob

    # ── Live game state override ──
    home_win_prob, away_win_prob = _apply_live_game_state(
        league_key=league_key,
        game=game,
        base_home_win_prob=float(home_win_prob),
        base_away_win_prob=float(away_win_prob),
    )

    # Clamp to valid range for each state.
    if game_status == "final":
        floor = 0.02
        ceiling = 0.98
    elif game_status != "live":
        floor = _PREGAME_PROB_FLOOR
        ceiling = _PREGAME_PROB_CEILING
    else:
        floor = 0.01
        ceiling = 0.99
    home_win_prob = float(max(floor, min(ceiling, home_win_prob)))
    away_win_prob = float(max(floor, min(ceiling, 1.0 - home_win_prob)))
    # Re-normalize
    total = home_win_prob + away_win_prob
    home_win_prob /= total
    away_win_prob /= total

    confidence_base = abs(home_win_prob - 0.5) * 2.0
    if game_status == "live":
        progress = _extract_live_progress(league_key, str(getattr(game, "_prediction_status_detail", "") or ""))
        confidence = round(min(1.0, confidence_base * (0.55 + progress * 0.75)), 4)
    elif game_status == "final":
        confidence = round(min(0.99, 0.55 + abs(home_win_prob - away_win_prob) * 0.45), 4)
    else:
        odds_confidence_bonus = 0.08 if odds_prob is not None else 0.0
        sample_strength = min(
            1.0,
            (features.get("home_games_played", 0.0) + features.get("away_games_played", 0.0)) / 40.0,
        )
        draw_penalty = min(0.12, max(0.0, draw_prob or 0.0) * 0.5)
        confidence = round(
            min(1.0, (confidence_base * (0.68 + sample_strength * 0.24)) + odds_confidence_bonus - draw_penalty),
            4,
        )

    return {
        "home_win_prob": round(float(home_win_prob), 4),
        "away_win_prob": round(float(away_win_prob), 4),
        "model_version": get_prediction_model_version(),
        "features": features,
        "confidence": confidence,
        "factors": all_factors[:8],  # Cap at 8 factors
    }


async def _predict_game_probabilities_v4(db: Session, game: Game) -> dict[str, Any]:
    bundle = load_model_bundle()
    league_key = game.league.upper()
    model = bundle.get("models", {}).get(league_key)
    if model is None:
        raise RuntimeError(f"No trained model available for league {league_key}.")

    features = build_feature_vector(db, game)
    vector = np.array([[features[column] for column in FEATURE_COLUMNS]], dtype=float)
    probabilities = model.predict_proba(vector)[0]
    class_map = {int(label): float(prob) for label, prob in zip(model.classes_, probabilities)}

    home_win_prob = class_map.get(1, 0.5)
    away_win_prob = class_map.get(0, 1.0 - home_win_prob)
    total = home_win_prob + away_win_prob
    if total <= 0:
        home_win_prob = away_win_prob = 0.5
    else:
        home_win_prob /= total
        away_win_prob /= total

    game_status = str(game.status or "").lower()
    if game_status not in {"live", "final"}:
        home_win_prob = _apply_structured_pregame_context(
            league_key=league_key,
            base_home_win_prob=float(home_win_prob),
            features=features,
        )
        away_win_prob = 1.0 - home_win_prob

    home_team = getattr(game, "_home_team", None)
    away_team = getattr(game, "_away_team", None)
    home_name = home_team.short_name or home_team.name if home_team else "Home"
    away_name = away_team.short_name or away_team.name if away_team else "Away"
    all_factors: list[str] = _build_factor_explanations(features, league_key, home_name, away_name)
    context_confidence_adjustment = 0.0

    summary_data = getattr(game, "_summary_data", None)
    if not summary_data:
        summary_data = await _fetch_summary_for_known_league(league_key, str(game.id))
        setattr(game, "_summary_data", summary_data)

    home_espn_id = home_team.external_id.split(":")[-1] if home_team and home_team.external_id else None
    away_espn_id = away_team.external_id.split(":")[-1] if away_team and away_team.external_id else None
    home_injury_shift = 0.0
    away_injury_shift = 0.0
    home_depth_shift = 0.0
    away_depth_shift = 0.0
    draw_prob: float | None = None

    try:
        season_year = _season_for_game_date(league_key, game.scheduled_at)
        home_injuries_coro = _fetch_team_injuries(league_key, home_espn_id) if home_espn_id else asyncio.sleep(0, result=[])
        away_injuries_coro = _fetch_team_injuries(league_key, away_espn_id) if away_espn_id else asyncio.sleep(0, result=[])
        home_roster_coro = _fetch_team_roster(league_key, home_espn_id, season_year) if home_espn_id else asyncio.sleep(0, result=[])
        away_roster_coro = _fetch_team_roster(league_key, away_espn_id, season_year) if away_espn_id else asyncio.sleep(0, result=[])
        home_injuries, away_injuries, home_roster, away_roster = await asyncio.gather(
            home_injuries_coro,
            away_injuries_coro,
            home_roster_coro,
            away_roster_coro,
        )

        if home_injuries:
            home_impact, home_injury_factors = _injury_impact_score(home_injuries, league_key)
            home_injury_shift = -home_impact * _MAX_INJURY_SHIFT
            all_factors.extend([f"{home_name}: {factor}" for factor in home_injury_factors])
            home_depth_impact, home_depth_factors = _depth_chart_impact_score(home_injuries, home_roster, league_key)
            home_depth_shift = -home_depth_impact * _MAX_DEPTH_SHIFT
            all_factors.extend([f"{home_name}: {factor}" for factor in home_depth_factors])

        if away_injuries:
            away_impact, away_injury_factors = _injury_impact_score(away_injuries, league_key)
            away_injury_shift = -away_impact * _MAX_INJURY_SHIFT
            all_factors.extend([f"{away_name}: {factor}" for factor in away_injury_factors])
            away_depth_impact, away_depth_factors = _depth_chart_impact_score(away_injuries, away_roster, league_key)
            away_depth_shift = -away_depth_impact * _MAX_DEPTH_SHIFT
            all_factors.extend([f"{away_name}: {factor}" for factor in away_depth_factors])
    except Exception as exc:
        logger.debug("Injury or roster fetch failed: %s", exc)

    home_win_prob = home_win_prob + home_injury_shift - away_injury_shift + home_depth_shift - away_depth_shift
    away_win_prob = 1.0 - home_win_prob
    if game_status == "live":
        live_injury_damping = 0.35
        live_depth_damping = 0.48
        home_win_prob = (
            home_win_prob
            - (home_injury_shift * (1.0 - live_injury_damping))
            + (away_injury_shift * (1.0 - live_injury_damping))
            - (home_depth_shift * (1.0 - live_depth_damping))
            + (away_depth_shift * (1.0 - live_depth_damping))
        )
        away_win_prob = 1.0 - home_win_prob

    odds_prob, draw_prob, odds_factors = _extract_market_odds_signal(summary_data, game_status=game_status)
    if odds_prob is not None:
        if game_status == "live":
            odds_blend_weight = _ODDS_BLEND_WEIGHT_LIVE_BY_LEAGUE.get(league_key, _ODDS_BLEND_WEIGHT_LIVE)
        else:
            odds_blend_weight = _ODDS_BLEND_WEIGHT_PREGAME_BY_LEAGUE.get(league_key, _ODDS_BLEND_WEIGHT_PREGAME)
        home_win_prob = ((1.0 - odds_blend_weight) * home_win_prob) + (odds_blend_weight * odds_prob)
        away_win_prob = 1.0 - home_win_prob
        all_factors.extend(odds_factors)

    market_shift, market_confidence_delta, market_factors = _market_movement_signal(summary_data, game_status=game_status)
    if market_shift:
        home_win_prob += market_shift
        away_win_prob = 1.0 - home_win_prob
        all_factors.extend(market_factors)
    context_confidence_adjustment += market_confidence_delta

    travel_shift, travel_confidence_delta, travel_factors = await _travel_signal(
        db,
        league_key=league_key,
        game=game,
        summary_data=summary_data,
        home_name=home_name,
        away_name=away_name,
    )
    if travel_shift:
        home_win_prob += travel_shift
        away_win_prob = 1.0 - home_win_prob
        all_factors.extend(travel_factors)
    context_confidence_adjustment += travel_confidence_delta

    weather_shift, weather_reversion, weather_confidence_delta, weather_factors = _weather_signal(summary_data)
    if weather_shift or weather_reversion:
        home_win_prob += weather_shift
        home_win_prob = 0.5 + ((home_win_prob - 0.5) * (1.0 - weather_reversion))
        away_win_prob = 1.0 - home_win_prob
        all_factors.extend(weather_factors)
    context_confidence_adjustment += weather_confidence_delta

    official_shift, official_reversion, official_confidence_delta, official_factors = await _official_tendency_signal(
        db,
        league_key=league_key,
        summary_data=summary_data,
    )
    if official_shift or official_reversion:
        home_win_prob += official_shift
        home_win_prob = 0.5 + ((home_win_prob - 0.5) * (1.0 - official_reversion))
        away_win_prob = 1.0 - home_win_prob
        all_factors.extend(official_factors)
    context_confidence_adjustment += official_confidence_delta

    if draw_prob is not None and game_status != "final":
        draw_damping = min(0.22, max(0.0, draw_prob) * 0.65)
        home_win_prob = 0.5 + ((home_win_prob - 0.5) * (1.0 - draw_damping))
        away_win_prob = 1.0 - home_win_prob

    home_win_prob, away_win_prob = _apply_live_game_state(
        league_key=league_key,
        game=game,
        base_home_win_prob=float(home_win_prob),
        base_away_win_prob=float(away_win_prob),
    )

    if game_status == "live":
        live_winprob_home, live_draw_prob, live_winprob_factors = _extract_live_winprobability_signal(summary_data)
        if live_winprob_home is not None:
            live_winprob_weight = _LIVE_WINPROB_BLEND_BY_LEAGUE.get(league_key, 0.34)
            home_win_prob = ((1.0 - live_winprob_weight) * home_win_prob) + (live_winprob_weight * live_winprob_home)
            away_win_prob = 1.0 - home_win_prob
            all_factors.extend(live_winprob_factors)
            context_confidence_adjustment += 0.04
            if live_draw_prob is not None:
                draw_prob = max(float(draw_prob or 0.0), float(live_draw_prob))

        live_boxscore_home, live_boxscore_factors = _live_boxscore_signal(summary_data, league_key)
        if live_boxscore_home is not None:
            live_boxscore_weight = _LIVE_BOXSCORE_BLEND_BY_LEAGUE.get(league_key, 0.16)
            home_win_prob = ((1.0 - live_boxscore_weight) * home_win_prob) + (live_boxscore_weight * live_boxscore_home)
            away_win_prob = 1.0 - home_win_prob
            all_factors.extend(live_boxscore_factors)
            context_confidence_adjustment += 0.02

        if draw_prob is not None:
            live_draw_damping = min(0.24, max(0.0, draw_prob) * 0.58)
            home_win_prob = 0.5 + ((home_win_prob - 0.5) * (1.0 - live_draw_damping))
            away_win_prob = 1.0 - home_win_prob

    if game_status == "final":
        floor = 0.02
        ceiling = 0.98
    elif game_status != "live":
        floor = _PREGAME_PROB_FLOOR
        ceiling = _PREGAME_PROB_CEILING
    else:
        floor = 0.01
        ceiling = 0.99
    home_win_prob = float(max(floor, min(ceiling, home_win_prob)))
    away_win_prob = float(max(floor, min(ceiling, 1.0 - home_win_prob)))
    total = home_win_prob + away_win_prob
    home_win_prob /= total
    away_win_prob /= total

    confidence_base = abs(home_win_prob - 0.5) * 2.0
    if game_status == "live":
        progress = _extract_live_progress(league_key, str(getattr(game, "_prediction_status_detail", "") or ""))
        confidence = round(
            max(0.01, min(1.0, (confidence_base * (0.55 + progress * 0.75)) + context_confidence_adjustment)),
            4,
        )
    elif game_status == "final":
        confidence = round(
            max(0.01, min(0.99, 0.55 + abs(home_win_prob - away_win_prob) * 0.45 + context_confidence_adjustment)),
            4,
        )
    else:
        odds_confidence_bonus = 0.08 if odds_prob is not None else 0.0
        sample_strength = min(
            1.0,
            (features.get("home_games_played", 0.0) + features.get("away_games_played", 0.0)) / 40.0,
        )
        draw_penalty = min(0.12, max(0.0, draw_prob or 0.0) * 0.5)
        confidence = round(
            max(
                0.01,
                min(
                    1.0,
                    (confidence_base * (0.68 + sample_strength * 0.24))
                    + odds_confidence_bonus
                    - draw_penalty
                    + context_confidence_adjustment,
                ),
            ),
            4,
        )

    deduped_factors = list(dict.fromkeys(factor for factor in all_factors if factor))
    return {
        "home_win_prob": round(float(home_win_prob), 4),
        "away_win_prob": round(float(away_win_prob), 4),
        "model_version": get_prediction_model_version(),
        "features": features,
        "confidence": confidence,
        "factors": deduped_factors[:10],
    }
