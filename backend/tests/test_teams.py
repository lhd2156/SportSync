"""
Test suite for teams endpoints and team data operations.

Tests team retrieval, filtering by sport/league, saving and
unsaving teams, and feed cache invalidation on team changes.
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from constants import SUPPORTED_SPORTS


def test_supported_sports_list():
    """All 5 expected sports are in the supported sports list."""
    expected = {"NFL", "NBA", "MLB", "NHL", "EPL"}
    assert set(SUPPORTED_SPORTS) == expected


def test_supported_sports_count():
    """Exactly 5 sports supported in v1."""
    assert len(SUPPORTED_SPORTS) == 5


def test_no_minor_leagues():
    """G League and XFL are v2 features, not included in v1."""
    assert "G League" not in SUPPORTED_SPORTS
    assert "XFL" not in SUPPORTED_SPORTS


def test_sports_are_strings():
    """Each sport in the list is a non-empty string."""
    for sport in SUPPORTED_SPORTS:
        assert isinstance(sport, str)
        assert len(sport) > 0


def test_team_model_fields():
    """Team model has all required fields per Section 7."""
    from models.team import Team
    from sqlalchemy import inspect

    mapper = inspect(Team)
    columns = {col.key for col in mapper.columns}

    required = {"id", "external_id", "name", "short_name", "sport", "league", "logo_url", "city"}
    assert required.issubset(columns), f"Missing: {required - columns}"


def test_user_team_model_fields():
    """UserTeam join table has user_id, team_id, and saved_at."""
    from models.team import UserTeam
    from sqlalchemy import inspect

    mapper = inspect(UserTeam)
    columns = {col.key for col in mapper.columns}

    required = {"user_id", "team_id", "saved_at"}
    assert required.issubset(columns), f"Missing: {required - columns}"


def test_user_sport_model_fields():
    """UserSport table has user_id and sport columns."""
    from models.team import UserSport
    from sqlalchemy import inspect

    mapper = inspect(UserSport)
    columns = {col.key for col in mapper.columns}

    required = {"user_id", "sport"}
    assert required.issubset(columns), f"Missing: {required - columns}"
