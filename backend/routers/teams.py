"""
SportSync - Teams Router.

Provides a browsable team index and a richer single-team profile payload with
record, schedule, and roster data sourced from ESPN-backed APIs.
"""
import asyncio
from datetime import datetime, timezone
from typing import Any, Optional
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from constants import CACHE_TTL_TEAM_DATA
from database import get_db
from models.game import Game
from models.team import Team
from routers.sports import (
    ESPN_BASE,
    ESPN_STANDINGS_URLS,
    LEAGUES,
    _collect_standings_groups,
    _extract_headshot,
    _extract_stat_lookup,
    _fetch_cached,
    _normalize_standings_seasons,
    _parse_espn_event,
    _resolve_selected_standings_season,
)
from schemas.sports import TeamResponse
from services.cache_service import get_cached, set_cached

router = APIRouter(prefix="/api/teams", tags=["teams"])

DEFAULT_PAGE_SIZE = 20
MAX_TEAM_PAGE_SIZE = 500
TEAM_FETCH_CONCURRENCY = 10
LEAGUE_SUMMARY_CACHE_VERSION = "v2"

_team_fetch_semaphore = asyncio.Semaphore(TEAM_FETCH_CONCURRENCY)


def _parse_external_team_id(external_id: str | None) -> tuple[str | None, str | None]:
    parts = (external_id or "").split(":")
    if len(parts) >= 3 and parts[0].lower() == "espn":
        return parts[1].upper(), parts[-1]
    return None, None


def _season_for_league(league_key: str) -> int:
    now = datetime.now(timezone.utc)
    year = now.year
    month = now.month

    if league_key == "NFL":
        return year if month >= 8 else year - 1
    if league_key == "EPL":
        return year if month >= 7 else year - 1
    if league_key in {"NBA", "NHL", "MLB"}:
        return year
    return year


def _clean_requested_season(season: str | None) -> str | None:
    cleaned = str(season or "").strip()
    return cleaned if cleaned.isdigit() else None


def _is_current_season_request(league_key: str, season: str | None) -> bool:
    cleaned_season = _clean_requested_season(season)
    return not cleaned_season or cleaned_season == str(_season_for_league(league_key))


def _build_schedule_url(league_key: str, espn_team_id: str, season: str | None = None) -> str:
    sport, espn_league, _ = LEAGUES[league_key]
    season_value = _clean_requested_season(season) or str(_season_for_league(league_key))
    url = f"{ESPN_BASE}/{sport}/{espn_league}/teams/{espn_team_id}/schedule"

    params: list[str] = []
    if league_key in {"NBA", "NHL", "NFL", "EPL"}:
        params.append(f"season={season_value}")
    elif league_key == "MLB":
        params.extend([f"season={season_value}", "seasontype=2"])

    if params:
        url = f"{url}?{'&'.join(params)}"
    return url


def _build_roster_url(league_key: str, espn_team_id: str, season: str | None = None) -> str:
    sport, espn_league, _ = LEAGUES[league_key]
    season_value = _clean_requested_season(season) or str(_season_for_league(league_key))
    return f"{ESPN_BASE}/{sport}/{espn_league}/teams/{espn_team_id}?enable=roster&season={season_value}"


def _normalize_color(value: str | None) -> str | None:
    cleaned = str(value or "").strip()
    return cleaned or None


def _normalize_team_name(value: str | None) -> str:
    return "".join(ch for ch in str(value or "").lower() if ch.isalnum())


def _team_payload(team: Team, record: str | None = None, color: str | None = None) -> dict[str, Any]:
    return TeamResponse(
        id=str(team.id),
        external_id=team.external_id,
        name=team.name,
        short_name=team.short_name,
        sport=team.sport,
        league=team.league,
        logo_url=team.logo_url,
        city=team.city,
        record=record,
        color=color,
    ).model_dump()


def _format_local_record(wins: int, losses: int, ties: int) -> str | None:
    if wins == 0 and losses == 0 and ties == 0:
        return None
    if ties > 0:
        return f"{wins}-{losses}-{ties}"
    return f"{wins}-{losses}"


