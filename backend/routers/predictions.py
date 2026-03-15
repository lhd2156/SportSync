"""
SportSync - Predictions Router.

ML prediction endpoint returning win probability for a game matchup.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models.game import Game
from models.prediction import Prediction
from schemas.sports import PredictionResponse

router = APIRouter(prefix="/api/predict", tags=["predictions"])


@router.get("/{game_id}", response_model=PredictionResponse)
async def get_prediction(game_id: str, db: Session = Depends(get_db)):
    """
    Get the ML win probability prediction for a game.
    Returns cached prediction if one exists, otherwise generates one.
    """
    game = db.query(Game).filter(Game.id == game_id).first()
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")

    prediction = db.query(Prediction).filter(Prediction.game_id == game_id).first()
    if not prediction:
        raise HTTPException(
            status_code=404,
            detail="No prediction available for this game",
        )

    return PredictionResponse(
        id=str(prediction.id),
        game_id=str(prediction.game_id),
        home_win_prob=prediction.home_win_prob,
        away_win_prob=prediction.away_win_prob,
        model_version=prediction.model_version,
        created_at=prediction.created_at,
    )
