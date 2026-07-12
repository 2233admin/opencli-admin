"""Resolve compiled workflow nodes to backend runtime bindings."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from backend.schemas.workflow import WorkflowAdapterBinding, WorkflowProjectNode
from backend.workflow.block_reasons import (
    MISSING_DELIVERY_PROJECTION,
    MISSING_RUNTIME_BINDING,
    MISSING_RUNTIME_IO_CONTRACT,
    MISSING_RUNTIME_PARAMETER,
    MISSING_TOOL_CAPABILITY_BINDING,
    MISSING_TURBOPUSH_CONTENT_TYPE,
    MISSING_TURBOPUSH_SERVICE,
)
from backend.workflow.runtime_contracts import runtime_io_contract_manifest
from backend.workflow.tool_capabilities import resolve_workflow_tool_capability
from backend.workflow.turbopush_runtime import (
    TURBOPUSH_BINDING_ID,
    TURBOPUSH_CHANNEL,
    TURBOPUSH_MCP_SERVER,
    TURBOPUSH_PROVIDER,
    normalize_turbopush_content_type,
    resolve_turbopush_service_resource,
    turbopush_binding_input,
    turbopush_platform_projection,
)

OPENCLI_BINDING_ID = "iii.collector-opencli.snapshot"
OPENCLI_WORKER = "collector-opencli"
OPENCLI_FUNCTION_ID = "odp.collect::opencli_snapshot"
DEMAND_DRAFT_BINDING_ID = "workflow.demand-draft.patch"
SCHEDULE_TRIGGER_BINDING_ID = "workflow.trigger.schedule_tick"
SOURCE_FETCH_BINDING_ID = "workflow.source.fetch"
SOURCE_POOL_BINDING_ID = "workflow.source-pool.parallel-fanout"
COLLECTION_OUTPUT_BINDING_ID = "workflow.collection-output.items"
NORMALIZE_BINDING_ID = "workflow.transform.normalize"
MERGE_BINDING_ID = "workflow.flow.merge"
ROUTER_ROUTE_BINDING_ID = "workflow.router.route"
RECORD_ACCEPTANCE_BINDING_ID = "workflow.gate.record-acceptance"
RECORD_SINK_BINDING_ID = "workflow.record-sink.records"
INBOX_STORE_BINDING_ID = "workflow.inbox.store"
WEBHOOK_NOTIFY_BINDING_ID = "workflow.notifier.webhook.send"
NOTIFY_SEND_BINDING_ID = "workflow.notify.send"
EXTERNAL_TOOL_BINDING_ID = "workflow.external-tool.capability"
N8N_COMPAT_BINDING_ID = "workflow.compat.n8n.execute"
DIFY_COMPAT_BINDING_ID = "workflow.compat.dify.execute"
SUPPORTED_TOOL_EXECUTOR_MODES = {"fixture", "okx_market_ticker_snapshot"}


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
    compat_target = _compat_runtime_target(node)
    if compat_target:
        metadata = _resolve_compat_runtime(node, target=compat_target, node_id=resolved_node_id)
    elif _is_collection_need(node):
        metadata = _resolve_collection_need(node, node_id=resolved_node_id)
    elif _is_schedule_trigger(node):
        metadata = _resolve_schedule_trigger(node, node_id=resolved_node_id)
    elif _is_source_pool(node):
        metadata = _resolve_source_pool(node, node_id=resolved_node_id)
    elif _is_collection_output(node):
        metadata = _resolve_collection_output(node, node_id=resolved_node_id)
    elif _is_normalize_node(node):
        metadata = _resolve_normalize_node(node, node_id=resolved_node_id)
    elif _is_merge_node(node):
        metadata = _resolve_merge_node(node, node_id=resolved_node_id)
    elif _is_router_route_node(node):
        metadata = _resolve_router_route_node(node, node_id=resolved_node_id)
    elif _is_record_acceptance_gate(node):
        metadata = _resolve_record_acceptance_gate(node, node_id=resolved_node_id)
    elif _is_record_sink(node):
        metadata = _resolve_record_sink(node, node_id=resolved_node_id)
    elif _is_inbox_store_node(node):
        metadata = _resolve_inbox_store_node(node, node_id=resolved_node_id)
    elif _is_external_tool_capability(node):
        metadata = _resolve_external_tool_capability(node, node_id=resolved_node_id)
    elif _is_turbopush_publish(node, adapter):
        metadata = _resolve_turbopush_publish(node, adapter, node_id=resolved_node_id)
    elif _is_webhook_notifier(node, adapter):
        metadata = _resolve_webhook_notifier(node, adapter, node_id=resolved_node_id)
    elif _is_opencli_source(node, adapter):
        metadata = _resolve_opencli_source(node, adapter, node_id=resolved_node_id)
    elif _is_source_fetch_node(node, adapter):
        metadata = _resolve_source_fetch_node(node, adapter, node_id=resolved_node_id)
    elif _is_notify_send_node(node, adapter):
        metadata = _resolve_notify_send_node(node, adapter, node_id=resolved_node_id)
    else:
        metadata = {
            "missing_runtime": _dump_missing_runtime(
                WorkflowMissingRuntime(
                    code=MISSING_RUNTIME_BINDING,
                    node_id=resolved_node_id,
                    kind=node.kind,
                    capability=node.capability,
                    adapter_id=adapter.id if adapter else None,
                    provider=adapter.provider if adapter else None,
                    message=(
                        f"No runtime binding registered for workflow.{node.kind}.{node.capability}"
                    ),
                )
            )
        }
    return _attach_runtime_contract(
        metadata,
        node=node,
        adapter=adapter,
        node_id=resolved_node_id,
    )


def _resolve_compat_runtime(
    node: WorkflowProjectNode,
    *,
    target: Literal["n8n", "dify"],
    node_id: str,
) -> dict[str, Any]:
    compat = _read_dict(node.params.get("compatRuntime"))
    binding_id = N8N_COMPAT_BINDING_ID if target == "n8n" else DIFY_COMPAT_BINDING_ID
    source = _read_dict((node.ui or {}).get(target))
    node_type = (
        _read_string(compat.get("nodeType"))
        or _read_string(source.get("type"))
        or _read_string(source.get("nodeType"))
        or "unknown"
    )
    return {
        "binding": {
            "status": "bound",
            "binding_id": binding_id,
            "runtime": "compatibility_worker",
            "worker": f"{target}-compat",
            "function_id": f"compat.{target}.execute_node",
            "channel": f"compat-{target}",
            "input": {
                "target": target,
                "nodeId": node_id,
                "nodeType": node_type,
                "sourceNodeId": _read_string(compat.get("sourceNodeId"))
                or _read_string(source.get("originalId")),
                "sourceNodeName": _read_string(compat.get("sourceNodeName"))
                or _read_string(source.get("originalName")),
                "parameters": _read_dict(source.get("parameters")),
            },
        },
        "compatibility_runtime": {
            "node_id": node_id,
            "target": target,
            "dispatch": "compatibility_worker",
            "worker": f"{target}-compat",
        },
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
                    code=MISSING_RUNTIME_PARAMETER,
                    node_id=node_id,
                    kind=node.kind,
                    capability=node.capability,
                    adapter_id=adapter.id if adapter else None,
                    provider=adapter.provider if adapter else None,
                    required_params=missing_params,
                    message=(
                        "OpenCLI runtime binding requires node.params.site and node.params.command"
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


def _resolve_source_pool(node: WorkflowProjectNode, *, node_id: str) -> dict[str, Any]:
    return {
        "binding": {
            "status": "bound",
            "binding_id": SOURCE_POOL_BINDING_ID,
            "runtime": "workflow",
            "channel": "source-pool",
            "input": {
                "sourceCount": _read_int(node.params.get("sourceCount")),
                "sourceGroups": _read_string_list(node.params.get("sourceGroups")),
                "fanout": "parallel",
            },
        },
        "source_pool": {
            "node_id": node_id,
            "fanout": "parallel",
        },
    }


def _resolve_source_fetch_node(
    node: WorkflowProjectNode,
    adapter: WorkflowAdapterBinding | None,
    *,
    node_id: str,
) -> dict[str, Any]:
    config = adapter.config if adapter else {}
    provider = (
        adapter.provider if adapter else _read_string(node.params.get("provider")) or "workflow"
    )
    channel_type = (
        _read_string(node.params.get("channelType"))
        or _read_string(node.params.get("channel_type"))
        or _read_string(config.get("channelType"))
        or _read_string(config.get("channel_type"))
        or _read_string(config.get("channel"))
        or provider
    )
    live_mode = (
        _read_string(node.params.get("liveMode"))
        or _read_string(config.get("liveMode"))
        or (adapter.mode if adapter else None)
        or "live"
    )
    source_id = _read_string(node.params.get("sourceId")) or _read_string(
        node.params.get("dataSourceId")
    )
    return {
        "binding": {
            "status": "bound",
            "binding_id": SOURCE_FETCH_BINDING_ID,
            "runtime": "workflow",
            "channel": "source",
            "input": {
                "provider": provider,
                "channelType": channel_type,
                "liveMode": live_mode,
                "sourceId": source_id,
                "adapterMode": adapter.mode if adapter else None,
                "adapterConfig": config,
                "params": dict(node.params),
                "outputPort": "items[]",
            },
        },
        "source_fetch": {
            "node_id": node_id,
            "provider": provider,
            "channelType": channel_type,
            "dispatch": "runtime_source_binding",
        },
    }


def _resolve_collection_output(node: WorkflowProjectNode, *, node_id: str) -> dict[str, Any]:
    return {
        "binding": {
            "status": "bound",
            "binding_id": COLLECTION_OUTPUT_BINDING_ID,
            "runtime": "workflow",
            "channel": "collection-output",
            "input": {
                "queue": _read_string(node.params.get("queue")) or "opencli-hda-output",
                "archive": bool(node.params.get("archive", False)),
            },
        },
        "collection_output": {
            "node_id": node_id,
            "artifact": "items[]",
        },
    }


def _resolve_normalize_node(node: WorkflowProjectNode, *, node_id: str) -> dict[str, Any]:
    return {
        "binding": {
            "status": "bound",
            "binding_id": NORMALIZE_BINDING_ID,
            "runtime": "workflow",
            "channel": "transform",
            "input": {
                "language": _read_string(node.params.get("language")) or "zh-CN",
                "preserveSourceRefs": node.params.get("preserveSourceRefs") is not False,
                "inputPort": "items[]",
                "outputPort": "recordCandidate[]",
            },
        },
        "normalize": {
            "node_id": node_id,
            "candidate_port": "recordCandidate[]",
        },
    }


def _resolve_merge_node(node: WorkflowProjectNode, *, node_id: str) -> dict[str, Any]:
    strategy = _read_string(node.params.get("strategy")) or "concat"
    lineage = node.params.get("preserveLineage")
    return {
        "binding": {
            "status": "bound",
            "binding_id": MERGE_BINDING_ID,
            "runtime": "workflow",
            "channel": "flow",
            "input": {
                "strategy": strategy,
                "preserveLineage": lineage if isinstance(lineage, bool) else True,
                "inputType": _read_string(node.params.get("inputType")) or "recordCandidate[]",
                "outputType": _read_string(node.params.get("outputType")) or "recordCandidate[]",
            },
        },
        "merge": {
            "node_id": node_id,
            "strategy": strategy,
            "lineage": "preserved",
        },
    }


def _resolve_router_route_node(node: WorkflowProjectNode, *, node_id: str) -> dict[str, Any]:
    expression = _read_string(node.params.get("expression")) or "true"
    return {
        "binding": {
            "status": "bound",
            "binding_id": ROUTER_ROUTE_BINDING_ID,
            "runtime": "workflow",
            "channel": "router",
            "input": {
                "expression": expression,
                "mode": _read_string(node.params.get("mode")) or "filter",
                "inputPort": "recordCandidate[]",
                "outputPort": "recordCandidate[]",
            },
        },
        "router": {
            "node_id": node_id,
            "expression": expression,
        },
    }


def _resolve_record_acceptance_gate(node: WorkflowProjectNode, *, node_id: str) -> dict[str, Any]:
    return {
        "binding": {
            "status": "bound",
            "binding_id": RECORD_ACCEPTANCE_BINDING_ID,
            "runtime": "workflow",
            "channel": "gate",
            "input": {
                "mode": _read_string(node.params.get("mode")) or "automatic_with_review",
                "schema": _read_string(node.params.get("schema")) or "record.v1",
                "dedupe": _read_string(node.params.get("dedupe")) or "required",
                "lineageRequired": node.params.get("lineageRequired") is not False,
                "minQuality": _read_number(node.params.get("minQuality")) or 0.0,
            },
        },
        "record_acceptance": {
            "node_id": node_id,
            "candidate_port": "recordCandidate[]",
            "record_port": "record[]",
        },
    }


def _resolve_record_sink(node: WorkflowProjectNode, *, node_id: str) -> dict[str, Any]:
    return {
        "binding": {
            "status": "bound",
            "binding_id": RECORD_SINK_BINDING_ID,
            "runtime": "workflow",
            "channel": "records",
            "input": {
                "target": _read_string(node.params.get("target")) or "records",
                "writeMode": _read_string(node.params.get("writeMode")) or "append",
                "preserveLineage": node.params.get("preserveLineage") is not False,
            },
        },
        "record_sink": {
            "node_id": node_id,
            "target": "records",
        },
    }


def _resolve_inbox_store_node(node: WorkflowProjectNode, *, node_id: str) -> dict[str, Any]:
    queue = _read_string(node.params.get("queue")) or "workflow-inbox"
    return {
        "binding": {
            "status": "bound",
            "binding_id": INBOX_STORE_BINDING_ID,
            "runtime": "workflow",
            "channel": "inbox",
            "input": {
                "queue": queue,
                "writeMode": _read_string(node.params.get("writeMode")) or "append",
                "archive": bool(node.params.get("archive", False)),
                "preserveLineage": node.params.get("preserveLineage") is not False,
            },
        },
        "inbox": {
            "node_id": node_id,
            "queue": queue,
        },
    }


def _resolve_external_tool_capability(node: WorkflowProjectNode, *, node_id: str) -> dict[str, Any]:
    tool_capability = _read_dict(node.params.get("toolCapability"))
    capability_id = _read_string(tool_capability.get("id")) or _read_string(
        node.params.get("toolCapabilityId")
    )
    executor = _read_dict(tool_capability.get("executor"))
    executor_mode = _read_string(executor.get("mode"))
    if not capability_id or executor_mode not in SUPPORTED_TOOL_EXECUTOR_MODES:
        return {
            "external_tool": {
                "node_id": node_id,
                "binding_id": EXTERNAL_TOOL_BINDING_ID,
                "dispatch": "blocked_until_tool_capability_binding",
                "origin": _read_dict(node.params.get("externalWorkflow")),
            },
            "missing_runtime": _dump_missing_runtime(
                WorkflowMissingRuntime(
                    code=MISSING_TOOL_CAPABILITY_BINDING,
                    node_id=node_id,
                    kind=node.kind,
                    capability=node.capability,
                    required_params=[
                        "toolCapability.id",
                        f"toolCapability.executor.mode in {sorted(SUPPORTED_TOOL_EXECUTOR_MODES)}",
                    ],
                    message=(
                        "Imported external tool node requires an OpenCLI Admin "
                        "Tool Capability binding before it can run."
                    ),
                )
            ),
        }

    tool = resolve_workflow_tool_capability(capability_id)
    if tool is None:
        return {
            "external_tool": {
                "node_id": node_id,
                "binding_id": EXTERNAL_TOOL_BINDING_ID,
                "dispatch": "blocked_unknown_tool_capability",
                "toolCapabilityId": capability_id,
                "origin": _read_dict(node.params.get("externalWorkflow")),
            },
            "missing_runtime": _dump_missing_runtime(
                WorkflowMissingRuntime(
                    code="unknown_tool_capability",
                    node_id=node_id,
                    kind=node.kind,
                    capability=node.capability,
                    required_params=["registered_toolCapability.id"],
                    message=(
                        f'OpenCLI Admin Tool Capability "{capability_id}" is not '
                        "registered in the workflow tool capability registry."
                    ),
                )
            ),
        }

    return {
        "binding": {
            "status": "bound",
            "binding_id": EXTERNAL_TOOL_BINDING_ID,
            "runtime": "workflow",
            "channel": "tool-capability",
            "input": {
                "toolCapabilityId": capability_id,
                "toolCapabilityVersionPin": tool.versionPin.model_dump(),
                "executorMode": executor_mode,
                "toolLabel": tool.label,
                "inputPort": "unknown",
                "outputPort": "unknown",
                "fixtureOutput": executor.get("output"),
                "fixtureOutputs": executor.get("outputs"),
                "executorParams": _read_dict(executor.get("params")),
                "toolParams": _read_dict(node.params.get("toolParams")),
                "externalWorkflow": _read_dict(node.params.get("externalWorkflow")),
            },
        },
        "external_tool": {
            "node_id": node_id,
            "binding_id": EXTERNAL_TOOL_BINDING_ID,
            "dispatch": "opencli_admin_tool_capability",
            "toolCapabilityId": capability_id,
            "versionPin": tool.versionPin.model_dump(),
        },
    }


def _resolve_turbopush_publish(
    node: WorkflowProjectNode,
    adapter: WorkflowAdapterBinding | None,
    *,
    node_id: str,
) -> dict[str, Any]:
    content_type = normalize_turbopush_content_type(node.params.get("contentType"))
    if content_type is None:
        return {
            "missing_runtime": _dump_missing_runtime(
                WorkflowMissingRuntime(
                    code=MISSING_TURBOPUSH_CONTENT_TYPE,
                    node_id=node_id,
                    kind=node.kind,
                    capability=node.capability,
                    adapter_id=adapter.id if adapter else None,
                    provider=adapter.provider if adapter else None,
                    required_params=["contentType"],
                    message=(
                        "TurboPush Publish requires node.params.contentType to be "
                        "article, graph_text, or video."
                    ),
                )
            )
        }

    service = resolve_turbopush_service_resource()
    publish_contract = {
        "node_id": node_id,
        "type": "turbopush",
        "binding_id": TURBOPUSH_BINDING_ID,
        "dispatch": "blocked_until_resource" if not service.configured else "guarded_publish",
        "resource": service.model_dump(exclude_none=True),
        "platforms": turbopush_platform_projection(),
        "input": turbopush_binding_input({**node.params, "contentType": content_type}),
    }
    if not service.configured:
        return {
            "turbopush": publish_contract,
            "missing_runtime": _dump_missing_runtime(
                WorkflowMissingRuntime(
                    code=MISSING_TURBOPUSH_SERVICE,
                    node_id=node_id,
                    kind=node.kind,
                    capability=node.capability,
                    adapter_id=adapter.id if adapter else None,
                    provider=adapter.provider if adapter else None,
                    required_params=service.missing,
                    message=service.message,
                )
            ),
        }

    return {
        "binding": {
            "status": "bound",
            "binding_id": TURBOPUSH_BINDING_ID,
            "runtime": "workflow",
            "channel": TURBOPUSH_CHANNEL,
            "input": {
                **turbopush_binding_input({**node.params, "contentType": content_type}),
                "service": {
                    "base_url": service.base_url,
                    "auth": "runtime-secret",
                    "source": service.source,
                },
            },
        },
        "turbopush": publish_contract,
    }


def _resolve_schedule_trigger(node: WorkflowProjectNode, *, node_id: str) -> dict[str, Any]:
    enabled = node.params.get("enabled")
    return {
        "binding": {
            "status": "bound",
            "binding_id": SCHEDULE_TRIGGER_BINDING_ID,
            "runtime": "workflow",
            "channel": "schedule",
            "input": {
                "interval": _read_string(node.params.get("interval")) or "5m",
                "timezone": _read_string(node.params.get("timezone")) or "Asia/Shanghai",
                "enabled": enabled if isinstance(enabled, bool) else True,
            },
        },
        "trigger": {
            "node_id": node_id,
            "mode": "manual_schedule_tick",
        },
    }


def _resolve_webhook_notifier(
    node: WorkflowProjectNode,
    adapter: WorkflowAdapterBinding | None,
    *,
    node_id: str,
) -> dict[str, Any]:
    config = adapter.config if adapter else {}
    webhook_url = _read_string(config.get("url")) or _read_string(config.get("webhook_url"))
    target = (
        _read_string(node.params.get("target")) or _read_string(config.get("target")) or "webhook"
    )
    delivery_configured = bool(webhook_url)
    notifier_contract = {
        "node_id": node_id,
        "type": "webhook",
        "binding_id": WEBHOOK_NOTIFY_BINDING_ID,
        "dispatch": "blocked_until_projection",
        "input": {
            "notifier_type": "webhook",
            "template": _read_string(node.params.get("template")) or "brief",
            "target": target,
            "adapter_mode": adapter.mode if adapter else "webhook",
            "delivery_configured": delivery_configured,
            "url": webhook_url,
            "config": config,
        },
    }
    if not delivery_configured:
        return {
            "notifier": notifier_contract,
            "missing_runtime": _dump_missing_runtime(
                WorkflowMissingRuntime(
                    code=MISSING_DELIVERY_PROJECTION,
                    node_id=node_id,
                    kind=node.kind,
                    capability=node.capability,
                    adapter_id=adapter.id if adapter else None,
                    provider=adapter.provider if adapter else None,
                    required_params=[
                        "evidencebatch_projection_api",
                        "delivery_projection",
                        "webhook_url",
                    ],
                    message=(
                        "Webhook Notify has a backend notifier contract, but live "
                        "delivery waits for EvidenceBatch projection and a "
                        "configured webhook URL."
                    ),
                )
            ),
        }

    return {
        "binding": {
            "status": "bound",
            "binding_id": WEBHOOK_NOTIFY_BINDING_ID,
            "runtime": "workflow",
            "channel": "notifier",
            "input": {
                "notifier_type": "webhook",
                "template": _read_string(node.params.get("template")) or "brief",
                "target": target,
                "adapter_mode": adapter.mode if adapter else "webhook",
                "delivery_configured": delivery_configured,
                "url": webhook_url,
                "config": config,
            },
        },
        "notifier": {
            "node_id": node_id,
            "type": "webhook",
            "dispatch": "guarded_delivery",
        },
    }


def _resolve_notify_send_node(
    node: WorkflowProjectNode,
    adapter: WorkflowAdapterBinding | None,
    *,
    node_id: str,
) -> dict[str, Any]:
    config = adapter.config if adapter else {}
    provider = adapter.provider if adapter else "workflow"
    notifier_type = (
        _read_string(config.get("notifierType"))
        or _read_string(config.get("notifier_type"))
        or ("webhook" if provider in {"generic-webhook", "webhook"} else provider)
    )
    target = (
        _read_string(node.params.get("target"))
        or _read_string(config.get("target"))
        or notifier_type
    )
    delivery_configured = bool(
        _read_string(config.get("url")) or _read_string(config.get("webhook_url"))
    )
    return {
        "binding": {
            "status": "bound",
            "binding_id": NOTIFY_SEND_BINDING_ID,
            "runtime": "workflow",
            "channel": "notifier",
            "input": {
                "notifier_type": notifier_type,
                "template": _read_string(node.params.get("template")) or "brief",
                "target": target,
                "adapter_mode": adapter.mode if adapter else "mock",
                "delivery_configured": delivery_configured,
                "config": config,
            },
        },
        "notifier": {
            "node_id": node_id,
            "type": notifier_type,
            "dispatch": "guarded_delivery" if delivery_configured else "blocked_until_delivery",
        },
    }


def _is_collection_need(node: WorkflowProjectNode) -> bool:
    ui = node.ui or {}
    return _read_string(ui.get("catalogId")) == "intelligence.input.collection-need" or (
        node.kind == "schedule"
        and node.capability == "trigger"
        and _read_string(node.params.get("mode")) == "demand-draft"
    )


def _is_source_pool(node: WorkflowProjectNode) -> bool:
    return _read_string((node.ui or {}).get("catalogId")) == "intelligence.source.pool"


def _compat_runtime_target(node: WorkflowProjectNode) -> Literal["n8n", "dify"] | None:
    compat = _read_dict(node.params.get("compatRuntime"))
    target = _read_string(compat.get("target"))
    if target in {"n8n", "dify"}:
        return target
    return None


def _is_source_fetch_node(
    node: WorkflowProjectNode,
    adapter: WorkflowAdapterBinding | None,
) -> bool:
    return node.kind == "source" and node.capability == "fetch" and adapter is not None


def _is_collection_output(node: WorkflowProjectNode) -> bool:
    return _read_string((node.ui or {}).get("catalogId")) == "intelligence.output.collection-result"


def _is_normalize_node(node: WorkflowProjectNode) -> bool:
    if node.internals or node.topicCollapse or node.miniNetwork:
        return False
    return _read_string(
        (node.ui or {}).get("catalogId")
    ) == "intelligence.processing.normalize" or (
        node.kind == "agent" and node.capability == "normalize"
    )


def _is_merge_node(node: WorkflowProjectNode) -> bool:
    return _read_string((node.ui or {}).get("catalogId")) == "intelligence.flow.merge" or (
        node.kind == "flow" and node.capability == "merge"
    )


def _is_router_route_node(node: WorkflowProjectNode) -> bool:
    return _read_string((node.ui or {}).get("catalogId")) == "intelligence.router.importance" or (
        node.kind == "router" and node.capability == "route"
    )


def _is_record_acceptance_gate(node: WorkflowProjectNode) -> bool:
    return _read_string(
        (node.ui or {}).get("catalogId")
    ) == "intelligence.control.record-acceptance" or (
        node.kind == "control" and node.capability == "accept"
    )


def _is_record_sink(node: WorkflowProjectNode) -> bool:
    return _read_string((node.ui or {}).get("catalogId")) == "intelligence.sink.records" or (
        node.kind == "sink" and node.capability == "store"
    )


def _is_inbox_store_node(node: WorkflowProjectNode) -> bool:
    return _read_string((node.ui or {}).get("catalogId")) == "intelligence.output.inbox" or (
        node.kind == "inbox" and node.capability == "store"
    )


def _is_external_tool_capability(node: WorkflowProjectNode) -> bool:
    return _read_string((node.ui or {}).get("catalogId")) == "external.tool.capability"


def _is_schedule_trigger(node: WorkflowProjectNode) -> bool:
    return node.kind == "schedule" and node.capability == "trigger"


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


def _is_webhook_notifier(
    node: WorkflowProjectNode,
    adapter: WorkflowAdapterBinding | None,
) -> bool:
    if node.kind != "notify" or node.capability != "send" or adapter is None:
        return False

    notifier_type = _read_string(adapter.config.get("notifierType"))
    return adapter.provider == "webhook" or notifier_type == "webhook"


def _is_notify_send_node(
    node: WorkflowProjectNode,
    adapter: WorkflowAdapterBinding | None,
) -> bool:
    return node.kind == "notify" and node.capability == "send" and adapter is not None


def _is_turbopush_publish(
    node: WorkflowProjectNode,
    adapter: WorkflowAdapterBinding | None,
) -> bool:
    if node.kind != "notify" or node.capability != "send" or adapter is None:
        return False

    config = adapter.config
    return (
        adapter.provider == TURBOPUSH_PROVIDER
        or _read_string(config.get("channel")) == TURBOPUSH_CHANNEL
        or _read_string(config.get("mcpServer")) == TURBOPUSH_MCP_SERVER
    )


def _read_string(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _read_int(value: Any) -> int | None:
    return value if isinstance(value, int) else None


def _read_number(value: Any) -> float | None:
    return float(value) if isinstance(value, int | float) else None


def _read_string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, str)]


def _read_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _dump_missing_runtime(missing_runtime: WorkflowMissingRuntime) -> dict[str, Any]:
    payload = missing_runtime.model_dump(exclude_none=True)
    if not payload.get("required_params"):
        payload.pop("required_params", None)
    return payload


def _attach_runtime_contract(
    metadata: dict[str, Any],
    *,
    node: WorkflowProjectNode,
    adapter: WorkflowAdapterBinding | None,
    node_id: str,
) -> dict[str, Any]:
    result = dict(metadata)
    binding = _read_dict(result.get("binding"))
    if binding:
        binding_id = _read_string(binding.get("binding_id"))
        contract = runtime_io_contract_manifest(binding_id)
        if contract is None:
            result.pop("binding", None)
            result["missing_runtime"] = _dump_missing_runtime(
                WorkflowMissingRuntime(
                    code=MISSING_RUNTIME_IO_CONTRACT,
                    node_id=node_id,
                    kind=node.kind,
                    capability=node.capability,
                    adapter_id=adapter.id if adapter else None,
                    provider=adapter.provider if adapter else None,
                    required_params=["runtime_io_contract"],
                    message=(
                        f'Runtime binding "{binding_id or "unknown"}" exists but '
                        "does not declare a real node I/O contract."
                    ),
                )
            )
        else:
            result["binding"] = {**binding, "contract": contract}

    for key, value in list(result.items()):
        if key in {"binding", "missing_runtime"} or not isinstance(value, dict):
            continue
        binding_id = _read_string(value.get("binding_id"))
        contract = runtime_io_contract_manifest(binding_id)
        if contract is not None:
            result[key] = {**value, "contract": contract}

    return result
