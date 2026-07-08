## Context

Recent work confirmed that Docker deployment exists and that the Agent image
needed to package runtime modules explicitly. The Agent Dockerfile now copies
`backend/agent_runtimes` and `backend/miniflow`, and PTT-0 tests protect that.
However, deployability is broader than container startup: a data platform must
persist state, package runtime profiles, expose health, support upgrades, and
prove the path on NAS/Fleet nodes.

This change defines the deployment compass so future runtime/source/workflow
work cannot skip the physical deployment layer.

## Deployment Profiles

| Profile | Purpose | Support bar |
|---|---|---|
| Local Docker Compose | Single-machine center + built-in Agent | Compose parses, services healthy, volumes stable, runtime inventory visible |
| NAS Compose | Durable center on NAS with persistent volumes | Named volume/path map, backup/restore, migration, restart survival |
| Edge Agent Docker | Remote/NAS/PC Agent registered to center | Image packages runtime adapters, reports inventory, logs, version, health |
| Shell/systemd Agent | Non-Docker Agent process | Installer distributes full runtime package, service restarts, logs, upgrade path |
| NetBird Fleet Agent | Cross-network Agent enrollment | Overlay online, WS/HTTP registration, token auth, runtime capability match |

## Persistent State Layout

The deployment compass treats these as first-class durable surfaces:

- Relational database and migrations.
- Source/capability catalog and support-state metadata.
- Encrypted credentials and auth/session references.
- Browser profiles and extension state.
- Workflow bundles and MiniFlow files.
- Raw collection artifacts and EvidenceBatch projections.
- Workflow run events, Agent events, runtime audit logs, and PTT evidence.
- Runtime logs, health snapshots, and failure counters.
- Backups, restore manifests, and retention policy.

## Runtime Profile Contract

Each runtime profile must declare:

- Runtime id and support state.
- Packaged files and dependencies.
- Required environment variables and secrets.
- Health check and inventory probe.
- Execution boundary: allowlist, working directory, artifact directory, and
  disabled operations.
- Trace mapping from native events to OpenCLI Admin events.
- Log/audit artifact paths.
- Upgrade and rollback behavior.
- PTT smoke command and promotion evidence.

## Decisions

1. Deployable means persistent and restart-safe.
   - Rationale: A service that starts but loses workflows, evidence, profiles,
     or traces is not a data platform deployment.

2. Docker/NAS is the first supported deployment path for runtime PTT.
   - Rationale: It already has compose, image, and installer surfaces. It is the
     shortest path to a real Agent and evidence persistence loop.

3. Shell/systemd Agent remains blocked for runtime support until it distributes
   runtime adapter packages, not only `agent_server.py`.
   - Rationale: Current Python install mode can start the server but cannot
     import the runtime registry package reliably.

4. Runtime profile support is separate from source support.
   - Rationale: A source may be approved, but a node still needs the runtime
     profile installed and healthy before Fleet can match it.

5. Backup/restore is part of acceptance.
   - Rationale: For NAS deployment, restart survival is insufficient. Operators
     need a restore path for database, artifacts, workflow bundles, and profiles.

## PTT Deployment Ladder

| Gate | Evidence |
|---|---|
| D0 Static preflight | Compose config, Dockerfile packaging test, OpenSpec validation |
| D1 Local center | API/docs healthy, built-in Agent online, runtime inventory visible |
| D2 Persistent restart | Restart services and verify DB, source catalog, workflows, evidence, profiles, and trace remain |
| D3 Remote Agent | Install one Agent through Docker or script and verify `/nodes` online |
| D4 Runtime smoke | Dispatch MiniFlow/OpenTabs/OpenCLI read-only task and persist events |
| D5 Evidence path | Collect real message, store raw artifact, EvidenceBatch, trace, audit |
| D6 Backup/restore | Backup selected state, restore to clean profile, verify run/evidence readability |
| D7 Upgrade/rollback | Upgrade image/tag or compose config, rollback, verify state and Agent registration |

## Risks / Trade-offs

- [Risk] Deployment docs drift from compose/install scripts.
  -> Mitigation: add packaging tests and PTT commands that exercise real files.
- [Risk] NAS paths differ by device.
  -> Mitigation: define defaults and allow overrides, but require final resolved
  paths in PTT evidence.
- [Risk] Runtime profiles execute local code.
  -> Mitigation: runtime allowlist, workflow directory allowlist, token auth,
  audit logs, disabled unsupported profiles.
- [Risk] Backups capture secrets unsafely.
  -> Mitigation: separate encrypted credential store from public PTT evidence;
  never write raw secrets into repo or logs.

## Migration Plan

1. Land this deployment compass.
2. Align PTT docs to deployment gates D0-D7.
3. Add deployment profile manifests and support-state metadata.
4. Fix shell/systemd runtime package distribution.
5. Add Agent health/version/log-tail fields.
6. Run Docker/NAS/NetBird PTT and promote only passing profiles.

