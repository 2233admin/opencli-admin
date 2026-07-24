"""Workflow capability projection for Canvas-visible nodes.

This is an audit/runtime-status surface, not an executor registry. It reports
which existing backend capabilities can support Canvas nodes today, and which
visible nodes are blocked until a real binding is added.
"""

from __future__ import annotations

from collections import Counter

from backend.channels.registry import list_channel_types
from backend.notifiers.registry import list_notifier_types
from backend.schemas.workflow import (
    WorkflowCapabilitiesResponse,
    WorkflowCapability,
    WorkflowCapabilityStatus,
    WorkflowCapabilitySurface,
    WorkflowNodeKind,
    WorkflowRuntimeCapability,
)
from backend.workflow.native_intelligence_executor import (
    NATIVE_INTELLIGENCE_LIFECYCLE_ACTIONS,
)
from backend.workflow.node_registry import WORKFLOW_PRIMITIVE_IDS
from backend.workflow.opencli_adapter_nodes import get_opencli_adapter_node_summary
from backend.workflow.runtime_contracts import runtime_io_contract_manifest
from backend.workflow.runtime_registry import (
    COLLECTION_OUTPUT_BINDING_ID,
    DEDUPE_BINDING_ID,
    DEMAND_DRAFT_BINDING_ID,
    EXTERNAL_TOOL_BINDING_ID,
    MERGE_BINDING_ID,
    NORMALIZE_BINDING_ID,
    OPENCLI_BINDING_ID,
    RECORD_ACCEPTANCE_BINDING_ID,
    RECORD_SINK_BINDING_ID,
    SCHEDULE_TRIGGER_BINDING_ID,
    SOURCE_POOL_BINDING_ID,
    TURBOPUSH_BINDING_ID,
    WEBHOOK_NOTIFY_BINDING_ID,
    WEBHOOK_TRIGGER_BINDING_ID,
)
from backend.workflow.tool_capabilities import list_workflow_tool_capabilities
from backend.workflow.turbopush_runtime import TURBOPUSH_PROVIDER


def build_workflow_capabilities() -> WorkflowCapabilitiesResponse:
    """Project real backend capabilities into Canvas runtime status rows."""

    return WorkflowCapabilitiesResponse(
        catalog=_catalog_capabilities(),
        primitives=_primitive_capabilities(),
        channels=_channel_capabilities(),
        notifiers=_notifier_capabilities(),
        triggers=_trigger_capabilities(),
        resources=_resource_capabilities(),
    )


def _capability(
    *,
    id: str,
    label: str,
    surface: WorkflowCapabilitySurface,
    status: WorkflowCapabilityStatus,
    backend_available: bool = False,
    kind: WorkflowNodeKind | None = None,
    capability: WorkflowCapability | None = None,
    provider: str | None = None,
    channel_type: str | None = None,
    notifier_type: str | None = None,
    runtime_binding: str | None = None,
    reason: str | None = None,
    missing: list[str] | None = None,
    tags: list[str] | None = None,
    source: str | None = None,
    manifest: dict[str, object] | None = None,
) -> WorkflowRuntimeCapability:
    resolved_manifest = _manifest_with_runtime_contract(manifest or {}, runtime_binding)
    return WorkflowRuntimeCapability(
        id=id,
        label=label,
        surface=surface,
        status=status,
        backendAvailable=backend_available,
        kind=kind,
        capability=capability,
        provider=provider,
        channelType=channel_type,
        notifierType=notifier_type,
        runtimeBinding=runtime_binding,
        reason=reason,
        missing=missing or [],
        tags=tags or [],
        source=source,
        manifest=resolved_manifest,
    )


