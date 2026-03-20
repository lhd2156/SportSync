"""
SportSync - ML feature engineering pipeline.

Builds matchup features from historical game results using Pandas/NumPy.
Expanded to ~50 features covering: rest days, scoring trends, momentum,
blowout rates, strength of schedule, standings, and head-to-head depth.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

import numpy as np
import pandas as pd

RECENT_FORM_WINDOW = 5

# League-specific blowout margin thresholds (points/goals).
_BLOWOUT_MARGINS: dict[str, float] = {
    "NFL": 17.0,
    "NBA": 15.0,
    "MLB": 5.0,
    "NHL": 3.0,
    "EPL": 2.0,
}

# Close-game margin thresholds.
_CLOSE_MARGINS: dict[str, float] = {
    "NFL": 3.0,
    "NBA": 5.0,
    "MLB": 1.0,
    "NHL": 1.0,
    "EPL": 0.0,  # any draw is "close"
}

FEATURE_COLUMNS = [
    # ── Original core (kept) ──
    "home_overall_win_rate",
    "away_overall_win_rate",
    "home_avg_points_for",
    "home_avg_points_against",
    "away_avg_points_for",
    "away_avg_points_against",
    "home_recent_win_rate",
    "away_recent_win_rate",
    "home_home_win_rate",
    "away_away_win_rate",
    "home_home_avg_points_for",
    "home_home_avg_points_against",
    "away_away_avg_points_for",
    "away_away_avg_points_against",
    "head_to_head_home_win_rate",
    "head_to_head_games",
    # ── Rest & schedule fatigue ──
    "home_rest_days",
    "away_rest_days",
    "home_is_back_to_back",
    "away_is_back_to_back",
    "home_games_last_7d",
    "away_games_last_7d",
    # ── Scoring trends & momentum ──
    "home_last3_avg_margin",
    "away_last3_avg_margin",
    "home_last3_avg_pf",
    "away_last3_avg_pf",
    "home_last3_avg_pa",
    "away_last3_avg_pa",
    "home_streak",
    "away_streak",
    "home_win_rate_last10",
    "away_win_rate_last10",
    # ── Blowout & volatility ──
    "home_blowout_win_rate",
    "away_blowout_win_rate",
    "home_close_game_rate",
    "away_close_game_rate",
    "home_scoring_std",
    "away_scoring_std",
    # ── Strength of schedule ──
    "home_avg_opp_win_rate",
    "away_avg_opp_win_rate",
    "home_recent_opp_win_rate",
    "away_recent_opp_win_rate",
    # ── Standings / season context ──
    "home_season_win_pct",
    "away_season_win_pct",
    "win_pct_gap",
    # ── Extended H2H ──
    "h2h_home_avg_margin",
    "h2h_recent_home_win_rate",
    # ── Avg margin overall ──
    "home_avg_margin",
    "away_avg_margin",
]


# ───────────────────────── Safe helpers ──────────────────────────────────

def _safe_rate(values: pd.Series | list | np.ndarray | None, default: float = 0.5) -> float:
    if values is None:
        return default
    series = pd.Series(values)
    if series.empty:
        return default
    return float(series.astype(float).mean())


def _safe_mean(values: pd.Series | list | np.ndarray | None, default: float = 0.0) -> float:
    if values is None:
        return default
    series = pd.Series(values)
    if series.empty:
        return default
    return float(series.astype(float).mean())


def _safe_std(values: pd.Series | list | np.ndarray | None, default: float = 0.0) -> float:
    if values is None:
        return default
    series = pd.Series(values, dtype=float)
    if len(series) < 2:
        return default
    return float(series.std())


# ───────────────────────── Data prep ─────────────────────────────────────

def prepare_games_dataframe(games_data: Any) -> pd.DataFrame:
    """Normalize raw historical game records into a clean DataFrame."""
    if isinstance(games_data, pd.DataFrame):
        df = games_data.copy()
    else:
        df = pd.DataFrame(list(games_data or []))

    if df.empty:
        return pd.DataFrame(
            columns=[
                "id", "home_team_id", "away_team_id", "league",
                "sport", "scheduled_at", "status", "home_score", "away_score",
            ]
        )

    rename_map = {
        "game_id": "id",
        "scheduledAt": "scheduled_at",
        "homeScore": "home_score",
        "awayScore": "away_score",
        "homeTeamId": "home_team_id",
        "awayTeamId": "away_team_id",
    }
    df = df.rename(columns=rename_map)

    required = {
        "id", "home_team_id", "away_team_id", "league",
        "scheduled_at", "status", "home_score", "away_score",
    }
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"Missing required game columns: {sorted(missing)}")

    if "sport" not in df.columns:
        df["sport"] = ""

    df["id"] = df["id"].astype(str)
    df["home_team_id"] = df["home_team_id"].astype(str)
    df["away_team_id"] = df["away_team_id"].astype(str)
    df["league"] = df["league"].astype(str).str.upper()
    df["sport"] = df["sport"].fillna("").astype(str)
    df["status"] = df["status"].fillna("").astype(str).str.lower()
    df["home_score"] = pd.to_numeric(df["home_score"], errors="coerce").fillna(0).astype(int)
    df["away_score"] = pd.to_numeric(df["away_score"], errors="coerce").fillna(0).astype(int)
    df["scheduled_at"] = pd.to_datetime(df["scheduled_at"], errors="coerce", utc=True)

    df = df.dropna(subset=["scheduled_at"])
    df = df[(df["home_team_id"] != "") & (df["away_team_id"] != "")]
    df = df.sort_values(["league", "scheduled_at", "id"]).reset_index(drop=True)
    return df


def _build_team_games_view(games_df: pd.DataFrame) -> pd.DataFrame:
    if games_df.empty:
        return pd.DataFrame(
            columns=[
                "game_id", "league", "scheduled_at", "team_id",
                "opponent_id", "points_for", "points_against", "is_home", "is_win",
            ]
        )

    home_rows = games_df[
        ["id", "league", "scheduled_at", "home_team_id", "away_team_id", "home_score", "away_score"]
    ].copy()
    home_rows.columns = [
        "game_id", "league", "scheduled_at", "team_id",
        "opponent_id", "points_for", "points_against",
    ]
    home_rows["is_home"] = True
    home_rows["is_win"] = home_rows["points_for"] > home_rows["points_against"]

    away_rows = games_df[
        ["id", "league", "scheduled_at", "away_team_id", "home_team_id", "away_score", "home_score"]
    ].copy()
    away_rows.columns = [
        "game_id", "league", "scheduled_at", "team_id",
        "opponent_id", "points_for", "points_against",
    ]
    away_rows["is_home"] = False
    away_rows["is_win"] = away_rows["points_for"] > away_rows["points_against"]

    team_games = pd.concat([home_rows, away_rows], ignore_index=True)
    return team_games.sort_values(["league", "scheduled_at", "game_id"]).reset_index(drop=True)


# ───────────────────────── New helper functions ──────────────────────────

def _compute_rest_days(history: pd.DataFrame, reference_time: pd.Timestamp) -> float:
    """Days since the team's last game. 14.0 if no history."""
    if history.empty:
        return 14.0
    last_game_time = history["scheduled_at"].max()
    if pd.isna(last_game_time):
        return 14.0
    delta = reference_time - last_game_time
    return max(0.0, float(delta.total_seconds() / 86400.0))


