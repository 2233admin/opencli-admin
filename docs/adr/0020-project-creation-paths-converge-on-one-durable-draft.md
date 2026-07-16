# Project Creation Paths Converge On One Durable Draft

Status: accepted

OpenCLI will offer three Project creation entries: Agent-guided creation as the primary action, creation from a template, and blank creation. All three immediately create the same durable Project Draft and Primary Workflow and then use the same editor, Agent conversation, Capability Gaps, readiness checks, validation, proposals, publishing, and activation model. Template and blank experiences are entry assistance rather than separate application types or shadow state machines.

Consequences:

- A user can switch from manual editing to Agent guidance without restarting or losing work.
- Templates cannot bypass capability, Connection, permission, or Execution Resource validation.
- Blank creation provides a Source → Process → Deliver guide while remaining the normal Workflow Canvas.
- Frontend implementation does not maintain separate template, blank, and conversational project stores.
