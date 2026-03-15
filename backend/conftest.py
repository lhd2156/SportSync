"""
Pytest configuration and shared fixtures for SportSync backend tests.

Provides a mock database session and test client that do not require
a real PostgreSQL or Redis connection.
"""
import sys
import os
import pytest

# Add backend directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


@pytest.fixture
def mock_db():
    """
    Provides a mock database session for tests that don't need
    a real PostgreSQL connection. Returns None; tests using this
    should mock db.query() calls.
    """
    return None


@pytest.fixture
def test_user_data():
    """Standard test user data used across multiple test modules."""
    return {
        "email": "test@sportsync.app",
        "password": "TestPassword123!",
        "display_name": "Test User",
        "date_of_birth": "2000-01-15",
        "gender": "male",
    }


@pytest.fixture
def test_jwt_payload():
    """Standard JWT payload for auth tests."""
    return {
        "sub": "test-user-id-123",
        "type": "access",
        "exp": 9999999999,
    }
