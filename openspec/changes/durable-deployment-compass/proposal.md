## Why

The system already has Docker Compose, NAS profile hints, an Agent image,
one-line install script, Fleet/NetBird registration, and runtime adapters. That
is not enough to call the platform deployable. A deployable data platform needs
an explicit compass for what lands on disk, what persists across restarts, how
an Agent is packaged, how runtime profiles are enabled, how upgrades/rollbacks
work, and what evidence proves the deployment passed PTT.

The user clarified that the current module is the **落盘部署罗盘**: the durable
deployment compass. Product direction may remain documented elsewhere, but this
change governs real deployment and persistence.

## What Changes

- Define supported deployment profiles: local Docker Compose, NAS Compose,
  edge Agent Docker, shell/systemd Agent, and NetBird Fleet Agent.
- Define persistent state boundaries for database, source configs, credentials,
  browser profiles, workflow bundles, EvidenceBatch/raw artifacts, audit logs,
  runtime logs, and backups.
- Require every supported Agent/runtime profile to declare packaged files,
  dependencies, environment variables, health checks, version reporting,
  allowlists, and upgrade/rollback behavior.
- Require PTT evidence before a deployment profile or runtime profile is called
  supported.
- Make the current Docker Agent runtime packaging fix part of the deployment
  acceptance gate, and keep shell/systemd runtime distribution visible as debt.

## Capabilities

### New Capabilities

- `deployment-profiles`: Docker/NAS/Agent profile manifests, install commands,
  health checks, upgrade/rollback, and support state.
- `persistent-state-layout`: Durable paths, volumes, backups, restore checks,
  artifact retention, and migration boundaries.
- `agent-runtime-packaging`: Runtime adapter packaging, inventory reporting,
  runtime allowlists, workflow directory allowlists, logs, and version health.
- `deployment-ptt`: Deployment acceptance gates and evidence required before a
  profile is promoted to supported.

### Modified Capabilities

- `ptt-governance`: Product PTT must reference deployment PTT when a capability
  depends on Docker/NAS/Agent runtime execution.

## Impact

- `docker-compose.yml`, `docker-compose.build.yml`, `agent/Dockerfile`, Agent
  installer, NAS profile docs, runtime adapter packaging, workflow artifact
  paths, backup/restore docs, and health/status APIs.
- PTT acceptance docs and future release notes.
- Future UI surfaces for node status, runtime status, deployment profile, logs,
  backup state, and PTT support state.

## Non-Goals

- Do not implement a full installer UI in this change.
- Do not promote shell/systemd Agent runtime support until runtime packages are
  distributed with `agent_server.py`.
- Do not call a runtime profile deployable because it passes unit tests alone.
- Do not store secrets in repo files or PTT evidence artifacts.

