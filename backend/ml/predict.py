"""
SportSync - ML Prediction Inference.

Loads the trained model and generates win probability predictions
for upcoming games. Results are stored in the predictions table.
"""
import joblib
import numpy as np

from ml.pipeline import normalize_features
from ml.train import get_latest_model_path


def predict_game(
    home_win_rate: float,
    away_win_rate: float,
    home_avg_score: float,
    away_avg_score: float,
) -> dict | None:
    """
    Generate win probability prediction for a single game.

    Returns:
        dict with home_win_prob, away_win_prob, model_version or None if no model
    """
    model_path = get_latest_model_path()
    if not model_path:
        return None

    model = joblib.load(model_path)

    features = np.array([[
        home_win_rate,
        away_win_rate,
        home_avg_score,
        away_avg_score,
        1.0,  # home advantage indicator
    ]])

    features = normalize_features(features)

    probabilities = model.predict_proba(features)[0]

    # Extract model version from filename
    model_version = model_path.split("/")[-1].replace(".joblib", "")

    # probabilities[0] = away win, probabilities[1] = home win
    # (because label 0 = away win, 1 = home win)
    home_win_prob = float(probabilities[1]) if len(probabilities) > 1 else 0.5
    away_win_prob = float(probabilities[0]) if len(probabilities) > 1 else 0.5

    return {
        "home_win_prob": round(home_win_prob, 4),
        "away_win_prob": round(away_win_prob, 4),
        "model_version": model_version,
    }