def _catalog_capabilities() -> list[WorkflowRuntimeCapability]:
    expected_native_children = {
        action: f"tool.intelligence.native.{action}"
        for action in NATIVE_INTELLIGENCE_LIFECYCLE_ACTIONS
    }
    expected_native_ids = set(expected_native_children.values())
    native_tools = [
        tool
        for tool in list_workflow_tool_capabilities().tools
        if tool.executor.mode == "native_intelligence"
        and (
            tool.executor.params.get("action") in expected_native_children
            or tool.id in expected_native_ids
        )
    ]
    native_actions = [
        action
        if isinstance(action := tool.executor.params.get("action"), str)
        else "<missing>"
        for tool in native_tools
    ]
    native_ids = [tool.id for tool in native_tools]
    action_counts = Counter(native_actions)
    id_counts = Counter(native_ids)
    missing_actions = sorted(set(expected_native_children) - set(native_actions))
    extra_actions = sorted(set(native_actions) - set(expected_native_children))
    duplicate_actions = sorted(
        action for action, count in action_counts.items() if count > 1
    )
    missing_tool_ids = sorted(expected_native_ids - set(native_ids))
    extra_tool_ids = sorted(set(native_ids) - expected_native_ids)
    duplicate_tool_ids = sorted(
        tool_id for tool_id, count in id_counts.items() if count > 1
    )
    expected_pairs = {
        (tool_id, action) for action, tool_id in expected_native_children.items()
    }
    actual_pairs = set(zip(native_ids, native_actions, strict=True))
    missing_children = [
        {"id": tool_id, "action": action}
        for tool_id, action in sorted(expected_pairs - actual_pairs)
    ]
    extra_children = [
        {"id": tool_id, "action": action}
        for tool_id, action in sorted(actual_pairs - expected_pairs)
    ]
    native_blocked = [tool for tool in native_tools if tool.status != "runnable"]
    native_action_set_invalid = bool(
        missing_actions
        or extra_actions
        or duplicate_actions
        or missing_tool_ids
        or extra_tool_ids
        or duplicate_tool_ids
        or missing_children
        or extra_children
    )
    native_package_status: WorkflowCapabilityStatus = (
        "runnable"
        if not native_action_set_invalid and not native_blocked
        else "blocked"
    )
    native_package_missing = [
        reason
        for tool in native_blocked
        for reason in (
            tool.manifest.get("readiness", {}).get("missingReasons", [])
            if isinstance(tool.manifest.get("readiness"), dict)
            else ["child_readiness_missing"]
        )
        if isinstance(reason, str)
    ]
    if native_package_status != "runnable":
        native_package_missing.append("missing_native_intelligence_action_set")
    native_package_missing = sorted(set(native_package_missing))
    return [
        _capability(
            id="intelligence.input.collection-need",
            label="Collection Need",
            surface="catalog",
            status="runnable",
            backend_available=True,
            kind="schedule",
            capability="trigger",
            provider="workflow",
            runtime_binding=DEMAND_DRAFT_BINDING_ID,
            reason="Canvas demand input calls the backend demand-draft endpoint "
            "to assemble existing real source/package nodes into a reviewable patch.",
            tags=["input", "demand", "patch"],
            source="backend.workflow.demand_assembler",
            manifest=_manifest(
                schema="capability.workflow.demand-draft.v1",
                output_ports=[_port("patch", "workflowPatch")],
                resources=["capability_catalog"],
                permissions=["canvas_review_required"],
                runtime_binding=DEMAND_DRAFT_BINDING_ID,
                trace_events=["patch_preview", "compile_preview"],
                probes=["demand_draft_endpoint_available"],
            ),
        ),
        _capability(
            id="intelligence.schedule.cron",
            label="Cron Schedule",
            surface="catalog",
            status="runnable",
            backend_available=True,
            kind="schedule",
            capability="trigger",
            provider="workflow",
            runtime_binding=SCHEDULE_TRIGGER_BINDING_ID,
            reason="Canvas Run creates an authoritative workflow trigger tick "
            "from the schedule node params. Automatic scheduler-to-run creation "
            "is a separate scheduler integration.",
            tags=["trigger", "schedule", "run"],
            source="backend.workflow.runtime_registry",
        ),
        _capability(
            id="intelligence.source.jin10",
            label="JIN10 Source",
            surface="catalog",
            status="preview_only",
            backend_available=False,
            kind="source",
            capability="fetch",
            provider="jin10",
            reason="JIN10 is wired as a frontend fixture/live adapter, not as "
            "an authoritative backend workflow runtime binding.",
            missing=["backend_source_channel_binding"],
            tags=["source", "adapter", "preview"],
        ),
        _capability(
            id="intelligence.source.opencli-slot",
            label="OpenCLI Source Slot",
            surface="catalog",
            status="runnable",
            backend_available=True,
            kind="source",
            capability="fetch",
            provider="opencli",
            channel_type="opencli",
            runtime_binding=OPENCLI_BINDING_ID,
            reason="Backend workflow compile resolves OpenCLI source/fetch "
            "nodes to the III OpenCLI collector binding.",
            missing=["canvas_resource_resolution"],
            tags=["source", "opencli", "hda"],
            source="backend.workflow.runtime_registry",
            manifest=_manifest(
                schema="capability.source.opencli-slot.v1",
                input_ports=[_port("in", "trigger")],
                output_ports=[_port("out", "items[]")],
                resources=[
                    "opencli_channel",
                    "sourceOutputs_or_bound_task_or_worker_dispatch",
                ],
                permissions=["canFetchNetwork"],
                runtime_binding=OPENCLI_BINDING_ID,
                trace_events=[
                    "batch_ready",
                    "sourceOutputs",
                    "bound_task_records",
                    "completed",
                ],
                probes=["opencli_adapter_registered", "source_output_ingest_available"],
            ),
        ),
        _capability(
            id="intelligence.source.pool",
            label="Source Pool",
            surface="catalog",
            status="runnable",
            backend_available=True,
            kind="agent",
            capability="normalize",
            provider="workflow",
            runtime_binding=SOURCE_POOL_BINDING_ID,
            reason="OpenCLI HDA internals use this real workflow node to "
            "fan out package demand to source slots in parallel.",
            tags=["source", "pool", "fanout", "hda"],
            source="backend.workflow.runtime_registry",
            manifest=_manifest(
                schema="capability.source.pool.v1",
                input_ports=[_port("in", "trigger")],
                output_ports=[_port("out", "trigger")],
                resources=["capability_catalog"],
                permissions=[],
                runtime_binding=SOURCE_POOL_BINDING_ID,
                trace_events=["partial:sourceCount", "completed"],
                probes=["source_slots_present"],
            ),
        ),
        _capability(
            id="intelligence.processing.normalize",
            label="Normalize Items",
            surface="catalog",
            status="runnable",
            backend_available=True,
            kind="agent",
            capability="normalize",
            provider="workflow",
            runtime_binding=NORMALIZE_BINDING_ID,
            reason="OpenCLI Admin owns normalization as a native Transform node "
            "that turns source items into Record Candidates while preserving "
            "source references.",
            tags=["transform", "normalize", "record-candidate", "lineage"],
            source="backend.workflow.runtime_registry",
            manifest=_manifest(
                schema="capability.transform.normalize.v1",
                input_ports=[_port("in", "items[]")],
                output_ports=[_port("out", "recordCandidate[]")],
                resources=[],
                permissions=[],
                runtime_binding=NORMALIZE_BINDING_ID,
                trace_events=["partial:recordCandidate[]", "completed"],
                probes=["normalizer_import_available"],
            ),
        ),
        _capability(
            id="intelligence.processing.dedupe",
            label="Dedupe Items",
            surface="catalog",
            status="runnable",
            backend_available=True,
            kind="agent",
            capability="dedupe",
            provider="workflow",
            runtime_binding=DEDUPE_BINDING_ID,
            reason=(
                "Deterministically removes duplicate Record Candidates by the "
                "configured business key while preserving lineage."
            ),
            tags=["transform", "dedupe", "record-candidate", "lineage"],
            source="backend.workflow.runtime_registry",
            manifest=_manifest(
                schema="capability.transform.dedupe.v1",
                input_ports=[_port("in", "recordCandidate[]")],
                output_ports=[_port("out", "recordCandidate[]")],
                resources=[],
                permissions=[],
                runtime_binding=DEDUPE_BINDING_ID,
                trace_events=[
                    "partial:deduplicatedCandidateCount",
                    "partial:rejectedCount",
                    "completed",
                ],
                probes=["dedupe_runtime_binding_available"],
            ),
        ),
        _capability(
            id="intelligence.flow.merge",
            label="Merge",
            surface="catalog",
            status="runnable",
            backend_available=True,
            kind="flow",
            capability="merge",
            provider="workflow",
            runtime_binding=MERGE_BINDING_ID,
            reason="OpenCLI Admin owns typed fan-in as a native Flow node. "
            "The first loop supports concat while preserving lineage.",
            tags=["flow", "merge", "lineage", "typed-port"],
            source="backend.workflow.runtime_registry",
            manifest=_manifest(
                schema="capability.flow.merge.v1",
                input_ports=[
                    _port("in1", "recordCandidate[]"),
                    _port("in2", "recordCandidate[]"),
                ],
                output_ports=[_port("out", "recordCandidate[]")],
                resources=[],
                permissions=[],
                runtime_binding=MERGE_BINDING_ID,
                trace_events=["partial:mergedCandidateCount", "completed"],
                probes=["typed_port_contract_registered"],
            ),
        ),
        _blocked_catalog(
            "intelligence.agent.summary",
            "LLM Summary",
            "agent",
            "summarize",
            backend_available=True,
            missing=["provider_resource_binding", "workflow_agent_executor"],
        ),
        _blocked_catalog("intelligence.agent.score", "Importance Score", "agent", "score"),
        _blocked_catalog("intelligence.agent.tag", "Auto Tag", "agent", "tag"),
        _blocked_catalog(
            "intelligence.router.importance",
            "Importance Router",
            "router",
            "route",
            missing=["workflow_router_executor"],
        ),
        _capability(
            id="intelligence.control.record-acceptance",
            label="Record Acceptance Gate",
            surface="catalog",
            status="runnable",
            backend_available=True,
            kind="control",
            capability="accept",
            provider="workflow",
            runtime_binding=RECORD_ACCEPTANCE_BINDING_ID,
            reason="Record acceptance is a native Gate node that promotes "
            "Record Candidates to Records only after schema, dedupe, quality, "
            "and lineage checks.",
            tags=["control", "gate", "record", "quality", "lineage"],
            source="backend.workflow.runtime_registry",
            manifest=_manifest(
                schema="capability.control.record-acceptance.v1",
                input_ports=[_port("candidates", "recordCandidate[]")],
                output_ports=[_port("records", "record[]")],
                resources=["record_schema_registry"],
                permissions=["record_acceptance_policy"],
                runtime_binding=RECORD_ACCEPTANCE_BINDING_ID,
                trace_events=[
                    "partial:acceptedRecordCount",
                    "partial:reviewRequiredCount",
                    "completed",
                ],
                probes=["record_schema_available", "lineage_required_check"],
            ),
        ),
        _blocked_catalog(
            "intelligence.output.inbox",
            "Inbox Store",
            "inbox",
            "store",
            backend_available=True,
            missing=["workflow_storage_sink_binding"],
        ),
        _capability(
            id="intelligence.output.collection-result",
            label="Collection Output",
            surface="catalog",
            status="runnable",
            backend_available=True,
            kind="inbox",
            capability="store",
            provider="workflow",
            runtime_binding=COLLECTION_OUTPUT_BINDING_ID,
            reason="OpenCLI HDA internals expose normalized items through this "
            "real package output boundary.",
            tags=["output", "items", "hda"],
            source="backend.workflow.runtime_registry",
            manifest=_manifest(
                schema="capability.output.collection-result.v1",
                input_ports=[_port("in", "recordCandidate[]")],
                output_ports=[_port("out", "items[]")],
                resources=["run_trace"],
                permissions=[],
                runtime_binding=COLLECTION_OUTPUT_BINDING_ID,
                trace_events=["partial:itemCount", "completed"],
                probes=["package_output_boundary_available"],
            ),
        ),
        _capability(
            id="intelligence.sink.records",
            label="Record Sink",
            surface="catalog",
            status="runnable",
            backend_available=True,
            kind="sink",
            capability="store",
            provider="workflow",
            runtime_binding=RECORD_SINK_BINDING_ID,
            reason="Accepted Records write through this native sink boundary "
            "instead of raw scrape output entering records directly.",
            tags=["sink", "records", "lineage"],
            source="backend.workflow.runtime_registry",
            manifest=_manifest(
                schema="capability.sink.records.v1",
                input_ports=[_port("records", "record[]")],
                output_ports=[_port("stored", "storedItems[]")],
                resources=[
                    "data_sources",
                    "collection_tasks",
                    "collected_records",
                ],
                permissions=["canWriteInbox"],
                runtime_binding=RECORD_SINK_BINDING_ID,
                trace_events=["partial:storedRefs", "completed"],
                probes=["record_table_available", "task_source_ownership_available"],
            ),
        ),
        _capability(
            id="intelligence.output.webhook",
            label="Webhook Notify",
            surface="catalog",
            status="blocked",
            backend_available=True,
            kind="notify",
            capability="send",
            provider="webhook",
            notifier_type="webhook",
            runtime_binding=WEBHOOK_NOTIFY_BINDING_ID,
            reason="Backend notifier and real workflow delivery path exist; "
            "each run still requires send permission, an upstream EvidenceBatch "
            "projection, and a configured webhook URL.",
            missing=[
                "evidencebatch_projection_input",
                "send_permission",
                "webhook_url_configuration",
            ],
            tags=["catalog", "notify", "webhook"],
            source="backend.workflow.runtime_registry",
        ),
        _capability(
            id="intelligence.output.turbopush-publish",
            label="TurboPush Publish",
            surface="catalog",
            status="runnable",
            backend_available=True,
            kind="notify",
            capability="send",
            provider=TURBOPUSH_PROVIDER,
            notifier_type=TURBOPUSH_PROVIDER,
            runtime_binding=TURBOPUSH_BINDING_ID,
            reason="Backend workflow compile resolves this node to the local "
            "TurboPush MCP/HTTP publishing flow: logged accounts, platform "
            "setting schemas, content creation, SSE publish, and records.",
            missing=["local_turbopush_service_when_not_running", "send_permission"],
            tags=["catalog", "notify", "publish", "turbopush"],
            source="backend.workflow.turbopush_runtime",
        ),
        _capability(
            id="external.tool.capability",
            label="Imported Tool Capability",
            surface="catalog",
            status="runnable",
            backend_available=True,
            kind="action",
            capability="store",
            provider="opencli-admin",
            runtime_binding=EXTERNAL_TOOL_BINDING_ID,
            reason="LangGraph, LangChain, and other external runtime tool nodes "
            "import as OpenCLI Admin Tool Capability placeholders. The original "
            "runtime remains provenance only; each node must still provide an "
            "OpenCLI Admin toolCapability binding before execution.",
            missing=["node_level_tool_capability_binding_when_unconfigured"],
            tags=["catalog", "external-runtime", "tool-capability", "import"],
            source="backend.workflow.external_importer",
            manifest=_manifest(
                schema="capability.external.tool.v1",
                input_ports=[_port("in", "unknown")],
                output_ports=[_port("out", "unknown")],
                resources=[
                    "capability_catalog",
                    "tool_capability_registry",
                    "external_workflow_origin",
                    "node_params.toolCapability",
                ],
                permissions=["canvas_review_required"],
                runtime_binding=EXTERNAL_TOOL_BINDING_ID,
                trace_events=[
                    "blocked:missing_tool_capability_binding",
                    "tool_call_started",
                    "partial:outputItemCount",
                    "tool_call_completed",
                    "completed",
                ],
                probes=[
                    "external_origin_metadata_present",
                    "tool_capability_binding_present_when_runnable",
                ],
            ),
        ),
        _blocked_catalog(
            "package.collection.pipeline",
            "Collection Pipeline",
            "source",
            "fetch",
            backend_available=True,
            reason="The package describes existing channel capabilities, but is "
            "not generated from the backend channel registry yet.",
            missing=["channel_capability_projection", "package_materializer"],
        ),
        _capability(
            id="package.opencli.multi-source-hda",
            label="多站点数据采集",
            surface="catalog",
            status="runnable",
            backend_available=True,
            kind="agent",
            capability="normalize",
            provider="opencli",
            channel_type="opencli",
            runtime_binding=OPENCLI_BINDING_ID,
            reason="This package materializes params.sources into real OpenCLI "
            "source/fetch nodes. OpenCLI itself is the node capability; the "
            "package is only a composition wrapper.",
            missing=["canvas_resource_resolution", "projection_workbench"],
            tags=["package", "hda", "opencli"],
            source="backend.workflow.opencli_hda_tracer",
        ),
        _capability(
            id="package.processing.record-hygiene",
            label="记录清洗与准入",
            surface="catalog",
            status="runnable",
            backend_available=True,
            kind="agent",
            capability="normalize",
            provider="workflow",
            runtime_binding=DEDUPE_BINDING_ID,
            reason="Expands into native normalize, deterministic dedupe, and Record acceptance nodes.",
            missing=[],
            tags=["package", "hda", "normalize", "dedupe", "record-acceptance"],
            source="backend.workflow.runtime_registry",
        ),
        _capability(
            id="package.intelligence.situation-awareness",
            label="近 30 天事态感知",
            surface="catalog",
            status="runnable",
            backend_available=True,
            kind="agent",
            capability="normalize",
            provider="opencli-admin",
            runtime_binding=EXTERNAL_TOOL_BINDING_ID,
            reason="Materializes to the registered situation-awareness Tool Capability.",
            missing=[],
            tags=["package", "hda", "research", "situation-awareness"],
            source="backend.workflow.hda_templates",
        ),
        _capability(
            id="package.simulation.swarm-forecast",
            label="群体智能推演",
            surface="catalog",
            status="runnable",
            backend_available=True,
            kind="agent",
            capability="normalize",
            provider="opencli-admin",
            runtime_binding=EXTERNAL_TOOL_BINDING_ID,
            reason="Materializes to the registered local or MiroFish swarm Tool Capability.",
            missing=["mirofish_provider_credentials_when_selected"],
            tags=["package", "hda", "simulation", "swarm", "mirofish"],
            source="backend.workflow.hda_templates",
        ),
        _capability(
            id="package.intelligence.native-lifecycle",
            label="Native Intelligence Lifecycle",
            surface="catalog",
            status=native_package_status,
            backend_available=native_package_status == "runnable",
            kind="agent",
            capability="normalize",
            provider="opencli-admin",
            runtime_binding=EXTERNAL_TOOL_BINDING_ID,
            reason=(
                "Credential-free HDA composed from machine-certified native lifecycle "
                "Tool Capabilities on the WorkflowRun/Event spine."
            ),
            missing=native_package_missing,
            tags=["package", "hda", "intelligence", "native", "offline"],
            source="backend.workflow.hda_templates",
            manifest={
                "readiness": {
                    "status": native_package_status,
                    "childCount": len(native_tools),
                    "expectedChildCount": len(expected_native_children),
                    "blockedChildren": sorted({tool.id for tool in native_blocked}),
                    "missingReasons": native_package_missing,
                    "missingActions": missing_actions,
                    "extraActions": extra_actions,
                    "duplicateActions": duplicate_actions,
                    "missingToolIds": missing_tool_ids,
                    "extraToolIds": extra_tool_ids,
                    "duplicateToolIds": duplicate_tool_ids,
                    "missingChildren": missing_children,
                    "extraChildren": extra_children,
                }
            },
        ),
        _blocked_catalog(
            "package.dispatch.fanout",
            "Dispatch Fanout",
            "notify",
            "send",
            backend_available=True,
            missing=["workflow_notifier_sink_binding", "fanout_materializer"],
        ),
        _blocked_catalog(
            "package.intelligence.pipeline",
            "Intelligence Pipeline",
            "agent",
            "normalize",
        ),
        _blocked_catalog("package.ops.event", "Ops Event", "action", "send"),
        _blocked_catalog("package.ops.monitor-guard", "Monitor Guard", "router", "route"),
        _blocked_catalog(
            "package.ops.alert-response",
            "Alert Response",
            "notify",
            "send",
            backend_available=True,
            missing=["workflow_notifier_sink_binding", "ticket_sink_binding"],
        ),
        _blocked_catalog(
            "package.ai.prompt-experiment",
            "Prompt Experiment",
            "agent",
            "summarize",
            backend_available=True,
            missing=["provider_resource_binding", "experiment_executor"],
        ),
        _blocked_catalog(
            "package.verify.regression-gate",
            "Regression Gate",
            "router",
            "route",
            missing=["evaluator_runtime_binding"],
        ),
        _blocked_catalog("package.map.knowledge-map", "Knowledge Map", "action", "store"),
        _blocked_catalog(
            "package.review.human-review",
            "Human Review",
            "inbox",
            "store",
            backend_available=True,
            missing=["workflow_review_sink_binding"],
        ),
    ]


