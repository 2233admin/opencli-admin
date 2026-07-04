# ruff: noqa: N815, UP045
"""WorkflowProject API contracts for Canvas-authored workflows.

The frontend owns the canonical authoring graph. These schemas mirror the
TypeScript WorkflowProject shape closely enough for the backend compiler to
validate and preview execution without persisting or dispatching work.
"""

from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

from backend.schemas.plan_ir import PlanGraph

WORKFLOW_COMPILE_VERSION = "1.0.0"

WorkflowProfile = Literal["intelligence", "agent-debug", "sdk-dev"]
WorkflowNodeKind = Literal["schedule", "source", "agent", "router", "notify", "inbox", "action"]
WorkflowCapability = Literal[
    "trigger",
    "fetch",
    "normalize",
    "dedupe",
    "summarize",
    "score",
    "tag",
    "route",
    "send",
    "store",
]
AdapterBindingType = Literal["source", "notification", "storage", "agent", "utility"]
AdapterBindingMode = Literal["fixture", "mock", "webhook", "live"]
WorkflowCapabilitySurface = Literal[
    "catalog",
    "primitive",
    "channel",
    "notifier",
    "trigger",
    "resource",
]
WorkflowCapabilityStatus = Literal["runnable", "blocked", "preview_only", "design_only"]


class WorkflowSourceAnchor(BaseModel):
    kind: Literal["artifact", "url", "message", "selector"]
    label: str = Field(..., min_length=1)
    href: Optional[str] = None
    artifactPath: Optional[str] = None
    selector: Optional[str] = None
    runId: Optional[str] = None


class WorkflowRunArtifact(BaseModel):
    runId: str = Field(..., min_length=1)
    artifactPath: str = Field(..., min_length=1)
    apiPath: Optional[str] = None


class WorkflowMiniNetwork(BaseModel):
    nodes: int = Field(..., ge=0)
    edges: int = Field(..., ge=0)
    mode: Literal["title-only", "ports", "contract"]


class WorkflowTopicCollapse(BaseModel):
    groupId: str = Field(..., min_length=1)
    nodeCount: int = Field(..., ge=0)
    mode: Literal["draft", "locked"]
    packageInternal: bool


class WorkflowParameterBinding(BaseModel):
    nodeId: str = Field(..., min_length=1)
    source: Literal["params", "adapter", "data"]
    fieldId: str = Field(..., min_length=1)


class WorkflowParameterInterfaceGroup(BaseModel):
    id: str = Field(..., min_length=1)
    label: str = Field(..., min_length=1)
    order: Optional[float] = None


class WorkflowParameterInterfaceField(BaseModel):
    id: str = Field(..., min_length=1)
    label: str = Field(..., min_length=1)
    groupId: str = Field(..., min_length=1)
    type: Literal["text", "textarea", "number", "slider", "select", "boolean", "tokens"]
    binding: WorkflowParameterBinding
    description: Optional[str] = None
    order: Optional[float] = None
    readonly: Optional[bool] = None
    value: Any = None
    placeholder: Optional[str] = None
    min: Optional[float] = None
    max: Optional[float] = None
    step: Optional[float] = None
    options: list[dict[str, str]] | None = None


class WorkflowParameterInterface(BaseModel):
    groups: list[WorkflowParameterInterfaceGroup] = Field(default_factory=list)
    fields: list[WorkflowParameterInterfaceField] = Field(default_factory=list)


class WorkflowProjectNode(BaseModel):
    id: str = Field(..., min_length=1)
    kind: WorkflowNodeKind
    capability: WorkflowCapability
    adapter: Optional[str] = None
    params: dict[str, Any] = Field(default_factory=dict)
    sourceAnchor: Optional[WorkflowSourceAnchor] = None
    runArtifact: Optional[WorkflowRunArtifact] = None
    miniNetwork: Optional[WorkflowMiniNetwork] = None
    topicCollapse: Optional[WorkflowTopicCollapse] = None
    proposalState: Optional[Literal["draft", "proposed", "accepted"]] = None
    parameterInterface: Optional[WorkflowParameterInterface] = None
    internals: Optional[WorkflowPackageInternals] = None
    ui: Optional[dict[str, Any]] = None