def _compute_games_in_window(history: pd.DataFrame, reference_time: pd.Timestamp, days: int = 7) -> int:
    """Count of games in the last N days."""
    if history.empty:
        return 0
    cutoff = reference_time - pd.Timedelta(days=days)
    return int((history["scheduled_at"] >= cutoff).sum())


def _compute_streak(history: pd.DataFrame) -> int:
    """Current streak length. Positive = winning streak, negative = losing."""
    if history.empty:
        return 0
    wins = history["is_win"].values
    if len(wins) == 0:
        return 0
    last_result = wins[-1]
    streak = 0
    for i in range(len(wins) - 1, -1, -1):
        if wins[i] == last_result:
            streak += 1
        else:
            break
    return streak if last_result else -streak


def _compute_opponent_win_rates(
    team_history: pd.DataFrame,
    all_team_games: pd.DataFrame,
    n_recent: int | None = None,
) -> float:
    """Average overall win rate of a team's opponents."""
    subset = team_history.tail(n_recent) if n_recent else team_history
    if subset.empty:
        return 0.5
    opponent_ids = subset["opponent_id"].unique()
    if len(opponent_ids) == 0:
        return 0.5
    opp_rates: list[float] = []
    for opp_id in opponent_ids:
        opp_games = all_team_games[all_team_games["team_id"] == opp_id]
        if opp_games.empty:
            opp_rates.append(0.5)
        else:
            opp_rates.append(float(opp_games["is_win"].mean()))
    return float(np.mean(opp_rates))