def _build_local_record_lookup(db: Session, team_ids: list[str]) -> dict[str, str]:
    if not team_ids:
        return {}

    games = (
        db.query(Game.home_team_id, Game.away_team_id, Game.home_score, Game.away_score)
        .filter(
            Game.status == "final",
            or_(Game.home_team_id.in_(team_ids), Game.away_team_id.in_(team_ids)),
        )
        .all()
    )

    tallies: dict[str, dict[str, int]] = {
        team_id: {"wins": 0, "losses": 0, "ties": 0}
        for team_id in team_ids
    }

    for home_team_id, away_team_id, home_score, away_score in games:
        if home_team_id not in tallies and away_team_id not in tallies:
            continue

        home_points = int(home_score or 0)
        away_points = int(away_score or 0)

        if home_points == away_points:
            if home_team_id in tallies:
                tallies[home_team_id]["ties"] += 1
            if away_team_id in tallies:
                tallies[away_team_id]["ties"] += 1
            continue

        home_won = home_points > away_points
        if home_team_id in tallies:
            tallies[home_team_id]["wins" if home_won else "losses"] += 1
        if away_team_id in tallies:
            tallies[away_team_id]["losses" if home_won else "wins"] += 1

    return {
        team_id: record
        for team_id, values in tallies.items()
        if (record := _format_local_record(values["wins"], values["losses"], values["ties"]))
    }


def _read_cached_league_summary_lookup(league_key: str) -> dict[str, dict[str, dict[str, str | None]]]:
    cached = get_cached(f"team:league-summary:{league_key}:{LEAGUE_SUMMARY_CACHE_VERSION}")
    if isinstance(cached, dict):
        return cached
    return {"by_id": {}, "by_name": {}}


def _collect_standings_entries(node: dict[str, Any], entries: list[dict[str, Any]]) -> None:
    standings = node.get("standings") or {}
    node_entries = standings.get("entries") or []
    if node_entries:
        entries.extend(entry for entry in node_entries if isinstance(entry, dict))

    for child in node.get("children") or []:
        if isinstance(child, dict):
            _collect_standings_entries(child, entries)


def _build_record_from_stats(stats_lookup: dict[str, str]) -> str | None:
    overall = str(stats_lookup.get("overall") or "").strip()
    if overall:
        return overall

    parts = [
        str(stats_lookup.get("wins") or "").strip(),
        str(stats_lookup.get("losses") or "").strip(),
        str(
            stats_lookup.get("ties")
            or stats_lookup.get("otLosses")
            or stats_lookup.get("overtimeLosses")
            or ""
        ).strip(),
    ]
    compact = [part for part in parts if part]
    return "-".join(compact) if compact else None


async def _fetch_league_summary_lookup(league_key: str) -> dict[str, dict[str, dict[str, str | None]]]:
    cache_key = f"team:league-summary:{league_key}:{LEAGUE_SUMMARY_CACHE_VERSION}"
    cached = get_cached(cache_key)
    if isinstance(cached, dict):
        return cached

    standings_url = ESPN_STANDINGS_URLS.get(league_key)
    if not standings_url:
        empty = {"by_id": {}, "by_name": {}}
        set_cached(cache_key, empty, CACHE_TTL_TEAM_DATA)
        return empty

    data = await _fetch_cached(standings_url, timeout=12.0)
    if not isinstance(data, dict):
        empty = {"by_id": {}, "by_name": {}}
        set_cached(cache_key, empty, CACHE_TTL_TEAM_DATA)
        return empty

    entries: list[dict[str, Any]] = []
    for child in data.get("children") or []:
        if isinstance(child, dict):
            _collect_standings_entries(child, entries)

    if not entries and isinstance((data.get("standings") or {}).get("entries"), list):
        _collect_standings_entries(data, entries)

    by_id: dict[str, dict[str, str | None]] = {}
    by_name: dict[str, dict[str, str | None]] = {}

    for entry in entries:
        team_blob = entry.get("team") or {}
        stats_lookup = _extract_stat_lookup(entry.get("stats"))
        summary = {
            "record": _build_record_from_stats(stats_lookup),
            "color": _normalize_color(team_blob.get("color")),
        }

        team_id = str(team_blob.get("id") or "").strip()
        if team_id:
            by_id[team_id] = summary

        candidates = {
            str(team_blob.get("displayName") or "").strip(),
            str(team_blob.get("shortDisplayName") or "").strip(),
            str(team_blob.get("abbreviation") or "").strip(),
            str(team_blob.get("location") or "").strip(),
            f"{str(team_blob.get('location') or '').strip()} {str(team_blob.get('name') or '').strip()}".strip(),
            f"{str(team_blob.get('location') or '').strip()} {str(team_blob.get('displayName') or '').strip()}".strip(),
        }
        for candidate in candidates:
            normalized = _normalize_team_name(candidate)
            if normalized and normalized not in by_name:
                by_name[normalized] = summary

    sport_name, espn_league, _ = LEAGUES.get(league_key, ("", "", 0))
    if sport_name and espn_league:
        teams_url = f"{ESPN_BASE}/{sport_name}/{espn_league}/teams"
        teams_data = await _fetch_cached(teams_url, timeout=12.0)
        sports = teams_data.get("sports", []) if isinstance(teams_data, dict) else []
        leagues = sports[0].get("leagues", []) if sports else []
        team_entries = leagues[0].get("teams", []) if leagues else []

        for entry in team_entries:
            team_blob = (entry or {}).get("team") or {}
            team_color = _normalize_color(team_blob.get("color"))
            team_id = str(team_blob.get("id") or "").strip()

            if team_id and team_color:
                summary = by_id.get(team_id, {"record": None, "color": None})
                if not summary.get("color"):
                    summary["color"] = team_color
                by_id[team_id] = summary

            candidates = {
                str(team_blob.get("displayName") or "").strip(),
                str(team_blob.get("shortDisplayName") or "").strip(),
                str(team_blob.get("abbreviation") or "").strip(),
                str(team_blob.get("location") or "").strip(),
                f"{str(team_blob.get('location') or '').strip()} {str(team_blob.get('name') or '').strip()}".strip(),
                f"{str(team_blob.get('location') or '').strip()} {str(team_blob.get('displayName') or '').strip()}".strip(),
            }
            for candidate in candidates:
                normalized = _normalize_team_name(candidate)
                if not normalized:
                    continue
                summary = by_name.get(normalized, {"record": None, "color": None})
                if team_color and not summary.get("color"):
                    summary["color"] = team_color
                by_name[normalized] = summary

    payload = {"by_id": by_id, "by_name": by_name}
    set_cached(cache_key, payload, CACHE_TTL_TEAM_DATA)
    return payload


