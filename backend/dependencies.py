"""
SportSync API - Shared Dependencies.

FastAPI dependencies injected into route handlers:
- get_current_user: extracts and verifies JWT from Authorization header
- require_onboarded: ensures user completed onboarding

These are used across multiple routers, so they live here (DRY).
"""
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from database import get_db
from models.user import User
from services.auth_service import decode_token, is_token_blacklisted
from services.cache_service import redis_client

security_scheme = HTTPBearer()


async def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(security_scheme),
    db: Session = Depends(get_db),
) -> User:
    """
    Extract the current user from a JWT in the Authorization header.
    Returns the user record from the database.
    Raises 401 if the token is invalid, expired, or blacklisted.
    """
    token = credentials.credentials

    # Reject tokens that were blacklisted on logout
    if is_token_blacklisted(redis_client, token):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has been revoked",
        )

    payload = decode_token(token)
    if not payload or payload.get("type") != "access":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )

    user_id = payload.get("sub")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )

    return user


async def require_onboarded(
    user: User = Depends(get_current_user),
) -> User:
    """
    Dependency that requires the user to have completed onboarding.
    Used on all dashboard/scores/teams routes.
    """
    if not user.is_onboarded:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Onboarding not complete",
        )
    return user


def require_role(*allowed_roles: str):
    """Return a dependency that enforces role-based access control."""
    normalized_roles = {role.strip().lower() for role in allowed_roles if role.strip()}

    async def _dependency(user: User = Depends(get_current_user)) -> User:
        user_role = str(getattr(user, "role", "user") or "user").strip().lower()
        if normalized_roles and user_role not in normalized_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to access this resource",
            )
        return user

    return _dependency


async def require_admin(user: User = Depends(require_role("admin"))) -> User:
    """Require an administrator account."""
    return user