# ───────────────────────── Core metrics aggregation ──────────────────────

def _aggregate_team_metrics(
    history: pd.DataFrame,
    *,
    league_avg_points_for: float,
    league_avg_points_against: float,
    home_context: bool,
    all_team_games: pd.DataFrame,
    reference_time: pd.Timestamp,
    league_key: str,
) -> dict[str, float]:
    """Build comprehensive per-team metrics from their game history."""
    split_history = history[history["is_home"] == home_context]
    recent5 = history.tail(RECENT_FORM_WINDOW)
    recent3 = history.tail(3)
    recent10 = history.tail(10)

    # Margins
    margins = history["points_for"] - history["points_against"]
    recent3_margins = recent3["points_for"] - recent3["points_against"] if not recent3.empty else pd.Series(dtype=float)

    # Blowout / close game rates
    blowout_threshold = _BLOWOUT_MARGINS.get(league_key, 10.0)
    close_threshold = _CLOSE_MARGINS.get(league_key, 3.0)
    if not history.empty:
        blowout_wins = ((margins >= blowout_threshold) & history["is_win"]).astype(float)
        blowout_win_rate = float(blowout_wins.sum() / max(1, len(history)))
        close_games = (margins.abs() <= close_threshold).astype(float)
        close_game_rate = float(close_games.sum() / max(1, len(history)))
    else:
        blowout_win_rate = 0.0
        close_game_rate = 0.0

    # Strength of schedule
    avg_opp_wr = _compute_opponent_win_rates(history, all_team_games)
    recent_opp_wr = _compute_opponent_win_rates(history, all_team_games, n_recent=RECENT_FORM_WINDOW)

    return {
        # ── Original ──
        "overall_win_rate": _safe_rate(history["is_win"], 0.5),
        "avg_points_for": _safe_mean(history["points_for"], league_avg_points_for),
        "avg_points_against": _safe_mean(history["points_against"], league_avg_points_against),
        "recent_win_rate": _safe_rate(recent5["is_win"], 0.5),
        "split_win_rate": _safe_rate(split_history["is_win"], 0.5),
        "split_avg_points_for": _safe_mean(split_history["points_for"], league_avg_points_for),
        "split_avg_points_against": _safe_mean(split_history["points_against"], league_avg_points_against),
        # ── Rest & fatigue ──
        "rest_days": _compute_rest_days(history, reference_time),
        "is_back_to_back": 1.0 if _compute_rest_days(history, reference_time) < 1.5 else 0.0,
        "games_last_7d": float(_compute_games_in_window(history, reference_time, 7)),
        # ── Scoring trends ──
        "last3_avg_margin": _safe_mean(recent3_margins, 0.0),
        "last3_avg_pf": _safe_mean(recent3["points_for"] if not recent3.empty else None, league_avg_points_for),
        "last3_avg_pa": _safe_mean(recent3["points_against"] if not recent3.empty else None, league_avg_points_against),
        "streak": float(_compute_streak(history)),
        "win_rate_last10": _safe_rate(recent10["is_win"], 0.5),
        # ── Blowout & volatility ──
        "blowout_win_rate": blowout_win_rate,
        "close_game_rate": close_game_rate,
        "scoring_std": _safe_std(history["points_for"], 0.0),
        # ── Strength of schedule ──
        "avg_opp_win_rate": avg_opp_wr,
        "recent_opp_win_rate": recent_opp_wr,
        # ── Season context ──
        "season_win_pct": _safe_rate(history["is_win"], 0.5),
        # ── Average margin ──
        "avg_margin": _safe_mean(margins, 0.0),
    }


# ───────────────────────── Main feature builder ──────────────────────────