async def _fetch_team_schedule_data(team: Team, season: str | None = None) -> dict[str, Any] | None:
    league_key, espn_team_id = _parse_external_team_id(team.external_id)
    if not league_key or not espn_team_id or league_key not in LEAGUES:
        return None

    async with _team_fetch_semaphore:
        data = await _fetch_cached(_build_schedule_url(league_key, espn_team_id, season), timeout=12.0)
    return data if isinstance(data, dict) else None


async def _fetch_team_roster_data(team: Team, season: str | None = None) -> dict[str, Any] | None:
    league_key, espn_team_id = _parse_external_team_id(team.external_id)
    if not league_key or not espn_team_id or league_key not in LEAGUES:
        return None

    season_value = _clean_requested_season(season) or str(_season_for_league(league_key))

    if league_key == "MLB":
        mlb_season = int(season_value)
        teams_data = await _fetch_cached(
            f"https://statsapi.mlb.com/api/v1/teams?sportId=1&season={mlb_season}",
            timeout=12.0,
        )
        if not isinstance(teams_data, dict):
            return None

        target_names = {
            _normalize_team_name(team.name),
            _normalize_team_name(team.city),
            _normalize_team_name(team.short_name),
        }
        target_names.discard("")

        mlb_team_id = ""
        for candidate in teams_data.get("teams", []) or []:
            if not isinstance(candidate, dict):
                continue
            candidate_names = {
                _normalize_team_name(candidate.get("name")),
                _normalize_team_name(candidate.get("teamName")),
                _normalize_team_name(candidate.get("clubName")),
                _normalize_team_name(candidate.get("locationName")),
                _normalize_team_name(
                    f"{candidate.get('locationName', '')} {candidate.get('teamName', '')}"
                ),
            }
            if target_names & candidate_names:
                mlb_team_id = str(candidate.get("id") or "").strip()
                break

        if not mlb_team_id:
            return None

        for roster_type in ("active", "40Man", "fullSeason"):
            async with _team_fetch_semaphore:
                data = await _fetch_cached(
                    f"https://statsapi.mlb.com/api/v1/teams/{mlb_team_id}/roster?rosterType={roster_type}&season={mlb_season}",
                    timeout=12.0,
                )
            if isinstance(data, dict) and (data.get("roster") or []):
                return data
        return None

    async with _team_fetch_semaphore:
        data = await _fetch_cached(_build_roster_url(league_key, espn_team_id, season_value), timeout=12.0)
    if not isinstance(data, dict):
        return None

    team_blob = data.get("team") or {}
    athletes = team_blob.get("athletes")
    if not isinstance(team_blob, dict) or not isinstance(athletes, list):
        return None

    return {
        "team": team_blob,
        "athletes": athletes,
        "season": data.get("season"),
    }


