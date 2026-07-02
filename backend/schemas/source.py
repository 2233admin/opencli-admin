from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field
from backend.schemas.common import UTCModel


ChannelType = Literal["opencli", "web_scraper", "api", "rss", "cli", "skill", "crawl4ai"]


class DataSourceCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    channel_type: ChannelType
    channel_config: dict[str, Any] = Field(default_factory=dict)
    ai_config: Optional[dict[str, Any]] = None
    enabled: bool = True
    tags: list[str] = Field(default_factory=list)


class DataSourceUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    channel_config: Optional[dict[str, Any]] = None
    ai_config: Optional[dict[str, Any]] = None
    enabled: Optional[bool] = None
    tags: Optional[list[str]] = None


class DataSourceRead(UTCModel):
    id: str
    name: str
    description: Optional[str]
    channel_type: str
    channel_config: dict[str, Any]
    ai_config: Optional[dict[str, Any]]
    enabled: bool
    tags: list[str]
    #: Raw stored per-source SourceObjective override (issue 02), null when
    #: none is set. This is the UNRESOLVED override dict — see
    #: backend.schemas.control.SourceControlStateRead.objective for what
    #: classification actually uses (resolved over defaults).
    objective_override: Optional[dict[str, Any]] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class DataSourceDetail(DataSourceRead):
    """Extended read with connectivity status."""
    connectivity_ok: Optional[bool] = None
    connectivity_errors: list[str] = Field(default_factory=list)


class SourceObjectiveOverridePatch(BaseModel):
    """Body for ``PATCH /sources/{source_id}/objective`` (issue 02).

    ``objective_override`` is the ONLY field: a partial SourceObjective dict
    to store, or ``null`` to clear a previously-set override back to "use
    global defaults". Omitting the field entirely is also a no-op-safe
    clear-to-null under the model's default, but callers should always send
    it explicitly (set, update, or clear) — this endpoint is not a general
    source PATCH.

    Field-level validation happens downstream against
    ``backend.control.objectives.SourceObjectiveOverride`` (unknown keys or
    wrong types -> 422), not by this outer envelope, so a syntactically valid
    JSON object with a bad field name still gets a precise error.
    """

    objective_override: Optional[dict[str, Any]] = None
