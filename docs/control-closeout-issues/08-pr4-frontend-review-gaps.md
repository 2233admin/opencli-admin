---
labels: ready-for-agent
---

# 08 — Close the three PR #4 frontend review gaps

## Parent

docs/control-closeout-PRD.md

## What to build

PR #4 (2233admin/opencli-admin, merged `f731897`) review threads flagged three frontend findings that were deliberately deferred as out-of-scope ("前端3处"). This issue closes that review debt:

1. Recover the exact findings first: read the PR #4 review threads (`gh pr view 4 --repo 2233admin/opencli-admin --comments` and the review API) and identify the three deferred frontend findings verbatim. Do not guess from memory.
2. Fix each finding as flagged, or — if a finding is obsolete because the code has since changed — document why with a pointer to the superseding change.

## Acceptance criteria

- [ ] The three findings are quoted verbatim in the work report with links/IDs to their review threads
- [ ] Each finding is either fixed (with test where the seam allows) or documented as obsolete with evidence
- [ ] `npx tsc -b` clean; frontend `npm test` green
- [ ] No unrelated frontend refactoring bundled in

## Blocked by

None - can start immediately

## Agent rules

- Do NOT use the Agent tool; write all code yourself
- Do NOT commit; leave changes in the working tree for the operator's acceptance gate
- GitHub access from this machine may need the 5080 proxy tunnel for pushes; plain `gh` API reads usually work directly — if `gh` fails, report instead of improvising credentials