async def _fetch_team_standings_context(team: Team, league_key: str, season: str | None) -> dict[str, Any]:
    standings_url = ESPN_STANDINGS_URLS.get(league_key)
    cleaned_season = _clean_requested_season(season)
    if not standings_url:
        return {
            "season": cleaned_season or "",
            "season_label": "",
            "seasons": [],
            "record": None,
        }

    if cleaned_season:
        standings_url = f"{standings_url}?{urlencode({'season': cleaned_season})}"

    async with _team_fetch_semaphore:
        data = await _fetch_cached(standings_url, timeout=12.0)

    if not isinstance(data, dict):
        return {
            "season": cleaned_season or "",
            "season_label": "",
            "seasons": [],
            "record": None,
        }

    groups: list[dict[str, Any]] = []
    for child in data.get("children") or []:
        if isinstance(child, dict):
            _collect_standings_groups(child, groups)

    if not groups and isinstance((data.get("standings") or {}).get("entries"), list):
        _collect_standings_groups(data, groups)

    selected_season = _resolve_selected_standings_season(data, cleaned_season or "")
    normalized_seasons = _normalize_standings_seasons(data.get("seasons"))
    active_season = (
        str((selected_season or {}).get("year") or "").strip()
        or cleaned_season
        or str(((data.get("season") or {}).get("year") or "")).strip()
        or str(_season_for_league(league_key))
    )
    season_label = (
        str((selected_season or {}).get("displayName") or (selected_season or {}).get("name") or "").strip()
        or next(
            (
                str((season_option or {}).get("display_name") or "").strip()
                for season_option in normalized_seasons
                if str((season_option or {}).get("year") or "").strip() == active_season
            ),
            "",
        )
        or active_season
    )

    _, espn_team_id = _parse_external_team_id(team.external_id)
    record = None
    if espn_team_id:
        for group in groups:
            for entry in group.get("entries") or []:
                entry_team = (entry or {}).get("team") or {}
                if str(entry_team.get("id") or "").strip() == espn_team_id:
                    record = str((entry or {}).get("record") or "").strip() or None
                    break
            if record:
                break

    return {
        "season": active_season,
        "season_label": season_label,
        "seasons": normalized_seasons,
        "record": record,
    }


async def _fetch_team_summary(team: Team) -> dict[str, Any]:
    cache_key = f"team:summary:{team.id}"
    cached = get_cached(cache_key)
    if isinstance(cached, dict):
        return cached

    schedule_data = await _fetch_team_schedule_data(team)
    team_blob = (schedule_data or {}).get("team", {}) or {}
    summary = {
        "record": (
            str(team_blob.get("recordSummary") or team_blob.get("standingSummary") or "").strip()
            or None
        ),
        "color": _normalize_color(team_blob.get("color")),
    }
    set_cached(cache_key, summary, CACHE_TTL_TEAM_DATA)
    return summary


def _extract_team_record(team_blob: dict[str, Any]) -> str | None:
    return (
        str(team_blob.get("recordSummary") or team_blob.get("standingSummary") or "").strip()
        or None
    )


def _build_internal_team_map(db: Session, league_key: str) -> dict[str, Team]:
    teams = db.query(Team).filter(Team.league == league_key).all()
    mapping: dict[str, Team] = {}
    for team in teams:
        _, espn_team_id = _parse_external_team_id(team.external_id)
        if espn_team_id:
            mapping[espn_team_id] = team
    return mapping


