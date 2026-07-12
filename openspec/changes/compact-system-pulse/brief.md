# Brief

- Goal: make System Pulse compact, truthful, and readable at a glance.
- Audience: operators checking the overview repeatedly under time pressure.
- Surface: dashboard System Pulse strip on mobile and desktop.
- Constraints: reuse current telemetry, MatrixClock, and status tokens; no new dependency.
- Non-goals: redesign the dashboard or change telemetry APIs.
- Acceptance: copy reflects demo/healthy/attention states; neutral white is the baseline; warning color appears only for attention; the right-side clock is clearly readable.
