"""
SportSync - Predictions Router.

Generates and caches ML win probability predictions for ESPN-backed games.
Enhanced with confidence scoring, factor explanations, injury + odds signals.
Includes ML management endpoints for data seeding and model retraining.
"""
from __future__ import annotations

import asyncio
import logging
import math
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from database import SessionLocal, get_db
from dependencies import get_current_user, require_admin
from ml.predict import ensure_prediction_game, get_prediction_model_version, predict_game_probabilities
from models.game import Game
from models.prediction import Prediction
from models.team import Team
from models.user import User
from schemas.sports import PredictionResponse
from schemas.common import PredictionBatchRequest
from services.cache_service import get_cached, set_cached

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/predict", tags=["predictions"])

# Max seconds to wait for game sync + feature generation before giving up.
_PREDICTION_TIMEOUT_SECONDS = 12.0
_PREDICTION_CACHE_VERSION = "v3"
_PREDICTION_LIVE_TTL_SECONDS = 12
_PREDICTION_UPCOMING_TTL_SECONDS = 900
_PREDICTION_FINAL_TTL_SECONDS = 21600
_PREDICTION_REQUEST_CACHE_VERSION = "v1"
_PREDICTION_BATCH_CONCURRENCY = 5
_FALLBACK_MODEL_VERSION = "fallback_v1"
_FALLBACK_MARGIN_SCALES = {
    "NFL": 7.0,
    "NBA": 11.0,
    "MLB": 2.0,
    "NHL": 1.5,
    "EPL": 1.0,
}


def _prediction_ttl_for_status(status: str | None) -> int:
    normalized = str(status or "").lower().strip()
    if normalized == "live":
        return _PREDICTION_LIVE_TTL_SECONDS
    if normalized == "final":
        return _PREDICTION_FINAL_TTL_SECONDS
    return _PREDICTION_UPCOMING_TTL_SECONDS


def _current_model_version() -> str:
    try:
        return get_prediction_model_version()
    except Exception:
        return "model_unknown"


def _prediction_cache_key(game: Game) -> str:
    return (
        f"prediction:{_PREDICTION_CACHE_VERSION}:{game.id}:"
        f"{_current_model_version()}:{str(game.status or '').lower()}:"
        f"{int(game.home_score or 0)}:{int(game.away_score or 0)}"
    )


def _prediction_request_cache_key(game_id: str, league_hint: str | None = None) -> str:
    normalized_league = str(league_hint or "").upper().strip() or "UNKNOWN"
    return f"prediction_request:{_PREDICTION_REQUEST_CACHE_VERSION}:{normalized_league}:{str(game_id)}"


def _prediction_payload_from_values(
    *,
    game_id: str,
    home_win_prob: float,
    away_win_prob: float,
    model_version: str,
    confidence: float | None = None,
    factors: list[str] | None = None,
    created_at: datetime | None = None,
) -> dict:
    payload = {
        "game_id": str(game_id),
        "home_win_prob": float(home_win_prob),
        "away_win_prob": float(away_win_prob),
        "model_version": str(model_version),
        "created_at": (created_at or datetime.utcnow()).isoformat(),
    }
    if confidence is not None:
        payload["confidence"] = float(confidence)
    if factors:
        payload["factors"] = list(factors)
    return payload


def _clamp_probability(value: float, floor: float = 0.02, ceiling: float = 0.98) -> float:
    return max(floor, min(ceiling, float(value)))


def _fallback_prediction_values(game: Game) -> dict[str, Any]:
    league_key = str(game.league or "").upper().strip()
    status = str(game.status or "").lower().strip()
    home_score = int(game.home_score or 0)
    away_score = int(game.away_score or 0)
    margin = home_score - away_score
    scale = float(_FALLBACK_MARGIN_SCALES.get(league_key, 8.0))

    if status == "final":
        if margin > 0:
            home_win_prob = 0.995
        elif margin < 0:
            home_win_prob = 0.005
        else:
            home_win_prob = 0.5
        confidence = 0.99
        factors = [
            "Fallback inference used while a league-specific model is unavailable.",
            "Final score outcome anchors the probability estimate.",
        ]
    elif status == "live":
        logistic_home = 1.0 / (1.0 + math.exp(-(margin / max(scale, 0.5))))
        home_win_prob = _clamp_probability((0.88 * logistic_home) + 0.0624)
        confidence = round(
            min(0.9, 0.55 + min(abs(margin) / max(scale * 2.0, 1.0), 1.0) * 0.3),
            4,
        )
        factors = [
            "Fallback inference used while a league-specific model is unavailable.",
            "Live score margin is shaping the current win estimate.",
        ]
    else:
        home_win_prob = 0.52
        confidence = 0.52
        factors = [
            "Fallback inference used while a league-specific model is unavailable.",
            "Pre-game estimate applies a modest home-side baseline edge.",
        ]

    away_win_prob = round(1.0 - home_win_prob, 4)
    return {
        "home_win_prob": round(home_win_prob, 4),
        "away_win_prob": away_win_prob,
        "model_version": _FALLBACK_MODEL_VERSION,
        "confidence": confidence,
        "factors": factors,
    }


