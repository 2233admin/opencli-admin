---
labels: ready-for-agent
---

# 05 — CLI channel hardening: binary allowlist + ctrl+c

## Parent

docs/control-closeout-PRD.md

## What to build

Two hardening items on the CLI channel:

1. **Binary allowlist** (ADR-0005: the CLI channel is an arbitrary-binary-execution surface, audit P0-4; the allowlist is deliberately orthogonal to API auth). A configured list of allowed binary paths; default empty = deny all. Enforcement happens in the channel before any execution; a violation is a permanent (non-retryable) error through the existing error taxonomy, so runs fail fast and honestly instead of retrying.
2. **ctrl+c handling**: interrupting the CLI (`opencli-skill` and any long-running CLI entry points in this repo) exits cleanly — no orphaned subprocesses, no half-written state, non-zero exit code. This was flagged in PR #4 review and deliberately deferred; recover the exact finding from the PR #4 review threads (`gh pr view 4 --comments` / review API on 2233admin/opencli-admin) before coding.

## Acceptance criteria

- [ ] Empty allowlist (default): every CLI channel execution is rejected as a permanent error (unit test at the channel seam)
- [ ] Binary on the allowlist executes; binary off the allowlist rejected (tests)
- [ ] Rejection is classified non-retryable by the error taxonomy (test)
- [ ] Existing CLI channel tests updated to configure an allowlist rather than deleted/weakened
- [ ] ctrl+c finding recovered from PR #4 review and addressed; interrupt leaves no orphaned process (test or documented manual verification if untestable in CI)
- [ ] Full pytest suite green, coverage ≥80%

## Blocked by

None - can start immediately

## Agent rules

- Do NOT use the Agent tool; write all code yourself
- Do NOT commit; leave changes in the working tree for the operator's acceptance gate
- Respect ADR-0005 and the existing error taxonomy — do not invent a parallel error path
- Run: `uv run --directory D:\projects\opencli-admin pytest` (full suite) before declaring done