def _serialize_schedule_event(event: dict[str, Any], league_key: str, internal_team_map: dict[str, Team]) -> dict[str, Any]:
    parsed = _parse_espn_event(event, league_key)
    competition = (event.get("competitions") or [{}])[0] or {}
    competitors = competition.get("competitors", []) or []
    home_comp = next((comp for comp in competitors if comp.get("homeAway") == "home"), {})
    away_comp = next((comp for comp in competitors if comp.get("homeAway") == "away"), {})

    def serialize_competitor(comp: dict[str, Any], fallback_name: str, fallback_abbr: str, fallback_logo: str, fallback_color: str) -> dict[str, Any]:
        team_blob = comp.get("team", {}) or {}
        team_id = str(team_blob.get("id") or "")
        internal_team = internal_team_map.get(team_id)
        record = str(comp.get("record") or "").strip() or None
        return {
            "id": str(internal_team.id) if internal_team else None,
            "external_id": f"espn:{league_key}:{team_id}" if team_id else None,
            "name": team_blob.get("displayName") or fallback_name,
            "short_name": team_blob.get("abbreviation") or fallback_abbr,
            "logo_url": team_blob.get("logo") or fallback_logo,
            "city": team_blob.get("location") or (internal_team.city if internal_team else None),
            "record": record,
            "color": _normalize_color(team_blob.get("color") or fallback_color),
        }

    home_team = serialize_competitor(
        home_comp,
        parsed["homeTeam"],
        parsed["homeAbbr"],
        parsed["homeBadge"],
        parsed["homeColor"],
    )
    away_team = serialize_competitor(
        away_comp,
        parsed["awayTeam"],
        parsed["awayAbbr"],
        parsed["awayBadge"],
        parsed["awayColor"],
    )

    return {
        "id": str(event.get("id") or parsed["id"]),
        "sport": league_key,
        "league": league_key,
        "scheduled_at": event.get("date") or competition.get("date") or "",
        "status": parsed["status"],
        "status_detail": parsed["statusDetail"],
        "home_team": home_team,
        "away_team": away_team,
        "home_score": parsed["homeScore"],
        "away_score": parsed["awayScore"],
        "venue": parsed["strVenue"],
    }


def _serialize_local_games(db: Session, team: Team) -> list[dict[str, Any]]:
    local_games = (
        db.query(Game)
        .filter(or_(Game.home_team_id == team.id, Game.away_team_id == team.id))
        .order_by(Game.scheduled_at.asc())
        .all()
    )

    serialized: list[dict[str, Any]] = []
    for game in local_games:
        home = db.query(Team).filter(Team.id == game.home_team_id).first()
        away = db.query(Team).filter(Team.id == game.away_team_id).first()
        if not home or not away:
            continue
        serialized.append(
            {
                "id": str(game.id),
                "sport": game.sport,
                "league": game.league,
                "scheduled_at": game.scheduled_at.isoformat(),
                "status": game.status,
                "status_detail": game.status.upper(),
                "home_team": {
                    "id": str(home.id),
                    "external_id": home.external_id,
                    "name": home.name,
                    "short_name": home.short_name,
                    "logo_url": home.logo_url,
                    "city": home.city,
                    "record": None,
                    "color": None,
                },
                "away_team": {
                    "id": str(away.id),
                    "external_id": away.external_id,
                    "name": away.name,
                    "short_name": away.short_name,
                    "logo_url": away.logo_url,
                    "city": away.city,
                    "record": None,
                    "color": None,
                },
                "home_score": game.home_score,
                "away_score": game.away_score,
                "venue": "",
            }
        )
    return serialized


def _resolve_schedule_team_summary(
    team_payload: dict[str, Any],
    league_summary_lookup: dict[str, dict[str, dict[str, str | None]]],
) -> dict[str, str | None]:
    by_id = league_summary_lookup.get("by_id", {}) if isinstance(league_summary_lookup, dict) else {}
    by_name = league_summary_lookup.get("by_name", {}) if isinstance(league_summary_lookup, dict) else {}

    external_id = str(team_payload.get("external_id") or "").strip()
    espn_team_id = external_id.split(":")[-1].strip() if external_id else ""
    if espn_team_id and isinstance(by_id, dict):
        summary = by_id.get(espn_team_id)
        if isinstance(summary, dict):
            return summary

    if isinstance(by_name, dict):
        candidates = (
            team_payload.get("name"),
            team_payload.get("short_name"),
            team_payload.get("city"),
            f"{str(team_payload.get('city') or '').strip()} {str(team_payload.get('name') or '').strip()}".strip(),
        )
        for candidate in candidates:
            normalized = _normalize_team_name(candidate)
            if normalized and normalized in by_name and isinstance(by_name[normalized], dict):
                return by_name[normalized]

    return {}


def _hydrate_schedule_team_visuals(
    schedule_items: list[dict[str, Any]],
    league_summary_lookup: dict[str, dict[str, dict[str, str | None]]],
) -> list[dict[str, Any]]:
    if not schedule_items:
        return schedule_items

    for item in schedule_items:
        for side in ("home_team", "away_team"):
            team_payload = item.get(side)
            if not isinstance(team_payload, dict):
                continue

            summary = _resolve_schedule_team_summary(team_payload, league_summary_lookup)
            if not team_payload.get("color"):
                resolved_color = _normalize_color(summary.get("color"))
                if resolved_color:
                    team_payload["color"] = resolved_color

    return schedule_items


