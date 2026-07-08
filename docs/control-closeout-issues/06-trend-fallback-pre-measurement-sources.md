---
labels: ready-for-agent
---

# 06 — Trend fallback for pre-measurement sources

## Parent

docs/control-closeout-PRD.md

## What to build

Sources that predate the `source_measurements` table (or have produced no rows yet) currently get no trend in their control-state, making them second-class in classification (zero-accepted streaks and error-rate trends never fire). Derive a fallback trend from recent task-run history via the existing PR-Control-2 fallback aggregation path when no measurement rows exist. Coverage/confidence reporting must stay honest: the response keeps signalling which path (measurement rows vs run-history fallback) produced the trend, so a fallback trend never masquerades as full sensor coverage.

## Acceptance criteria

- [ ] A source with zero measurement rows but with task-run history gets a trend in control-state (integration test)
- [ ] Trend provenance is distinguishable in the response (fallback vs measurement-backed)
- [ ] Confidence/coverage math does not upgrade because of a fallback trend (no fake HEALTHY reachability change)
- [ ] Sources with measurement rows are unaffected (existing tests pass unmodified)
- [ ] Outcome judgment is NOT changed — it judges post-decision measurement rows only (out of scope here)
- [ ] Full pytest suite green, coverage ≥80%

## Blocked by

- 01-prefactor-unified-decision-path

## Agent rules

- Do NOT use the Agent tool; write all code yourself
- Do NOT commit; leave changes in the working tree for the operator's acceptance gate
- Reuse the existing aggregation fallback path — do not build a second run-history reader
- Run: `uv run --directory D:\projects\opencli-admin pytest` (full suite) before declaring done