def _manifest(
    *,
    schema: str,
    input_ports: list[dict[str, str]] | None = None,
    output_ports: list[dict[str, str]] | None = None,
    resources: list[str] | None = None,
    permissions: list[str] | None = None,
    runtime_binding: str | None = None,
    trace_events: list[str] | None = None,
    probes: list[str] | None = None,
) -> dict[str, object]:
    return {
        "schema": schema,
        "ports": {
            "inputs": input_ports or [],
            "outputs": output_ports or [],
        },
        "resources": resources or [],
        "permissions": permissions or [],
        "runtime": {
            "binding": runtime_binding,
        },
        "trace": {
            "events": trace_events or ["queued", "started", "partial", "completed"],
        },
        "probes": probes or [],
    }


def _port(name: str, type: str) -> dict[str, str]:
    return {"name": name, "type": type}


def _blocked_catalog(
    id: str,
    label: str,
    kind: WorkflowNodeKind,
    capability: WorkflowCapability,
    *,
    backend_available: bool = False,
    reason: str | None = None,
    missing: list[str] | None = None,
) -> WorkflowRuntimeCapability:
    return _capability(
        id=id,
        label=label,
        surface="catalog",
        status="blocked",
        backend_available=backend_available,
        kind=kind,
        capability=capability,
        reason=reason
        or "The node is visible in Canvas, but no authoritative workflow "
        "runtime binding exists yet.",
        missing=missing or ["workflow_runtime_binding"],
        tags=["catalog", kind, capability],
    )


