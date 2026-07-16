# Delivery Separates Submission From Business Outcome

Status: accepted

OpenCLI will model each Delivery with two distinct results: the technical Execution Result of submitting the operation and the Business Outcome that describes whether the intended external effect was actually achieved. A successful HTTP response, accepted email submission, or completed browser action does not by itself prove delivery, publication, or business acceptance. Destination policy defines the evidence, timeout, continuation, retry, compensation, and human-confirmation behavior for pending or unknown outcomes.

Consequences:

- Runs can distinguish transport failure from delayed, rejected, or semantically unsuccessful external effects.
- Email receipts, bounces, callbacks, status queries, semantic response checks, and authorized human confirmation can update the Business Outcome without rewriting execution history.
- Pending or unknown outcomes do not universally block a Workflow; the Destination or Automation policy determines the safe behavior.
- Human intervention enters the single global Inbox only when an outcome genuinely requires a person.
- Agent actions cannot declare business success without outcome evidence.
