"""Workflow capability projection for Canvas-visible nodes.

This is an audit/runtime-status surface, not an executor registry. It reports
which existing backend capabilities can support Canvas nodes today, and which
visible nodes are blocked until a real binding is added.
"""

from __future__ import annotations

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
from backend.workflow.node_registry import WORKFLOW_PRIMITIVE_IDS
from backend.workflow.runtime_registry import (
    DEMAND_DRAFT_BINDING_ID,
    OPENCLI_BINDING_ID,
    SCHEDULE_TRIGGER_BINDING_ID,
    WEBHOOK_NOTIFY_BINDING_ID,
)


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
) -> WorkflowRuntimeCapability:
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
    )


def _catalog_capabilities() -> list[WorkflowRuntimeCapability]:
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
        ),
        _blocked_catalog(
            "intelligence.processing.normalize",
            "Normalize Items",
            "agent",
            "normalize",
            reason="Normalize exists as an HDA internal trace node, but has no "
            "standalone workflow executor binding.",
            missing=["workflow_transform_executor"],
        ),
        _blocked_catalog(
            "intelligence.processing.dedupe",
            "Dedupe Items",
            "agent",
            "dedupe",
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
        _blocked_catalog(
            "intelligence.output.inbox",
            "Inbox Store",
            "inbox",
            "store",
            backend_available=True,
            missing=["workflow_storage_sink_binding"],
        ),
        _capability(
            id="intelligence.output.webhook",
            label="Webhook Notify",
            surface="catalog",
            status="runnable",
            backend_available=True,
            kind="notify",
            capability="send",
            provider="webhook",
            notifier_type="webhook",
            runtime_binding=WEBHOOK_NOTIFY_BINDING_ID,
            reason="Backend workflow compile resolves Webhook Notify nodes to "
            "the guarded webhook notifier sink binding. Delivery still depends "
            "on notification permission and configured webhook URL at send time.",
            tags=["catalog", "notify", "webhook"],
            source="backend.workflow.runtime_registry",
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
            label="OpenCLI Multi-source HDA",
            surface="catalog",
            status="runnable",
            backend_available=True,
            kind="agent",
            capability="normalize",
            provider="opencli",
            channel_type="opencli",
            runtime_binding=OPENCLI_BINDING_ID,
            reason="Backend materializes params.sources into real OpenCLI "
            "source slots and emits node-level run events.",
            missing=["canvas_resource_resolution", "projection_workbench"],
            tags=["package", "hda", "opencli"],
            source="backend.workflow.opencli_hda_tracer",
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
            status="blocked",
            backend_available=True,
            kind="schedule",
            capability="trigger",
            reason="Backend source webhook ingress exists, but workflow-level "
            "webhook trigger binding is not connected to runs.",
            missing=["workflow_webhook_trigger_binding", "runtime_input_envelope"],
            tags=["primitive", "webhook", "trigger"],
        ),
        "primitive.ops.trigger-webhook": _capability(
            id="primitive.ops.trigger-webhook",
            label="Webhook Trigger",
            surface="primitive",
            status="blocked",
            backend_available=True,
            kind="schedule",
            capability="trigger",
            reason="Backend source webhook ingress exists, but workflow-level "
            "webhook trigger binding is not connected to runs.",
            missing=["workflow_webhook_trigger_binding", "runtime_input_envelope"],
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
            reason="Backend webhook notifier exists, but workflow notifier sink "
            "binding is not connected.",
            missing=["workflow_notifier_sink_binding", "delivery_projection"],
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
                    status="runnable",
                    backend_available=True,
                    kind="notify",
                    capability="send",
                    provider="webhook",
                    notifier_type="webhook",
                    runtime_binding=WEBHOOK_NOTIFY_BINDING_ID,
                    reason="Workflow notify/send nodes can bind to the guarded "
                    "webhook notifier sink.",
                    missing=["delivery_projection"],
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
            status="blocked",
            backend_available=True,
            kind="schedule",
            capability="trigger",
            reason="Source webhook ingress exists, but workflow-level webhook "
            "triggers are not connected to workflow runs.",
            missing=["workflow_webhook_trigger_binding", "runtime_input_envelope"],
            tags=["trigger", "webhook"],
        ),
    ]


def _resource_capabilities() -> list[WorkflowRuntimeCapability]:
    return [
        _resource("resource.source-credentials", "Source credentials"),
        _resource("resource.cookie-jar", "Cookie/session state"),
        _resource("resource.browser-profile", "Browser profile binding"),
        _resource("resource.browser-worker-pool", "Browser worker pool"),
    ]


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


def _label_from_id(value: str) -> str:
    return value.rsplit(".", 1)[-1].replace("-", " ").title()
