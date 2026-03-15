"""
SportSync API - Shared Dependencies.

FastAPI dependencies injected into route handlers:
- get_current_user: extracts and verifies JWT from Authorization header
- rate_limit: Redis-based rate limiting per IP address

These are used across multiple routers, so they live here (DRY).
"""
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

security_scheme = HTTPBearer()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security_scheme),
):
    """
    Extract the current user from a JWT in the Authorization header.
    Returns the user record from the database.
    Raises 401 if the token is invalid, expired, or blacklisted.
    """
    # Implementation will be added in feature/auth
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Auth not yet implemented",
    )
