"""
SportSync - Bulk season data ingestion for ML training.

Fetches every team's season schedule from the ESPN public API (stdlib only),
upserts games + teams into the local database, then prints a summary.

Usage:
    cd backend
    python ml/seed_data.py              # seeds NBA (default)
    python ml/seed_data.py --all        # seeds NBA, NFL, NHL, MLB, EPL
    python ml/seed_data.py --league NHL
"""
from __future__ import annotations

import argparse
import asyncio
import json
import ssl
import sys
import time
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any

import pandas as pd
from sqlalchemy import func, or_

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from database import SessionLocal
from models.game import Game
from models.team import Team

ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports"

LEAGUES: dict[str, tuple[str, str]] = {
    "NBA": ("basketball", "nba"),
    "NFL": ("football",   "nfl"),
    "MLB": ("baseball",   "mlb"),
    "NHL": ("hockey",     "nhl"),
    "EPL": ("soccer",     "eng.1"),
}

# Create a permissive SSL context for ESPN requests
_ssl_ctx = ssl.create_default_context()
_ssl_ctx.check_hostname = False
_ssl_ctx.verify_mode = ssl.CERT_NONE


def _fetch_json(url: str) -> dict | list | None:
    """Fetch JSON from ESPN using stdlib urllib — zero external deps."""
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "SportSync/0.1"})
            with urllib.request.urlopen(req, timeout=15, context=_ssl_ctx) as resp:
                return json.loads(resp.read().decode())
        except Exception:
            time.sleep(1.0 * (attempt + 1))
    return None


def fetch_all_team_ids(league_key: str) -> list[dict[str, str]]:
    """Get all ESPN team IDs + metadata for a league."""
    sport, espn_league = LEAGUES[league_key]
    url = f"{ESPN_BASE}/{sport}/{espn_league}/teams?limit=100"
    data = _fetch_json(url)
    if not isinstance(data, dict):
        return []

    teams: list[dict[str, str]] = []
    for sport_block in data.get("sports", []) or []:
        for league_block in sport_block.get("leagues", []) or []:
            for team_entry in league_block.get("teams", []) or []:
                team = team_entry.get("team", {}) if isinstance(team_entry, dict) else {}
                team_id = str(team.get("id", "")).strip()
                if team_id:
                    teams.append({
                        "espn_id": team_id,
                        "name": str(team.get("displayName", "")),
                        "abbreviation": str(team.get("abbreviation", "")),
                        "location": str(team.get("location", "")),
                        "logo": _extract_logo(team),
                    })
    return teams


def _extract_logo(team_data: dict) -> str:
    logo = str(team_data.get("logo", "") or "").strip()
    if logo:
        return logo
    for item in team_data.get("logos", []) or []:
        if isinstance(item, dict):
            href = str(item.get("href", "") or "").strip()
            if href:
                return href
    return ""


def fetch_team_schedule(league_key: str, espn_team_id: str, season: int) -> list[dict]:
    sport, espn_league = LEAGUES[league_key]
    url = f"{ESPN_BASE}/{sport}/{espn_league}/teams/{espn_team_id}/schedule?season={season}"
    data = _fetch_json(url)
    if not isinstance(data, dict):
        return []
    return data.get("events", []) or []


# ── Parsing & upsert ─────────────────────────────────────────────────────

def _parse_status(event: dict) -> str:
    competition = (event.get("competitions") or [{}])[0] or {}
    status_obj = event.get("status", {}) or competition.get("status", {}) or {}
    status_type = status_obj.get("type", {})
    state = status_type.get("state", "")
    name = status_type.get("name", "")
    if state == "in" or name == "STATUS_IN_PROGRESS":
        return "live"
    if state == "post" or name in ("STATUS_FINAL", "STATUS_END", "STATUS_FULL_TIME"):
        return "final"
    return "upcoming"


def _extract_score(value) -> int:
    if isinstance(value, dict):
        dv = str(value.get("displayValue", "") or "").strip()
        nv = value.get("value")
        if dv.lstrip("-").isdigit():
            return int(dv)
        if isinstance(nv, (int, float)):
            return int(nv)
        return 0
    if isinstance(value, (int, float)):
        return int(value)
    text = str(value or "").strip()
    return int(text) if text.lstrip("-").isdigit() else 0


def _parse_dt(value: Any) -> datetime:
    ts = pd.to_datetime(value, errors="coerce", utc=True)
    if pd.isna(ts):
        return datetime.utcnow()
    return ts.to_pydatetime().replace(tzinfo=None)


def _lookup_team(db, external_id: str, league_key: str, name: str, abbr: str) -> Team | None:
    team = db.query(Team).filter(Team.external_id == external_id).first()
    if team:
        return team
    return (
        db.query(Team)
        .filter(Team.league == league_key)
        .filter(or_(
            func.lower(Team.name) == name.lower(),
            func.lower(func.coalesce(Team.short_name, "")) == abbr.lower(),
        ))
        .first()
    )


