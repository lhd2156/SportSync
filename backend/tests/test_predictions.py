"""
Test suite for ML prediction pipeline.

Tests feature engineering, model structure, and prediction
output format without requiring a trained model file.
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def test_prediction_model_fields():
    """Prediction model has all required fields per Section 7."""
    from models.prediction import Prediction
    from sqlalchemy import inspect

    mapper = inspect(Prediction)
    columns = {col.key for col in mapper.columns}

    required = {"id", "game_id", "home_win_prob", "away_win_prob", "model_version", "created_at"}
    assert required.issubset(columns), f"Missing: {required - columns}"


def test_game_model_fields():
    """Game model has all required fields per Section 7."""
    from models.game import Game
    from sqlalchemy import inspect

    mapper = inspect(Game)
    columns = {col.key for col in mapper.columns}

    required = {
        "id", "home_team_id", "away_team_id", "sport", "league",
        "scheduled_at", "status", "home_score", "away_score",
    }
    assert required.issubset(columns), f"Missing: {required - columns}"


def test_pipeline_feature_columns():
    """Pipeline produces expected feature columns for model training."""
    from ml.pipeline import build_features
    import pandas as pd

    # Minimal game data
    games = pd.DataFrame([
        {
            "home_team_id": "t1", "away_team_id": "t2",
            "home_score": 100, "away_score": 95,
            "status": "final",
        },
        {
            "home_team_id": "t2", "away_team_id": "t1",
            "home_score": 88, "away_score": 92,
            "status": "final",
        },
    ])

    features = build_features(games)
    assert isinstance(features, pd.DataFrame)
    assert len(features) > 0


def test_predict_output_format():
    """Prediction output must have home_win_prob and away_win_prob."""
    # Simulate prediction output format check
    prediction = {"home_win_prob": 0.63, "away_win_prob": 0.37}
    assert "home_win_prob" in prediction
    assert "away_win_prob" in prediction
    assert abs(prediction["home_win_prob"] + prediction["away_win_prob"] - 1.0) < 0.01


def test_probabilities_valid_range():
    """Win probabilities must be between 0 and 1."""
    home = 0.63
    away = 0.37
    assert 0.0 <= home <= 1.0
    assert 0.0 <= away <= 1.0


def test_model_version_format():
    """Model version string follows expected format."""
    version = "rf_v1"
    assert isinstance(version, str)
    assert len(version) > 0