def _primitive_capabilities() -> list[WorkflowRuntimeCapability]:
    special = {
        "primitive.core.webhook-trigger": _capability(
            id="primitive.core.webhook-trigger",
            label="Webhook Trigger",
            surface="primitive",
            status="runnable",
            backend_available=True,
            kind="schedule",
            capability="trigger",
            runtime_binding=WEBHOOK_TRIGGER_BINDING_ID,
            reason="The workflow webhook input contract has HTTP ingress "
            "and run dispatch.",
            missing=[],
            tags=["primitive", "webhook", "trigger"],
        ),
        "primitive.ops.trigger-webhook": _capability(
            id="primitive.ops.trigger-webhook",
            label="Webhook Trigger",
            surface="primitive",
            status="runnable",
            backend_available=True,
            kind="schedule",
            capability="trigger",
            runtime_binding=WEBHOOK_TRIGGER_BINDING_ID,
            reason="The workflow webhook input contract has HTTP ingress "
            "and run dispatch.",
            missing=[],
            tags=["primitive", "webhook", "trigger"],
        ),
        "primitive.ops.action-webhook": _capability(
            id="primitive.ops.action-webhook",
            label="Webhook Action",
            surface="primitive",
            status="blocked",
            backend_available=True,
            kind="notify",
            capability="send",
            reason="Backend webhook notifier and the catalog sink contract exist, "
            "but primitive action execution and projection delivery are not bound.",
            missing=["primitive_executor_binding", "delivery_projection"],
            tags=["primitive", "webhook", "notify"],
        ),
        "primitive.core.respond-webhook": _capability(
            id="primitive.core.respond-webhook",
            label="Respond to Webhook",
            surface="primitive",
            status="blocked",
            backend_available=False,
            kind="notify",
            capability="send",
            reason="Respond-to-webhook requires workflow run input envelopes and "
            "projection APIs before it can be real.",
            missing=["runtime_input_envelope", "projection_api"],
            tags=["primitive", "webhook", "response"],
        ),
    }

    rows: list[WorkflowRuntimeCapability] = []
    for primitive_id in sorted(WORKFLOW_PRIMITIVE_IDS):
        rows.append(
            special.get(primitive_id)
            or _capability(
                id=primitive_id,
                label=_label_from_id(primitive_id),
                surface="primitive",
                status="design_only",
                backend_available=False,
                reason="Primitive ids are accepted as import/design vocabulary, "
                "but no primitive executor binding exists yet.",
                missing=["primitive_executor_binding"],
                tags=["primitive"],
            )
        )
    return rows


