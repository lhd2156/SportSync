"""
SportSync - Authentication Schemas.

Pydantic models for auth request/response validation.
All inputs validated here before any database query.
"""
from datetime import date
from typing import Optional

from pydantic import BaseModel, Field, field_validator

from services.profile_validation import validate_display_handle, validate_person_name


def _parse_flexible_date(v: object) -> date:
    """Parse date from multiple formats: YYYY-MM-DD, MM/DD/YYYY, MMDDYYYY, etc."""
    if isinstance(v, date):
        return v
    if not isinstance(v, str):
        raise ValueError("Date must be a string or date object")

    s = v.strip()
    if not s:
        raise ValueError("Date of birth is required")

    # ISO format: YYYY-MM-DD
    if len(s) == 10 and s[4] == "-":
        parts = s.split("-")
        return date(int(parts[0]), int(parts[1]), int(parts[2]))

    # US format: MM/DD/YYYY or M/D/YYYY
    if "/" in s:
        parts = s.split("/")
        if len(parts) == 3:
            return date(int(parts[2]), int(parts[0]), int(parts[1]))

    # Dash-separated: MM-DD-YYYY
    if "-" in s and len(s.split("-")) == 3:
        parts = s.split("-")
        if len(parts[0]) <= 2:
            return date(int(parts[2]), int(parts[0]), int(parts[1]))

    # Pure digits: MMDDYYYY
    digits = s.replace("/", "").replace("-", "")
    if len(digits) == 8:
        return date(int(digits[4:8]), int(digits[0:2]), int(digits[2:4]))

    raise ValueError(f"Cannot parse date: {v}. Use YYYY-MM-DD or MM/DD/YYYY format.")


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

    @field_validator("date_of_birth", mode="before")
    @classmethod
    def parse_dob(cls, v: object) -> date:
        return _parse_flexible_date(v)

    @field_validator("first_name")
    @classmethod
    def validate_first_name(cls, v: str) -> str:
        return validate_person_name(v, "First name")

    @field_validator("last_name")
    @classmethod
    def validate_last_name(cls, v: str) -> str:
        return validate_person_name(v, "Last name")

    @field_validator("display_name")
    @classmethod
    def validate_display_name(cls, v: str) -> str:
        return validate_display_handle(v)





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
    provider: Optional[str] = None
    has_password: bool = False


class OnboardingStep1Request(BaseModel):
    date_of_birth: date
    display_name: str = Field(min_length=1, max_length=100)
    gender: Optional[str] = None
    profile_picture_url: Optional[str] = None

    @field_validator("date_of_birth", mode="before")
    @classmethod
    def parse_dob(cls, v: object) -> date:
        return _parse_flexible_date(v)

    @field_validator("display_name")
    @classmethod
    def validate_display_name(cls, v: str) -> str:
        return validate_display_handle(v)


class OnboardingStep2Request(BaseModel):
    sports: list[str] = Field(default_factory=list)


class OnboardingCompleteRequest(BaseModel):
    team_ids: list[str] = Field(default_factory=list)


class SetPasswordRequest(BaseModel):
    password: str = Field(min_length=8, max_length=128)
    confirm_password: str = Field(min_length=8, max_length=128)


class ChangePasswordRequest(BaseModel):
    current_password: Optional[str] = Field(default=None, min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)
    confirm_password: str = Field(min_length=8, max_length=128)


class PasswordResetRequest(BaseModel):
    email: str

    @field_validator("email")
    @classmethod
    def email_must_have_at(cls, v: str) -> str:
        if "@" not in v:
            raise ValueError("Must be a valid email address")
        return v.strip().lower()


class PasswordResetTokenRequest(BaseModel):
    token: str = Field(min_length=16, max_length=512)

    @field_validator("token")
    @classmethod
    def token_must_exist(cls, v: str) -> str:
        normalized = v.strip()
        if not normalized:
            raise ValueError("Reset token is required")
        return normalized


class PasswordResetConfirmRequest(PasswordResetTokenRequest):
    password: str = Field(min_length=8, max_length=128)
    confirm_password: str = Field(min_length=8, max_length=128)


class PasswordResetCodeConfirmRequest(BaseModel):
    email: str
    code: str = Field(min_length=4, max_length=12)
    password: str = Field(min_length=8, max_length=128)
    confirm_password: str = Field(min_length=8, max_length=128)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, v: str) -> str:
        if "@" not in v:
            raise ValueError("Must be a valid email address")
        return v.strip().lower()

    @field_validator("code")
    @classmethod
    def normalize_code(cls, v: str) -> str:
        normalized = v.strip().replace(" ", "")
        if not normalized:
            raise ValueError("Reset code is required")
        return normalized


class TokenRefreshResponse(BaseModel):
    access_token: str
