# Persistent Setup Center Over One-Time Onboarding

Status: accepted

OpenCLI will provide a persistent Setup Center rather than a one-time onboarding wizard. The Setup Center reports workspace capability readiness, missing or unhealthy configuration, and the next useful action for models, email and delivery, Connections, Execution Resources, Plugin Installations, and other shared prerequisites. Every item can open Agent-Guided Configuration or the corresponding manual Governance & Settings control; both paths mutate the same authoritative domain objects through the same schemas, probes, permissions, proposals, confirmations, and audit trail.

Consequences:

- Initial setup and later configuration repair use one surface instead of separate onboarding state.
- Agent guidance never owns hidden configuration or creates a second settings model.
- Empty states and Project creation can deep-link to a specific unresolved readiness item.
- Setup completion is derived from current capability health and may become incomplete again when a Connection, Plugin, model, email channel, or Execution Resource fails.
- Personal Preferences remain outside workspace readiness unless a preference directly prevents the current operator from receiving an opted-in alert.
