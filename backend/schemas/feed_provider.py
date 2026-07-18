from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, Field, field_validator

from backend.schemas.common import UTCModel

FeedProviderType = Literal["rsshub", "rss_bridge"]


class FeedProviderConfig(BaseModel):
    timeout_seconds: int = Field(default=15, ge=1, le=60)
    allowed_domains: list[str] = Field(default_factory=list)
    allow_private_network: bool = False
    browser_routes: bool = False
    authenticated_routes: bool = False

    @field_validator("allowed_domains")
    @classmethod
    def normalize_allowed_domains(cls, values: list[str]) -> list[str]:
        normalized: list[str] = []
        for value in values:
            domain = value.strip().lower().lstrip(".")
            if domain and domain not in normalized:
                normalized.append(domain)
        return normalized


def _validate_base_url(value: str) -> str:
    normalized = value.strip().rstrip("/")
    parsed = urlsplit(normalized)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("base_url must be an absolute http(s) URL")
    if parsed.query or parsed.fragment:
        raise ValueError("base_url must not contain a query or fragment")
    return normalized


class FeedProviderCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    provider_type: FeedProviderType
    base_url: str
    access_token: str | None = None
    config: FeedProviderConfig = Field(default_factory=FeedProviderConfig)
    enabled: bool = True

    _base_url = field_validator("base_url")(_validate_base_url)


class FeedProviderUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    base_url: str | None = None
    access_token: str | None = None
    config: FeedProviderConfig | None = None
    enabled: bool | None = None

    _base_url = field_validator("base_url")(_validate_base_url)


class FeedProviderRead(UTCModel):
    id: str
    name: str
    provider_type: FeedProviderType
    base_url: str
    has_access_token: bool
    access_token_preview: str | None
    config: FeedProviderConfig
    enabled: bool
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_model(cls, provider: Any) -> FeedProviderRead:
        token = provider.access_token
        preview = None
        if token:
            preview = f"...{token[-4:]}" if len(token) >= 4 else "...."
        return cls.model_validate(
            {
                "id": provider.id,
                "name": provider.name,
                "provider_type": provider.provider_type,
                "base_url": provider.base_url,
                "has_access_token": bool(token),
                "access_token_preview": preview,
                "config": provider.config or {},
                "enabled": provider.enabled,
                "created_at": provider.created_at,
                "updated_at": provider.updated_at,
            }
        )


class FeedProviderWorkflowNodeRequest(BaseModel):
    route: str | None = None
    bridge: str | None = None
    parameters: dict[str, str] = Field(default_factory=dict)
    source_group: str = Field(..., min_length=1, max_length=120)
    site: str = Field(..., min_length=1, max_length=120)
    max_entries: int = Field(default=20, ge=1, le=500)


class FeedProviderConnectionTest(BaseModel):
    ok: bool
    latency_ms: float | None = None
    error: str | None = None
    error_kind: str | None = None
    capabilities: dict[str, bool] = Field(default_factory=dict)
