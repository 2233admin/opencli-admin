from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

CONTRACT_VERSION = "opencli.graphon.compat.v1"


class ContractModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")


class DifySource(ContractModel):
    format: Literal["dify-app-dsl"]
    sha256: str = Field(min_length=64, max_length=64, pattern=r"^[0-9a-f]{64}$")
    content: str = Field(min_length=1)


class ExecutionPolicy(ContractModel):
    allow_network: bool = Field(default=False, alias="allowNetwork")
    allow_code: bool = Field(default=False, alias="allowCode")
    allow_tools: bool = Field(default=False, alias="allowTools")
    allowed_domains: list[str] = Field(default_factory=list, alias="allowedDomains")


class InspectRequest(ContractModel):
    source: DifySource
    policy: ExecutionPolicy = Field(default_factory=ExecutionPolicy)


class RunRequest(InspectRequest):
    inputs: dict[str, Any] = Field(default_factory=dict)
    grants: dict[str, Any] = Field(default_factory=dict)


class RuntimeContractError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        status_code: int = 400,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details or {}
