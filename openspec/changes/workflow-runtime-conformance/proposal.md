## Why

OpenCLI Admin can project workflow runs and expose run events, but a canvas node
should not claim live runtime support from labels alone. Backend runtime support
needs an executable conformance gate that proves the registry declaration,
fixture execution, and observed event transcript agree.

## What Changes

- Define the first workflow runtime conformance contract for the interim
  `/api/v1/workflows/runs/{runId}/events` source.
- Add canonical fixture, expected transcript, and passport expectations for the
  backend first slice.
- Cover happy path, permission-blocked path, and unsupported missing-binding
  path as executable evidence.
- Record that config-blocked, SSE, and ODP/Redis-stream conformance are later
  fixture groups, not part of this first backend slice.

## Capabilities

### New Capabilities

- `workflow-runtime-conformance`: Runtime compatibility evidence from workflow
  fixtures, expected event transcripts, and generated runtime passports.

### Modified Capabilities

- None.

## Impact

- Backend workflow conformance helpers and expected transcript goldens.
- Integration tests that hit the public workflow run and run event APIs.
- Generated conformance passports scoped to caller-provided artifact directories.
