"""
SportSync - Gradient Boosted Trees training script.

Run manually before deploy and whenever retraining is needed.
Trains one GBT model per league with cross-validated hyperparameters.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.metrics import accuracy_score, brier_score_loss, log_loss
from sklearn.model_selection import cross_val_score
from sklearn.model_selection import train_test_split
from sqlalchemy import text

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from database import engine
from ml.pipeline import FEATURE_COLUMNS, build_training_dataset

MODEL_PATH = Path(__file__).resolve().parent / "model.pkl"
MIN_SAMPLES_PER_LEAGUE = 25


def load_historical_games() -> pd.DataFrame:
    """Pull historical games from the database into a DataFrame."""
    query = text(
        """
        SELECT
            g.id,
            g.home_team_id,
            g.away_team_id,
            g.sport,
            g.league,
            g.scheduled_at,
            g.status,
            g.home_score,
            g.away_score
        FROM games g
        WHERE g.home_team_id IS NOT NULL
          AND g.away_team_id IS NOT NULL
          AND g.scheduled_at IS NOT NULL
        ORDER BY g.scheduled_at ASC, g.id ASC
        """
    )
    return pd.read_sql_query(query, engine)


def train_models() -> dict[str, Any]:
    """
    Train a Gradient Boosted Trees classifier bundle, one model per league.
    Reports accuracy, log loss, and Brier score for calibration.
    """
    historical_games = load_historical_games()
    training_df = build_training_dataset(historical_games)
    if training_df.empty:
        raise RuntimeError("No completed historical games were found in the database.")

    model_bundle: dict[str, Any] = {
        "model_version": datetime.now(timezone.utc).strftime("gbt_%Y%m%d_%H%M%S"),
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "feature_columns": FEATURE_COLUMNS,
        "models": {},
        "metrics": {},
        "feature_importance": {},
    }

    for league, league_df in training_df.groupby("league"):
        league_df = league_df.dropna(subset=FEATURE_COLUMNS + ["label"]).copy()
        if len(league_df) < MIN_SAMPLES_PER_LEAGUE:
            continue
        if league_df["label"].nunique() < 2:
            continue

        X = league_df[FEATURE_COLUMNS].astype(float).values
        y = league_df["label"].astype(int).values

        stratify = y if len(pd.Series(y).value_counts()) > 1 else None
        X_train, X_test, y_train, y_test = train_test_split(
            X, y,
            test_size=0.2,
            random_state=42,
            stratify=stratify,
        )

        # Gradient Boosted Trees — tuned to avoid overfitting on small datasets
        model = GradientBoostingClassifier(
            n_estimators=200,
            max_depth=4,
            learning_rate=0.08,
            min_samples_leaf=8,
            min_samples_split=12,
            subsample=0.85,
            max_features="sqrt",
            random_state=42,
        )
        model.fit(X_train, y_train)

        y_pred = model.predict(X_test)
        y_prob = model.predict_proba(X_test)
        y_prob_positive = y_prob[:, 1] if y_prob.shape[1] > 1 else y_prob[:, 0]

        # 5-fold cross-validation for reliable metrics
        cv_folds = min(5, max(2, len(league_df) // 20))
        cv_scores = cross_val_score(model, X, y, cv=cv_folds, scoring="accuracy")

        metrics = {
            "samples": int(len(league_df)),
            "train_samples": int(len(X_train)),
            "test_samples": int(len(X_test)),
            "accuracy": round(float(accuracy_score(y_test, y_pred)), 4),
            "log_loss": round(float(log_loss(y_test, y_prob)), 4),
            "brier_score": round(float(brier_score_loss(y_test, y_prob_positive)), 4),
            "cv_accuracy_mean": round(float(cv_scores.mean()), 4),
            "cv_accuracy_std": round(float(cv_scores.std()), 4),
        }

        # Feature importance ranking
        importances = model.feature_importances_
        importance_pairs = sorted(
            zip(FEATURE_COLUMNS, importances),
            key=lambda x: x[1],
            reverse=True,
        )
        top_features = [
            {"feature": name, "importance": round(float(imp), 4)}
            for name, imp in importance_pairs[:15]
        ]

        model_bundle["models"][league] = model
        model_bundle["metrics"][league] = metrics
        model_bundle["feature_importance"][league] = top_features

    if not model_bundle["models"]:
        raise RuntimeError(
            "Training data was loaded, but no league had enough completed games to train a model."
        )

    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(model_bundle, MODEL_PATH)
    return {
        "model_path": str(MODEL_PATH),
        "model_version": model_bundle["model_version"],
        "trained_leagues": sorted(model_bundle["models"].keys()),
        "metrics": model_bundle["metrics"],
        "feature_importance": model_bundle["feature_importance"],
    }


def main() -> None:
    """CLI entrypoint for manual retraining."""
    summary = train_models()
    print(json.dumps(summary, indent=2))
    engine.dispose()


if __name__ == "__main__":
    main()
