"""Contracts for importing Dify DSL through the managed Graphon runtime."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from backend.schemas.workflow import WorkflowProject


class DifyContractModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


class DifyImportRequest(DifyContractModel):
    source: str = Field(..., min_length=1)
    name: str | None = Field(default=None, min_length=1, max_length=200)


class DifyGraphonEngine(DifyContractModel):
    name: str
    version: str
    commit: str


class DifyInspectionNode(DifyContractModel):
    source_node_id: str = Field(alias="sourceNodeId")
    type: str
    status: str


class DifyInspectionDependency(DifyContractModel):
    type: str
    id: str


class DifyBlocker(DifyContractModel):
    code: str
    message: str
    node_id: str | None = Field(default=None, alias="nodeId")


class DifyInspection(DifyContractModel):
    load_status: Literal["ready", "blocked", "unsupported", "failed"] = Field(
        alias="loadStatus"
    )
    load_reason: str | None = Field(default=None, alias="loadReason")
    engine: DifyGraphonEngine
    app_mode: str | None = Field(default=None, alias="appMode")
    nodes: list[DifyInspectionNode] = Field(default_factory=list)
    dependencies: list[DifyInspectionDependency] = Field(default_factory=list)
    blockers: list[DifyBlocker] = Field(default_factory=list)


class DifyTranslationReport(DifyContractModel):
    source: Literal["dify"] = "dify"
    workflow_name: str = Field(alias="workflowName")
    app_mode: str = Field(alias="appMode")
    node_count: int = Field(alias="nodeCount")
    edge_count: int = Field(alias="edgeCount")
    source_sha256: str = Field(alias="sourceSha256")
    executable: bool
    blockers: list[DifyBlocker] = Field(default_factory=list)


class DifyImportResponse(DifyContractModel):
    project: WorkflowProject
    report: DifyTranslationReport
    inspection: DifyInspection
    metadata: dict[str, Any] = Field(default_factory=dict)


class DifyRuntimeRunStart(DifyContractModel):
    contract_version: str = Field(alias="contractVersion")
    runtime_run_id: str = Field(alias="runtimeRunId", min_length=1)
    status: Literal["queued", "running"]
    events_url: str = Field(alias="eventsUrl", min_length=1)


class DifyRuntimeEvent(DifyContractModel):
    sequence: int = Field(ge=1)
    event_type: str = Field(alias="eventType", min_length=1)
    node_id: str | None = Field(default=None, alias="nodeId")
    payload: dict[str, Any] = Field(default_factory=dict)


class DifyRuntimeEventPage(DifyContractModel):
    contract_version: str = Field(alias="contractVersion")
    runtime_run_id: str = Field(alias="runtimeRunId", min_length=1)
    status: Literal[
        "queued",
        "running",
        "completed",
        "failed",
        "cancelled",
        "paused",
    ]
    next_sequence: int = Field(alias="nextSequence", ge=0)
    events: list[DifyRuntimeEvent] = Field(default_factory=list)


class DifyRuntimeCancelResponse(DifyContractModel):
    contract_version: str = Field(alias="contractVersion")
    runtime_run_id: str = Field(alias="runtimeRunId", min_length=1)
    status: str
    cancel_requested: bool = Field(alias="cancelRequested")
