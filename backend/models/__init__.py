"""
SportSync - Model Registry.

Import all models here so SQLAlchemy discovers them for migrations.
"""
from models.user import User
from models.team import Team, UserTeam, UserSport
from models.game import Game
from models.prediction import Prediction

__all__ = ["User", "Team", "UserTeam", "UserSport", "Game", "Prediction"]