def upsert_team(db, competitor: dict, league_key: str) -> Team:
    sport, _ = LEAGUES[league_key]
    team_data = competitor.get("team", {}) or {}
    team_id = str(team_data.get("id") or competitor.get("id") or "")
    team_name = str(team_data.get("displayName") or team_data.get("shortDisplayName") or "")
    team_abbr = str(team_data.get("abbreviation") or "")
    external_id = f"espn:{league_key}:{team_id}"

    team = _lookup_team(db, external_id, league_key, team_name, team_abbr)
    if not team:
        team = Team(
            external_id=external_id, name=team_name, short_name=team_abbr,
            sport=sport, league=league_key, logo_url=_extract_logo(team_data),
            city=str(team_data.get("location") or ""),
        )
        db.add(team)
        db.flush()
        return team

    team.name = team_name or team.name
    team.short_name = team_abbr or team.short_name
    team.sport = sport
    team.league = league_key
    team.logo_url = _extract_logo(team_data) or team.logo_url
    team.city = str(team_data.get("location") or team.city or "")
    if not team.external_id:
        team.external_id = external_id
    db.flush()
    return team


def upsert_game(db, event: dict, league_key: str) -> Game | None:
    event_id = str(event.get("id") or "")
    competition = (event.get("competitions") or [{}])[0] or {}
    competitors = competition.get("competitors") or []
    if not event_id or len(competitors) < 2:
        return None

    home_comp = next((c for c in competitors if c.get("homeAway") == "home"), competitors[0])
    away_comp = next((c for c in competitors if c.get("homeAway") == "away"), competitors[-1])
    home_team = upsert_team(db, home_comp, league_key)
    away_team = upsert_team(db, away_comp, league_key)

    status = _parse_status(event)
    home_score = _extract_score(home_comp.get("score", 0))
    away_score = _extract_score(away_comp.get("score", 0))
    scheduled_at = _parse_dt(event.get("date") or competition.get("date"))
    sport, _ = LEAGUES[league_key]

    game = db.query(Game).filter(Game.id == event_id).first()
    if not game:
        game = Game(
            id=event_id, home_team_id=home_team.id, away_team_id=away_team.id,
            sport=sport, league=league_key, scheduled_at=scheduled_at,
            status=status, home_score=home_score, away_score=away_score,
        )
        db.add(game)
    else:
        game.home_team_id = home_team.id
        game.away_team_id = away_team.id
        game.sport = sport
        game.league = league_key
        game.scheduled_at = scheduled_at
        game.status = status
        game.home_score = home_score
        game.away_score = away_score

    db.flush()
    return game


# ── Main ingestion ────────────────────────────────────────────────────────

def seed_league(league_key: str, season: int | None = None) -> dict[str, int]:
    if season is None:
        now = datetime.utcnow()
        if league_key in ("NFL", "EPL"):
            season = now.year if now.month >= 8 else now.year - 1
        else:
            season = now.year if now.month >= 9 else now.year

    print(f"\n{'='*60}")
    print(f"  Seeding {league_key} — Season {season}")
    print(f"{'='*60}")

    teams = fetch_all_team_ids(league_key)
    print(f"  Found {len(teams)} teams")
    if not teams:
        print("  ERROR: No teams found from ESPN API!")
        return {"teams": 0, "games_new": 0, "games_updated": 0, "games_final": 0}

    db = SessionLocal()
    games_new = 0
    games_updated = 0
    seen_event_ids: set[str] = set()

    try:
        for i, team_info in enumerate(teams):
            espn_id = team_info["espn_id"]
            abbr = team_info["abbreviation"]
            print(f"  [{i+1}/{len(teams)}] {abbr} ({team_info['name']})...", end="", flush=True)

            events = fetch_team_schedule(league_key, espn_id, season)
            team_new = 0
            team_upd = 0

            for event in events:
                eid = str(event.get("id", ""))
                if not eid:
                    continue
                is_new = eid not in seen_event_ids and not db.query(Game).filter(Game.id == eid).first()
                seen_event_ids.add(eid)
                try:
                    g = upsert_game(db, event, league_key)
                    if g:
                        if is_new:
                            team_new += 1
                            games_new += 1
                        else:
                            team_upd += 1
                            games_updated += 1
                except Exception as e:
                    print(f" ERR({e})", end="")
                    db.rollback()

            db.commit()
            print(f" {len(events)} events ({team_new} new, {team_upd} upd)")
            time.sleep(0.3)

        games_final = db.query(Game).filter(Game.league == league_key, Game.status == "final").count()
        total_teams = db.query(Team).filter(Team.league == league_key).count()

        print(f"\n  {league_key} Summary: {total_teams} teams, {games_new} new, {games_updated} upd, {games_final} final")
        return {"teams": total_teams, "games_new": games_new, "games_updated": games_updated, "games_final": games_final}
    finally:
        db.close()


def main():
    parser = argparse.ArgumentParser(description="Seed ESPN season data for ML training")
    parser.add_argument("--all", action="store_true", help="Seed all leagues")
    parser.add_argument("--league", type=str, default="NBA", help="Specific league (default: NBA)")
    parser.add_argument("--season", type=int, default=None, help="Season year")
    args = parser.parse_args()

    start = time.time()
    leagues = ["NBA", "NFL", "NHL", "MLB", "EPL"] if args.all else [args.league.upper()]

    all_stats = {}
    for lk in leagues:
        if lk not in LEAGUES:
            print(f"Unknown league: {lk}")
            continue
        all_stats[lk] = seed_league(lk, args.season)

    elapsed = time.time() - start
    print(f"\n{'='*60}")
    print(f"  DONE in {elapsed:.1f}s")
    for league, stats in all_stats.items():
        print(f"  {league}: {stats['games_final']} final games, {stats['teams']} teams")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
