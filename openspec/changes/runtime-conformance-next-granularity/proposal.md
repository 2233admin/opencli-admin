## Why

The first workflow runtime conformance slice proves registry declaration,
fixture execution, and observed `/events` snapshot transcripts for the current
backend path. It intentionally leaves config-blocked evidence, SSE parity,
ODP/Redis mirroring, full node I/O contracts, and real webhook delivery outside
that first slice.

Those items are coupled, but they are not one deliverable. If they are tracked
as a single "runtime support" task, the project can again look supported from
Canvas labels while runtime truth remains unproven. The next conformance change
needs a finer acceptance ladder.

## What Changes

- Define the next workflow runtime conformance granularity as five separately
  verifiable layers:
  1. config-blocked evidence
  2. SSE/events-stream parity
  3. ODP/Redis event mirroring
  4. real node I/O contracts
  5. webhook real delivery
- Require the implementation order to start with stable block reason taxonomy,
  then config fixtures, then event transport parity, then node I/O contracts,
  then webhook delivery.
- Keep the first conformance slice truthful: it remains partial until later
  fixture groups pass their own evidence gates.
- Align this planning layer with `real-node-io-webhook-runtime` without claiming
  that change is complete.

## Capabilities

### New Capabilities

- `runtime-conformance-next-granularity`: Acceptance ladder for completing
  workflow runtime support after the first backend conformance slice.

### Modified Capabilities

- `workflow-runtime-conformance`: Clarifies that partial runtime passports can
  only become complete after all next-granularity layers are evidenced.

## Impact

- OpenSpec acceptance criteria for the next runtime conformance milestones.
- A checklist that keeps config, stream transport, ODP/Redis, node I/O, and
  webhook delivery independently testable.
- No runtime behavior changes in this planning-only change.