def _channel_capabilities() -> list[WorkflowRuntimeCapability]:
    rows: list[WorkflowRuntimeCapability] = []
    for channel_type in sorted(list_channel_types()):
        if channel_type == "opencli":
            rows.append(
                _capability(
                    id=f"channel.{channel_type}",
                    label="OpenCLI channel",
                    surface="channel",
                    status="runnable",
                    backend_available=True,
                    kind="source",
                    capability="fetch",
                    provider="opencli",
                    channel_type=channel_type,
                    runtime_binding=OPENCLI_BINDING_ID,
                    reason="The workflow runtime registry resolves OpenCLI "
                    "source/fetch nodes to this channel.",
                    missing=["canvas_resource_resolution"],
                    tags=["channel", "source", "opencli"],
                    source="backend.channels.opencli_channel",
                )
            )
            continue

        rows.append(
            _capability(
                id=f"channel.{channel_type}",
                label=f"{channel_type} channel",
                surface="channel",
                status="blocked",
                backend_available=True,
                kind="source",
                capability="fetch",
                provider=channel_type,
                channel_type=channel_type,
                reason="A real DataSource channel exists, but it has not been "
                "projected into Canvas source nodes or workflow runtime binding.",
                missing=["canvas_source_projection", "workflow_runtime_binding"],
                tags=["channel", "source"],
                source=f"backend.channels.{channel_type}_channel",
            )
        )
    return rows


