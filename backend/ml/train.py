"""
SportSync - Random Forest training script.

Run manually before deploy and whenever retraining is needed.
Trains one calibrated Random Forest model per league using a temporal
holdout split so the reported metrics reflect future games, not shuffled data.
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
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, brier_score_loss, log_loss, roc_auc_score
from sqlalchemy import select

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from database import engine
from ml.pipeline import FEATURE_COLUMNS, build_training_dataset
from models.game import Game

MODEL_PATH = Path(__file__).resolve().parent / "model.pkl"
MIN_SAMPLES_PER_LEAGUE = 40
TEMPORAL_TEST_FRACTION = 0.2


def load_historical_games() -> pd.DataFrame:
    """Pull historical games from the database into a DataFrame."""
    query = select(
        Game.id,
        Game.home_team_id,
        Game.away_team_id,
        Game.sport,
        Game.league,
        Game.scheduled_at,
        Game.status,
        Game.home_score,
        Game.away_score,
    ).where(
        Game.home_team_id.is_not(None),
        Game.away_team_id.is_not(None),
        Game.scheduled_at.is_not(None),
    ).order_by(
        Game.scheduled_at.asc(),
        Game.id.asc(),
    )
    return pd.read_sql(query, engine)


def _temporal_train_test_split(league_df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    ordered = league_df.sort_values(["scheduled_at", "game_id"]).reset_index(drop=True)
    if len(ordered) < 2:
        return ordered.iloc[:0].copy(), ordered.copy()

    split_idx = int(round(len(ordered) * (1.0 - TEMPORAL_TEST_FRACTION)))
    split_idx = max(1, min(len(ordered) - 1, split_idx))
    train_df = ordered.iloc[:split_idx].copy()
    test_df = ordered.iloc[split_idx:].copy()
    return train_df, test_df


def _calibration_splits(train_df: pd.DataFrame) -> int:
    if len(train_df) >= 300:
        return 4
    if len(train_df) >= 120:
        return 3
    return 2


def _mean_feature_importance(model: CalibratedClassifierCV) -> list[dict[str, float]]:
    importance_vectors: list[np.ndarray] = []
    for calibrated in getattr(model, "calibrated_classifiers_", []):
        estimator = getattr(calibrated, "estimator", None)
        if estimator is not None and hasattr(estimator, "feature_importances_"):
            importance_vectors.append(np.asarray(estimator.feature_importances_, dtype=float))

    if not importance_vectors:
        return []

    averaged = np.mean(np.vstack(importance_vectors), axis=0)
    ranked = sorted(zip(FEATURE_COLUMNS, averaged), key=lambda item: item[1], reverse=True)
    return [
        {"feature": feature, "importance": round(float(importance), 4)}
        for feature, importance in ranked[:15]
    ]


def train_models() -> dict[str, Any]:
    """
    Train one calibrated Random Forest per league.

    The evaluation is time-aware: models train on earlier games and are scored on
    later games, which better matches the real prediction problem.
    """
    historical_games = load_historical_games()
    training_df = build_training_dataset(historical_games)
    if training_df.empty:
        raise RuntimeError("No completed historical games were found in the database.")

    if "scheduled_at" not in training_df.columns:
        raise RuntimeError("Training dataset is missing scheduled_at; retraining cannot continue.")

    training_df["scheduled_at"] = pd.to_datetime(training_df["scheduled_at"], errors="coerce", utc=True)
    training_df = training_df.dropna(subset=["scheduled_at"]).copy()

    model_bundle: dict[str, Any] = {
        "model_version": datetime.now(timezone.utc).strftime("rfcal_%Y%m%d_%H%M%S"),
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "model_type": "RandomForestClassifier+CalibratedClassifierCV",
        "feature_columns": FEATURE_COLUMNS,
        "models": {},
        "metrics": {},
        "feature_importance": {},
    }

    for league, league_df in training_df.groupby("league"):
        league_df = league_df.dropna(subset=FEATURE_COLUMNS + ["label", "scheduled_at"]).copy()
        if len(league_df) < MIN_SAMPLES_PER_LEAGUE:
            continue
        if league_df["label"].nunique() < 2:
            continue

        train_df, test_df = _temporal_train_test_split(league_df)
        if train_df.empty or test_df.empty:
            continue
        if train_df["label"].nunique() < 2:
            continue

        X_train = train_df[FEATURE_COLUMNS].astype(float).values
        y_train = train_df["label"].astype(int).values
        X_test = test_df[FEATURE_COLUMNS].astype(float).values
        y_test = test_df["label"].astype(int).values

        base_model = RandomForestClassifier(
            n_estimators=500,
            max_depth=10,
            min_samples_leaf=4,
            min_samples_split=10,
            max_features="sqrt",
            class_weight="balanced_subsample",
            n_jobs=1,
            random_state=42,
        )
        model = CalibratedClassifierCV(
            estimator=base_model,
            method="sigmoid",
            cv=_calibration_splits(train_df),
        )
        model.fit(X_train, y_train)

        y_pred = model.predict(X_test)
        y_prob = model.predict_proba(X_test)
        y_prob_positive = y_prob[:, 1] if y_prob.shape[1] > 1 else y_prob[:, 0]

        metrics = {
            "samples": int(len(league_df)),
            "train_samples": int(len(train_df)),
            "test_samples": int(len(test_df)),
            "accuracy": round(float(accuracy_score(y_test, y_pred)), 4),
            "log_loss": round(float(log_loss(y_test, y_prob, labels=[0, 1])), 4),
            "brier_score": round(float(brier_score_loss(y_test, y_prob_positive)), 4),
            "auc": round(float(roc_auc_score(y_test, y_prob_positive)), 4) if len(np.unique(y_test)) > 1 else None,
            "train_start": pd.Timestamp(train_df["scheduled_at"].min()).isoformat(),
            "train_end": pd.Timestamp(train_df["scheduled_at"].max()).isoformat(),
            "test_start": pd.Timestamp(test_df["scheduled_at"].min()).isoformat(),
            "test_end": pd.Timestamp(test_df["scheduled_at"].max()).isoformat(),
        }

        model_bundle["models"][league] = model
        model_bundle["metrics"][league] = metrics
        model_bundle["feature_importance"][league] = _mean_feature_importance(model)

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
