from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field, field_validator

from backend.llm import is_valid_model_source, is_valid_model_type
from backend.schemas.common import UTCModel


class ProviderModelCreate(BaseModel):
    """Body for registering a provider model catalog entry.

    Minimal shape for PR-A: PR-C wires the actual sync/CRUD endpoints (decision
    #10) that construct/consume this; here it's just the validated payload.
    """

    provider_id: str
    model_id: str = Field(..., min_length=1, max_length=255)
    model_type: str = "llm"
    capabilities: Optional[dict[str, Any]] = None
    source: str = "manual"
    enabled: bool = True

    @field_validator("model_type")
    @classmethod
    def _validate_model_type(cls, v: str) -> str:
        if not is_valid_model_type(v):
            raise ValueError(f"invalid model_type: {v!r}")
        return v

    @field_validator("source")
    @classmethod
    def _validate_source(cls, v: str) -> str:
        if not is_valid_model_source(v):
            raise ValueError(f"invalid source: {v!r}")
        return v


class ProviderModelRead(UTCModel):
    id: str
    provider_id: str
    model_id: str
    model_type: str
    capabilities: Optional[dict[str, Any]]
    source: str
    enabled: bool
    created_at: datetime

    model_config = {"from_attributes": True}
