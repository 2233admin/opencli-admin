# Govern First-Party and External Agents Through One Control API

Status: accepted

OpenCLI will expose one Agent Control API for the first-party Operator Agent and authorized External Operator Agents such as Codex or Claude Code. MCP and SDKs are adapters over this boundary, while browser control is only a fallback for missing capabilities; every mutation must use the same identity, context, Agent Operation Proposal, confirmation, permission, Gate, Actuator, and evidence path as the visual UI. This preserves the existing ability for Agents to operate OpenCLI without granting a database, shell, static administrator-token, or UI-automation bypass.

Considered options:

- Make the MCP server a direct mirror of REST mutations. Rejected because transport tools would bypass the proposal and confirmation lifecycle and duplicate business policy.
- Make browser automation the primary Agent protocol. Rejected because UI structure is not a stable control contract and cannot reliably express scoped identity, validation evidence, or durable action state.
- Give external Agents a privileged administrator channel. Rejected because Agent-originated changes must remain attributable and governed by the same policy as human actions.

Consequences:

- The existing narrow `backend/mcp_server.py` tool set remains useful but must grow by calling Agent Control API capabilities rather than embedding independent mutation rules.
- Static bearer-token fleet authentication is transport authentication, not sufficient Agent authorization; external Agent identity and scopes must be explicit.
- Agent Dock, embedded conversations, MCP clients, and SDK clients can originate and continue the same proposal and confirmation flow.
