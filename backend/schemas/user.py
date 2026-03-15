"""
SportSync - User Profile Schemas.

Pydantic models for user profile and feed responses.
"""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class UserProfileResponse(BaseModel):
    id: str
    email: str
    display_name: Optional[str] = None
    date_of_birth: Optional[str] = None
    gender: Optional[str] = None
    profile_picture_url: Optional[str] = None
    is_onboarded: bool
    created_at: datetime

    class Config:
        from_attributes = True


class UserProfileUpdateRequest(BaseModel):
    display_name: Optional[str] = None
    gender: Optional[str] = None
    profile_picture_url: Optional[str] = None
