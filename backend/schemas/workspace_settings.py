from datetime import datetime
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, Field, field_validator

from backend.schemas.common import UTCModel


class SettingsValues(BaseModel):
    theme: Literal["system", "dark", "light"] = "system"
    motion_enabled: bool = True
    sidebar_mode: Literal["expanded", "icon", "collapsed"] = "expanded"
    timezone: str = "Asia/Shanghai"
    landing_page: Literal["/dashboard", "/canvas", "/inbox"] = "/dashboard"
    default_concurrency: int = Field(default=4, ge=1, le=64)
    automatic_retries: bool = True
    retain_raw_data: bool = True
    retention_days: Literal[7, 30, 90, 365] = 30
    inbox_alerts: bool = True
    failure_alerts: bool = True
    agent_alerts: bool = True

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except ZoneInfoNotFoundError as exc:
            raise ValueError("unknown IANA timezone") from exc
        return value


class SettingsPatch(BaseModel):
    theme: Literal["system", "dark", "light"] | None = None
    motion_enabled: bool | None = None
    sidebar_mode: Literal["expanded", "icon", "collapsed"] | None = None
    timezone: str | None = None
    landing_page: Literal["/dashboard", "/canvas", "/inbox"] | None = None
    default_concurrency: int | None = Field(default=None, ge=1, le=64)
    automatic_retries: bool | None = None
    retain_raw_data: bool | None = None
    retention_days: Literal[7, 30, 90, 365] | None = None
    inbox_alerts: bool | None = None
    failure_alerts: bool | None = None
    agent_alerts: bool | None = None

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, value: str | None) -> str | None:
        if value is not None:
            try:
                ZoneInfo(value)
            except ZoneInfoNotFoundError as exc:
                raise ValueError("unknown IANA timezone") from exc
        return value


class SettingsRead(UTCModel):
    values: SettingsValues
    sources: dict[str, Literal["default", "override"]]
    apply_modes: dict[str, Literal["immediate", "next_run"]]
    revision: int
    updated_at: datetime | None = None