def _read_cached_prediction(game: Game) -> dict | None:
    cached = get_cached(_prediction_cache_key(game))
    if isinstance(cached, dict) and "home_win_prob" in cached and "away_win_prob" in cached:
        return cached
    return None


def _read_request_cached_prediction(game_id: str, league_hint: str | None = None) -> dict | None:
    cached = get_cached(_prediction_request_cache_key(game_id, league_hint))
    if isinstance(cached, dict) and "home_win_prob" in cached and "away_win_prob" in cached:
        return cached
    return None


def _write_cached_prediction(game: Game, payload: dict) -> None:
    set_cached(_prediction_cache_key(game), payload, _prediction_ttl_for_status(game.status))
    set_cached(
        _prediction_request_cache_key(str(game.id), getattr(game, "league", None)),
        payload,
        _prediction_ttl_for_status(game.status),
    )


def _prediction_payload_from_record(game: Game, prediction: Prediction | None) -> dict | None:
    if not prediction:
        return None
    if str(prediction.model_version or "") != _current_model_version():
        return None

    age_seconds = (datetime.utcnow() - prediction.created_at).total_seconds()
    if age_seconds > _prediction_ttl_for_status(game.status):
        return None

    return _prediction_payload_from_values(
        game_id=str(game.id),
        home_win_prob=prediction.home_win_prob,
        away_win_prob=prediction.away_win_prob,
        model_version=prediction.model_version,
        created_at=prediction.created_at,
    )


