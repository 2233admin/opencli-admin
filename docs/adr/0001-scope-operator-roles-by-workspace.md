# Scope operator roles by Workspace

Operator roles are assigned per Workspace rather than globally because Data Sources, Plans, Runs, and Operations Inbox work share the same ownership boundary. This lets one person hold different responsibilities in different Workspaces and avoids coupling future team isolation to system-wide roles. Platform Admin remains system-scoped for Workspace lifecycle and infrastructure, but receives no implicit access to Workspace business data; intervention requires explicit Workspace membership and an audit record.
