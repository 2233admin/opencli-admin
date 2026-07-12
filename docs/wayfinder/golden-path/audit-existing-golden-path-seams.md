---
title: Audit the existing golden-path seams
label: wayfinder:research
parent: map.md
blocked_by: []
status: closed
assignee: codex
---

## Question

Which existing Project, Collection Request, Workflow Draft/Version, Run, Worker Connection, Artifact, Data Feed, Finding, Gate, Inbox, and frontend seams can carry the golden path unchanged, and where are the smallest real gaps or conflicting legacy models?

## Resolution

Resolved by [Golden-path seam audit](assets/audit-existing-golden-path-seams.md). The existing canvas/compiler/run-event and reverse-Worker foundations are reusable, but the product lacks a persistent Project→Workflow Version→Data Feed backbone and currently maintains conflicting legacy collection, execution, Inbox, Automation, and device facts. Converge through compatibility adapters rather than replacing working collectors or the canvas.