class WorkflowSemanticLink(BaseModel):
    relationship: Literal["related", "depends-on", "evidence", "contradicts", "implements"]
    reason: Optional[str] = None
    confidence: Optional[float] = Field(None, ge=0, le=1)


class WorkflowProjectEdge(BaseModel):
    id: str = Field(..., min_length=1)
    source: str = Field(..., min_length=1)
    target: str = Field(..., min_length=1)
    sourcePort: Optional[str] = None
    targetPort: Optional[str] = None
    label: Optional[str] = None
    condition: Optional[str] = None
    semantic: Optional[WorkflowSemanticLink] = None
    weight: Optional[float] = Field(None, ge=0, le=1)
    contractId: Optional[str] = None
    proposalState: Optional[Literal["draft", "proposed", "accepted"]] = None
    ui: Optional[dict[str, Any]] = None


class WorkflowPackageInternals(BaseModel):
    locked: Optional[bool] = None
    nodes: list[WorkflowProjectNode] = Field(default_factory=list)
    edges: list[WorkflowProjectEdge] = Field(default_factory=list)


class WorkflowSettings(BaseModel):
    timezone: str = "Asia/Shanghai"
    deterministicSimulation: bool = True
    maxItemsPerRun: int = Field(20, gt=0)


class WorkflowAdapterBinding(BaseModel):
    id: str = Field(..., min_length=1)
    type: AdapterBindingType
    provider: str = Field(..., min_length=1)
    mode: AdapterBindingMode = "fixture"
    config: dict[str, Any] = Field(default_factory=dict)


class WorkflowAgentPermissions(BaseModel):
    canFetchNetwork: bool = False
    canSendNotifications: bool = False
    canWriteInbox: bool = True
    allowedDomains: list[str] = Field(default_factory=list)


class WorkflowProject(BaseModel):
    id: str = Field(..., min_length=1)
    name: str = Field(..., min_length=1)
    profile: WorkflowProfile
    version: Literal[1] = 1
    nodes: list[WorkflowProjectNode] = Field(..., min_length=1)
    edges: list[WorkflowProjectEdge] = Field(default_factory=list)
    settings: WorkflowSettings = Field(
        default_factory=lambda: WorkflowSettings(
            timezone="Asia/Shanghai",
            deterministicSimulation=True,
            maxItemsPerRun=20,
        )
    )
    adapters: list[WorkflowAdapterBinding] = Field(default_factory=list)
    agentPermissions: WorkflowAgentPermissions = Field(
        default_factory=lambda: WorkflowAgentPermissions()
    )


class WorkflowCompileRequest(BaseModel):
    project: WorkflowProject


class WorkflowPatchOperation(BaseModel):
    op: Literal[
        "add_node",
        "connect_nodes",
        "update_parameters",
        "package_nodes",
        "request_missing_capability",
    ]
    node: Optional[WorkflowProjectNode] = None
    edge: Optional[WorkflowProjectEdge] = None
    nodeId: Optional[str] = None
    params: dict[str, Any] = Field(default_factory=dict)
    packageNode: Optional[WorkflowProjectNode] = None
    internalNodeIds: list[str] = Field(default_factory=list)
    capability: Optional[str] = None
    reason: Optional[str] = None


class WorkflowPatchRequest(BaseModel):
    project: WorkflowProject
    operations: list[WorkflowPatchOperation] = Field(..., min_length=1)


class WorkflowCompileError(BaseModel):
    code: str
    message: str
    node_id: Optional[str] = None
    edge_id: Optional[str] = None
    path: list[str] = Field(default_factory=list)