def _notifier_capabilities() -> list[WorkflowRuntimeCapability]:
    rows: list[WorkflowRuntimeCapability] = []
    for notifier_type in sorted(list_notifier_types()):
        if notifier_type == "webhook":
            rows.append(
                _capability(
                    id="notifier.webhook",
                    label="webhook notifier",
                    surface="notifier",
                    status="blocked",
                    backend_available=True,
                    kind="notify",
                    capability="send",
                    provider="webhook",
                    notifier_type="webhook",
                    runtime_binding=WEBHOOK_NOTIFY_BINDING_ID,
                    reason="The guarded webhook notifier is wired into workflow "
                    "delivery; each run still requires projection input and URL "
                    "configuration.",
                    missing=[
                        "evidencebatch_projection_input",
                        "webhook_url_configuration",
                    ],
                    tags=["notifier", "output", "webhook"],
                    source="backend.notifiers.webhook_notifier",
                )
            )
            continue

        rows.append(
            _capability(
                id=f"notifier.{notifier_type}",
                label=f"{notifier_type} notifier",
                surface="notifier",
                status="blocked",
                backend_available=True,
                kind="notify",
                capability="send",
                provider=notifier_type,
                notifier_type=notifier_type,
                reason="The notifier exists, but Canvas output nodes do not yet "
                "bind to this notifier type.",
                missing=["workflow_notifier_sink_binding", "delivery_projection"],
                tags=["notifier", "output"],
            )
        )
    return rows


