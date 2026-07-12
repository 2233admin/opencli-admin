---
title: Bridge the legacy collection pipeline into Workflow Runs
label: wayfinder:research
parent: map.md
blocked_by:
  - define-persistent-golden-path-facts.md
status: open
---

## Question

Where should a compatibility adapter join the existing DataSource/CollectionTask pipeline to Workflow Nodes and WorkflowRun events so one user-visible Run owns retries, evidence, blocking, and results while existing collectors, cursors, sinks, and schedules continue working during migration?
