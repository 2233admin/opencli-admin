# Separate reusable Connections from Project Sources

Authentication and connectivity belong to Workspace-owned Connections, while concrete collection targets and scopes belong to Project-owned Sources. Workflow Nodes reference Sources and do not copy credentials. Connection rotation and removal must expose the affected Sources, Workflows, and Automations.
