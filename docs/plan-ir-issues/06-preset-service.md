# 06 — Preset service

Labels: ready-for-agent
Parent: docs/plan-ir-PRD.md

## What to build

Presets served from backend adapter metadata: a read-only endpoint listing packaged
one-click node configurations — for opencli, site × command × format bundles with
human names (e.g. "雪球·热帖"); analogous bundles for other channels where the
channel metadata supports it. Each preset declares the node type it applies to and
the params it prefills, so the palette (issue 07) can consume it dynamically —
nothing hardcoded in the frontend (stories 4, 26; glossary term Preset).

## Acceptance criteria

- [ ] Read-only presets endpoint lists presets grouped by channel/node type, each with id, human label, description, and the exact param prefill payload
- [ ] opencli presets are derived from the real adapter metadata the backend already knows (sites, commands, formats) — not a hand-maintained list
- [ ] Preset prefill payloads validate against the corresponding channel config schema
- [ ] Endpoint follows the standard ApiResponse envelope and is covered by HTTP-seam tests (grouping, payload validity, at least one non-opencli channel)

## Blocked by

None - can start immediately (parallel branch)
