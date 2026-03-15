"""Initial database schema - all tables for SportSync v0.1

Revision ID: 001
Revises: None
Create Date: 2026-03-14
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Users table stores all account data including auth and onboarding state
    op.create_table(
        "users",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("email", sa.String(255), unique=True, nullable=False, index=True),
        sa.Column("hashed_password", sa.String, nullable=True),
        sa.Column("google_id", sa.String, nullable=True, unique=True),
        sa.Column("display_name", sa.String(100), nullable=True),
        sa.Column("date_of_birth", sa.Date, nullable=True),
        sa.Column("gender", sa.String(50), nullable=True),
        sa.Column("profile_picture_url", sa.String, nullable=True),
        sa.Column("is_onboarded", sa.Boolean, default=False, nullable=False),
        sa.Column("failed_login_attempts", sa.Integer, default=0, nullable=False),
        sa.Column("locked_until", sa.DateTime, nullable=True),
        sa.Column("last_login_at", sa.DateTime, nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False),
    )

    # Teams table synced from TheSportsDB
    op.create_table(
        "teams",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("external_id", sa.String, nullable=False, unique=True, index=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("short_name", sa.String(10), nullable=True),
        sa.Column("sport", sa.String(50), nullable=False, index=True),
        sa.Column("league", sa.String(50), nullable=False, index=True),
        sa.Column("logo_url", sa.String, nullable=True),
        sa.Column("city", sa.String(100), nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False),
    )

    # Many-to-many: users and their saved teams
    op.create_table(
        "user_teams",
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), primary_key=True),
        sa.Column("team_id", UUID(as_uuid=True), sa.ForeignKey("teams.id"), primary_key=True),
        sa.Column("saved_at", sa.DateTime, nullable=False),
    )

    # Sports selected during onboarding step 2
    op.create_table(
        "user_sports",
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), primary_key=True),
        sa.Column("sport", sa.String(50), primary_key=True),
    )

    # Games with live scores and schedule data
    op.create_table(
        "games",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("home_team_id", UUID(as_uuid=True), sa.ForeignKey("teams.id"), nullable=False),
        sa.Column("away_team_id", UUID(as_uuid=True), sa.ForeignKey("teams.id"), nullable=False),
        sa.Column("sport", sa.String(50), nullable=False, index=True),
        sa.Column("league", sa.String(50), nullable=False, index=True),
        sa.Column("scheduled_at", sa.DateTime, nullable=False, index=True),
        sa.Column("status", sa.String(20), default="scheduled", nullable=False),
        sa.Column("home_score", sa.Integer, default=0, nullable=False),
        sa.Column("away_score", sa.Integer, default=0, nullable=False),
        sa.Column("created_at", sa.DateTime, nullable=False),
    )

    # ML prediction output per game
    op.create_table(
        "predictions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("game_id", UUID(as_uuid=True), sa.ForeignKey("games.id"), nullable=False, unique=True),
        sa.Column("home_win_prob", sa.Float, nullable=False),
        sa.Column("away_win_prob", sa.Float, nullable=False),
        sa.Column("model_version", sa.String(50), nullable=False),
        sa.Column("created_at", sa.DateTime, nullable=False),
    )


def downgrade() -> None:
    op.drop_table("predictions")
    op.drop_table("games")
    op.drop_table("user_sports")
    op.drop_table("user_teams")
    op.drop_table("teams")
    op.drop_table("users")
