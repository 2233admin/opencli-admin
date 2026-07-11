from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from backend.schemas.common import UTCModel

_FORBIDDEN_DATA_SCOPE_MARKERS = (
    "operational_config",
    "credential",
    "candidate",
    "artifact",
    "run_trace",
)


class ConsumerResourceScope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    all_accepted_records: bool = False
    source_ids: list[str] = Field(default_factory=list)
    record_schema_ids: list[str] = Field(default_factory=list)
    record_ids: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def require_explicit_resource_scope(self):
        if not self.all_accepted_records and not any(
            (self.source_ids, self.record_schema_ids, self.record_ids)
        ):
            raise ValueError("Consumer Grant requires an explicit Record resource scope")
        return self


class ConsumerDataScope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    accepted_records: bool = False
    allowed_summaries: list[str] = Field(default_factory=list)
    explicit_evidence: list[str] = Field(default_factory=list)

    @field_validator("allowed_summaries", "explicit_evidence")
    @classmethod
    def exclude_operational_data(cls, values: list[str]) -> list[str]:
        for value in values:
            normalized = value.strip().lower().replace("-", "_").replace(" ", "_")
            if any(marker in normalized for marker in _FORBIDDEN_DATA_SCOPE_MARKERS):
                raise ValueError(f"Consumer Grants cannot expose {value!r}")
        return values

    @model_validator(mode="after")
    def require_allowed_data(self):
        if not any((self.accepted_records, self.allowed_summaries, self.explicit_evidence)):
            raise ValueError("Consumer Grant must expose at least one allowed data class")
        return self


class ConsumerQuota(BaseModel):
    model_config = ConfigDict(extra="forbid")

    requests_per_minute: int = Field(gt=0)
    records_per_day: int = Field(gt=0)
    egress_bytes_per_day: int = Field(gt=0)


class ConsumerGrantCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    service_identity_id: str
    name: str = Field(min_length=1, max_length=255)
    resource_scope: ConsumerResourceScope
    data_scope: ConsumerDataScope
    quota: ConsumerQuota


class ConsumerGrantPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool


class ConsumerGrantRevoke(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str = Field(min_length=1, max_length=2000)


class ConsumerGrantRead(UTCModel):
    id: str
    service_identity_id: str
    name: str
    resource_scope: ConsumerResourceScope
    data_scope: ConsumerDataScope
    quota: ConsumerQuota
    status: str
    enabled: bool
    created_by_user_id: str
    revoked_at: datetime | None
    revoked_by_user_id: str | None
    revocation_reason: str | None
    created_at: datetime
    updated_at: datetime