def _merge_schedule_items(primary: list[dict[str, Any]], supplemental: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {str(item["id"]): item for item in supplemental}
    for item in primary:
        existing = merged.get(str(item["id"]))
        if existing:
            merged[str(item["id"])] = {**existing, **item}
        else:
            merged[str(item["id"])] = item

    return sorted(
        merged.values(),
        key=lambda item: item.get("scheduled_at") or "",
    )


def _flatten_roster_items(roster_data: dict[str, Any]) -> list[dict[str, Any]]:
    flattened: list[dict[str, Any]] = []
    for group in roster_data.get("athletes") or []:
        if isinstance(group, dict) and isinstance(group.get("items"), list):
            flattened.extend(item for item in group.get("items") or [] if isinstance(item, dict))
        elif isinstance(group, dict):
            flattened.append(group)
    return flattened


def _extract_epl_stat_facts(statistics_blob: Any) -> list[dict[str, str]]:
    if not isinstance(statistics_blob, dict):
        return []

    categories = (
        statistics_blob.get("splits", {})
        .get("categories", [])
    )
    preferred = ["G", "A", "ST", "SH", "SV", "YC", "RC", "APP"]
    stat_map: dict[str, str] = {}
    for category in categories:
        for stat in category.get("stats", []) or []:
            abbr = str(stat.get("abbreviation") or "").strip()
            display_value = str(stat.get("displayValue") or "").strip()
            if abbr and display_value and display_value != "0":
                stat_map[abbr] = display_value

    facts: list[dict[str, str]] = []
    for abbr in preferred:
        value = stat_map.get(abbr)
        if value:
            facts.append({"label": abbr, "value": value})
    return facts[:4]


def _build_roster_facts(athlete: dict[str, Any], league_key: str) -> list[dict[str, str]]:
    facts: list[dict[str, str]] = []

    def push(label: str, value: Any) -> None:
        text = str(value or "").strip()
        if text:
            facts.append({"label": label, "value": text})

    position = (athlete.get("position") or {}).get("abbreviation", "")
    if position:
        push("POS", position)

    jersey = athlete.get("jersey")
    if jersey:
        push("#", jersey)

    if league_key == "MLB":
        bats = str(athlete.get("bats") or "").strip()
        throws = str(athlete.get("throws") or "").strip()
        if bats or throws:
            push("B/T", f"{bats or '-'} / {throws or '-'}")
        push("AGE", athlete.get("age"))
        push("HT", athlete.get("displayHeight"))
    elif league_key == "NHL":
        push("AGE", athlete.get("age"))
        push("HT", athlete.get("displayHeight"))
        push("HAND", athlete.get("hand"))
        push("EXP", (athlete.get("experience") or {}).get("years"))
    elif league_key == "NFL":
        push("AGE", athlete.get("age"))
        push("HT", athlete.get("displayHeight"))
        push("WT", athlete.get("displayWeight"))
        push("EXP", (athlete.get("experience") or {}).get("years"))
    elif league_key == "NBA":
        push("AGE", athlete.get("age"))
        push("HT", athlete.get("displayHeight"))
        push("WT", athlete.get("displayWeight"))
        push("EXP", (athlete.get("experience") or {}).get("years"))
    elif league_key == "EPL":
        epl_facts = _extract_epl_stat_facts(athlete.get("statistics"))
        if epl_facts:
            return epl_facts
        push("AGE", athlete.get("age"))
        push("HT", athlete.get("displayHeight"))

    return facts[:4]


def _serialize_roster(roster_data: dict[str, Any], league_key: str) -> list[dict[str, Any]]:
    if league_key == "MLB" and isinstance(roster_data.get("roster"), list):
        roster: list[dict[str, Any]] = []
        for entry in roster_data.get("roster", []) or []:
            if not isinstance(entry, dict):
                continue
            person = entry.get("person", {}) or {}
            person_id = str(person.get("id") or "").strip()
            full_name = str(person.get("fullName") or "").strip()
            if not full_name:
                continue

            roster.append(
                {
                    "id": person_id,
                    "name": full_name,
                    "short_name": full_name,
                    "headshot": (
                        f"https://img.mlbstatic.com/mlb-photos/image/upload/w_160,q_auto:best/v1/people/{person_id}/headshot/67/current"
                        if person_id
                        else ""
                    ),
                    "position": ((entry.get("position") or {}).get("abbreviation") or "").strip(),
                    "jersey": entry.get("jerseyNumber"),
                    "status": ((entry.get("status") or {}).get("description") or "").strip().lower(),
                    "facts": [
                        *(
                            [{"label": "POS", "value": str((entry.get("position") or {}).get("abbreviation") or "").strip()}]
                            if str((entry.get("position") or {}).get("abbreviation") or "").strip()
                            else []
                        ),
                        *(
                            [{"label": "#", "value": str(entry.get("jerseyNumber") or "").strip()}]
                            if str(entry.get("jerseyNumber") or "").strip()
                            else []
                        ),
                        *(
                            [{"label": "STATUS", "value": str((entry.get("status") or {}).get("description") or "").strip()}]
                            if str((entry.get("status") or {}).get("description") or "").strip()
                            else []
                        ),
                    ][:4],
                }
            )

        roster.sort(key=lambda item: ((item.get("position") or "ZZZ"), item.get("name") or ""))
        return roster

    sport, _, _ = LEAGUES[league_key]
    roster_items = _flatten_roster_items(roster_data)
    roster: list[dict[str, Any]] = []

    for athlete in roster_items:
        athlete_id = str(athlete.get("id") or "")
        roster.append(
            {
                "id": athlete_id,
                "name": athlete.get("displayName") or athlete.get("fullName") or "",
                "short_name": athlete.get("shortName") or athlete.get("displayName") or "",
                "headshot": _extract_headshot(athlete.get("headshot"), athlete_id, sport),
                "position": (athlete.get("position") or {}).get("abbreviation", ""),
                "jersey": athlete.get("jersey"),
                "status": (athlete.get("status") or {}).get("type") if isinstance(athlete.get("status"), dict) else athlete.get("status"),
                "facts": _build_roster_facts(athlete, league_key),
            }
        )

    roster.sort(key=lambda item: ((item.get("position") or "ZZZ"), item.get("name") or ""))
    return roster


@router.get("", response_model=list[TeamResponse])
async def list_teams(
    sport: Optional[str] = Query(None),
    league: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(DEFAULT_PAGE_SIZE, ge=1, le=MAX_TEAM_PAGE_SIZE),
    db: Session = Depends(get_db),
):
    """All teams, optionally filtered by sport/league, with cached current records."""
    cache_key = f"teams:{sport or 'all'}:{league or 'all'}:p{page}:s{page_size}:v6"
    cached = get_cached(cache_key)
    if cached is not None:
        return cached

    query = db.query(Team)
    if sport:
        normalized_sport = (sport or "").strip()
        query = query.filter(or_(Team.sport == normalized_sport, Team.league == normalized_sport))
    if league:
        query = query.filter(Team.league == league)

    teams = (
        query.order_by(Team.league.asc(), Team.city.asc(), Team.name.asc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    league_keys = sorted(
        {
            league_key
            for team in teams
            for league_key, _espn_team_id in [_parse_external_team_id(team.external_id)]
            if league_key in ESPN_STANDINGS_URLS
        }
    )
    summary_lookup_payloads = await asyncio.gather(
        *[_fetch_league_summary_lookup(league_key) for league_key in league_keys]
    ) if league_keys else []
    summary_lookups = {
        league_key: lookup
        for league_key, lookup in zip(league_keys, summary_lookup_payloads)
    }

    result = []
    for team in teams:
        league_key, espn_team_id = _parse_external_team_id(team.external_id)
        summary_data: dict[str, str | None] = {}
        if league_key:
            lookup = summary_lookups.get(league_key, {})
            by_id = lookup.get("by_id", {})
            by_name = lookup.get("by_name", {})
            if espn_team_id and isinstance(by_id, dict):
                summary_data = by_id.get(espn_team_id, {}) or {}
            if not summary_data and isinstance(by_name, dict):
                for candidate in (
                    team.name,
                    team.short_name,
                    team.city,
                    f"{team.city or ''} {team.name or ''}".strip(),
                ):
                    normalized = _normalize_team_name(candidate)
                    if normalized and normalized in by_name:
                        summary_data = by_name[normalized] or {}
                        break
        result.append(
            _team_payload(
                team,
                record=summary_data.get("record"),
                color=summary_data.get("color"),
            )
        )

    set_cached(cache_key, result, CACHE_TTL_TEAM_DATA)
    return result


@router.get("/slug/{slug}", response_model=dict[str, Any])
async def get_team_by_slug(
    slug: str,
    season: str | None = Query(default=None, description="Optional ESPN season year, e.g. 2024"),
    db: Session = Depends(get_db),
):
    """Single team detail looked up by URL slug (e.g. 'los-angeles-lakers')."""
    cleaned_season = _clean_requested_season(season)
    cache_key = f"team:slug:{slug}:detail:{cleaned_season or 'current'}:v5"
    cached = get_cached(cache_key)
    if cached is not None:
        return cached

    # Build slug from team name/city and match
    all_teams = db.query(Team).all()
    team = None
    for t in all_teams:
        candidate_slug = _make_slug(t.name)
        if candidate_slug == slug:
            team = t
            break
        # Also try city + name combo
        if t.city:
            candidate_slug2 = _make_slug(f"{t.city} {t.name}")
            if candidate_slug2 == slug:
                team = t
                break

    if not team:
        raise HTTPException(status_code=404, detail="Team not found")

    # Re-use the existing get_team logic
    result = await get_team(str(team.id), season=cleaned_season, db=db)
    set_cached(cache_key, result, CACHE_TTL_TEAM_DATA)
    return result


def _make_slug(name: str) -> str:
    """Convert a team name to a URL-friendly slug."""
    import re
    slug = name.lower().strip()
    slug = re.sub(r"[^a-z0-9\s-]", "", slug)
    slug = re.sub(r"[\s]+", "-", slug)
    slug = re.sub(r"-+", "-", slug)
    return slug.strip("-")


@router.get("/{team_id}", response_model=dict[str, Any])
async def get_team(
    team_id: str,
    season: str | None = Query(default=None, description="Optional ESPN season year, e.g. 2024"),
    db: Session = Depends(get_db),
):
    """Single team detail with selected-season record, schedule, and roster."""
    cleaned_season = _clean_requested_season(season)
    cache_key = f"team:{team_id}:detail:{cleaned_season or 'current'}:v5"
    cached = get_cached(cache_key)
    if cached is not None:
        return cached

    team = db.query(Team).filter(Team.id == team_id).first()
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")

    league_key, _ = _parse_external_team_id(team.external_id)
    if not league_key or league_key not in LEAGUES:
        raise HTTPException(status_code=400, detail="Unsupported team source")

    schedule_data, roster_data, standings_context, league_summary_lookup = await asyncio.gather(
        _fetch_team_schedule_data(team, cleaned_season),
        _fetch_team_roster_data(team, cleaned_season),
        _fetch_team_standings_context(team, league_key, cleaned_season),
        _fetch_league_summary_lookup(league_key),
    )

    team_blob = (schedule_data or {}).get("team", {}) or {}
    internal_team_map = _build_internal_team_map(db, league_key)
    external_schedule = [
        _serialize_schedule_event(event, league_key, internal_team_map)
        for event in (schedule_data or {}).get("events", []) or []
        if isinstance(event, dict)
    ]
    local_schedule = _serialize_local_games(db, team) if _is_current_season_request(league_key, cleaned_season) else []
    merged_schedule = _merge_schedule_items(external_schedule, local_schedule)
    merged_schedule = _hydrate_schedule_team_visuals(merged_schedule, league_summary_lookup)
    roster = _serialize_roster(roster_data or {}, league_key)
    if not roster:
        retry_roster_data = await _fetch_team_roster_data(team, cleaned_season)
        roster = _serialize_roster(retry_roster_data or {}, league_key)
    record = standings_context.get("record") or _extract_team_record(team_blob)
    color = _normalize_color(team_blob.get("color"))
    summary_data: dict[str, Any] = {}
    if not color or (not record and _is_current_season_request(league_key, cleaned_season)):
        summary_data = await _fetch_team_summary(team)

    requested_season_blob = (schedule_data or {}).get("requestedSeason") or {}
    active_season = (
        str(requested_season_blob.get("year") or "").strip()
        or cleaned_season
        or str(standings_context.get("season") or "").strip()
        or str(_season_for_league(league_key))
    )
    season_label = (
        str(requested_season_blob.get("displayName") or requested_season_blob.get("name") or "").strip()
        or str(standings_context.get("season_label") or "").strip()
        or active_season
    )
    season_record = record or (
        summary_data.get("record") if _is_current_season_request(league_key, cleaned_season) else None
    )

    result = {
        **_team_payload(
            team,
            record=season_record,
            color=color or summary_data.get("color"),
        ),
        "season": active_season,
        "season_label": season_label,
        "season_record": season_record,
        "seasons": standings_context.get("seasons") or [],
        "schedule": merged_schedule,
        "roster": roster,
    }

    set_cached(cache_key, result, CACHE_TTL_TEAM_DATA)
    return result
