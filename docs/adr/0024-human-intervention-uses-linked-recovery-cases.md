# Human Intervention Uses Linked Recovery Cases

Status: accepted

OpenCLI will represent execution failures that genuinely require a person as Recovery Cases in the single global Inbox. A Recovery Case remains linked to the original Project, Workflow Version, Run, failed node, Side Effect Operation, checkpoint, and redacted evidence. It exposes a bounded set of typed Recovery Actions declared by the capability and allowed by policy. Successful resolution resumes from a safe checkpoint while retaining the original failure and all intervention evidence.

Consequences:

- Automatic retries and policy recovery do not create unnecessary Inbox noise.
- Operators receive enough structured context to reauthenticate, inspect external state, retry safely, adjust permitted input, skip, compensate, or terminate without searching across unrelated pages.
- Recovery cannot become an arbitrary production shell or bypass the normal permission, confirmation, and audit path.
- The original Run remains immutable evidence; resumed execution is linked rather than rewritten.
- Recovery Cases are operational attention objects, not duplicate Work Items or a second run-specific inbox.
