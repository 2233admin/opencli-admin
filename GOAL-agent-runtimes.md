# GOAL: Pluggable Agent Runtimes on Fleet Edge Nodes

Status: PROPOSAL (2026-07-03) — research done, design settled, awaiting implementation green-light.
Owner intent (user, 2026-07-03): the edge agent (Docker agent / agent_server.py) should be able to
run agentic workflows built on multiple frameworks — LangGraph, VoltAgent, pi — behind ONE
decoupled, reusable abstraction. Framework choice must never leak past the adapter boundary.
Reference patterns: OpenAlice `feature/openalice-dev` (`src/workspaces/` CLI-adapter layer).

---

## 1. Why process-level, not library-level

The three frameworks span two runtimes:

| Framework | Lang | Native external-invocation surface | Weight |
|---|---|---|---|
| LangGraph (langchain-ai) | Python | `langgraph dev` local HTTP server — Assistants/Threads/Runs API + SSE (open-source, not Platform-gated) | heavy (langchain-core stack) |
| VoltAgent | TS/Node | embedded REST server (Hono/Elysia): `POST /agents/:id/stream` SSE, OpenAPI 3.1 spec | moderate (Node + ai-sdk) |
| pi (earendil-works) | TS/Node | `--mode rpc`: stdio JSONL RPC, purpose-built for subprocess embedding; `--mode json`; `-p` one-shot | lightest (pinned npm shrinkwrap) |

A Python `import`-based abstraction can only ever cover LangGraph. Therefore the adapter contract
is a **process/protocol contract**: each runtime runs as a subprocess or local sidecar in its own
env (venv / node_modules), and the adapter translates its native stream (SSE / JSONL) into one
normalized event set. This is exactly OpenAlice's proven split: subprocess CLI adapters
(`workspaces/`) kept separate from in-process SDK providers (`ai-providers/`) — different failure
modes, different contracts. We build the subprocess layer.

## 2. Core contract (new module `backend/agent_runtimes/`)

Mirrors `backend/channels/` conventions (AbstractChannel / Capabilities / registry decorator):

```python
@dataclass(frozen=True)
class RuntimeCapabilities:
    transport: str            # "stdio" | "http"
    streaming: bool = True
    resume_by_id: bool = False    # can reopen a session by launcher-assigned id
    checkpoint: str = "none"      # none | memory | sqlite | postgres
    concurrent_sessions: bool = True

@dataclass
class AgentTask:
    task_id: str
    workflow: str                  # runtime-native workflow/agent identifier
    input: dict[str, Any]
    config: dict[str, Any]         # runtime-specific (model, tools, cwd, ...)
    session_id: str | None = None  # resume handle

# Closed tagged-union event set — adapters normalize INTO this, callers never
# see framework-native shapes. (OpenAlice lesson: normalize the protocol, not
# the output; keep the set tiny and closed.)
RuntimeEvent = {"type": "started" | "text" | "tool_call" | "tool_result"
                       | "state" | "done" | "error", ...}

class RuntimeAdapter(ABC):
    runtime_type: str                      # "pi" | "langgraph" | "voltagent"
    capabilities: RuntimeCapabilities      # data flags — callers branch on these, never isinstance

    @abstractmethod
    async def invoke(self, task: AgentTask) -> AsyncIterator[dict]: ...  # yields RuntimeEvents
    @abstractmethod
    async def health(self) -> bool: ...
    @abstractmethod
    def validate_config(self, config: dict) -> list[str]: ...
    async def bootstrap(self) -> None: ...  # one-time env/config setup (OpenAlice bootstrap())
```

Registry: same decorator pattern as `channels/registry.py`; discovery import in `__init__`.

Split-by-concern composition (from OpenAlice `CliAdapter`): argv composition, env composition,
provider-config translation, and session-id acquisition are separate small methods on stdio
adapters — never one monolithic `spawn()`.

Session identity ⊥ process lifetime (OpenAlice registry/pool split): a small durable
`RuntimeSessionRegistry` (session_id, runtime_type, resume hint, state) survives agent restarts;
the ephemeral process/connection pool does not.

## 3. Per-runtime adapters

