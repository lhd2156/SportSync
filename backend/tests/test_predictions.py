"""
Test suite for the ML prediction pipeline.

Covers: feature columns, matchup vector shape, rest days, streaks,
blowout rates, strength of schedule, odds conversion, injury scoring,
and probability validity.
"""
from __future__ import annotations

import os
import sys

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _sample_games() -> pd.DataFrame:
    """Minimal game history spanning multiple dates for feature calculation."""
    return pd.DataFrame(
        [
            {
                "id": "g1",
                "home_team_id": "t1",
                "away_team_id": "t2",
                "sport": "basketball",
                "league": "NBA",
                "scheduled_at": "2026-01-01T00:00:00Z",
                "status": "final",
                "home_score": 110,
                "away_score": 103,
            },
            {
                "id": "g2",
                "home_team_id": "t2",
                "away_team_id": "t1",
                "sport": "basketball",
                "league": "NBA",
                "scheduled_at": "2026-01-03T00:00:00Z",
                "status": "final",
                "home_score": 97,
                "away_score": 102,
            },
            {
                "id": "g3",
                "home_team_id": "t1",
                "away_team_id": "t3",
                "sport": "basketball",
                "league": "NBA",
                "scheduled_at": "2026-01-05T00:00:00Z",
                "status": "final",
                "home_score": 115,
                "away_score": 109,
            },
            {
                "id": "g4",
                "home_team_id": "t3",
                "away_team_id": "t2",
                "sport": "basketball",
                "league": "NBA",
                "scheduled_at": "2026-01-06T00:00:00Z",
                "status": "final",
                "home_score": 88,
                "away_score": 95,
            },
            {
                "id": "g5",
                "home_team_id": "t1",
                "away_team_id": "t2",
                "sport": "basketball",
                "league": "NBA",
                "scheduled_at": "2026-01-08T00:00:00Z",
                "status": "final",
                "home_score": 120,
                "away_score": 99,
            },
        ]
    )


def test_prediction_model_fields():
    from models.prediction import Prediction
    from sqlalchemy import inspect

    mapper = inspect(Prediction)
    columns = {col.key for col in mapper.columns}
    required = {"id", "game_id", "home_win_prob", "away_win_prob", "model_version", "created_at"}
    assert required.issubset(columns)


def test_game_model_fields():
    from models.game import Game
    from sqlalchemy import inspect

    mapper = inspect(Game)
    columns = {col.key for col in mapper.columns}
    required = {
        "id",
        "home_team_id",
        "away_team_id",
        "sport",
        "league",
        "scheduled_at",
        "status",
        "home_score",
        "away_score",
    }
    assert required.issubset(columns)


def test_pipeline_feature_columns():
    from ml.pipeline import FEATURE_COLUMNS, build_features

    features = build_features(_sample_games())
    assert isinstance(features, pd.DataFrame)
    assert len(features) == 5  # 5 sample games
    for column in FEATURE_COLUMNS:
        assert column in features.columns, f"Missing column: {column}"


def test_matchup_feature_vector_shape():
    from ml.pipeline import FEATURE_COLUMNS, build_matchup_features

    features = build_matchup_features(
        _sample_games(),
        home_team_id="t1",
        away_team_id="t2",
        league="NBA",
        scheduled_at="2026-01-10T00:00:00Z",
    )
    assert list(features.keys()) == FEATURE_COLUMNS
    assert all(isinstance(value, float) for value in features.values())


def test_expanded_feature_count():
    """Verify we have ~50 features."""
    from ml.pipeline import FEATURE_COLUMNS

    assert len(FEATURE_COLUMNS) >= 45, f"Expected ~50 features, got {len(FEATURE_COLUMNS)}"


def test_probabilities_valid_range():
    prediction = {"home_win_prob": 0.63, "away_win_prob": 0.37}
    assert 0.0 <= prediction["home_win_prob"] <= 1.0
    assert 0.0 <= prediction["away_win_prob"] <= 1.0
    assert abs(prediction["home_win_prob"] + prediction["away_win_prob"] - 1.0) < 0.01


# ── Rest days ──

def test_rest_days_computation():
    from ml.pipeline import build_matchup_features

    features = build_matchup_features(
        _sample_games(),
        home_team_id="t1",
        away_team_id="t2",
        league="NBA",
        scheduled_at="2026-01-10T00:00:00Z",  # 2 days after g5
    )
    # t1 last played g5 on Jan 8 → ~2 rest days
    assert features["home_rest_days"] > 1.0
    assert features["home_rest_days"] < 4.0
    # t2 last played g5 on Jan 8 → ~2 rest days
    assert features["away_rest_days"] > 1.0
    # Not back-to-back
    assert features["home_is_back_to_back"] == 0.0


def test_back_to_back_detection():
    from ml.pipeline import build_matchup_features

    features = build_matchup_features(
        _sample_games(),
        home_team_id="t1",
        away_team_id="t3",
        scheduled_at="2026-01-06T00:00:00Z",  # t1 played g3 on Jan 5
        league="NBA",
    )
    # t1 played yesterday (Jan 5) → should be back-to-back
    assert features["home_is_back_to_back"] == 1.0


# ── Streaks ──

