# ruff: noqa: N815, UP045
"""Read-only projection contracts for EvidenceBatch results.

These schemas describe what frontend and AI consumers can read from the workflow
run axis. They do not dispatch workers, mutate state, or stream raw records.
"""

from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

EvidenceBatchStatus = Literal[
    "ready",
    "partial",
    "blocked",
    "failed",
    "completed",
    "ingested",
    "missing",
]

WorkflowProjectionInclude = Literal[
    "clusters",
    "missingSources",
    "summaries",
    "conflicts",
]


class EvidenceBatchSummary(BaseModel):
    runId: str = Field(..., min_length=1)
    nodeId: str = Field(..., min_length=1)
    packageNodeId: Optional[str] = None
    internalNodeId: Optional[str] = None
    sourceGroup: Optional[str] = None
    adapterTaskId: Optional[str] = None
    traceId: Optional[str] = None
    batchId: str = Field(..., min_length=1)
    manifestUri: Optional[str] = None
    odpRef: Optional[str] = None
    itemCount: int = Field(0, ge=0)
    recordCount: int = Field(0, ge=0)
    status: EvidenceBatchStatus
    createdAt: Optional[str] = None


class EvidenceBatchListResponse(BaseModel):
    runId: str = Field(..., min_length=1)
    batches: list[EvidenceBatchSummary] = Field(default_factory=list)
    nextCursor: Optional[str] = None


class EvidenceBatchSourceCoverage(BaseModel):
    sourceGroup: Optional[str] = None
    site: Optional[str] = None
    command: Optional[str] = None
    itemCount: int = Field(0, ge=0)
    recordCount: int = Field(0, ge=0)
    status: EvidenceBatchStatus


class EvidenceBatchDetail(BaseModel):
    runId: str = Field(..., min_length=1)
    batch: EvidenceBatchSummary
    manifestUri: Optional[str] = None
    odpRef: Optional[str] = None
    recordCount: int = Field(0, ge=0)
    itemCount: int = Field(0, ge=0)
    sourceCoverage: list[EvidenceBatchSourceCoverage] = Field(default_factory=list)


class EvidenceBatchDetailResponse(BaseModel):
    runId: str = Field(..., min_length=1)
    batch: EvidenceBatchSummary
    manifestUri: Optional[str] = None
    odpRef: Optional[str] = None
    recordCount: int = Field(0, ge=0)
    itemCount: int = Field(0, ge=0)
    sourceCoverage: list[EvidenceBatchSourceCoverage] = Field(default_factory=list)


class EvidenceClusterMember(BaseModel):
    nodeId: str = Field(..., min_length=1)
    sourceGroup: Optional[str] = None
    recordId: Optional[str] = None
    contentHash: Optional[str] = None
    title: Optional[str] = None
    url: Optional[str] = None
    score: Optional[float] = None


class EvidenceCluster(BaseModel):
    clusterId: str = Field(..., min_length=1)
    label: Optional[str] = None
    size: int = Field(0, ge=0)
    canonicalEvidence: Optional[EvidenceClusterMember] = None
    members: list[EvidenceClusterMember] = Field(default_factory=list)
    sourceGroups: list[str] = Field(default_factory=list)
    batchRefs: list[str] = Field(default_factory=list)
    status: EvidenceBatchStatus = "ready"


class EvidenceMissingSource(BaseModel):
    nodeId: Optional[str] = None
    packageNodeId: Optional[str] = None
    internalNodeId: Optional[str] = None
    sourceGroup: Optional[str] = None
    site: Optional[str] = None
    command: Optional[str] = None
    reason: Optional[str] = None
    code: Optional[str] = None
    details: dict[str, Any] = Field(default_factory=dict)


class EvidenceAnswerSummary(BaseModel):
    summaryId: str = Field(..., min_length=1)
    title: str = Field(..., min_length=1)
    text: str
    clusterRefs: list[str] = Field(default_factory=list)
    batchRefs: list[str] = Field(default_factory=list)
    confidence: Optional[float] = Field(None, ge=0, le=1)
    generatedAt: Optional[str] = None


class EvidenceConflict(BaseModel):
    conflictId: str = Field(..., min_length=1)
    kind: Optional[str] = None
    description: Optional[str] = None
    batchRefs: list[str] = Field(default_factory=list)
    clusterRefs: list[str] = Field(default_factory=list)
    details: dict[str, Any] = Field(default_factory=dict)


class EvidenceNodeProjection(BaseModel):
    nodeId: str = Field(..., min_length=1)
    packageNodeId: Optional[str] = None
    internalNodeId: Optional[str] = None
    sourceGroup: Optional[str] = None
    status: Optional[str] = None
    itemCount: int = Field(0, ge=0)
    batchRefs: list[str] = Field(default_factory=list)
    blockReasons: list[str] = Field(default_factory=list)


class EvidenceArtifactRef(BaseModel):
    kind: str = Field(..., min_length=1)
    uri: str = Field(..., min_length=1)
    nodeId: Optional[str] = None
    batchId: Optional[str] = None
    label: Optional[str] = None


class EvidenceProjectionResponse(BaseModel):
    runId: str = Field(..., min_length=1)
    status: str = Field(..., min_length=1)
    valid: bool
    nodes: list[EvidenceNodeProjection] = Field(default_factory=list)
    clusters: list[EvidenceCluster] = Field(default_factory=list)
    missingSources: list[EvidenceMissingSource] = Field(default_factory=list)
    summaries: list[EvidenceAnswerSummary] = Field(default_factory=list)
    conflicts: list[EvidenceConflict] = Field(default_factory=list)
    artifacts: list[EvidenceArtifactRef] = Field(default_factory=list)
    batches: list[EvidenceBatchSummary] = Field(default_factory=list)