class CompiledWorkflowAdapterBinding(BaseModel):
    id: str
    type: AdapterBindingType
    provider: str
    mode: AdapterBindingMode
    config: dict[str, Any] = Field(default_factory=dict)


class CompiledWorkflowNode(BaseModel):
    id: str
    kind: WorkflowNodeKind
    capability: WorkflowCapability
    params: dict[str, Any] = Field(default_factory=dict)
    depends_on: list[str] = Field(default_factory=list)
    adapter: Optional[CompiledWorkflowAdapterBinding] = None
    sourceAnchor: Optional[WorkflowSourceAnchor] = None
    runArtifact: Optional[WorkflowRunArtifact] = None
    package: Optional[dict[str, Any]] = None
    runtime: dict[str, Any] = Field(default_factory=dict)


class CompiledWorkflowEdge(BaseModel):
    id: str
    source: str
    target: str
    sourcePort: str
    targetPort: str
    contractId: Optional[str] = None
    condition: Optional[str] = None


class WorkflowAuthoringMetadata(BaseModel):
    project_id: str
    project_name: str
    project_version: int
    profile: WorkflowProfile
    node_count: int
    edge_count: int
    adapter_count: int
    settings: WorkflowSettings
    agentPermissions: WorkflowAgentPermissions


class WorkflowRuntimePreview(BaseModel):
    execution_mode: Literal["preview"] = "preview"
    dispatch: Literal["none"] = "none"
    node_ids: list[str] = Field(default_factory=list)
    nodes: list[CompiledWorkflowNode] = Field(default_factory=list)
    edges: list[CompiledWorkflowEdge] = Field(default_factory=list)
    plan_ir: PlanGraph


class WorkflowCompiledPlanPreview(BaseModel):
    compile_version: str = WORKFLOW_COMPILE_VERSION
    authoring: WorkflowAuthoringMetadata
    runtime: WorkflowRuntimePreview


class WorkflowCompileResponse(BaseModel):
    valid: bool
    errors: list[WorkflowCompileError] = Field(default_factory=list)
    plan: Optional[WorkflowCompiledPlanPreview] = None


class WorkflowRuntimeCapability(BaseModel):
    id: str = Field(..., min_length=1)
    label: str = Field(..., min_length=1)
    surface: WorkflowCapabilitySurface
    status: WorkflowCapabilityStatus
    backendAvailable: bool = False
    kind: Optional[WorkflowNodeKind] = None
    capability: Optional[WorkflowCapability] = None
    provider: Optional[str] = None
    channelType: Optional[str] = None
    notifierType: Optional[str] = None
    runtimeBinding: Optional[str] = None
    reason: Optional[str] = None
    missing: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    source: Optional[str] = None


class WorkflowCapabilitiesResponse(BaseModel):
    version: str = WORKFLOW_COMPILE_VERSION
    catalog: list[WorkflowRuntimeCapability] = Field(default_factory=list)
    primitives: list[WorkflowRuntimeCapability] = Field(default_factory=list)
    channels: list[WorkflowRuntimeCapability] = Field(default_factory=list)
    notifiers: list[WorkflowRuntimeCapability] = Field(default_factory=list)
    triggers: list[WorkflowRuntimeCapability] = Field(default_factory=list)
    resources: list[WorkflowRuntimeCapability] = Field(default_factory=list)


class WorkflowOpenCLIHDATraceRequest(BaseModel):
    project: WorkflowProject
    packageNodeId: Optional[str] = None
    runId: Optional[str] = None
    traceId: Optional[str] = None


class WorkflowOpenCLIHDATraceDispatch(BaseModel):
    taskId: str
    nodeId: str
    packageNodeId: Optional[str] = None
    internalNodeId: Optional[str] = None
    sourceGroup: str
    site: str
    command: str
    args: dict[str, Any] = Field(default_factory=dict)
    iii: dict[str, Any]


