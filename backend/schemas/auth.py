"""
SportSync - Authentication Schemas.

Pydantic models for auth request/response validation.
All inputs validated here before any database query.
"""
from datetime import date
from typing import Optional

from pydantic import BaseModel, Field, field_validator


class RegisterRequest(BaseModel):
    email: str
    password: str = Field(min_length=8, max_length=128)
    confirm_password: str = Field(min_length=8, max_length=128)
    first_name: str = Field(min_length=1, max_length=50)
    last_name: str = Field(min_length=1, max_length=50)
    date_of_birth: date
    display_name: str = Field(min_length=1, max_length=100)
    gender: Optional[str] = None

    @field_validator("email")
    @classmethod
    def email_must_have_at(cls, v: str) -> str:
        if "@" not in v:
            raise ValueError("Must be a valid email address")
        return v.strip().lower()





class LoginRequest(BaseModel):
    email: str
    password: str
    remember_me: bool = False

    @field_validator("email")
    @classmethod
    def email_must_have_at(cls, v: str) -> str:
        if "@" not in v:
            raise ValueError("Must be a valid email address")
        return v.strip().lower()


class GoogleAuthRequest(BaseModel):
    google_token: str


class AuthResponse(BaseModel):
    access_token: str
    is_onboarded: bool
    is_new_user: bool = False
    # User profile data — avoids a separate profile fetch
    user_id: str = ""
    email: str = ""
    display_name: Optional[str] = None
    date_of_birth: Optional[str] = None
    gender: Optional[str] = None
    profile_picture_url: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None


class OnboardingStep1Request(BaseModel):
    date_of_birth: date
    display_name: str = Field(min_length=1, max_length=100)
    gender: Optional[str] = None
    profile_picture_url: Optional[str] = None


class OnboardingStep2Request(BaseModel):
    sports: list[str] = Field(default_factory=list)


class OnboardingCompleteRequest(BaseModel):
    team_ids: list[str] = Field(default_factory=list)


class SetPasswordRequest(BaseModel):
    password: str = Field(min_length=8, max_length=128)
    confirm_password: str = Field(min_length=8, max_length=128)


class TokenRefreshResponse(BaseModel):
    access_token: str