@router.get("/ml/status", response_model=dict[str, Any])
async def ml_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Check the current state of ML training data and model."""
    rows = (
        db.query(Game.league, Game.status, func.count(Game.id))
        .group_by(Game.league, Game.status)
        .order_by(Game.league, Game.status)
        .all()
    )

    game_counts = {}
    for row in rows:
        league = row[0]
        status = row[1]
        count = row[2]
        if league not in game_counts:
            game_counts[league] = {}
        game_counts[league][status] = count

    team_count = db.query(Team).count()

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


@router.post("/ml/seed", response_model=dict[str, Any])
async def ml_seed(
    league: str = Query(default="ALL", description="League to seed (NBA, NFL, NHL, MLB, EPL, or ALL)"),
    current_user: User = Depends(require_admin),
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


@router.post("/ml/retrain", response_model=dict[str, Any])
async def ml_retrain(current_user: User = Depends(require_admin)):
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


@router.post("/batch", response_model=dict[str, dict[str, dict[str, Any]]])
async def get_predictions_batch(
    body: PredictionBatchRequest,
    db: Session = Depends(get_db),
):
    """
    Batch prediction endpoint - accepts {"game_ids": [...], "leagues": {...}} and
    returns predictions for all requested games.
    """
    game_ids = body.game_ids
    leagues = body.leagues  # optional map of game_id -> league hint
    if not game_ids:
        return {"predictions": {}}

    # Cap at 30 games per batch to prevent abuse
    game_ids = game_ids[:30]
    predictions: dict[str, dict] = {}
    unresolved_game_ids: list[str] = []

    for game_id in game_ids:
        cached_payload = _read_request_cached_prediction(str(game_id), leagues.get(str(game_id)))
        if cached_payload:
            predictions[str(game_id)] = cached_payload
            continue
        unresolved_game_ids.append(str(game_id))

    if not unresolved_game_ids:
        return {"predictions": predictions}

    local_games = {
        str(game.id): game
        for game in db.query(Game).filter(Game.id.in_(unresolved_game_ids)).all()
    }
    existing_predictions = {
        str(prediction.game_id): prediction
        for prediction in db.query(Prediction).filter(Prediction.game_id.in_(list(local_games.keys()))).all()
    }
    pending_game_ids: list[str] = []

    for game_id in unresolved_game_ids:
        local_game = local_games.get(str(game_id))
        if not local_game:
            pending_game_ids.append(str(game_id))
            continue

        cached_payload = _read_cached_prediction(local_game)
        if cached_payload:
            predictions[str(game_id)] = cached_payload
            continue

        stored_payload = _prediction_payload_from_record(local_game, existing_predictions.get(str(game_id)))
        if stored_payload:
            _write_cached_prediction(local_game, stored_payload)
            predictions[str(game_id)] = stored_payload
            continue

        pending_game_ids.append(str(game_id))

    semaphore = asyncio.Semaphore(_PREDICTION_BATCH_CONCURRENCY)

    async def predict_one(game_id: str) -> tuple[str, dict | None]:
        async with semaphore:
            session = SessionLocal()
            try:
                league_hint = leagues.get(game_id)
                game = await asyncio.wait_for(
                    ensure_prediction_game(session, game_id, league_hint=league_hint),
                    timeout=_PREDICTION_TIMEOUT_SECONDS,
                )
                try:
                    prediction_data = await predict_game_probabilities(session, game)
                except RuntimeError:
                    prediction_data = _fallback_prediction_values(game)

                prediction = session.query(Prediction).filter(Prediction.game_id == game.id).first()
                if not prediction:
                    prediction = Prediction(
                        game_id=game.id,
                        home_win_prob=prediction_data["home_win_prob"],
                        away_win_prob=prediction_data["away_win_prob"],
                        model_version=prediction_data["model_version"],
                        created_at=datetime.utcnow(),
                    )
                    session.add(prediction)
                else:
                    prediction.home_win_prob = prediction_data["home_win_prob"]
                    prediction.away_win_prob = prediction_data["away_win_prob"]
                    prediction.model_version = prediction_data["model_version"]
                    prediction.created_at = datetime.utcnow()
                session.commit()
                session.refresh(game)

                payload = _prediction_payload_from_values(
                    game_id=str(game.id),
                    home_win_prob=prediction_data["home_win_prob"],
                    away_win_prob=prediction_data["away_win_prob"],
                    model_version=prediction_data["model_version"],
                    confidence=prediction_data.get("confidence"),
                    factors=prediction_data.get("factors"),
                    created_at=prediction.created_at,
                )
                _write_cached_prediction(game, payload)
                return game_id, payload
            except Exception as exc:
                session.rollback()
                logger.debug("Batch prediction failed for %s: %s", game_id, exc)
                return game_id, None
            finally:
                session.close()

    if pending_game_ids:
        results = await asyncio.gather(*(predict_one(pending_game_id) for pending_game_id in pending_game_ids))
        for game_id, data in results:
            if data is not None:
                predictions[game_id] = data
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
    request_cached_payload = _read_request_cached_prediction(str(game_id), league)
    if request_cached_payload:
        cached_created_at = request_cached_payload.get("created_at")
        try:
            created_at = datetime.fromisoformat(str(cached_created_at))
        except Exception:
            created_at = datetime.utcnow()
        return PredictionResponse(
            id=str(game_id),
            game_id=str(request_cached_payload["game_id"]),
            home_win_prob=float(request_cached_payload["home_win_prob"]),
            away_win_prob=float(request_cached_payload["away_win_prob"]),
            model_version=str(request_cached_payload["model_version"]),
            created_at=created_at,
            confidence=request_cached_payload.get("confidence"),
            factors=request_cached_payload.get("factors"),
        )

    existing_game = db.query(Game).filter(Game.id == str(game_id)).first()
    if existing_game:
        cached_payload = _read_cached_prediction(existing_game)
        if cached_payload:
            cached_created_at = cached_payload.get("created_at")
            try:
                created_at = datetime.fromisoformat(str(cached_created_at))
            except Exception:
                created_at = existing_game.prediction.created_at if existing_game.prediction else datetime.utcnow()
            return PredictionResponse(
                id=str(existing_game.prediction.id) if existing_game.prediction else str(game_id),
                game_id=str(cached_payload["game_id"]),
                home_win_prob=float(cached_payload["home_win_prob"]),
                away_win_prob=float(cached_payload["away_win_prob"]),
                model_version=str(cached_payload["model_version"]),
                created_at=created_at,
                confidence=cached_payload.get("confidence"),
                factors=cached_payload.get("factors"),
            )

        stored_payload = _prediction_payload_from_record(existing_game, existing_game.prediction)
        if stored_payload:
            _write_cached_prediction(existing_game, stored_payload)
            return PredictionResponse(
                id=str(existing_game.prediction.id),
                game_id=str(stored_payload["game_id"]),
                home_win_prob=float(stored_payload["home_win_prob"]),
                away_win_prob=float(stored_payload["away_win_prob"]),
                model_version=str(stored_payload["model_version"]),
                created_at=existing_game.prediction.created_at,
                confidence=stored_payload.get("confidence"),
                factors=stored_payload.get("factors"),
            )

    try:
        game = await asyncio.wait_for(
            ensure_prediction_game(db, game_id, league_hint=league),
            timeout=_PREDICTION_TIMEOUT_SECONDS,
        )
        # predict_game_probabilities is now async (fetches injuries/odds)
        try:
            prediction_data = await predict_game_probabilities(db, game)
        except RuntimeError:
            prediction_data = _fallback_prediction_values(game)
    except asyncio.TimeoutError:
        raise HTTPException(
            status_code=504,
            detail="Prediction timed out while syncing game data. Try again shortly.",
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Prediction inference failed for game %s", game_id)
        raise HTTPException(
            status_code=503,
            detail="Prediction service is temporarily unavailable. Try again shortly.",
        ) from exc

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
    payload = _prediction_payload_from_values(
        game_id=str(prediction.game_id),
        home_win_prob=prediction.home_win_prob,
        away_win_prob=prediction.away_win_prob,
        model_version=prediction.model_version,
        confidence=prediction_data.get("confidence"),
        factors=prediction_data.get("factors"),
        created_at=prediction.created_at,
    )
    _write_cached_prediction(game, payload)

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
