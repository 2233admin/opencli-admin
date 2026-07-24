"""API read models for the unified plugin registry."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from backend.schemas.common import UTCModel


class PluginBlockerRead(BaseModel):
    code: str
    message: str


class PluginCapabilityRead(BaseModel):
    model_config = {"populate_by_name": True}

    id: str
    family: Literal["tool", "model", "datasource", "trigger", "agent_strategy", "endpoint"]
    key: str
    label: str
    source_path: str | None = Field(default=None, alias="sourcePath")
    status: Literal["READY", "BLOCKED"]
    runtime_adapter_id: str | None = Field(default=None, alias="runtimeAdapterId")
    blockers: list[PluginBlockerRead] = Field(default_factory=list)
    flow_capability: bool = Field(default=False, alias="flowCapability")


class PluginNodeDefinitionRead(BaseModel):
    model_config = {"populate_by_name": True}

    id: str
    label: str
    family: str
    status: Literal["READY", "BLOCKED"]
    locked: bool
    lock_reason: str | None = Field(default=None, alias="lockReason")
    installation_id: str = Field(alias="installationId")
    provider_key: str = Field(alias="providerKey")
    plugin_version: str = Field(alias="pluginVersion")
    capability_id: str = Field(alias="capabilityId")


class PluginInstallationRead(UTCModel):
    model_config = {**UTCModel.model_config, "populate_by_name": True}

    id: str
    provider_key: str = Field(alias="providerKey")
    name: str
    author: str
    version: str
    source_kind: Literal["manifest", "difypkg", "bundled"] = Field(alias="sourceKind")
    source_digest: str = Field(alias="sourceDigest")
    manifest_spec_version: str = Field(alias="manifestSpecVersion")
    signature_state: Literal["unsigned", "present_unverified", "bundled"] = Field(
        alias="signatureState"
    )
    labels: dict[str, str] = Field(default_factory=dict)
    descriptions: dict[str, str] = Field(default_factory=dict)
    icon: str | None = None
    plugin_types: list[str] = Field(default_factory=list, alias="pluginTypes")
    manifest: dict[str, Any] = Field(default_factory=dict)
    capabilities: list[PluginCapabilityRead] = Field(default_factory=list)
    permissions: dict[str, Any] = Field(default_factory=dict)
    runtime_status: Literal["READY", "BLOCKED"] = Field(alias="runtimeStatus")
    blockers: list[PluginBlockerRead] = Field(default_factory=list)
    node_definitions: list[PluginNodeDefinitionRead] = Field(
        default_factory=list, alias="nodeDefinitions"
    )
    bundled: bool = False
    installed_at: datetime = Field(alias="installedAt")
    updated_at: datetime = Field(alias="updatedAt")


class PluginNodePortRead(BaseModel):
    name: str
    type: str
    required: bool = False


class PluginNodeParameterRead(BaseModel):
    name: str
    label: str
    type: str
    required: bool = False
    default: Any = None
    options: list[Any] = Field(default_factory=list)


class PluginNodeCapabilityRead(BaseModel):
    model_config = {"populate_by_name": True}

    id: str
    label: str
    description: str
    category: Literal[
        "input",
        "trigger",
        "ai",
        "knowledge",
        "logic",
        "transform",
        "flow",
        "tool",
        "agent",
        "human",
        "output",
        "plugin",
        "compatibility",
    ]
    origin: Literal["native", "composite", "plugin", "compatibility"]
    kind: Literal[
        "schedule",
        "source",
        "agent",
        "router",
        "notify",
        "inbox",
        "action",
        "flow",
        "control",
        "sink",
    ]
    capability: Literal[
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
        "merge",
        "accept",
    ]
    icon: str
    provider: str
    source: str
    readiness: Literal["runnable", "blocked", "composed", "plugin_required"]
    runtime_binding: str | None = Field(default=None, alias="runtimeBinding")
    input_ports: list[PluginNodePortRead] = Field(default_factory=list, alias="inputPorts")
    output_ports: list[PluginNodePortRead] = Field(default_factory=list, alias="outputPorts")
    parameters: list[PluginNodeParameterRead] = Field(default_factory=list)
    dify_node_types: list[str] = Field(default_factory=list, alias="difyNodeTypes")
    missing: list[str] = Field(default_factory=list)


class PluginNodeCategoryRead(BaseModel):
    id: str
    label: str
    count: int


class PluginNodeCatalogSummaryRead(BaseModel):
    model_config = {"populate_by_name": True}

    total: int
    by_readiness: dict[str, int] = Field(alias="byReadiness")
    by_origin: dict[str, int] = Field(alias="byOrigin")


class PluginNodeCatalogRead(BaseModel):
    version: Literal["opencli.node-capabilities.v1"] = "opencli.node-capabilities.v1"
    authority: Literal["backend"] = "backend"
    nodes: list[PluginNodeCapabilityRead] = Field(default_factory=list)
    categories: list[PluginNodeCategoryRead] = Field(default_factory=list)
    summary: PluginNodeCatalogSummaryRead
