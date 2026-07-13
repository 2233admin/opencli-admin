"""Workflow node catalog ids accepted by the backend compiler.

The frontend remains the authoring catalog owner. This backend mirror is a
guardrail: compiled nodes may reference existing catalog/primitive ids or n8n
translations, but they may not smuggle freshly invented primitive/executor
definitions into the runtime.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from backend.schemas.workflow import WorkflowProjectNode

NodeOriginKind = Literal["node_library", "primitive_library", "n8n", "legacy"]

WORKFLOW_CATALOG_IDS = {
    "intelligence.input.collection-need",
    "intelligence.schedule.cron",
    "intelligence.source.jin10",
    "intelligence.source.pool",
    "intelligence.source.opencli-slot",
    "intelligence.processing.normalize",
    "intelligence.processing.dedupe",
    "intelligence.flow.merge",
    "intelligence.agent.summary",
    "intelligence.agent.score",
    "intelligence.agent.tag",
    "intelligence.router.importance",
    "intelligence.control.record-acceptance",
    "intelligence.output.inbox",
    "intelligence.output.webhook",
    "intelligence.output.collection-result",
    "intelligence.sink.records",
    "intelligence.output.turbopush-publish",
    "external.tool.capability",
    "package.collection.pipeline",
    "package.opencli.multi-source-hda",
    "package.dispatch.fanout",
    "package.intelligence.pipeline",
    "package.ops.event",
    "package.ops.monitor-guard",
    "package.ops.alert-response",
    "package.ai.prompt-experiment",
    "package.verify.regression-gate",
    "package.map.knowledge-map",
    "package.review.human-review",
}

WORKFLOW_PRIMITIVE_IDS = {
    "primitive.input.adapter-read",
    "primitive.input.manual-sample",
    "primitive.transform.parse-json",
    "primitive.transform.map-fields",
    "primitive.transform.filter-items",
    "primitive.transform.limit-window",
    "primitive.ai.prompt-template",
    "primitive.ai.prompt-version",
    "primitive.ai.prompt-test-case",
    "primitive.ai.model-call",
    "primitive.ai.model-compare",
    "primitive.ai.score-dimensions",
    "primitive.logic.condition",
    "primitive.logic.branch-label",
    "primitive.state.cache-window",
    "primitive.state.inbox-write",
    "primitive.output.payload-format",
    "primitive.output.mock-send",
    "primitive.verify.assert-schema",
    "primitive.verify.coverage-mark",
    "primitive.verify.trace-span",
    "primitive.verify.eval-dataset",
    "primitive.verify.evaluator",
    "primitive.verify.experiment-run",
    "primitive.verify.scorecard",
    "primitive.verify.regression-gate",
    "primitive.business.source-health",
    "primitive.business.freshness-gate",
    "primitive.business.entity-extract",
    "primitive.business.topic-classify",
    "primitive.business.sentiment-score",
    "primitive.business.impact-estimate",
    "primitive.business.evidence-pack",
    "primitive.business.digest-compose",
    "primitive.business.human-approval",
    "primitive.business.delivery-rate-limit",
    "primitive.ops.trigger-manual",
    "primitive.ops.trigger-schedule",
    "primitive.ops.trigger-interval",
    "primitive.ops.trigger-single-shot",
    "primitive.ops.trigger-webhook",
    "primitive.ops.trigger-startup",
    "primitive.ops.trigger-catch-up",
    "primitive.ops.trigger-range",
    "primitive.ops.trigger-blackout",
    "primitive.ops.trigger-delay",
    "primitive.ops.trigger-precision",
    "primitive.ops.limit-runtime",
    "primitive.ops.limit-concurrency",
    "primitive.ops.limit-output-size",
    "primitive.ops.limit-memory",
    "primitive.ops.limit-cpu",
    "primitive.ops.limit-retry",
    "primitive.ops.limit-queue",
    "primitive.ops.limit-file",
    "primitive.ops.limit-daily",
    "primitive.ops.action-email",
    "primitive.ops.action-webhook",
    "primitive.ops.action-run-event",
    "primitive.ops.action-channel",
    "primitive.ops.action-snapshot",
    "primitive.ops.action-ticket",
    "primitive.ops.action-plugin",
    "primitive.ops.action-suspend-job",
    "primitive.ops.action-disable-event",
    "primitive.ops.action-bucket-store",
    "primitive.ops.action-bucket-fetch",
    "primitive.ops.action-apply-tags",
    "primitive.ops.monitor-metric-expression",
    "primitive.ops.monitor-data-match",
    "primitive.ops.monitor-delta",
    "primitive.ops.monitor-quick",
    "primitive.ops.plugin-shell",
    "primitive.ops.plugin-http-request",
    "primitive.ops.plugin-docker",
    "primitive.ops.plugin-test-fixture",
    "primitive.ops.secret-ref",
    "primitive.core.manual-trigger",
    "primitive.core.schedule-trigger",
    "primitive.core.webhook-trigger",
    "primitive.core.error-trigger",
    "primitive.core.edit-fields",
    "primitive.core.code",
    "primitive.core.http-request",
    "primitive.core.respond-webhook",
    "primitive.core.if",
    "primitive.core.switch",
    "primitive.core.merge",
    "primitive.core.loop-over-items",
    "primitive.core.wait",
    "primitive.core.execute-workflow",
    "primitive.core.stop-and-error",
    "primitive.core.filter",
    "primitive.core.remove-duplicates",
    "primitive.core.sort",
    "primitive.core.limit",
    "primitive.core.aggregate",
    "primitive.core.split-out",
    "primitive.core.date-time",
    "primitive.core.no-op",
    "primitive.map.source-anchor",
    "primitive.map.jump-back",
    "primitive.map.mini-map",
    "primitive.map.topic-collapse",
    "primitive.map.semantic-link",
    "primitive.map.link-weight",
    "primitive.map.knowledge-export",
}

FORBIDDEN_UI_KEYS = {
    "executor",
    "executorBinding",
    "generatedPrimitive",
    "implementation",
    "primitiveImplementation",
    "rawExecutor",
}

FORBIDDEN_PARAM_KEYS = {
    "commandLine",
    "concurrency",
    "concurrencyLimit",
    "cookie",
    "cookieHeader",
    "cookieMaterial",
    "cookies",
    "lockId",
    "maxConcurrency",
    "profileBinding",
    "profileBindingId",
    "profileId",
    "profileLockId",
    "rawExecutor",
    "rawIIIPayload",
    "rawOpencliCommand",
    "rawOpenCLICommand",
    "rawCommand",
    "resourceTags",
    "resolvedCommand",
    "sessionId",
    "sessionPolicy",
    "sessionSnapshotId",
    "workerId",
    "workerPool",
    "workerSlotId",
    "workerTags",
}


class WorkflowNodeOrigin(BaseModel):
    kind: NodeOriginKind
    catalog_id: str | None = None
    primitive_id: str | None = None
    n8n: dict[str, Any] | None = None
    missing_capability: str | None = None
    notes: list[str] = Field(default_factory=list)


def resolve_node_origin(node: WorkflowProjectNode) -> WorkflowNodeOrigin:
    """Resolve the node source without inventing any runtime implementation."""

    ui = node.ui or {}
    catalog_id = _read_string(ui.get("catalogId"))
    primitive_id = _read_string(ui.get("primitiveId"))
    n8n = _read_n8n(ui.get("n8n"))
    missing_capability = _read_string(ui.get("missingCapability"))

    if catalog_id in WORKFLOW_CATALOG_IDS:
        return WorkflowNodeOrigin(kind="node_library", catalog_id=catalog_id)
    if primitive_id in WORKFLOW_PRIMITIVE_IDS:
        return WorkflowNodeOrigin(kind="primitive_library", primitive_id=primitive_id)
    if n8n is not None:
        return WorkflowNodeOrigin(
            kind="n8n",
            n8n=n8n,
            missing_capability=missing_capability,
        )

    notes = []
    if catalog_id:
        notes.append(f"unknown catalogId: {catalog_id}")
    if primitive_id:
        notes.append(f"unknown primitiveId: {primitive_id}")
    if missing_capability:
        notes.append(f"missing capability: {missing_capability}")
    return WorkflowNodeOrigin(kind="legacy", missing_capability=missing_capability, notes=notes)


def forbidden_node_definition_keys(node: WorkflowProjectNode) -> list[str]:
    """Return raw implementation keys that are never valid workflow authoring data."""

    ui = node.ui or {}
    keys = [f"ui.{key}" for key in sorted(FORBIDDEN_UI_KEYS) if key in ui]
    keys.extend(_forbidden_param_paths(node.params))
    return keys


def _forbidden_param_paths(
    value: Any,
    *,
    path: tuple[str, ...] = ("params",),
) -> list[str]:
    paths: list[str] = []
    if isinstance(value, dict):
        for key, nested in value.items():
            nested_path = (*path, str(key))
            if key in FORBIDDEN_PARAM_KEYS:
                paths.append(".".join(nested_path))
            paths.extend(_forbidden_param_paths(nested, path=nested_path))
    elif isinstance(value, list):
        for index, nested in enumerate(value):
            paths.extend(_forbidden_param_paths(nested, path=(*path, str(index))))
    return paths


def _read_string(value: Any) -> str | None:
    return value if isinstance(value, str) and value else None


def _read_n8n(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    return dict(value) if value.get("source") == "n8n" else None
