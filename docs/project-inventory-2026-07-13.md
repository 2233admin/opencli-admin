# OpenCLI Admin project inventory — 2026-07-13

## Delivery state

The product is not starting from zero. The collection administration baseline,
pipeline reliability work, control loop, skill execution loop, Plan IR backend,
and the first Workflow HDA vertical slice all exist. The current delivery risk
is integration: two worktrees contain different uncommitted feature slices and
their branches have diverged.

| Source | Branch/base | What it currently contains |
| --- | --- | --- |
| `D:\projects\opencli-admin` | `main` at `6e09973` before the WIP branch | EvidenceBatch projection, runtime resource resolution, webhook ingress, Canvas runtime binding, auth shell, `/studio/workflow`, and targeted tests |
| Repowise worktree | `codex/notification-ack` at `6de36cb` before the WIP branch | Workflow authoring UI foundation, fonts, SSGOI route transitions, and the frontend currently served on port 3000 |
| `origin/feat/workflow-persistence-closed-loop` | `c326a2a` | Workflow/workspace persistence, Dify/n8n import, recursive packages, validation runs, and integration tests |

Neither dirty worktree is a complete release candidate by itself. The next
delivery branch must start from `origin/main` and integrate the three feature
slices above as reviewable commits.

## What is implemented

- Collection Admin routes and the core source/schedule/task/record/node/provider
  surfaces exist in the Next.js application.
- Pipeline reliability, credential handling, BrowserAct integration, notifier
  delivery, and the historical GOAL 1-7 work are implemented with tests.
- The control loop, per-source objectives, action history, fleet bearer auth,
  and CLI allow-list are implemented.
- Skill execution v1 includes perceive/propose/confirm/act, risk gating,
  `awaiting_confirm`, journey traces, self-evaluation, and human-triggered
  re-distillation. Cross-process pause/resume remains a v2 item.
- Plan IR has backend CRUD, execution, health, shared segments, and dataflow
  triggering.
- Workflow HDA compile, patch, runtime registry, multi-source tracing, run event
  streaming, webhook ingress, EvidenceBatch projection, and the first Canvas
  runtime binding are implemented in local or remote feature slices.
- The workflow authoring route is placed under `/studio/workflow`; `/canvas` is
  retained as a compatibility redirect in the runtime slice.
- The font and interruptible route-transition work is implemented only in the
  Repowise feature slice and is not yet integrated into the canonical branch.

## Unfinished promises

### P0 — integration and truthful release state

1. Integrate the runtime, persistence, Studio/editor, and motion/font slices on
   one branch based on `origin/main`.
2. Resolve the current frontend TypeScript failures caused by cross-branch
   imports (`WorkspaceSummary`, project/workflow hooks, Dock, workflow codec,
   inspector/session capability props, and stale generated Next route types).
3. Exclude or remove the legacy generated `frontend/dist` tree from the Next.js
   lint surface; repository-wide lint currently reports generated-code debt.
4. Run frontend typecheck, changed-source lint, production build, workflow
   regression assertions, targeted backend tests, and OpenSpec strict validation.
5. Make the integrated frontend, not a detached worktree, the process served on
   port 3000.
6. Reconcile documentation that still calls Vite the production frontend or
   names `/build/workflow` as canonical. The current product uses Next.js and
   `/studio/workflow`.

### P1 — promised workflow depth

1. EvidenceBatch projections still return empty cluster/conflict collections;
   implement real grouping, conflicts, source coverage, and their Result
   Workbench views.
2. Browser worker/profile concurrency currently derives resource identifiers
   but does not provide durable `ProfileBinding`, `SessionSnapshot`,
   `ProfileLock`, capacity accounting, or multi-machine scheduling.
3. Choose one persistent authoring/execution model. Plan IR UI promises and
   WorkflowProject currently overlap; either absorb Plan persistence/execution
   into WorkflowProject or explicitly retire the old Plan Canvas UI roadmap.
4. Complete browser-level rapid-navigation regression coverage for the SSGOI
   transition so a blank intermediate frame is tested, not inferred.

### P2 — later platform work

- ODP egress acknowledgements, asynchronous AI/notification consumers, and the
  Phase 2/3 scheduler/query/metrics work.
- Agent runtime sidecars/session registry/MCP callbacks and later evidence and
  credential-distribution work.
- Full design-system, internationalization, accessibility, and deployment visual
  acceptance passes.

## Verification snapshot

- Workflow backend target: `50 passed` with `--no-cov`.
- Workflow frontend source assertions: `8 passed`; contract assertions passed.
- OpenSpec: `real-node-io-webhook-runtime` strict validation passed.
- `git diff --check`: passed.
- Frontend TypeScript: failed because the D: runtime slice references types and
  components that exist only in the other feature slices.
- Repository-wide ESLint: failed mainly because `frontend/dist` generated Vite
  assets are included; changed-source lint must be rerun after integration.

## Next-session stop condition

The next integration session is complete only when there is one pushed branch
based on current `origin/main`, no uncommitted feature work is stranded in either
worktree, TypeScript and the production build pass, targeted backend/frontend
tests pass, and the branch serves the same UI that was visually reviewed.