class WorkflowOpenCLIHDATraceResponse(BaseModel):
    valid: bool
    errors: list[WorkflowCompileError] = Field(default_factory=list)
    workflowId: str
    runId: str
    traceId: str
    packageNodeId: Optional[str] = None
    dispatch: dict[str, Any] = Field(default_factory=dict)
    dispatches: list[WorkflowOpenCLIHDATraceDispatch] = Field(default_factory=list)


WorkflowRunStatus = Literal["queued", "running", "partial", "blocked", "completed", "failed"]
WorkflowNodeRunEventType = Literal[
    "queued",
    "started",
    "blocked",
    "batch_ready",
    "partial",
    "completed",
    "failed",
]


class WorkflowRunStartRequest(BaseModel):
    project: WorkflowProject
    packageNodeId: Optional[str] = None
    runId: Optional[str] = None
    traceId: Optional[str] = None


class WorkflowRunBlockReason(BaseModel):
    code: str = Field(..., min_length=1)
    message: str = Field(..., min_length=1)
    source: Optional[str] = None
    details: dict[str, Any] = Field(default_factory=dict)


class WorkflowRunBatchReference(BaseModel):
    batchId: str = Field(..., min_length=1)
    itemCount: int = Field(..., ge=0)
    recordCount: int = Field(..., ge=0)
    sourceGroup: Optional[str] = None
    adapterTaskId: Optional[str] = None
    odpRef: Optional[str] = None
    manifestUri: Optional[str] = None


class WorkflowNodeRunEvent(BaseModel):
    id: str = Field(..., min_length=1)
    sequence: int = Field(..., ge=1)
    workflowId: str = Field(..., min_length=1)
    workflowRunId: str = Field(..., min_length=1)
    traceId: str = Field(..., min_length=1)
    nodeId: str = Field(..., min_length=1)
    eventType: WorkflowNodeRunEventType
    createdAt: str = Field(..., min_length=1)
    packageNodeId: Optional[str] = None
    internalNodeId: Optional[str] = None
    sourceGroup: Optional[str] = None
    message: Optional[str] = None
    blockReason: Optional[WorkflowRunBlockReason] = None
    batch: Optional[WorkflowRunBatchReference] = None
    details: dict[str, Any] = Field(default_factory=dict)


class WorkflowRunNodeState(BaseModel):
    nodeId: str = Field(..., min_length=1)
    status: WorkflowRunStatus = "queued"
    packageNodeId: Optional[str] = None
    internalNodeId: Optional[str] = None
    sourceGroups: list[str] = Field(default_factory=list)
    latestEventId: Optional[str] = None
    eventCount: int = Field(0, ge=0)
    blockReasons: list[WorkflowRunBlockReason] = Field(default_factory=list)
    batches: list[WorkflowRunBatchReference] = Field(default_factory=list)


class WorkflowRunProjection(BaseModel):
    workflowId: str = Field(..., min_length=1)
    runId: str = Field(..., min_length=1)
    traceId: str = Field(..., min_length=1)
    valid: bool
    status: WorkflowRunStatus
    packageNodeId: Optional[str] = None
    startedAt: str = Field(..., min_length=1)
    updatedAt: str = Field(..., min_length=1)
    eventCount: int = Field(..., ge=0)
    nodeStates: list[WorkflowRunNodeState] = Field(default_factory=list)
    errors: list[WorkflowCompileError] = Field(default_factory=list)


class WorkflowMissingCapability(BaseModel):
    capability: str
    reason: Optional[str] = None
    n8n_search_hint: Optional[str] = None


class WorkflowPatchPreview(BaseModel):
    operations: list[dict[str, Any]] = Field(default_factory=list)


class WorkflowPatchResponse(BaseModel):
    valid: bool
    errors: list[WorkflowCompileError] = Field(default_factory=list)
    missing_capabilities: list[WorkflowMissingCapability] = Field(default_factory=list)
    patch: WorkflowPatchPreview
    project: Optional[WorkflowProject] = None
    compile: Optional[WorkflowCompileResponse] = None