def build_matchup_features(
    games_data: Any,
    home_team_id: str,
    away_team_id: str,
    league: str,
    scheduled_at: datetime | str | pd.Timestamp,
) -> dict[str, float]:
    """Build a single feature vector for a home/away matchup."""
    games_df = prepare_games_dataframe(games_data)
    if games_df.empty:
        return {col: 0.5 if "win_rate" in col or "pct" in col else 0.0 for col in FEATURE_COLUMNS}

    league_key = str(league).upper()
    when = pd.Timestamp(scheduled_at)
    if when.tzinfo is None:
        when = when.tz_localize("UTC")
    else:
        when = when.tz_convert("UTC")

    league_games = games_df[(games_df["league"] == league_key) & (games_df["status"] == "final")].copy()
    history_games = league_games[league_games["scheduled_at"] < when]
    team_games = _build_team_games_view(history_games)

    league_avg_points_for = _safe_mean(team_games["points_for"], 0.0)
    league_avg_points_against = _safe_mean(team_games["points_against"], 0.0)

    home_history = team_games[team_games["team_id"] == str(home_team_id)].sort_values("scheduled_at")
    away_history = team_games[team_games["team_id"] == str(away_team_id)].sort_values("scheduled_at")

    home_metrics = _aggregate_team_metrics(
        home_history,
        league_avg_points_for=league_avg_points_for,
        league_avg_points_against=league_avg_points_against,
        home_context=True,
        all_team_games=team_games,
        reference_time=when,
        league_key=league_key,
    )
    away_metrics = _aggregate_team_metrics(
        away_history,
        league_avg_points_for=league_avg_points_for,
        league_avg_points_against=league_avg_points_against,
        home_context=False,
        all_team_games=team_games,
        reference_time=when,
        league_key=league_key,
    )

    # ── Head-to-head ──
    head_to_head = history_games[
        (
            (history_games["home_team_id"] == str(home_team_id))
            & (history_games["away_team_id"] == str(away_team_id))
        )
        | (
            (history_games["home_team_id"] == str(away_team_id))
            & (history_games["away_team_id"] == str(home_team_id))
        )
    ]

    if head_to_head.empty:
        h2h_home_win_rate = 0.5
        h2h_games = 0.0
        h2h_home_avg_margin = 0.0
        h2h_recent_home_win_rate = 0.5
    else:
        home_wins = (
            (
                (head_to_head["home_team_id"] == str(home_team_id))
                & (head_to_head["home_score"] > head_to_head["away_score"])
            )
            | (
                (head_to_head["away_team_id"] == str(home_team_id))
                & (head_to_head["away_score"] > head_to_head["home_score"])
            )
        ).astype(float)
        h2h_home_win_rate = _safe_rate(home_wins, 0.5)
        h2h_games = float(len(head_to_head))

        # Margin from home team's perspective across all H2H games
        h2h_margins: list[float] = []
        for _, row in head_to_head.iterrows():
            if str(row["home_team_id"]) == str(home_team_id):
                h2h_margins.append(float(row["home_score"] - row["away_score"]))
            else:
                h2h_margins.append(float(row["away_score"] - row["home_score"]))
        h2h_home_avg_margin = float(np.mean(h2h_margins)) if h2h_margins else 0.0

        # Recent H2H (last 4 meetings)
        recent_h2h = head_to_head.tail(4)
        recent_home_wins = (
            (
                (recent_h2h["home_team_id"] == str(home_team_id))
                & (recent_h2h["home_score"] > recent_h2h["away_score"])
            )
            | (
                (recent_h2h["away_team_id"] == str(home_team_id))
                & (recent_h2h["away_score"] > recent_h2h["home_score"])
            )
        ).astype(float)
        h2h_recent_home_win_rate = _safe_rate(recent_home_wins, 0.5)

    # ── Win pct gap ──
    win_pct_gap = home_metrics["season_win_pct"] - away_metrics["season_win_pct"]

    features = {
        # ── Original core ──
        "home_overall_win_rate": home_metrics["overall_win_rate"],
        "away_overall_win_rate": away_metrics["overall_win_rate"],
        "home_avg_points_for": home_metrics["avg_points_for"],
        "home_avg_points_against": home_metrics["avg_points_against"],
        "away_avg_points_for": away_metrics["avg_points_for"],
        "away_avg_points_against": away_metrics["avg_points_against"],
        "home_recent_win_rate": home_metrics["recent_win_rate"],
        "away_recent_win_rate": away_metrics["recent_win_rate"],
        "home_home_win_rate": home_metrics["split_win_rate"],
        "away_away_win_rate": away_metrics["split_win_rate"],
        "home_home_avg_points_for": home_metrics["split_avg_points_for"],
        "home_home_avg_points_against": home_metrics["split_avg_points_against"],
        "away_away_avg_points_for": away_metrics["split_avg_points_for"],
        "away_away_avg_points_against": away_metrics["split_avg_points_against"],
        "head_to_head_home_win_rate": h2h_home_win_rate,
        "head_to_head_games": h2h_games,
        # ── Rest & schedule fatigue ──
        "home_rest_days": home_metrics["rest_days"],
        "away_rest_days": away_metrics["rest_days"],
        "home_is_back_to_back": home_metrics["is_back_to_back"],
        "away_is_back_to_back": away_metrics["is_back_to_back"],
        "home_games_last_7d": home_metrics["games_last_7d"],
        "away_games_last_7d": away_metrics["games_last_7d"],
        # ── Scoring trends & momentum ──
        "home_last3_avg_margin": home_metrics["last3_avg_margin"],
        "away_last3_avg_margin": away_metrics["last3_avg_margin"],
        "home_last3_avg_pf": home_metrics["last3_avg_pf"],
        "away_last3_avg_pf": away_metrics["last3_avg_pf"],
        "home_last3_avg_pa": home_metrics["last3_avg_pa"],
        "away_last3_avg_pa": away_metrics["last3_avg_pa"],
        "home_streak": home_metrics["streak"],
        "away_streak": away_metrics["streak"],
        "home_win_rate_last10": home_metrics["win_rate_last10"],
        "away_win_rate_last10": away_metrics["win_rate_last10"],
        # ── Blowout & volatility ──
        "home_blowout_win_rate": home_metrics["blowout_win_rate"],
        "away_blowout_win_rate": away_metrics["blowout_win_rate"],
        "home_close_game_rate": home_metrics["close_game_rate"],
        "away_close_game_rate": away_metrics["close_game_rate"],
        "home_scoring_std": home_metrics["scoring_std"],
        "away_scoring_std": away_metrics["scoring_std"],
        # ── Strength of schedule ──
        "home_avg_opp_win_rate": home_metrics["avg_opp_win_rate"],
        "away_avg_opp_win_rate": away_metrics["avg_opp_win_rate"],
        "home_recent_opp_win_rate": home_metrics["recent_opp_win_rate"],
        "away_recent_opp_win_rate": away_metrics["recent_opp_win_rate"],
        # ── Standings / season context ──
        "home_season_win_pct": home_metrics["season_win_pct"],
        "away_season_win_pct": away_metrics["season_win_pct"],
        "win_pct_gap": win_pct_gap,
        # ── Extended H2H ──
        "h2h_home_avg_margin": h2h_home_avg_margin,
        "h2h_recent_home_win_rate": h2h_recent_home_win_rate,
        # ── Average margin ──
        "home_avg_margin": home_metrics["avg_margin"],
        "away_avg_margin": away_metrics["avg_margin"],
    }
    return {key: float(features[key]) for key in FEATURE_COLUMNS}


