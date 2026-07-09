from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, field_validator

from backend.llm import is_valid_role
from backend.schemas.common import UTCModel


class ModelDefaultCandidate(BaseModel):
    """One entry in ``ModelDefault.candidates`` (ordered: index 0 = primary,
    the rest are failover order — PR-D resolver)."""

    provider_id: str
    model_id: str


class ModelDefaultPut(BaseModel):
    """Body for ``PUT /model-defaults`` (decision #10; PR-C wires the actual
    endpoint — this is just the validated payload shape)."""

    role: str
    candidates: list[ModelDefaultCandidate] = Field(default_factory=list)

    @field_validator("role")
    @classmethod
    def _validate_role(cls, v: str) -> str:
        if not is_valid_role(v):
            raise ValueError(f"invalid role: {v!r}")
        return v


class ModelDefaultCandidatesBody(BaseModel):
    """Body for ``PUT /model-defaults/{role}`` (decision #10).

    ``role`` comes from the URL path, not repeated in the body — the router
    wraps this into a role-validated :class:`ModelDefaultPut` before handing
    off to :func:`backend.services.provider_model_service.put_default`, so
    the same closed-set check that schema already enforces gets reused
    end-to-end instead of duplicated.
    """

    candidates: list[ModelDefaultCandidate] = Field(default_factory=list)


class ModelDefaultRead(UTCModel):
    id: str
    role: str
    candidates: list[dict[str, Any]]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
