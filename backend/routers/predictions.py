"""
SportSync - Predictions Router.

Generates and caches ML win probability predictions for ESPN-backed games.
Enhanced with confidence scoring, factor explanations, injury + odds signals.
Includes ML management endpoints for data seeding and model retraining.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from database import get_db
from ml.predict import ensure_prediction_game, predict_game_probabilities
from models.prediction import Prediction
from schemas.sports import PredictionResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/predict", tags=["predictions"])

# Max seconds to wait for game sync + feature generation before giving up.
_PREDICTION_TIMEOUT_SECONDS = 12.0


@router.get("/ml/status")
async def ml_status(db: Session = Depends(get_db)):
    """Check the current state of ML training data and model."""
    rows = db.execute(
        text("SELECT league, status, COUNT(*) as cnt FROM games GROUP BY league, status ORDER BY league, status")
    ).fetchall()

    game_counts = {}
    for row in rows:
        league = row[0]
        status = row[1]
        count = row[2]
        if league not in game_counts:
            game_counts[league] = {}
        game_counts[league][status] = count

    team_count = db.execute(text("SELECT COUNT(*) FROM teams")).scalar()

    # Try to load model info
    model_info = {}
    try:
        from ml.predict import load_model_bundle
        bundle = load_model_bundle()
        model_info = {
            "model_version": bundle.get("model_version"),
            "trained_at": bundle.get("trained_at"),
            "leagues": sorted(bundle.get("models", {}).keys()),
            "metrics": bundle.get("metrics", {}),
        }
    except Exception as e:
        model_info = {"error": str(e)}

    return {
        "game_counts": game_counts,
        "total_teams": team_count,
        "model": model_info,
    }


@router.post("/ml/seed")
async def ml_seed(
    league: str = Query(default="ALL", description="League to seed (NBA, NFL, NHL, MLB, EPL, or ALL)"),
):
    """Seed the database with full season data from ESPN for ML training."""
    from ml.seed_data import seed_league, LEAGUES as SEED_LEAGUES

    league_upper = league.upper()
    if league_upper == "ALL":
        leagues_to_seed = list(SEED_LEAGUES.keys())
    elif league_upper in SEED_LEAGUES:
        leagues_to_seed = [league_upper]
    else:
        raise HTTPException(status_code=400, detail=f"Unknown league: {league}. Use NBA, NFL, NHL, MLB, EPL, or ALL")

    results = {}
    for lk in leagues_to_seed:
        try:
            stats = seed_league(lk)
            results[lk] = stats
        except Exception as e:
            logger.error("Seed failed for %s: %s", lk, e)
            results[lk] = {"error": str(e)}

    return {"status": "completed", "results": results}


@router.post("/ml/retrain")
async def ml_retrain():
    """Retrain the ML model using all available data in the database."""
    try:
        from ml.train import train_models
        summary = train_models()
        # Force reload the model on next prediction
        from ml import predict as _predict_mod
        _predict_mod._MODEL_BUNDLE = None
        _predict_mod._MODEL_MTIME = None
        return {"status": "success", "summary": summary}
    except Exception as e:
        logger.error("Retrain failed: %s", e)
        raise HTTPException(status_code=500, detail=f"Retrain failed: {e}")


@router.post("/batch")
async def get_predictions_batch(
    body: dict,
    db: Session = Depends(get_db),
):
    """
    Batch prediction endpoint — accepts {"game_ids": [...], "leagues": {...}} and
    returns predictions for all games concurrently.
    """
    game_ids = body.get("game_ids", [])
    leagues = body.get("leagues", {})  # optional map of game_id -> league hint
    if not game_ids or not isinstance(game_ids, list):
        return {"predictions": {}}

    # Cap at 30 games per batch to prevent abuse
    game_ids = game_ids[:30]

    async def predict_one(game_id: str) -> tuple[str, dict | None]:
        try:
            league_hint = leagues.get(game_id)
            game = await asyncio.wait_for(
                ensure_prediction_game(db, game_id, league_hint=league_hint),
                timeout=_PREDICTION_TIMEOUT_SECONDS,
            )
            prediction_data = await predict_game_probabilities(db, game)

            # Upsert prediction record
            prediction = db.query(Prediction).filter(Prediction.game_id == game.id).first()
            if not prediction:
                prediction = Prediction(
                    game_id=game.id,
                    home_win_prob=prediction_data["home_win_prob"],
                    away_win_prob=prediction_data["away_win_prob"],
                    model_version=prediction_data["model_version"],
                    created_at=datetime.utcnow(),
                )
                db.add(prediction)
            else:
                prediction.home_win_prob = prediction_data["home_win_prob"]
                prediction.away_win_prob = prediction_data["away_win_prob"]
                prediction.model_version = prediction_data["model_version"]
                prediction.created_at = datetime.utcnow()
            db.commit()

            return game_id, {
                "game_id": str(game.id),
                "home_win_prob": prediction_data["home_win_prob"],
                "away_win_prob": prediction_data["away_win_prob"],
                "model_version": prediction_data["model_version"],
                "confidence": prediction_data.get("confidence"),
                "factors": prediction_data.get("factors"),
            }
        except Exception as exc:
            logger.debug("Batch prediction failed for %s: %s", game_id, exc)
            return game_id, None

    results = await asyncio.gather(*[predict_one(gid) for gid in game_ids])
    predictions = {gid: data for gid, data in results if data is not None}
    return {"predictions": predictions}


@router.get("/{game_id}", response_model=PredictionResponse)
async def get_prediction(
    game_id: str,
    league: str | None = Query(default=None, description="Optional league hint, e.g. MLB or NBA"),
    db: Session = Depends(get_db),
):
    """
    Get the ML win probability prediction for a game.

    If the game does not exist locally yet, sync it from ESPN first, then compute
    and persist the prediction in the predictions table.

    Returns probabilities, confidence score, and human-readable factor explanations.
    """
    try:
        game = await asyncio.wait_for(
            ensure_prediction_game(db, game_id, league_hint=league),
            timeout=_PREDICTION_TIMEOUT_SECONDS,
        )
        # predict_game_probabilities is now async (fetches injuries/odds)
        prediction_data = await predict_game_probabilities(db, game)
    except asyncio.TimeoutError:
        raise HTTPException(
            status_code=504,
            detail="Prediction timed out while syncing game data. Try again shortly.",
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    prediction = db.query(Prediction).filter(Prediction.game_id == game.id).first()
    if not prediction:
        prediction = Prediction(
            game_id=game.id,
            home_win_prob=prediction_data["home_win_prob"],
            away_win_prob=prediction_data["away_win_prob"],
            model_version=prediction_data["model_version"],
            created_at=datetime.utcnow(),
        )
        db.add(prediction)
    else:
        prediction.home_win_prob = prediction_data["home_win_prob"]
        prediction.away_win_prob = prediction_data["away_win_prob"]
        prediction.model_version = prediction_data["model_version"]
        prediction.created_at = datetime.utcnow()

    db.commit()
    db.refresh(prediction)

    return PredictionResponse(
        id=str(prediction.id),
        game_id=str(prediction.game_id),
        home_win_prob=prediction.home_win_prob,
        away_win_prob=prediction.away_win_prob,
        model_version=prediction.model_version,
        created_at=prediction.created_at,
        confidence=prediction_data.get("confidence"),
        factors=prediction_data.get("factors"),
    )
