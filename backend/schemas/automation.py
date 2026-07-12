from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from backend.schemas.common import UTCModel

SessionMode = Literal["fresh", "reuse"]
ApprovalMode = Literal["observe_only", "suggest_changes", "low_risk_automatic"]


class AutomationCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    prompt: str = Field(min_length=1, max_length=20000)
    precheck: str | None = Field(default=None, max_length=4000)
    executor: str = Field(min_length=1, max_length=64)
    schedule: str = Field(min_length=1, max_length=255)
    timezone: str = Field(default="UTC", min_length=1, max_length=64)
    session_mode: SessionMode = "fresh"
    approval_mode: ApprovalMode = "suggest_changes"
    project: dict = Field(default_factory=dict)
    enabled: bool = True


class AutomationUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    prompt: str | None = Field(default=None, min_length=1, max_length=20000)
    precheck: str | None = Field(default=None, max_length=4000)
    executor: str | None = Field(default=None, min_length=1, max_length=64)
    schedule: str | None = Field(default=None, min_length=1, max_length=255)
    timezone: str | None = Field(default=None, min_length=1, max_length=64)
    session_mode: SessionMode | None = None
    approval_mode: ApprovalMode | None = None
    project: dict | None = None
    enabled: bool | None = None


class AutomationRead(UTCModel):
    id: str
    workspace_id: str
    name: str
    prompt: str
    precheck: str | None
    executor: str
    schedule: str
    timezone: str
    session_mode: str
    approval_mode: str
    project: dict
    enabled: bool
    created_by_user_id: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
