# External Side Effects Have Stable Operation Identity

Status: accepted

OpenCLI will assign a stable Operation ID to each intended external side effect and reuse it across all attempts. Every Plugin write capability must declare a Side Effect Contract: native idempotency, lookup-before-write with platform deduplication, or explicitly non-idempotent. An unknown submission result cannot be retried blindly; the runtime follows the declared status-check or lookup path before retry, compensation, or human intervention.

Consequences:

- Replayed Runs and transport retries do not silently become new business operations.
- Each attempt, deduplication decision, external object identifier, and Business Outcome is traceable to one operation.
- Non-idempotent actions receive stricter confirmation and bounded retry behavior.
- Compensation is represented as a separate governed operation rather than an impossible cross-system rollback.
- Plugin capability schemas must expose their idempotency and outcome-check behavior to validation and policy.
