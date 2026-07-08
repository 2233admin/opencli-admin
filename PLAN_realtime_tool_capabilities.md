# OpenCLI Admin Realtime Tool Capabilities

> Status: active tool-capability package
> Builds on: `PLAN_native_nodes_loop.md`

## Position

Realtime collection, rolling computation, state cache, feature computation, and
signal emission are **tools**, not Canvas nodes and not a new product axis.

Canvas nodes remain business/capability nodes. Realtime work appears as runtime
tool calls through OpenCLI Admin Tool Capability bindings, then enters trace,
state, checkpoint, and replay like every other governed tool call.

## Registered Tools

- `tool.realtime.stream.subscribe`
  - `trigger -> event[]`
  - stream subscribe/replay/poll acquisition.
- `tool.realtime.event.normalize`
  - `event[] -> event[]`
  - event-time/source/raw/lineage normalization.
- `tool.realtime.window.rolling`
  - `event[] -> window[]`
  - event-time windowing, watermark, dedupe boundary.
- `tool.realtime.state.cache`
  - `window[] -> stateSnapshot[]`
  - incremental state cache and checkpointable state.
- `tool.realtime.feature.compute`
  - `stateSnapshot[] -> feature[]`
  - quant and situation-awareness feature computation.
- `tool.realtime.signal.emit`
  - `feature[] -> signal[]`
  - traceable signal output. It must not directly place orders.

## Runtime Rule

- Tool calls are runtime events, not Canvas nodes.
- These tools are projected as `resource.tool-capability.*` resources.
- A business node, imported external tool node, preset, or managed executor may
  bind to these tools through `params.toolCapability`.
- Trace must record `tool_call_started`, partial output evidence, and
  `tool_call_completed`.

## Next Slice

- Add guarded non-fixture executors for these registered tools.
- Add durable stream offset/window/state/feature/signal storage.
- Add first adapter executor for OKX ETH market stream replay/live subscribe.
- Keep the Canvas surface centered on business nodes and presets, not low-level
  realtime tool internals.
