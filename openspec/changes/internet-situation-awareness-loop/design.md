## Context

The user clarified the product identity: OpenCLI Admin is a data platform for
aggregating internet-accessible messages and doing situation awareness. Recent
work added important implementation pieces: adapter node projection, Fleet
runtime inventory, MiniFlow/OpenTabs adapters, NetBird bootstrap, Docker Agent
runtime packaging, and a PTT acceptance note. Those pieces need a product-level
compass so future work is approved by tests before it becomes product capability.

The existing `real-node-io-webhook-runtime` OpenSpec remains valid, but it is
lower-level. It describes real node runtime I/O, Canvas binding, and
EvidenceBatch projection. This change defines the product loop and approval
rules above that runtime layer.

## Product Loop

1. Operator states an information need.
2. System resolves approved source capabilities and runtime requirements.
3. Fleet match selects a capable node/profile.
4. Workflow runs collection through approved adapters/runtimes.
5. Raw outputs are stored as evidence with source, time, node, runtime, request,
   trace, and artifact links.
6. Evidence is normalized into entities, events, topics, timelines, and
   confidence/impact signals.
7. Situation summary is generated with links back to evidence and run trace.
8. Operator reviews, exports, notifies, or promotes the workflow/source.

## Decisions

1. Source support is a catalog state, not an adapter existence claim.
   - Rationale: A working adapter is only one part of support. Support also
     requires schema, auth/session policy, rate limit, freshness, trace, legal
     boundary, PTT evidence, and failure modes.

2. PTT is a promotion gate.
   - Rationale: New frameworks, source families, runtime profiles, and workflow
     templates may be proposed and tested, but they must not enter the supported
     product path until the operator approves PTT evidence.

3. Market Situation Monitor is the first closed-loop proof.
   - Rationale: It exercises the complete data-platform promise without needing
     every source family at once: real collection, Fleet/NAS dispatch, evidence,
     trace, normalization, and summary.

4. Evidence is the system's truth boundary.
   - Rationale: Situation awareness must be auditable. Every summary, event, or
     alert needs provenance back to raw record, artifact, source, workflow run,
     Agent node, runtime, and timestamp.

5. Agent/NAS execution must be operationally packaged.
   - Rationale: A runtime that only works in a developer shell is not product
     support. Docker/NAS/Agent profiles need install, upgrade, health, logs,
     runtime inventory, allowlist, and rollback/disable paths.

6. External runtimes are managed profiles, not the domain model.
   - Rationale: MiniFlow, OpenTabs, Pi, and future tools can execute work, but
     product semantics stay in OpenCLI Admin: capability catalog, PTT, trace,
     evidence, and safety policy.

## Workstream Inventory

| Workstream | Current state | Needed before support |
|---|---|---|
| Source catalog | Channels and adapter docs exist, but support states are informal | Capability records with support level, schema, auth/session policy, rate limit, freshness, and PTT status |
| Fleet/NAS Agent | Registration, runtimes, Docker packaging, and PTT docs exist | Real NetBird/NAS PTT run, shell installer runtime package distribution, health/log/version reporting |
| Workflow runtime | Runtime I/O and trace work exists | Product run entrypoint, Fleet match by runtime capability, event/evidence persistence, UI trace review |
| Evidence | EvidenceBatch direction exists | Raw artifact storage, normalized evidence records, idempotent projection, provenance links |
| Situation layer | Not yet productized | Entity/event/topic extraction, timeline, confidence/impact scoring, summary with citations |
| OpenTabs | Adapter exists | Server startup/profile, secret injection, extension health, manifest projection, read-only smoke |
| MiniFlow | Built-in runtime exists | Managed workflow distribution, allowlist, audit artifacts, NAS path policy |
| Governance | PTT note exists | OpenSpec-linked approval states, pass/fail evidence, blocked reasons, promotion checklist |

## Test Seams

The highest seam is the Market Situation Monitor PTT. It should prove external
behavior instead of internal implementation:

- A real Agent appears online in `/api/v1/nodes`.
- Fleet inventory exposes the required runtime/source capabilities.
- A workflow run selects the node and emits trace events.
- Real internet messages are captured into evidence records.
- Normalization produces a situation summary linked to evidence and trace.
- Failure states produce structured blocked/error reasons, not silent success.

Lower-level tests should protect catalog support-state validation, runtime
inventory projection, EvidenceBatch idempotency, trace persistence, and PTT
promotion rules.

## Risks / Trade-offs

- [Risk] The product tries to support too many source families at once.
  -> Mitigation: keep only approved PTT sources in supported state; everything
  else remains proposed, experimental, or blocked.
- [Risk] Evidence and summaries drift apart.
  -> Mitigation: require provenance links on all generated situation outputs.
- [Risk] Runtime integration creates unsafe local execution.
  -> Mitigation: runtime allowlist, workflow directory allowlist, token auth,
  audit artifacts, and explicit blocked states.
- [Risk] PTT becomes paperwork.
  -> Mitigation: every PTT item must have a runnable command, API check,
  persisted artifact, or UI evidence.

## Migration Plan

1. Land this OpenSpec compass.
2. Align `docs/ptt-acceptance.md` and existing runtime OpenSpec tasks to this
   product loop.
3. Implement source catalog support states and PTT approval metadata.
4. Run the Market Situation Monitor PTT through a real Agent.
5. Promote only passing source/runtime/workflow profiles into supported status.

