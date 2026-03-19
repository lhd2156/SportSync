"""
SportSync - Team and Game Schemas.

Pydantic models for teams, games, scores, and prediction responses.
"""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class TeamResponse(BaseModel):
    id: str
    external_id: str
    name: str
    short_name: Optional[str] = None
    sport: str
    league: str
    logo_url: Optional[str] = None
    city: Optional[str] = None
    record: Optional[str] = None
    color: Optional[str] = None

    class Config:
        from_attributes = True


class GameResponse(BaseModel):
    id: str
    home_team: TeamResponse
    away_team: TeamResponse
    sport: str
    league: str
    scheduled_at: datetime
    status: str
    home_score: int
    away_score: int

    class Config:
        from_attributes = True


class PredictionResponse(BaseModel):
    id: str
    game_id: str
    home_win_prob: float
    away_win_prob: float
    model_version: str
    created_at: datetime

    class Config:
        from_attributes = True


class ScoreEventSchema(BaseModel):
    game_id: str
    home_team: str
    away_team: str
    home_score: int
    away_score: int
    status: str
    sport: str
    league: str
