## 1. Product Compass And Governance

- [ ] 1.1 Link `docs/ptt-acceptance.md` to this OpenSpec change and mark it as the PTT evidence checklist for the first closed-loop run.
- [ ] 1.2 Add product support states for source/runtime/workflow capabilities: proposed, experimental, ptt-ready, supported, blocked, deprecated.
- [ ] 1.3 Require new source families, runtime profiles, workflow templates, and frameworks to start as proposed and move only after PTT approval.
- [ ] 1.4 Add blocked-reason vocabulary for unsupported source, missing auth/session, missing runtime, missing node, failed smoke, unsafe path, and unapproved capability.

## 2. Source Capability Catalog

- [ ] 2.1 Define source capability records for site/API/RSS/web/OpenCLI/OpenTabs sources with schema, auth/session mode, rate limit, freshness, ownership, and support state.
- [ ] 2.2 Project existing channel/source capabilities into the catalog without claiming unsupported entries are runnable.
- [ ] 2.3 Add validation that supported sources have at least one smoke/PTT evidence link and a normalized output schema.
- [ ] 2.4 Add API/UI read paths for browsing source capabilities and their support state.

## 3. Fleet/NAS Runtime Readiness

- [ ] 3.1 Complete Docker/NAS Agent profile packaging for approved runtime profiles.
- [ ] 3.2 Fix shell/systemd Python install mode so runtime adapter packages are distributed with `agent_server.py`.
- [ ] 3.3 Expose Agent version, runtime versions, deploy type, last heartbeat, current task, failure count, and log tail.
- [ ] 3.4 Add runtime allowlist and workflow directory allowlist for NAS/MiniFlow execution.

## 4. Market Situation Monitor PTT

- [ ] 4.1 Define the first Market Situation Monitor source set and mark each source's support state.
- [ ] 4.2 Run a real Agent through NetBird or LAN and verify `/api/v1/nodes` online state.
- [ ] 4.3 Verify Fleet inventory exposes required source/runtime capabilities.
- [ ] 4.4 Run the workflow through Fleet match and persist workflow run trace events.
- [ ] 4.5 Capture real internet messages into evidence records with raw artifact links.
- [ ] 4.6 Normalize evidence into entities, events, topics, timeline, confidence, and impact fields.
- [ ] 4.7 Generate a situation summary that cites evidence and workflow trace.
- [ ] 4.8 Record PTT pass/fail evidence and require operator approval before promoting the workflow to supported.

## 5. Evidence And Situation Layer

- [ ] 5.1 Define the raw message/evidence envelope with source, artifact, timestamp, node, runtime, workflow, and run ids.
- [ ] 5.2 Add idempotent projection from raw collection output into EvidenceBatch records.
- [ ] 5.3 Add event/entity/topic extraction contracts with provenance links.
- [ ] 5.4 Add situation summary output contract with confidence, impact, uncertainty, and evidence references.
- [ ] 5.5 Add tests that generated summaries cannot be accepted without evidence links.

## 6. OpenTabs And External Runtime Promotion

- [ ] 6.1 Treat OpenTabs as experimental until server startup, secret injection, extension health, `/tools` manifest, and read-only tool smoke pass.
- [ ] 6.2 Treat MiniFlow as experimental for NAS workflows until workflow distribution, allowlist, audit artifact, and trace persistence pass.
- [ ] 6.3 Require every future external runtime profile to define capability manifest, safety boundary, smoke command, trace mapping, and PTT approval evidence.

## 7. Verification

- [ ] 7.1 Run `openspec validate internet-situation-awareness-loop --strict`.
- [ ] 7.2 Run `openspec validate real-node-io-webhook-runtime --strict` after aligning runtime tasks.
- [ ] 7.3 Run targeted pytest suites for source catalog, Fleet inventory, workflow trace, EvidenceBatch, and Agent runtime packaging.
- [ ] 7.4 Run Code Intel Pipeline and Sentrux checks before promoting implementation changes.

