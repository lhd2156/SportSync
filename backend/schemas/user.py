"""
SportSync - User Profile Schemas.

Pydantic models for user profile and feed responses.
"""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class UserProfileResponse(BaseModel):
    id: str
    email: str
    display_name: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    date_of_birth: Optional[str] = None
    gender: Optional[str] = None
    profile_picture_url: Optional[str] = None
    is_onboarded: bool
    sports: list[str] = Field(default_factory=list)
    provider: str = "email"
    has_password: bool = False
    created_at: datetime

    class Config:
        from_attributes = True


class UserProfileUpdateRequest(BaseModel):
    display_name: Optional[str] = None
    first_name: Optional[str] = Field(default=None, min_length=1, max_length=50)
    last_name: Optional[str] = Field(default=None, min_length=1, max_length=50)
    gender: Optional[str] = None
    profile_picture_url: Optional[str] = None
    sports: Optional[list[str]] = None


class DeleteAccountRequest(BaseModel):
    confirm_text: str = Field(min_length=1, max_length=20)
    current_password: Optional[str] = Field(default=None, min_length=1, max_length=128)
