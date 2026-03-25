from services import password_reset_service as prs


def test_password_reset_code_round_trip_local(monkeypatch):
    monkeypatch.setattr(prs, "redis_client", None)
    prs.delete_password_reset_code("user@example.com")

    code = prs.generate_password_reset_code()
    prs.store_password_reset_code(
        "user@example.com",
        code,
        user_id="user-123",
        ttl_seconds=300,
    )

    assert prs.verify_password_reset_code("user@example.com", code) == "user-123"
    prs.delete_password_reset_code("user@example.com")


def test_password_reset_code_invalidates_after_too_many_attempts(monkeypatch):
    monkeypatch.setattr(prs, "redis_client", None)
    prs.delete_password_reset_code("user@example.com")

    code = prs.generate_password_reset_code()
    prs.store_password_reset_code(
        "user@example.com",
        code,
        user_id="user-123",
        ttl_seconds=300,
    )

    for _ in range(prs.PASSWORD_RESET_CODE_MAX_ATTEMPTS):
        assert prs.verify_password_reset_code("user@example.com", "000000") is None

    assert prs.verify_password_reset_code("user@example.com", code) is None
    prs.delete_password_reset_code("user@example.com")
