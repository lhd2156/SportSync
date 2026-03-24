from typing import Any

from pydantic import BaseModel, Field


class DetailResponse(BaseModel):
    detail: str


class ValidResponse(BaseModel):
    valid: bool


class PasswordResetResponse(DetailResponse):
    dev_reset_url: str | None = None
    dev_reset_token: str | None = None


class OnboardingCompleteResponse(DetailResponse):
    is_onboarded: bool
    teams_saved: int = Field(ge=0)


class PredictionBatchRequest(BaseModel):
    game_ids: list[str] = Field(default_factory=list, max_length=30)
    leagues: dict[str, str] = Field(default_factory=dict)


class DynamicObjectResponse(BaseModel):
    model_config = {"extra": "allow"}


class DynamicListResponse(BaseModel):
    items: list[dict[str, Any]] = Field(default_factory=list)
