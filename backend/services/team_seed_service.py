"""
Bootstrap reference teams for fresh environments.

Production deploys start with an empty relational database. The app's saved-team
and onboarding flows depend on the `teams` table containing known teams, so we
seed that table from ESPN metadata on first startup.
"""
from __future__ import annotations

import logging
from typing import Any

import httpx
from sqlalchemy.orm import Session

from models.team import Team

logger = logging.getLogger(__name__)

ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports"
LEAGUES: dict[str, tuple[str, str]] = {
    "NBA": ("basketball", "nba"),
    "NFL": ("football", "nfl"),
    "MLB": ("baseball", "mlb"),
    "NHL": ("hockey", "nhl"),
    "EPL": ("soccer", "eng.1"),
}


def _extract_logo(team_data: dict[str, Any]) -> str | None:
    direct_logo = str(team_data.get("logo") or "").strip()
    if direct_logo:
        return direct_logo

    for item in team_data.get("logos") or []:
        if not isinstance(item, dict):
            continue
        href = str(item.get("href") or "").strip()
        if href:
            return href

    return None


def _fetch_league_team_payloads(league_key: str) -> list[dict[str, str]]:
    sport, espn_league = LEAGUES[league_key]
    url = f"{ESPN_BASE}/{sport}/{espn_league}/teams?limit=100"

    try:
        response = httpx.get(
            url,
            timeout=15.0,
            headers={"User-Agent": "SportSync/0.1"},
            follow_redirects=True,
        )
        response.raise_for_status()
        data = response.json()
    except Exception:
        logger.exception("Failed to fetch reference teams for %s", league_key)
        return []

    payloads: list[dict[str, str]] = []
    for sport_block in data.get("sports", []) or []:
        for league_block in sport_block.get("leagues", []) or []:
            for team_entry in league_block.get("teams", []) or []:
                if not isinstance(team_entry, dict):
                    continue
                team_data = team_entry.get("team", {}) or {}
                team_id = str(team_data.get("id") or "").strip()
                if not team_id:
                    continue
                payloads.append(
                    {
                        "external_id": f"espn:{league_key}:{team_id}",
                        "name": str(team_data.get("displayName") or team_data.get("shortDisplayName") or "").strip(),
                        "short_name": str(team_data.get("abbreviation") or "").strip(),
                        "city": str(team_data.get("location") or "").strip(),
                        "logo_url": _extract_logo(team_data) or "",
                    }
                )
    return payloads


def seed_reference_teams(db: Session) -> dict[str, int]:
    """Upsert reference teams for all supported leagues."""
    created = 0
    updated = 0

    for league_key, (sport, _espn_league) in LEAGUES.items():
        for payload in _fetch_league_team_payloads(league_key):
            existing = db.query(Team).filter(Team.external_id == payload["external_id"]).first()
            if existing:
                existing.name = payload["name"] or existing.name
                existing.short_name = payload["short_name"] or existing.short_name
                existing.city = payload["city"] or existing.city
                existing.logo_url = payload["logo_url"] or existing.logo_url
                existing.sport = sport
                existing.league = league_key
                updated += 1
                continue

            db.add(
                Team(
                    external_id=payload["external_id"],
                    name=payload["name"],
                    short_name=payload["short_name"] or None,
                    sport=sport,
                    league=league_key,
                    logo_url=payload["logo_url"] or None,
                    city=payload["city"] or None,
                )
            )
            created += 1

    db.commit()
    return {"created": created, "updated": updated}
