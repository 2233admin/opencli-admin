## 1. Deployment Compass Alignment

- [ ] 1.1 Link `docs/ptt-acceptance.md` to this deployment compass.
- [ ] 1.2 Split PTT into deployment gates D0-D7 and product workflow gates P0-P6.
- [ ] 1.3 Add deployment support states: proposed, dry-run, ptt-ready, supported, blocked, deprecated.
- [ ] 1.4 Document the current blocker: shell/systemd Agent installs only `agent_server.py` and not runtime packages.

## 2. Deployment Profiles

- [ ] 2.1 Define profile manifests for local Docker Compose, NAS Compose, edge Agent Docker, shell/systemd Agent, and NetBird Fleet Agent.
- [ ] 2.2 For each profile, declare install command, required env vars, persistent paths, health checks, logs, backup coverage, and support state.
- [ ] 2.3 Add validation that supported profiles have PTT evidence links and restart-survival evidence.
- [ ] 2.4 Expose deployment profile and support state in node/system status APIs.

## 3. Persistent State Layout

- [ ] 3.1 Define durable paths/volumes for DB, source catalog, credentials, browser profiles, workflow bundles, raw artifacts, EvidenceBatch, run events, audit logs, runtime logs, and PTT evidence.
- [ ] 3.2 Add backup and restore manifest format for NAS/compose deployments.
- [ ] 3.3 Add restart-survival smoke that verifies evidence, workflow run trace, profiles, and catalog records persist.
- [ ] 3.4 Add retention policy hooks for raw artifacts, logs, and PTT evidence.

## 4. Agent Runtime Packaging

- [x] 4.1 Package `backend/agent_runtimes` and `backend/miniflow` into the Docker Agent image.
- [x] 4.2 Add a unit test that prevents Docker Agent runtime packaging regression.
- [ ] 4.3 Fix shell/systemd Python installer to distribute runtime adapter packages with `agent_server.py`.
- [ ] 4.4 Add runtime version reporting and health probes for MiniFlow, OpenTabs, OpenCLI, and future profiles.
- [ ] 4.5 Add runtime allowlist and workflow directory allowlist for NAS/MiniFlow execution.
- [ ] 4.6 Add Agent log tail, failure count, current task, deployed image/tag, and deploy type to inventory/status.

## 5. Deployment PTT

- [ ] 5.1 D0: Run compose config, packaging tests, OpenSpec validation, and Sentrux checks.
- [ ] 5.2 D1: Bring up local Docker center and verify API/docs plus built-in Agent.
- [ ] 5.3 D2: Restart services and verify durable state remains readable.
- [ ] 5.4 D3: Enroll one remote Agent through Docker or script and verify `/api/v1/nodes`.
- [ ] 5.5 D4: Dispatch one runtime smoke through Fleet match.
- [ ] 5.6 D5: Persist raw artifact, EvidenceBatch, workflow trace, and audit artifact.
- [ ] 5.7 D6: Backup and restore deployment state to a clean profile.
- [ ] 5.8 D7: Upgrade and rollback image/tag or compose config without losing state.

## 6. Verification

- [ ] 6.1 Run `openspec validate durable-deployment-compass --strict`.
- [ ] 6.2 Run `openspec validate internet-situation-awareness-loop --strict`.
- [ ] 6.3 Run targeted pytest suites for Agent Docker packaging, install script rendering, nodes registration, Fleet inventory, and workflow trace.
- [ ] 6.4 Run Code Intel Pipeline and Sentrux checks before promoting deployment changes.

