# Schedule by verified capability rather than hardware model

Workflow Nodes declare vendor-neutral Capability Requirements, and the scheduler matches them to Verified Capabilities reported by Workers. RTX 3080, RTX 5080, Apple Silicon, CPU, cloud API, and other environments are validation targets rather than product roles or Workflow semantics. Explicit Device placement remains an optional constraint for locality, login state, or policy, not the default scheduling model.
