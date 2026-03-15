"""
SportSync - ML Model Training.

Trains a Random Forest classifier on historical game data
to predict win probabilities. Model is saved to disk via joblib
and versioned for reproducibility.
"""
import os
import joblib
from datetime import datetime

import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, log_loss

from ml.pipeline import build_features, normalize_features

MODEL_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")
MODEL_VERSION_FORMAT = "rf-v%Y%m%d-%H%M"


def train_model(games_data: list[dict], teams_data: list[dict]) -> dict:
    """
    Train a Random Forest model on historical game outcomes.

    Returns:
        dict with model_version, accuracy, and model_path
    """
    os.makedirs(MODEL_DIR, exist_ok=True)

    # Build and normalize features
    df = build_features(games_data, teams_data)
    if df.empty or len(df) < 20:
        return {"error": "Not enough data to train (need at least 20 completed games)"}

    feature_cols = ["home_win_rate", "away_win_rate", "home_avg_score", "away_avg_score", "home_advantage"]
    X = df[feature_cols].values
    y = df["label"].values

    X = normalize_features(X)

    # Split 80/20 for train/test
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42
    )

    # Train Random Forest
    model = RandomForestClassifier(
        n_estimators=100,
        max_depth=8,
        min_samples_split=5,
        random_state=42,
        n_jobs=-1,
    )
    model.fit(X_train, y_train)

    # Evaluate
    y_pred = model.predict(X_test)
    y_prob = model.predict_proba(X_test)
    accuracy = accuracy_score(y_test, y_pred)

    # Try to compute log loss; handle edge cases
    try:
        loss = log_loss(y_test, y_prob)
    except ValueError:
        loss = None

    # Save model with version timestamp
    model_version = datetime.utcnow().strftime(MODEL_VERSION_FORMAT)
    model_path = os.path.join(MODEL_DIR, f"{model_version}.joblib")
    joblib.dump(model, model_path)

    return {
        "model_version": model_version,
        "model_path": model_path,
        "accuracy": round(accuracy, 4),
        "log_loss": round(loss, 4) if loss else None,
        "training_samples": len(X_train),
        "test_samples": len(X_test),
    }


def get_latest_model_path() -> str | None:
    """Find the most recent trained model file."""
    if not os.path.exists(MODEL_DIR):
        return None

    models = [f for f in os.listdir(MODEL_DIR) if f.endswith(".joblib")]
    if not models:
        return None

    models.sort(reverse=True)
    return os.path.join(MODEL_DIR, models[0])
