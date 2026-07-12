# Derive the Inbox from Gate facts

The Inbox is a read model of unresolved Gate Requests rather than a second approval state store. Approval writes one Gate Decision and resumes the affected Run idempotently, preventing the user-facing Inbox and execution state from drifting apart.
