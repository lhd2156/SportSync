"""
SportSync - Team ORM Model.

Stores team metadata synced from TheSportsDB.
Each team has an external ID for API lookups and rich display data.
"""
import uuid
from datetime import datetime

from sqlalchemy import Column, String, DateTime
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from database import Base


class Team(Base):
    __tablename__ = "teams"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    external_id = Column(String, nullable=False, unique=True, index=True)
    name = Column(String(100), nullable=False)
    short_name = Column(String(10), nullable=True)
    sport = Column(String(50), nullable=False, index=True)
    league = Column(String(50), nullable=False, index=True)
    logo_url = Column(String, nullable=True)
    city = Column(String(100), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    saved_by_users = relationship("UserTeam", back_populates="team", cascade="all, delete-orphan")


class UserTeam(Base):
    """Many-to-many relationship between users and their saved teams."""
    __tablename__ = "user_teams"

    user_id = Column(UUID(as_uuid=True), primary_key=True)
    team_id = Column(UUID(as_uuid=True), primary_key=True)
    saved_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    user = relationship("User", back_populates="saved_teams")
    team = relationship("Team", back_populates="saved_by_users")


class UserSport(Base):
    """Sports a user selected during onboarding step 2."""
    __tablename__ = "user_sports"

    user_id = Column(UUID(as_uuid=True), primary_key=True)
    sport = Column(String(50), primary_key=True)

    user = relationship("User", back_populates="selected_sports")
