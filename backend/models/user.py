"""
SportSync - User ORM Model.

Stores all user account data including auth credentials,
onboarding status, and account lockout tracking.
"""
import uuid
from datetime import datetime

from sqlalchemy import Column, String, Boolean, Integer, DateTime, Date
from sqlalchemy.orm import relationship

from database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    email = Column(String(255), unique=True, nullable=False, index=True)

    # Nullable for Google OAuth users who register without a password
    hashed_password = Column(String, nullable=True)

    # Only set for users who registered via Google OAuth
    google_id = Column(String, nullable=True, unique=True)
    role = Column(String(20), nullable=False, default="user", server_default="user")

    display_name = Column(String(100), nullable=True)
    display_name_normalized = Column(String(100), nullable=True, unique=True, index=True)
    first_name = Column(String(50), nullable=True)
    last_name = Column(String(50), nullable=True)
    date_of_birth = Column(Date, nullable=True)
    gender = Column(String(50), nullable=True)
    profile_picture_url = Column(String, nullable=True)

    # Users cannot access the dashboard until onboarding is complete
    is_onboarded = Column(Boolean, default=False, nullable=False)

    # Account lockout: lock after 5 failed login attempts for 15 minutes
    failed_login_attempts = Column(Integer, default=0, nullable=False)
    locked_until = Column(DateTime, nullable=True)

    last_login_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    saved_teams = relationship("UserTeam", back_populates="user", cascade="all, delete-orphan")
    selected_sports = relationship("UserSport", back_populates="user", cascade="all, delete-orphan")