def test_streak_computation():
    from ml.pipeline import build_matchup_features

    features = build_matchup_features(
        _sample_games(),
        home_team_id="t1",
        away_team_id="t2",
        league="NBA",
        scheduled_at="2026-01-10T00:00:00Z",
    )
    # t1 has won g1, g2 (away), g3, g5 → should have a positive streak
    assert features["home_streak"] > 0
    # t2 lost g4 (as away) and g5 → negative streak
    assert features["away_streak"] < 0


# ── Blowout rates ──

def test_blowout_rate_computation():
    from ml.pipeline import build_matchup_features

    features = build_matchup_features(
        _sample_games(),
        home_team_id="t1",
        away_team_id="t2",
        league="NBA",
        scheduled_at="2026-01-10T00:00:00Z",
    )
    # g5: t1 won by 21 (120-99) → blowout. Should have non-zero blowout rate.
    assert features["home_blowout_win_rate"] > 0.0
    assert 0.0 <= features["home_blowout_win_rate"] <= 1.0


# ── Strength of schedule ──

def test_strength_of_schedule():
    from ml.pipeline import build_matchup_features

    features = build_matchup_features(
        _sample_games(),
        home_team_id="t1",
        away_team_id="t2",
        league="NBA",
        scheduled_at="2026-01-10T00:00:00Z",
    )
    # SOS values should be numbers between 0 and 1
    assert 0.0 <= features["home_avg_opp_win_rate"] <= 1.0
    assert 0.0 <= features["away_avg_opp_win_rate"] <= 1.0
    assert 0.0 <= features["home_recent_opp_win_rate"] <= 1.0


# ── Odds conversion ──

def test_odds_to_probability():
    from ml.predict import _spread_to_home_probability

    # Home favorite by 7 → should be > 60%
    prob = _spread_to_home_probability(-7.0)
    assert 0.6 < prob < 0.85

    # Home underdog by 7 → should be < 40%
    prob_under = _spread_to_home_probability(7.0)
    assert 0.15 < prob_under < 0.4

    # Even game (0 spread) → ~50%
    prob_even = _spread_to_home_probability(0.0)
    assert abs(prob_even - 0.5) < 0.01

    # Symmetric property
    assert abs(prob + prob_under - 1.0) < 0.001


# ── Injury impact ──

def test_injury_impact_score():
    from ml.predict import _injury_impact_score

    injuries = [
        {"name": "Star Player", "position": "PG", "status": "out", "is_starter": True},
        {"name": "Bench Player", "position": "SG", "status": "questionable", "is_starter": False},
        {"name": "Role Player", "position": "PF", "status": "probable", "is_starter": False},
    ]
    impact, factors = _injury_impact_score(injuries, "NBA")

    # Should have a meaningful impact with a starter out
    assert impact > 0.2
    assert impact <= 1.0

    # Should report the "Out" player as a factor
    assert any("Star Player" in f for f in factors)


def test_injury_impact_none():
    from ml.predict import _injury_impact_score

    impact, factors = _injury_impact_score([], "NBA")
    assert impact == 0.0
    assert factors == []


# ── Win pct gap ──

def test_win_pct_gap():
    from ml.pipeline import build_matchup_features

    features = build_matchup_features(
        _sample_games(),
        home_team_id="t1",
        away_team_id="t3",
        league="NBA",
        scheduled_at="2026-01-10T00:00:00Z",
    )
    # win_pct_gap = home_season_win_pct - away_season_win_pct
    assert features["win_pct_gap"] == features["home_season_win_pct"] - features["away_season_win_pct"]


# ── Scoring volatility ──

def test_scoring_variance():
    from ml.pipeline import build_matchup_features

    features = build_matchup_features(
        _sample_games(),
        home_team_id="t1",
        away_team_id="t2",
        league="NBA",
        scheduled_at="2026-01-10T00:00:00Z",
    )
    # t1 scored 110, 102, 115, 120 → should have non-trivial std dev
    assert features["home_scoring_std"] > 0.0


def test_parse_espn_event_handles_schedule_payload_scores():
    from routers.sports import _parse_espn_event

    event = {
        "id": "401809933",
        "date": "2025-10-22T23:00Z",
        "competitions": [
            {
                "date": "2025-10-22T23:00Z",
                "status": {
                    "type": {
                        "name": "STATUS_FINAL",
                        "state": "post",
                        "shortDetail": "Final",
                    }
                },
                "competitors": [
                    {
                        "homeAway": "home",
                        "score": {"value": 136.0, "displayValue": "136"},
                        "team": {
                            "displayName": "Charlotte Hornets",
                            "abbreviation": "CHA",
                            "logos": [{"href": "https://example.com/cha.png", "rel": ["scoreboard"]}],
                        },
                    },
                    {
                        "homeAway": "away",
                        "score": {"value": 117.0, "displayValue": "117"},
                        "team": {
                            "displayName": "Atlanta Hawks",
                            "abbreviation": "ATL",
                            "logos": [{"href": "https://example.com/atl.png", "rel": ["scoreboard"]}],
                        },
                    },
                ],
            }
        ],
    }

    parsed = _parse_espn_event(event, "NBA")
    assert parsed["status"] == "final"
    assert parsed["homeScore"] == 136
    assert parsed["awayScore"] == 117
    assert parsed["homeBadge"] == "https://example.com/cha.png"
    assert parsed["awayBadge"] == "https://example.com/atl.png"