- **`pi`** (P0, first): subprocess `pi --mode rpc`, LF-delimited JSONL over stdio. Same shape as
  our existing shell-out pattern — least new plumbing. Steal from OpenAlice `adapters/pi.ts`:
  `--session-id` create-or-reopen (launcher assigns ids → resume_by_id=True), provider override
  via `PI_CODING_AGENT_DIR` redirect, skills injection into `<cwd>/.pi/skills`, tools via
  CLI-shim-on-PATH since pi speaks no MCP.
- **`langgraph`** (P1): local sidecar server (open-source `langgraph-api`, the `langgraph dev`
  machinery) on a loopback port; adapter = httpx client speaking Assistants/Threads/Runs + SSE.
  Best checkpoint story (Postgres/SQLite checkpointers) → the runtime for long/resumable
  workflows. Sidecar lifecycle owned by our supervisor (below).
- **`voltagent`** (P2): Node sidecar with `@voltagent/server`, REST+SSE per its OpenAPI 3.1 spec.
  Bespoke schema (no A2A/OpenAI-compat confirmed) → adapter does the translation, nothing else does.

Sidecar supervisor in agent_server: spawn on first use, health-probe, restart-with-backoff,
SIGTERM watchdog + kill grace (OpenAlice headless-task pattern; plain subprocess, never PTY —
PTY mangles JSON streams).

## 4. Wire protocol extension (center ⇄ edge)

Today: ws reverse channel carries `collect` → single `result` (request/response,
`ws_agent_manager.resolve_response`). Agent runs are long and streaming:

- New message types: `agent_task` (center→edge), `agent_event` (edge→center, many,
  carries request_id + one RuntimeEvent), final `agent_result`.
- `ws_agent_manager` grows a per-request event callback/queue alongside the existing
  single-shot future (existing collect path untouched).
- **Runtime advertisement**: register handshake gains `runtimes: ["pi", ...]` — the center
  learns node capabilities the same way it learns mode/node_type today; scheduler can route
  agent tasks only to nodes advertising the runtime (analog of `session_affinity`).
- Fleet auth: already covered — ws handshake carries the bearer token (8fab4fe).

## 5. Center side

- Thin `agent_channel` (AbstractChannel impl): declares capabilities, one fetch() = one agent
  run dispatched via the reverse channel; runner keeps owning retry/rate/cursor. Agent runs
  emit the same evidence (accepted/error_kind → SourceMeasurement) so the control loop
  (PR-Control-*) covers agent tasks with zero new sensor machinery — agent runtimes are just
  another 被控对象 class with different observability/controllability.
- MCP callback surface (P1+): expose center MCP endpoint to edge runtimes so agents report
  structured results by calling back (OpenAlice `inbox_push` inversion) instead of us parsing
  heterogeneous stdout. opencli-admin already ships `backend/mcp_server.py` — reuse.

## 6. Docker image layering

Base image = agent_server only (unchanged). Runtimes are opt-in layers/build-args:
`INSTALL_RUNTIME_PI=true` (adds node + pinned pi), `INSTALL_RUNTIME_LANGGRAPH=true`
(pip layer), `INSTALL_RUNTIME_VOLTAGENT=true` (node layer). Image advertises what it has
via the register handshake — no config drift. LLM API keys: node-local env first (P0);
center-side encrypted distribution later (provider api_key store already exists, `06684a7`).

## 7. Phasing

- **P0**: contract + registry + pi adapter (stdio) + ws `agent_task`/`agent_event` protocol +
  runtime advertisement + tests. Proves the seam end-to-end with the lightest runtime.
- **P1**: LangGraph sidecar adapter + sidecar supervisor + center `agent_channel` +
  session registry (resume) + MCP callback.
- **P2**: VoltAgent adapter + control-loop evidence integration + credential distribution +
  UI (node runtime badges on the topology canvas).

## 8. Non-goals / rejected

- In-process Python embedding of LangGraph as the primary path (couples versions, blocks
  TS runtimes from ever being first-class; kept possible later as an optimization behind the
  same adapter contract).
- Normalizing framework semantics (graph vs supervisor vs tool-loop) — we normalize only the
  run/stream/result protocol; workflow definitions stay runtime-native in `AgentTask.config`.
- A2A/AG-UI as the wire format now — only LangGraph speaks AG-UI today; revisit if a second
  runtime adopts it.