# ───────────────────────── Training dataset builder ──────────────────────

def build_training_dataset(games_data: Any) -> pd.DataFrame:
    """Build a supervised-learning dataset from historical completed games."""
    games_df = prepare_games_dataframe(games_data)
    if games_df.empty:
        return pd.DataFrame(columns=["game_id", "league", *FEATURE_COLUMNS, "label"])

    finals = games_df[games_df["status"] == "final"].copy()
    if finals.empty:
        return pd.DataFrame(columns=["game_id", "league", *FEATURE_COLUMNS, "label"])

    rows: list[dict[str, Any]] = []
    for _, game in finals.iterrows():
        features = build_matchup_features(
            finals,
            home_team_id=str(game["home_team_id"]),
            away_team_id=str(game["away_team_id"]),
            league=str(game["league"]),
            scheduled_at=game["scheduled_at"],
        )
        rows.append(
            {
                "game_id": str(game["id"]),
                "league": str(game["league"]).upper(),
                **features,
                "label": int(game["home_score"] > game["away_score"]),
            }
        )

    return pd.DataFrame(rows)


def build_features(games_data: Any, teams_data: Any | None = None) -> pd.DataFrame:
    """Backwards-compatible alias used by the existing tests and callers."""
    _ = teams_data
    return build_training_dataset(games_data)
