"""OpenCLI Admin Tool Capability registry."""

from __future__ import annotations

from backend.schemas.workflow import (
    WorkflowToolCapabilitiesResponse,
    WorkflowToolCapability,
    WorkflowToolCapabilityExecutor,
    WorkflowToolCapabilityPort,
)
from backend.workflow.joyai_vl_executor import (
    JOYAI_VL_INTERACTION_EXECUTOR,
    JOYAI_VL_TOOL_CAPABILITY_ID,
)
from backend.workflow.realtime_market_executor import OKX_MARKET_TICKER_SNAPSHOT_EXECUTOR


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
        _realtime_tool(
            id=JOYAI_VL_TOOL_CAPABILITY_ID,
            label="JoyAI VL Interaction",
            description=(
                "Vision-language interaction over video/image media via a "
                "self-hosted JoyAI-VL-Interaction deployment (JD open source, "
                "8B, vLLM-Omni serving). Sends the node prompt plus media "
                "references, emits the model's interaction reply as event[]."
            ),
            input_type="event[]",
            output_type="event[]",
            tags=["tool", "realtime", "vision", "vl", "interaction", "joyai"],
            schema="tool-capability.vl-interaction.v1",
            resources=["media_reference", "run_trace"],
            executor=WorkflowToolCapabilityExecutor(
                mode=JOYAI_VL_INTERACTION_EXECUTOR,
                description=(
                    "POSTs one chat-completions interaction turn to the "
                    "JOYAI_VL_URL vLLM-Omni endpoint; unconfigured endpoint "
                    "degrades to an error event, never a run crash."
                ),
                params={"model": "JoyAI-VL-Interaction-Preview"},
            ),
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
