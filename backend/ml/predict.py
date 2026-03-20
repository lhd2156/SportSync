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

import logging
import re
from datetime import datetime
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
from sqlalchemy import func, or_, text
from sqlalchemy.orm import Session

from ml.pipeline import FEATURE_COLUMNS, build_matchup_features
from models.game import Game
from models.team import Team
from routers.sports import ESPN_BASE, LEAGUES, _fetch_cached, _parse_espn_event

logger = logging.getLogger(__name__)

MODEL_PATH = Path(__file__).resolve().parent / "model.pkl"
_MODEL_BUNDLE: dict[str, Any] | None = None
_MODEL_MTIME: float | None = None

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

# ── Injury severity weights (higher = more impactful) ──
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

# Weight given to Vegas odds when blending (0 = ignore, 1 = fully trust odds).
# Vegas lines are the most accurate public signal — lean on them heavily.
_ODDS_BLEND_WEIGHT = 0.45

# Pre-game probability clamp range — wider to allow extreme blowout predictions.
_PREGAME_PROB_FLOOR = 0.02
_PREGAME_PROB_CEILING = 0.98


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

    bundle = joblib.load(MODEL_PATH)
    if not isinstance(bundle, dict) or "models" not in bundle:
        raise RuntimeError("Prediction model bundle is invalid.")

    _MODEL_BUNDLE = bundle
    _MODEL_MTIME = model_mtime
    return bundle


# ─────────────────────────────────────────────────────────────────────────
# ESPN data helpers
# ─────────────────────────────────────────────────────────────────────────

def _parse_dt(value: Any) -> datetime:
    ts = pd.to_datetime(value, errors="coerce", utc=True)
    if pd.isna(ts):
        return datetime.utcnow()
    return ts.to_pydatetime().replace(tzinfo=None)


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
    query = text(
        """
        SELECT
            id, home_team_id, away_team_id, sport, league,
            scheduled_at, status, home_score, away_score
        FROM games
        WHERE league = :league
        ORDER BY scheduled_at ASC, id ASC
        """
    )
    return pd.read_sql_query(query, db.get_bind(), params={"league": league_key})


# ─────────────────────────────────────────────────────────────────────────
# Injury impact
# ─────────────────────────────────────────────────────────────────────────

async def _fetch_team_injuries(league_key: str, espn_team_id: str) -> list[dict[str, Any]]:
    """Fetch injury report for a team from ESPN."""
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
    return injuries


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
    if status != "live":
        return base_home_win_prob, base_away_win_prob

    score_diff = float(game.home_score - game.away_score)
    score_total = float(max(0, game.home_score) + max(0, game.away_score))
    margin_scale = LEAGUE_MARGIN_SCALES.get(league_key, 10.0)
    expected_total = LEAGUE_EXPECTED_TOTALS.get(league_key, 1.0)

    # Logistic transform of score difference → implied home win probability
    score_state_home = float(1.0 / (1.0 + np.exp(-(score_diff / max(margin_scale, 0.1)))))

    status_detail = str(getattr(game, "_prediction_status_detail", "") or "")
    progress = _extract_live_progress(league_key, status_detail)
    score_weight = min(1.0, score_total / max(expected_total, 1.0))

    # The blend weight determines how much the live score overrides the model.
    # As the game progresses and more points are scored, trust the score more.
    # Minimum 0.30 (so even early, a 10-pt NBA lead still matters),
    # maximum 0.92 (so near-final games almost fully reflect the score).
    blend_weight = min(0.92, max(0.30, 0.30 + progress * 0.45 + score_weight * 0.20))

    adjusted_home = (base_home_win_prob * (1.0 - blend_weight)) + (score_state_home * blend_weight)
    adjusted_away = 1.0 - adjusted_home
    return adjusted_home, adjusted_away


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

    # H2H history
    h2h_games = features.get("head_to_head_games", 0)
    h2h_wr = features.get("head_to_head_home_win_rate", 0.5)
    if h2h_games >= 3 and abs(h2h_wr - 0.5) > 0.2:
        dominant = home_name if h2h_wr > 0.5 else away_name
        factors.append(f"{dominant} dominates the head-to-head series")

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

    # ── Vegas odds blending ──
    summary_data = getattr(game, "_summary_data", None)
    odds_prob, odds_factors = _extract_odds_signal(summary_data)
    if odds_prob is not None:
        home_win_prob = (1.0 - _ODDS_BLEND_WEIGHT) * home_win_prob + _ODDS_BLEND_WEIGHT * odds_prob
        away_win_prob = 1.0 - home_win_prob
        all_factors.extend(odds_factors)

    # ── Live game state override ──
    home_win_prob, away_win_prob = _apply_live_game_state(
        league_key=league_key,
        game=game,
        base_home_win_prob=float(home_win_prob),
        base_away_win_prob=float(away_win_prob),
    )

    # Clamp to valid range — use tighter bounds for pre-game predictions
    game_status = str(game.status or "").lower()
    if game_status != "live":
        # Pre-game: clamp to 10%-90% — no team should ever be <10% before tipoff
        floor = _PREGAME_PROB_FLOOR
        ceiling = _PREGAME_PROB_CEILING
    else:
        # Live: allow wider range as game state dominates
        floor = 0.01
        ceiling = 0.99
    home_win_prob = float(max(floor, min(ceiling, home_win_prob)))
    away_win_prob = float(max(floor, min(ceiling, 1.0 - home_win_prob)))
    # Re-normalize
    total = home_win_prob + away_win_prob
    home_win_prob /= total
    away_win_prob /= total

    # ── Confidence score ──
    # How far the probability is from 50/50 (0 = coin flip, 1 = very confident)
    confidence = round(abs(home_win_prob - 0.5) * 2.0, 4)

    return {
        "home_win_prob": round(float(home_win_prob), 4),
        "away_win_prob": round(float(away_win_prob), 4),
        "model_version": str(bundle.get("model_version", "gbt_unknown")),
        "features": features,
        "confidence": confidence,
        "factors": all_factors[:8],  # Cap at 8 factors
    }
