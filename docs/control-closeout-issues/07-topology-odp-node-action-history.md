---
labels: ready-for-agent
---

# 07 — Topology ODP node + action history view

## Parent

docs/control-closeout-PRD.md

## What to build

Two operator-visibility slices over already-existing data:

1. **ODP system node on the topology canvas.** The shared ODP plane already has a state endpoint (`/api/v1/control/odp-state`); render it as a node through the existing node-kit registry so shared-plane backpressure is visible where the operator already looks. Reuse the ControlBadge/SensorCoverageBadge defensive-rendering patterns (an unavailable sensor renders grey, never fake-healthy).
2. **Action history view.** A new read-only backend endpoint listing Evidence Ledger rows with filters (source, mode, outcome) and pagination, plus a frontend view showing suggestion-vs-executed rows and their outcome verdicts (recovered / persisted / insufficient_data / pending). This is the operator's audit surface over everything the controller ever suggested or did. It must render advisory-only data correctly today (executed rows only start existing after issue 03, which this issue does not depend on).

## Acceptance criteria

- [ ] Ledger listing endpoint: filters by source/mode/outcome, paginated, read-only (integration tests)
- [ ] ODP node appears on the topology canvas with live state; ODP-plane-down renders degraded/grey, not healthy (data-mapping node --test)
- [ ] Action history view renders ledger rows with state, action, reason, mode, executed flag, and outcome verdict
- [ ] Data-mapping logic covered at the frontend node --test seam; visual check is manual QA (screenshot in the PR/report)
- [ ] `npx tsc -b` clean; frontend `npm test` green; full pytest suite green, coverage ≥80%

## Blocked by

None - can start immediately

## Agent rules

- Do NOT use the Agent tool; write all code yourself
- Do NOT commit; leave changes in the working tree for the operator's acceptance gate
- Reuse node-kit registry + existing badges; frontend canvas is xyflow (FlowGram was abandoned — do not reintroduce it)
- Run backend and frontend test suites before declaring done
