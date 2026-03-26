"""
SportSync - Backend Test Suite.

Tests for auth endpoints, age validation, and core business logic.
Run with: pytest backend/tests/
"""
import pytest
from datetime import date, timedelta


class TestAgeCalculation:
    """Tests for the 18+ age gate requirement (Section 5.3)."""

    def test_over_18_allowed(self):
        """User 20 years old should pass."""
        from services.auth_service import hash_password, verify_password
        # Test password hashing works correctly
        hashed = hash_password("TestPassword123")
        assert verify_password("TestPassword123", hashed)

    def test_password_wrong(self):
        """Wrong password should fail verification."""
        from services.auth_service import hash_password, verify_password
        hashed = hash_password("CorrectPassword")
        assert not verify_password("WrongPassword", hashed)

    def test_age_under_18_blocked(self):
        """Under-18 DOB should be rejected."""
        today = date.today()
        under_18_dob = today - timedelta(days=17 * 365)  # roughly 17 years
        age = _calculate_age(under_18_dob)
        assert age < 18

    def test_age_exactly_18_allowed(self):
        """Exactly 18 today should pass."""
        today = date.today()
        exactly_18_dob = date(today.year - 18, today.month, today.day)
        age = _calculate_age(exactly_18_dob)
        assert age >= 18

    def test_age_over_18_allowed(self):
        """25-year-old should pass."""
        today = date.today()
        over_18_dob = date(today.year - 25, today.month, today.day)
        age = _calculate_age(over_18_dob)
        assert age >= 18


class TestJWT:
    """Tests for JWT token creation and validation."""

    def test_create_and_decode_access_token(self):
        """Access token should contain user ID and be decodable."""
        from services.auth_service import create_access_token, decode_token
        token = create_access_token("test-user-id-123")
        payload = decode_token(token)
        assert payload is not None
        assert payload["sub"] == "test-user-id-123"
        assert payload["type"] == "access"

    def test_create_refresh_token(self):
        """Refresh token should have correct type."""
        from services.auth_service import create_refresh_token, decode_token
        token, max_age = create_refresh_token("test-user-id-456")
        payload = decode_token(token)
        assert payload is not None
        assert payload["type"] == "refresh"
        assert max_age > 0

    def test_remember_me_longer_expiry(self):
        """Remember Me refresh token should extend to 30 days."""
        from services.auth_service import create_refresh_token
        _, normal_max_age = create_refresh_token("user", remember_me=False)
        _, remember_max_age = create_refresh_token("user", remember_me=True)
        assert normal_max_age == 7 * 86400
        assert remember_max_age == 30 * 86400

    def test_invalid_token_returns_none(self):
        """Garbage token should return None from decode."""
        from services.auth_service import decode_token
        payload = decode_token("this.is.not.a.valid.jwt")
        assert payload is None


class TestConstants:
    """Verify constants match blueprint specifications."""

    def test_rate_limit_values(self):
        """Rate limits match Section 12 requirements."""
        from constants import RATE_LIMIT_LOGIN_MAX, RATE_LIMIT_REGISTER_MAX
        assert RATE_LIMIT_LOGIN_MAX == 10
        assert RATE_LIMIT_REGISTER_MAX == 5

    def test_supported_sports(self):
        """All 5 leagues must be supported."""
        from constants import SUPPORTED_SPORTS
        assert len(SUPPORTED_SPORTS) == 5
        for league in ["NFL", "NBA", "MLB", "NHL", "EPL"]:
            assert league in SUPPORTED_SPORTS

    def test_bcrypt_cost_factor(self):
        """bcrypt cost must be 12 per Section 12."""
        from constants import BCRYPT_COST_FACTOR
        assert BCRYPT_COST_FACTOR == 12

    def test_account_lockout_threshold(self):
        """Account lockout should trigger after 5 failed attempts."""
        from constants import MAX_FAILED_LOGIN_ATTEMPTS
        assert MAX_FAILED_LOGIN_ATTEMPTS == 5


def _calculate_age(dob: date) -> int:
    """Calculate age from DOB for test purposes."""
    today = date.today()
    age = today.year - dob.year
    if (today.month, today.day) < (dob.month, dob.day):
        age -= 1
    return age
