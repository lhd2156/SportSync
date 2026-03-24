"""
SportSync - Prediction ORM Model.

Stores ML model output for each game matchup.
One prediction per game, tracking the model version for reproducibility.
"""
import uuid
from datetime import datetime

from sqlalchemy import Column, String, Float, DateTime, ForeignKey
from sqlalchemy.orm import relationship

from database import Base


class Prediction(Base):
    __tablename__ = "predictions"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    game_id = Column(String(36), ForeignKey("games.id"), nullable=False, unique=True)
    home_win_prob = Column(Float, nullable=False)
    away_win_prob = Column(Float, nullable=False)
    model_version = Column(String(50), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    game = relationship("Game", back_populates="prediction")
