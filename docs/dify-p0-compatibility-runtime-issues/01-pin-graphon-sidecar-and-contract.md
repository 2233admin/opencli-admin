# P0-01: Pin the Graphon sidecar and lock its contract

Labels: `p0`, `backend`, `runtime`, `dify`, `graphon`

Parent: `docs/dify-p0-compatibility-runtime-PRD.md`

Blocked by: none

## Outcome

Create a reproducible, isolated Graphon compatibility service that can inspect and run Dify DSL without importing Graphon into the OpenCLI API process.

## Files

Create:

- `compat/dify_graphon_runtime/pyproject.toml`
- `compat/dify_graphon_runtime/uv.lock`
- `compat/dify_graphon_runtime/Dockerfile`
- `compat/dify_graphon_runtime/app.py`
- `compat/dify_graphon_runtime/contracts.py`
- `compat/dify_graphon_runtime/engine.py`
- `compat/dify_graphon_runtime/tests/test_contract.py`
- `compat/dify_graphon_runtime/THIRD_PARTY_NOTICES.md`

Modify:

- `docker-compose.yml:12-180`
- `.env.example`
- `.env.nas.example`

## Build

- Pin Graphon source to commit `b187ce7927fea1a7c137b642be3f78e3abb9f7de`.
- Use Python 3.13.
- Pin the optional Slim helper to Dify Plugin Daemon commit `14877f8f8b6dd63d3cec760411a875cc8e077547` / tag `0.6.5`.
- Add `GET /health`.
- Add the ADR-defined inspect, run, replay and cancel endpoints.
- Normalize Graphon-specific classes into JSON DTOs at the sidecar boundary.
- Return stable sidecar error codes; never return Python tracebacks to the caller.
- Add limits for request bytes, output bytes, execution seconds and concurrent runs.
- Do not mount the Docker socket.
- Run with a read-only filesystem and one bounded temporary volume.
- Default network, code and tool policies to denied.

## Acceptance criteria

- [ ] A clean Docker build uses the pinned Graphon commit and records it in `/health`.
- [ ] `POST /v1/dify/inspect` accepts the pure-logic fixture and returns node ids, types and `ready`.
- [ ] Unsupported app mode returns `unsupported`, not HTTP 500.
- [ ] `POST /v1/dify/runs` plus event replay completes the pure-logic fixture with stable monotonically increasing runtime sequence numbers.
- [ ] Repeating an event replay cursor returns no duplicate sequence.
- [ ] Cancel is idempotent.
- [ ] A code node is reported as blocked when no sandbox is configured.
- [ ] Secrets supplied in an ephemeral grant do not appear in response bodies or captured test logs.
- [ ] Health becomes unhealthy when the pinned engine cannot import.

## Verification

Run:

    docker compose build dify-graphon-runtime
    docker compose up -d dify-graphon-runtime
    curl http://localhost:${DIFY_GRAPHON_PORT}/health
    uv run --project compat/dify_graphon_runtime pytest -c compat/dify_graphon_runtime/pyproject.toml compat/dify_graphon_runtime/tests