def _trigger_capabilities() -> list[WorkflowRuntimeCapability]:
    return [
        _capability(
            id="trigger.manual",
            label="Manual workflow run",
            surface="trigger",
            status="runnable",
            backend_available=True,
            kind="schedule",
            capability="trigger",
            reason="Frontend Canvas Run calls the backend workflow run API and "
            "replays node events onto existing Canvas nodes. User collection "
            "needs are drafted separately before the run starts.",
            missing=[],
            tags=["trigger", "manual"],
        ),
        _capability(
            id="trigger.webhook",
            label="Inbound webhook trigger",
            surface="trigger",
            status="runnable",
            backend_available=True,
            kind="schedule",
            capability="trigger",
            runtime_binding=WEBHOOK_TRIGGER_BINDING_ID,
            reason="The workflow webhook input contract has HTTP ingress "
            "and run dispatch.",
            missing=[],
            tags=["trigger", "webhook"],
        ),
    ]


def _resource_capabilities() -> list[WorkflowRuntimeCapability]:
    opencli_adapter_summary = get_opencli_adapter_node_summary()
    rows = [
        _resource("resource.source-credentials", "Source credentials"),
        _resource("resource.cookie-jar", "Cookie/session state"),
        _resource("resource.browser-profile", "Browser profile binding"),
        _resource("resource.browser-worker-pool", "Browser worker pool"),
        _resource("resource.turbopush-local-service", "TurboPush local service"),
        _capability(
            id="resource.workflow-fleet-runtime",
            label="Workflow Fleet Runtime Projection",
            surface="resource",
            status="runnable",
            backend_available=True,
            provider="opencli-admin",
            runtime_binding="workflow.fleet.inventory",
            reason=(
                "Existing browser pool, HTTP/WS agents, EdgeNode state, and "
                "site bindings are projected into a workflow-runtime fleet view."
            ),
            missing=[],
            tags=["resource", "fleet", "agent", "browser-pool"],
            source="backend.workflow.fleet_inventory",
            manifest={
                "schema": "resource.workflow-fleet-runtime.v1",
                "canvas": {"node": False},
                "endpoints": {
                    "inventory": "/api/v1/workflows/fleet/inventory",
                    "match": "/api/v1/workflows/fleet/match",
                },
                "inputs": [
                    "browser_pool",
                    "browser_instances",
                    "edge_nodes",
                    "browser_bindings",
                    "ws_agent_connections",
                    "opencli_adapter_nodes",
                ],
                "trace": {
                    "events": [
                        "fleet_agent_selected",
                        "fleet_dispatch_started",
                        "fleet_dispatch_completed",
                    ]
                },
            },
        ),
        _capability(
            id="resource.opencli-adapter-nodes",
            label="OpenCLI Adapter Node Registry",
            surface="resource",
            status="runnable" if opencli_adapter_summary.get("total") else "blocked",
            backend_available=bool(opencli_adapter_summary.get("total")),
            provider="opencli",
            runtime_binding=OPENCLI_BINDING_ID,
            reason=(
                "Every OpenCLI adapter command is projected as a stable node "
                "manifest. Read adapters materialize through OpenCLI Source Slot; "
                "write adapters require Tool Capability review."
            ),
            missing=[] if opencli_adapter_summary.get("total") else ["opencli_catalog"],
            tags=["resource", "opencli", "adapter-node-registry"],
            source="backend.workflow.opencli_adapter_nodes",
            manifest={
                "schema": "resource.opencli-adapter-node-registry.v1",
                "endpoint": "/api/v1/workflows/opencli-adapter-nodes",
                "summary": opencli_adapter_summary,
                "canvas": {"node": False},
                "materialization": {
                    "readNoRequiredArgs": "intelligence.source.opencli-slot",
                    "readRequiredArgs": "intelligence.source.opencli-slot with params",
                    "write": "external.tool.capability with review",
                },
                "runtime": {"binding": OPENCLI_BINDING_ID},
            },
        ),
    ]
    rows.extend(
        _capability(
            id=f"resource.tool-capability.{tool.id}",
            label=tool.label,
            surface="resource",
            status=tool.status,
            backend_available=tool.status == "runnable",
            provider=tool.provider,
            runtime_binding=_read_manifest_runtime_binding(tool.manifest),
            reason=tool.description,
            missing=[] if tool.status == "runnable" else ["tool_capability_unavailable"],
            tags=["resource", "tool-capability", *tool.tags],
            source="backend.workflow.tool_capabilities",
            manifest={
                **tool.manifest,
                "toolCapability": {
                    "id": tool.id,
                    "inputPorts": [port.model_dump() for port in tool.inputPorts],
                    "outputPorts": [port.model_dump() for port in tool.outputPorts],
                    "executor": tool.executor.model_dump(),
                },
            },
        )
        for tool in list_workflow_tool_capabilities().tools
    )
    return rows


def _resource(id: str, label: str) -> WorkflowRuntimeCapability:
    return _capability(
        id=id,
        label=label,
        surface="resource",
        status="blocked",
        backend_available=True,
        reason="The runtime resource exists in the backend surface, but Canvas "
        "source materialization does not resolve it implicitly yet.",
        missing=["canvas_resource_resolver"],
        tags=["resource"],
    )


def _read_manifest_runtime_binding(manifest: dict[str, object]) -> str | None:
    runtime = manifest.get("runtime")
    if not isinstance(runtime, dict):
        return None
    binding = runtime.get("binding")
    return binding if isinstance(binding, str) else None


def _manifest_with_runtime_contract(
    manifest: dict[str, object],
    runtime_binding: str | None,
) -> dict[str, object]:
    contract = runtime_io_contract_manifest(runtime_binding)
    if contract is None:
        return manifest
    return {**manifest, "contract": contract}


def _label_from_id(value: str) -> str:
    return value.rsplit(".", 1)[-1].replace("-", " ").title()
