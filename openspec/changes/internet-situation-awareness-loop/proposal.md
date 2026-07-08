## Why

OpenCLI Admin already has source/channel concepts, workflow runtime work,
Fleet/Agent registration, MiniFlow/OpenTabs runtime adapters, and PTT notes. The
missing product compass is the higher-level promise: the system is a data
platform that aggregates legally and technically obtainable internet messages,
normalizes them into evidence, and supports situation awareness with traceable
collection and analysis loops.

Without this compass, new adapters, runtimes, sites, and workflow ideas can look
like progress while bypassing the user's approval rule: ideas may be proposed,
but they must pass test/approval gates before becoming product capability.

## What Changes

- Define the first-class product loop: source intent -> source catalog ->
  collection -> evidence -> entity/event normalization -> situation summary ->
  trace/audit -> operator action.
- Require every internet source, runtime, and workflow to be represented in a
  governed capability catalog before it is treated as supported.
- Require PTT approval gates before new frameworks, source families, runtime
  profiles, or workflow templates enter the main product path.
- Make Market Situation Monitor the first approved end-to-end PTT candidate:
  real source collection, Fleet/NAS Agent dispatch, persisted trace, evidence
  output, and situation summary.
- Keep the existing real-node runtime I/O OpenSpec as an implementation layer,
  not the product compass itself.

## Capabilities

### New Capabilities

- `internet-source-catalog`: Governs source/site/channel/runtime capability
  records, support levels, legal/technical boundaries, schemas, freshness, and
  rate limits.
- `situation-evidence-loop`: Covers raw message capture, evidence artifacts,
  normalization, event/entity extraction, confidence, summaries, and audit
  linkage.
- `ptt-governance`: Covers proposal, dry-run, smoke, PTT pass/fail evidence,
  approval, and promotion of new capabilities into supported product paths.

### Modified Capabilities

- `real-node-runtime-io`: Becomes the runtime implementation layer under the
  situation-awareness product compass.
- `canvas-runtime-binding`: Becomes the operator workbench/projection layer for
  approved workflows and trace/result inspection.

## Impact

- Product direction, source onboarding, workflow approval, PTT verification, and
  release discipline.
- Backend source/channel catalogs, Agent runtime inventory, workflow run trace,
  EvidenceBatch projections, and situation-analysis APIs.
- Frontend operator flows for source capability review, workflow run/trace,
  evidence inspection, and PTT approval status.
- Deployment packaging for Docker/NAS/Agent profiles, including MiniFlow,
  OpenTabs, OpenCLI, and future source/runtime profiles.

## Non-Goals

- Do not bulk-add new websites or runtimes without PTT.
- Do not claim a source is supported because a demo adapter exists.
- Do not ask users to hand-fill cookies, raw browser profile ids, raw OpenCLI
  commands, or local workflow paths as the normal product experience.
- Do not turn external frameworks into the product model. They enter as managed
  runtime profiles only when their capability, trace, and safety contracts are
  projected into OpenCLI Admin.

