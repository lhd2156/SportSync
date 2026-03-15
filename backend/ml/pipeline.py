"""
SportSync - ML Pipeline: Feature Engineering.

Transforms raw game and team data into features suitable for
the prediction model. Uses Pandas for data manipulation and
NumPy for normalization.
"""
import numpy as np
import pandas as pd
from typing import Optional


def build_features(games_data: list[dict], teams_data: list[dict]) -> pd.DataFrame:
    """
    Build a feature matrix from historical game data.

    Features per game:
    - home_win_rate: rolling 10-game home win percentage
    - away_win_rate: rolling 10-game away win percentage
    - home_avg_score: rolling 10-game home team average score
    - away_avg_score: rolling 10-game away team average score
    - head_to_head_ratio: historical h2h win ratio between teams
    - home_advantage: binary indicator
    """
    if not games_data:
        return pd.DataFrame()

    df = pd.DataFrame(games_data)

    # Only use completed games for training
    df = df[df["status"] == "final"].copy()
    if df.empty:
        return pd.DataFrame()

    # Calculate winner
    df["home_win"] = (df["home_score"] > df["away_score"]).astype(int)

    # Build rolling stats per team
    features = []
    for _, game in df.iterrows():
        home_id = game["home_team_id"]
        away_id = game["away_team_id"]

        # Home team recent performance
        home_recent = df[
            ((df["home_team_id"] == home_id) | (df["away_team_id"] == home_id))
        ].tail(10)

        home_wins = home_recent[
            ((home_recent["home_team_id"] == home_id) & (home_recent["home_win"] == 1)) |
            ((home_recent["away_team_id"] == home_id) & (home_recent["home_win"] == 0))
        ].shape[0]

        home_win_rate = home_wins / max(len(home_recent), 1)

        # Away team recent performance
        away_recent = df[
            ((df["home_team_id"] == away_id) | (df["away_team_id"] == away_id))
        ].tail(10)

        away_wins = away_recent[
            ((away_recent["home_team_id"] == away_id) & (away_recent["home_win"] == 1)) |
            ((away_recent["away_team_id"] == away_id) & (away_recent["home_win"] == 0))
        ].shape[0]

        away_win_rate = away_wins / max(len(away_recent), 1)

        # Average scores
        home_scores = df[df["home_team_id"] == home_id]["home_score"].tail(10)
        away_scores = df[df["away_team_id"] == away_id]["away_score"].tail(10)

        features.append({
            "game_id": game.get("id", ""),
            "home_win_rate": home_win_rate,
            "away_win_rate": away_win_rate,
            "home_avg_score": home_scores.mean() if len(home_scores) > 0 else 0,
            "away_avg_score": away_scores.mean() if len(away_scores) > 0 else 0,
            "home_advantage": 1.0,
            "label": game["home_win"],
        })

    return pd.DataFrame(features)


def normalize_features(X: np.ndarray) -> np.ndarray:
    """Min-max normalize features to [0, 1] range."""
    mins = X.min(axis=0)
    maxs = X.max(axis=0)
    ranges = maxs - mins

    # Avoid division by zero for constant features
    ranges[ranges == 0] = 1

    return (X - mins) / ranges
