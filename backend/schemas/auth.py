"""
SportSync - Authentication Schemas.

Pydantic models for auth request/response validation.
All inputs validated here before any database query.
"""
from datetime import date
from typing import Optional

from pydantic import BaseModel, EmailStr, Field


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    confirm_password: str = Field(min_length=8, max_length=128)
    first_name: str = Field(min_length=1, max_length=50)
    last_name: str = Field(min_length=1, max_length=50)
    date_of_birth: date
    display_name: str = Field(min_length=1, max_length=100)
    gender: Optional[str] = None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str
    remember_me: bool = False


class GoogleAuthRequest(BaseModel):
    google_token: str


class AuthResponse(BaseModel):
    access_token: str
    is_onboarded: bool
    is_new_user: bool = False


class OnboardingStep1Request(BaseModel):
    date_of_birth: date
    display_name: str = Field(min_length=1, max_length=100)
    gender: Optional[str] = None
    profile_picture_url: Optional[str] = None


class OnboardingStep2Request(BaseModel):
    sports: list[str] = Field(min_length=1)


class OnboardingCompleteRequest(BaseModel):
    team_ids: list[str] = Field(min_length=1)


class SetPasswordRequest(BaseModel):
    password: str = Field(min_length=8, max_length=128)
    confirm_password: str = Field(min_length=8, max_length=128)


class TokenRefreshResponse(BaseModel):
    access_token: str
