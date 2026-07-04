"""Resolve compiled workflow nodes to backend runtime bindings."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from backend.schemas.workflow import WorkflowAdapterBinding, WorkflowProjectNode

OPENCLI_BINDING_ID = "iii.collector-opencli.snapshot"
OPENCLI_WORKER = "collector-opencli"
OPENCLI_FUNCTION_ID = "odp.collect::opencli_snapshot"
DEMAND_DRAFT_BINDING_ID = "workflow.demand-draft.patch"


class WorkflowRuntimeBinding(BaseModel):
    status: Literal["bound"] = "bound"
    binding_id: str
    runtime: Literal["iii"]
    worker: str
    function_id: str
    channel: str
    input: dict[str, Any] = Field(default_factory=dict)


class WorkflowMissingRuntime(BaseModel):
    status: Literal["missing"] = "missing"
    code: str
    node_id: str
    kind: str
    capability: str
    adapter_id: str | None = None
    provider: str | None = None
    required_params: list[str] = Field(default_factory=list)
    message: str


def resolve_runtime_metadata(
    node: WorkflowProjectNode,
    adapter: WorkflowAdapterBinding | None,
    *,
    node_id: str | None = None,
) -> dict[str, Any]:
    """Return runtime binding metadata for a compiled WorkflowProject node."""

    resolved_node_id = node_id or node.id
    if _is_collection_need(node):
        return _resolve_collection_need(node, node_id=resolved_node_id)
    if _is_opencli_source(node, adapter):
        return _resolve_opencli_source(node, adapter, node_id=resolved_node_id)

    return {
        "missing_runtime": _dump_missing_runtime(
            WorkflowMissingRuntime(
                code="missing_runtime_binding",
                node_id=resolved_node_id,
                kind=node.kind,
                capability=node.capability,
                adapter_id=adapter.id if adapter else None,
                provider=adapter.provider if adapter else None,
                message=(
                    f"No runtime binding registered for "
                    f"workflow.{node.kind}.{node.capability}"
                ),
            )
        )
    }


def _resolve_opencli_source(
    node: WorkflowProjectNode,
    adapter: WorkflowAdapterBinding | None,
    *,
    node_id: str,
) -> dict[str, Any]:
    site = _read_string(node.params.get("site"))
    command = _read_string(node.params.get("command"))
    missing_params = [
        param_name
        for param_name, param_value in (("site", site), ("command", command))
        if param_value is None
    ]
    if missing_params:
        return {
            "missing_runtime": _dump_missing_runtime(
                WorkflowMissingRuntime(
                    code="missing_runtime_parameter",
                    node_id=node_id,
                    kind=node.kind,
                    capability=node.capability,
                    adapter_id=adapter.id if adapter else None,
                    provider=adapter.provider if adapter else None,
                    required_params=missing_params,
                    message=(
                        "OpenCLI runtime binding requires node.params.site and "
                        "node.params.command"
                    ),
                )
            )
        }

    return {
        "binding": WorkflowRuntimeBinding(
            binding_id=OPENCLI_BINDING_ID,
            runtime="iii",
            worker=OPENCLI_WORKER,
            function_id=OPENCLI_FUNCTION_ID,
            channel="opencli",
            input={"site": site, "command": command},
        ).model_dump()
    }


def _resolve_collection_need(node: WorkflowProjectNode, *, node_id: str) -> dict[str, Any]:
    text = _read_string(node.params.get("text"))
    return {
        "binding": {
            "status": "bound",
            "binding_id": DEMAND_DRAFT_BINDING_ID,
            "runtime": "workflow",
            "channel": "demand-draft",
            "input": {
                "text": text,
                "locale": _read_string(node.params.get("locale")) or "zh-CN",
            },
        },
        "demand_draft": {
            "node_id": node_id,
            "endpoint": "/api/v1/workflows/demand-draft",
        },
    }


def _is_collection_need(node: WorkflowProjectNode) -> bool:
    ui = node.ui or {}
    return (
        _read_string(ui.get("catalogId")) == "intelligence.input.collection-need"
        or (
            node.kind == "schedule"
            and node.capability == "trigger"
            and _read_string(node.params.get("mode")) == "demand-draft"
        )
    )


def _is_opencli_source(
    node: WorkflowProjectNode,
    adapter: WorkflowAdapterBinding | None,
) -> bool:
    if node.kind != "source" or node.capability != "fetch" or adapter is None:
        return False

    config = adapter.config
    return (
        adapter.provider == "opencli"
        or _read_string(config.get("channel")) == "opencli"
        or _read_string(config.get("channel_type")) == "opencli"
    )


def _read_string(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _dump_missing_runtime(missing_runtime: WorkflowMissingRuntime) -> dict[str, Any]:
    payload = missing_runtime.model_dump(exclude_none=True)
    if not payload.get("required_params"):
        payload.pop("required_params", None)
    return payload
