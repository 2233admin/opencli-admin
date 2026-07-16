# Agent And Human Edits Use Optimistic Revision Guards

Status: accepted

OpenCLI will bind Agent Operation Proposals and human draft edits to the base revisions of every affected object. Before applying a change, the platform rechecks object revisions, Connection Bindings, permissions, and relevant policy. Proven non-overlapping changes may be rebased with the final diff shown again. Overlapping changes or authority changes invalidate the proposal and require regeneration or explicit re-editing from current state. Published Workflow Versions remain immutable.

Consequences:

- Human and Agent changes cannot silently overwrite one another through last-write-wins behavior.
- P0 collaboration needs editor presence, revision checks, and conflict presentation but not CRDT-style simultaneous graph editing.
- A stale proposal cannot retain authority after a Binding, permission, or policy is narrowed.
- Safe automatic rebases remain reviewable because the final applied diff is surfaced before confirmation.
