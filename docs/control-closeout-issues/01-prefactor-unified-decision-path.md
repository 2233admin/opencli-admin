---
labels: ready-for-agent
---

# 01 — Prefactor: unified decision path

## Parent

docs/control-closeout-PRD.md

## What to build

Extract the measure → evaluate → record-to-Evidence-Ledger flow that currently lives inline in the source control-state endpoint into a single service function in the backend control layer. The endpoint becomes a thin caller of that function; behavior is byte-identical. This is pure prefactoring so the upcoming Control Cycle (issue 03) can call the exact same decision path instead of duplicating it (a judgment must never disagree with the endpoint because it read the sensor differently — same principle already documented in the outcomes module).

The function takes a session plus source identity and returns everything the endpoint needs (measurement, provenance, trend, state, suggested actions, coverage/confidence). Ledger recording stays best-effort inside it, same stance as today.

## Acceptance criteria

- [ ] One control-layer function owns the measure→evaluate→record flow; the endpoint contains no decision logic of its own
- [ ] Endpoint response schema unchanged (existing integration tests pass unmodified)
- [ ] The existing zero-mutation test (`GET control-state` never mutates the data source) passes unmodified
- [ ] Full pytest suite green, coverage ≥80%, single alembic head (no migration expected)

## Blocked by

None - can start immediately

## Agent rules

- Do NOT use the Agent tool; write all code yourself
- Do NOT commit; leave changes in the working tree for the operator's acceptance gate
- Respect ADR-0004/0005/0006/0007 and CONTEXT.md Control vocabulary
- Run: `uv run --directory D:\projects\opencli-admin pytest` (full suite) before declaring done
