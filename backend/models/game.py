"""
SportSync - Game ORM Model.

Stores game schedule, live scores, and final results.
Linked to teams via foreign keys for home and away sides.
"""
import uuid
from datetime import datetime

from sqlalchemy import Column, String, Integer, DateTime, ForeignKey
from sqlalchemy.orm import relationship

from database import Base


class Game(Base):
    __tablename__ = "games"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    home_team_id = Column(String(36), ForeignKey("teams.id"), nullable=False)
    away_team_id = Column(String(36), ForeignKey("teams.id"), nullable=False)
    sport = Column(String(50), nullable=False, index=True)
    league = Column(String(50), nullable=False, index=True)
    scheduled_at = Column(DateTime, nullable=False, index=True)

    # Status: scheduled, live, final, postponed
    status = Column(String(20), default="scheduled", nullable=False)
    home_score = Column(Integer, default=0, nullable=False)
    away_score = Column(Integer, default=0, nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    home_team = relationship("Team", foreign_keys=[home_team_id])
    away_team = relationship("Team", foreign_keys=[away_team_id])
    prediction = relationship("Prediction", back_populates="game", uselist=False)
