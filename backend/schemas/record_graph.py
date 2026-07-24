"""Bounded project record-graph preview contracts."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

RecordGraphNodeKind = Literal["project", "workflow", "run", "source", "record", "entity"]
RecordGraphEdgeKind = Literal[
    "contains",
    "produced",
    "origin",
    "semantic",
    "reference",
    "batch",
    "duplicate",
]


class RecordGraphNode(BaseModel):
    id: str
    kind: RecordGraphNodeKind
    label: str
    subtitle: str | None = None
    count: int = Field(default=1, ge=0)
    record_id: str | None = None
    source_id: str | None = None
    workflow_id: str | None = None
    workflow_run_id: str | None = None
    url: str | None = None
    preview: str | None = None
    status: str | None = None
    source_published_at: str | None = None
    created_at: datetime | None = None


class RecordGraphEdge(BaseModel):
    id: str
    source: str
    target: str
    kind: RecordGraphEdgeKind
    label: str
    weight: int = Field(default=1, ge=1)
    bidirectional: bool = True


class RecordGraphStats(BaseModel):
    total_records: int = Field(ge=0)
    sampled_records: int = Field(ge=0)
    hidden_records: int = Field(ge=0)
    total_sources: int = Field(ge=0)
    total_workflows: int = Field(ge=0)
    total_runs: int = Field(ge=0)
    visible_nodes: int = Field(ge=0)
    visible_edges: int = Field(ge=0)


class ProjectRecordGraphPreview(BaseModel):
    workspace_id: str
    project_id: str
    project_name: str
    strategy: Literal["server-aggregated-sample"] = "server-aggregated-sample"
    truncated: bool
    max_nodes: int = Field(ge=100, le=2000)
    nodes: list[RecordGraphNode]
    edges: list[RecordGraphEdge]
    stats: RecordGraphStats
    generated_at: datetime
