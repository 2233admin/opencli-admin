"""OpenCLI Admin Tool Capability registry."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from pydantic import ValidationError

from backend.schemas.workflow import (
    WorkflowCapabilityVersionPin,
    WorkflowToolCapabilitiesResponse,
    WorkflowToolCapability,
    WorkflowToolCapabilityExecutor,
    WorkflowToolCapabilityPort,
)
from backend.workflow.realtime_market_executor import OKX_MARKET_TICKER_SNAPSHOT_EXECUTOR

WORKFLOW_TOOL_PACKAGE = "opencli-admin"
WORKFLOW_TOOL_PACKAGE_VERSION = "0.1.0"
ALLOWED_AUTHORITATIVE_PROVENANCE = {"built-in", "verified"}


@dataclass(frozen=True)
class WorkflowCapabilityPinIssue:
    code: str
    message: str


def validate_workflow_tool_capability_version_pin(
    tool_id: str,
    version_pin: Any,
) -> WorkflowCapabilityPinIssue | None:
    """Validate a node pin against the installed Tool Capability registry."""

    tool = resolve_workflow_tool_capability(tool_id)
    if tool is None:
        return WorkflowCapabilityPinIssue(
            code="unknown_tool_capability",
            message=f'Tool Capability "{tool_id}" is not installed in the registry.',
        )
    if not isinstance(version_pin, dict):
        return WorkflowCapabilityPinIssue(
            code="unpinned_tool_capability",
            message=(
                "must pin the exact package and capability version for "
                f'Tool Capability "{tool_id}".'
            ),
        )

    provenance = version_pin.get("provenance")
    if provenance not in ALLOWED_AUTHORITATIVE_PROVENANCE:
        return WorkflowCapabilityPinIssue(
            code="disallowed_tool_capability_provenance",
            message=(
                f'Tool Capability "{tool_id}" uses provenance {provenance!r}; '
                "authoritative definitions allow only built-in or verified packages."
            ),
        )

    try:
        submitted = WorkflowCapabilityVersionPin.model_validate(version_pin)
    except ValidationError:
        return WorkflowCapabilityPinIssue(
            code="invalid_tool_capability_version_pin",
            message=f'Tool Capability "{tool_id}" has an incomplete version pin.',
        )

    expected = tool.versionPin
    if submitted != expected:
        return WorkflowCapabilityPinIssue(
            code="tool_capability_version_pin_mismatch",
            message=(
                f'Tool Capability "{tool_id}" version pin does not match the '
                "installed registry entry."
            ),
        )
    return None


def _version_pin(capability_version: str = "1.0.0") -> WorkflowCapabilityVersionPin:
    return WorkflowCapabilityVersionPin(
        package=WORKFLOW_TOOL_PACKAGE,
        packageVersion=WORKFLOW_TOOL_PACKAGE_VERSION,
        capabilityVersion=capability_version,
        provenance="built-in",
    )


def list_workflow_tool_capabilities() -> WorkflowToolCapabilitiesResponse:
    """Return registered OpenCLI Admin tool capabilities."""

    return WorkflowToolCapabilitiesResponse(tools=_tool_capabilities())


def resolve_workflow_tool_capability(tool_id: str) -> WorkflowToolCapability | None:
    """Resolve a tool capability by id."""

    return next((tool for tool in _tool_capabilities() if tool.id == tool_id), None)


def _tool_capabilities() -> list[WorkflowToolCapability]:
    return [
        WorkflowToolCapability(
            id="tool.search.fixture",
            label="Fixture Search Tool",
            description=(
                "Deterministic fixture-backed search capability for imported "
                "external-runtime Tool nodes during Canvas review."
            ),
            status="runnable",
            provider="opencli-admin",
            inputPorts=[WorkflowToolCapabilityPort(name="in", type="unknown")],
            outputPorts=[WorkflowToolCapabilityPort(name="out", type="unknown")],
            executor=WorkflowToolCapabilityExecutor(
                mode="fixture",
                description="Reads fixture output from node params.",
            ),
            versionPin=_version_pin(),
            tags=["tool", "fixture", "external-runtime", "review"],
            manifest={
                "schema": "tool-capability.fixture-search.v1",
                "runtime": {"binding": "workflow.external-tool.capability"},
                "permissions": ["canvas_review_required"],
                "trace": {
                    "events": [
                        "tool_call_started",
                        "partial:outputItemCount",
                        "tool_call_completed",
                        "completed",
                    ]
                },
            },
        ),
        _realtime_tool(
            id="tool.realtime.stream.subscribe",
            label="Realtime Stream Subscribe",
            description=(
                "Tool capability for live/replay stream acquisition. It emits "
                "event[] for market data, web events, social feeds, or sensor-like sources."
            ),
            input_type="trigger",
            output_type="event[]",
            tags=["tool", "realtime", "stream", "subscribe", "replay"],
            schema="tool-capability.realtime-stream-subscribe.v1",
            resources=["stream_adapter", "offset_checkpoint", "run_trace"],
            executor=WorkflowToolCapabilityExecutor(
                mode=OKX_MARKET_TICKER_SNAPSHOT_EXECUTOR,
                description=(
                    "Collects one real OKX public ticker snapshot for the first "
                    "runtime acquisition loop; WS smoke covers live subscribe."
                ),
                params={"provider": "okx", "channel": "tickers", "instId": "ETH-USDT-SWAP"},
            ),
        ),
        _realtime_tool(
            id="tool.realtime.event.normalize",
            label="Realtime Event Normalize",
            description=(
                "Tool capability for normalizing raw stream payloads into event.v1 "
                "while preserving event-time, source, raw payload, and lineage."
            ),
            input_type="event[]",
            output_type="event[]",
            tags=["tool", "realtime", "event", "normalize"],
            schema="tool-capability.realtime-event-normalize.v1",
            resources=["event_schema_registry"],
        ),
        _realtime_tool(
            id="tool.realtime.window.rolling",
            label="Realtime Rolling Window",
            description=(
                "Tool capability for event-time rolling windows, watermark handling, "
                "dedupe boundary, and replayable window aggregation."
            ),
            input_type="event[]",
            output_type="window[]",
            tags=["tool", "realtime", "window", "watermark", "dedupe"],
            schema="tool-capability.realtime-window-rolling.v1",
            resources=["window_state", "watermark_clock", "checkpoint_store"],
        ),
        _realtime_tool(
            id="tool.realtime.state.cache",
            label="Realtime State Cache",
            description=(
                "Tool capability for incremental state snapshots used by realtime "
                "feature computation and replay."
            ),
            input_type="window[]",
            output_type="stateSnapshot[]",
            tags=["tool", "realtime", "state", "cache", "checkpoint"],
            schema="tool-capability.realtime-state-cache.v1",
            resources=["state_store", "checkpoint_store"],
        ),
        _realtime_tool(
            id="tool.realtime.feature.compute",
            label="Realtime Feature Compute",
            description=(
                "Tool capability for incremental quant and situation-awareness features "
                "such as count, rate, volatility, spread, severity, or momentum."
            ),
            input_type="stateSnapshot[]",
            output_type="feature[]",
            tags=["tool", "realtime", "feature", "quant", "situation"],
            schema="tool-capability.realtime-feature-compute.v1",
            resources=["feature_registry"],
        ),
        _realtime_tool(
            id="tool.realtime.signal.emit",
            label="Realtime Signal Emit",
            description=(
                "Tool capability for producing traceable signal[] outputs. It emits "
                "signals for review/automation and must not directly place orders."
            ),
            input_type="feature[]",
            output_type="signal[]",
            tags=["tool", "realtime", "signal", "alert", "quant"],
            schema="tool-capability.realtime-signal-emit.v1",
            resources=["signal_policy", "run_trace"],
        ),
    ]


def _realtime_tool(
    *,
    id: str,
    label: str,
    description: str,
    input_type: str,
    output_type: str,
    tags: list[str],
    schema: str,
    resources: list[str],
    executor: WorkflowToolCapabilityExecutor | None = None,
) -> WorkflowToolCapability:
    return WorkflowToolCapability(
        id=id,
        label=label,
        description=description,
        status="runnable",
        provider="opencli-admin",
        inputPorts=[WorkflowToolCapabilityPort(name="in", type=input_type)],
        outputPorts=[WorkflowToolCapabilityPort(name="out", type=output_type)],
        executor=executor
        or WorkflowToolCapabilityExecutor(
            mode="fixture",
            description="Registered tool capability; concrete executor is bound by runtime policy.",
        ),
        versionPin=_version_pin(),
        tags=tags,
        manifest={
            "schema": schema,
            "runtime": {"binding": "workflow.external-tool.capability"},
            "resources": resources,
            "permissions": ["runtime_tool_call"],
            "trace": {
                "events": [
                    "tool_call_started",
                    "partial:outputItemCount",
                    "tool_call_completed",
                    "completed",
                ]
            },
            "canvas": {"node": False},
        },
    )
