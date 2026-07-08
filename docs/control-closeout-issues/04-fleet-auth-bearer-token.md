---
labels: ready-for-agent
---

# 04 — Fleet auth: static bearer token + bind guard + frontend token

## Parent

docs/control-closeout-PRD.md

## What to build

Network reachability must not equal operability (ADR-0005: deployment surface is the NetBird fleet LAN). Add a FastAPI middleware that validates a single static bearer token (environment-configured, name following existing settings conventions, e.g. `API_AUTH_TOKEN`) on every `/api` route. Startup refuses to bind a non-localhost address when no token is configured. Localhost binding without a token stays allowed (dev posture). The MCP server (separate stdio process) is outside the middleware path and unaffected.

Frontend: send the token automatically on every API call — read from build/runtime config with a localStorage override so the operator can set it once per browser without rebuilding.

## Acceptance criteria

- [ ] With token configured: request without/with wrong `Authorization: Bearer` → 401; correct token → 200 (integration tests)
- [ ] Non-localhost bind with no token configured → startup refuses with a clear error (test)
- [ ] Localhost bind with no token → API open (dev posture preserved; existing test suite runs unchanged without configuring tokens)
- [ ] Frontend attaches the token to all API calls; localStorage override wins over build config (node --test where logic is testable)
- [ ] Health/liveness endpoints exempt if and only if they leak nothing (document the choice in the middleware)
- [ ] Full pytest suite green, coverage ≥80%

## Blocked by

None - can start immediately

## Agent rules

- Do NOT use the Agent tool; write all code yourself
- Do NOT commit; leave changes in the working tree for the operator's acceptance gate
- Respect ADR-0005; do not build users/sessions/roles
- Run: `uv run --directory D:\projects\opencli-admin pytest` (full suite) and frontend `npm test` + `npx tsc -b` before declaring done
