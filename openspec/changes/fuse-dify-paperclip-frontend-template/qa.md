# QA

## Latest formal-node integration correction

- Scope: Direction C keeps the project browser and project header, then embeds the existing
  standalone `WorkflowEditorSession`.
- Removed: Direction C's duplicate project-node Inspector, `bindingOptions`, local binding state,
  fake capability chips, fixed sample/log/Schema dock, and static project graph.
- Reused: canonical Schema, Catalog, React Flow canvas, ports/edges, Inspector, internal Networks,
  node management, and Run Trace.
- Targeted ESLint: passed with zero warnings and zero errors.
- TypeScript: passed with `pnpm exec tsc --noEmit`.
- Workflow regressions: 9/9 passed, including a new guard that requires Direction C to use
  `forceStandalone` and forbids the duplicate binding/Inspector model.
- Workflow contract assertions: passed.
- Production build: passed with Next.js 16.2.6.
- Production isolation: passed on port 8040 — the prototype returned 404 without its marker and
  `/dashboard` returned 200.
- Development route: returned 200 on port 8030 and included the workspace plus cross-device video
  project markers.
- Independent audits: two read-only audits independently confirmed the duplicate-model defect and
  recommended reusing the formal editor/session.
- Independent final review: no findings after explicit standalone isolation, prototype-switcher
  suppression, dead comparison-profile removal, and stale QA wording correction.
- Browser automation gap remains: the installed browser-control runtime previously failed during
  initialization with `Cannot redefine property: process`.
- Manual review URL: `http://127.0.0.1:8030/prototype/product-shell?variant=C`.

This section supersedes earlier claims that Direction C should demonstrate a separate execution-
binding panel or its own project-node Inspector.

## Superseded product-granularity correction

- Scope: Direction C only; formal Studio, WorkflowEditorSession, React Flow editor, inspector,
  node catalog, and Fleet code were not modified.
- Targeted lint: passed after stateful Workflow and execution-binding fixes.
- TypeScript: passed after stateful Workflow and execution-binding fixes.
- Production build: passed with Next.js 16.2.6.
- Production isolation: passed on a fresh port — prototype returned 404 without its marker and
  `/dashboard` returned 200.
- Development route: returned 200 and includes the revised cross-device video project.
- Independent audit: confirmed the formal `Workspace → Project → WorkflowAsset → WorkflowGraph → Node`
  model and identified the previous Project/Workflow compression plus four Agent meanings.
- Independent revision review: initially found contradictory binding selection, a non-functional
  Workflow switcher, stale Paperclip-only-as-visualization decisions, a stale Workflow heading,
  and historical QA conflicts. All findings were remediated; final re-review reported no
  P0/P1/P2/P3 findings.
- Browser automation gap: fresh click/visual checks could not run because the installed browser-control
  runtime failed during initialization with `Cannot redefine property: process`. This is recorded as
  a tooling gap; it is not reported as a passed visual check.
- Manual review URL remains `http://127.0.0.1:8030/prototype/product-shell?variant=C`.

## Self-check

- Command: `node C:\Users\Administrator\.codex\skills\design-pipeline\scripts\check-deps.cjs --json`
- Result: OK
- Missing required skills: none
- Missing enhancement skills: none
- Missing optional skills: none
- Fallbacks: GBrain is not enabled; decisions remain in this OpenSpec change.

## Historical QA before the latest correction

The checks and visual observations below document earlier Direction C iterations. They are kept
for traceability and are superseded where they conflict with “Latest product-granularity correction”.

### Static checks

- Lint: passed — targeted ESLint returned zero warnings and zero errors
- Typecheck: passed — `pnpm exec tsc --noEmit`
- Independent product-boundary review: passed after moving the global Inbox explanation out of the Linear work-item card and naming the right attention rail `Inbox · 需要处理`
- Independent hierarchy review: passed for the earlier Workspace → Project → Node iteration; the
  latest locked model adds the explicit Workflow layer.
- Independent screen-boundary review: passed after two review findings were fixed — project cards
  now load project-specific nodes/metrics/work items, and the AttentionRail now loads project-specific
  Inbox, alert, run, owner, evidence, and draft-version context
- Workspace/editor boundary: passed in the browser — C defaults to the workspace project index,
  opens the project lifecycle only after a project-card action, and returns to the index without
  retaining a sibling-project sidebar
- Tests: prototype intentionally has no behavioral test suite
- Build: passed — `pnpm build` completed with Next.js 16.2.6
- Production isolation: passed — the fresh production server returned 404 for `/prototype/product-shell?variant=C`, contained no prototype marker, and returned 200 for `/dashboard`

### Browser / visual checks

- 390x812: passed for the earlier C structure; fresh revised-C metrics are an explicit gap because the selected browser exposes no viewport resize and rejected the isolated harness under its security policy
- 500x812: passed for the earlier C structure as a narrow-stack visual check
- 1280x720: passed for revised C in the in-app browser; `innerWidth=1280`, document/body scroll width `1265`, no horizontal overflow
- Project-context switching: passed — cleaning loaded `v9 / RUN-3147`, notification loaded
  `v7 / RUN-6231`, and neither retained the previous project's node or run identifiers
- Earlier hierarchy semantics: passed in the DOM snapshot for the then-current project cards,
  template area, project work items, project runs, and global Inbox. The latest correction moves
  templates into creation and removes permanent work/run/Inbox panels from the IDE.
- 768x1024: static breakpoint inspection only; no separate screenshot retained
- 1920x1080: optional

Observed desktop captures:

- A keeps the workflow graph and debug trace dominant while retaining work, run, evidence, and approval context.
- B makes the project queue and selected work item cockpit dominant; the workflow becomes execution context.
- Earlier C rendered a two-screen structure with templates and shared-capability context on the
  workspace. The latest C keeps the two-screen entry, reduces workspace to the project browser,
  and directly embeds the formal standalone editor; production Workflow switching remains a later
  Studio/session integration.
- Acquisition, cleaning, knowledge, workflow, and delivery appear as separate project cards on
  the workspace page, not as a permanent sidebar inside the project editor.
- The latest granularity correction removes permanent work-item, runtime, evidence, and Inbox panels
  from the IDE; they remain global or project-tab destinations instead of competing with the graph.
- A/B remain available as builder-first and control-plane-first comparison extremes.

Observed mobile capture:

- The revised structure still uses the same one-column base grid and hides both persistent side
  panels below their desktop breakpoints, but fresh 390 px automation remains pending.
- The lifecycle navigation remains horizontally scrollable and the prototype switcher remains URL-stable.
- The earlier narrow-width pass exposed horizontal overflow; base grids were corrected to `minmax(0, 1fr)` and its final 390 px metrics showed no overflow.

## Motion checks

- `motion.md` required: yes, because the prototype has selection/focus feedback
- `motion.md` created: yes
- Implementation match: passed — only existing tokenized CSS transitions are used
- Reduced motion: passed by static inspection — shared `globals.css` disables/reduces motion under `prefers-reduced-motion: reduce`

## Accessibility checks

- Keyboard controls: passed for A/B/C switch buttons and left/right shortcuts; shortcuts ignore form and editable targets
- Focus ring: passed by shared focus styles and native focus fallback
- ARIA names: passed in DOM snapshots for icon-only controls and the prototype switcher
- Semantics: passed — skip link, `main`, `nav`, `header`, `aside`, headings, buttons, and tab roles are present
- Contrast: passed by visual inspection against existing dark semantic tokens
- Touch targets: acceptable for a dense desktop prototype; several 28–32 px controls should be enlarged if mobile operation becomes a production requirement

## Engineering fit

- Uses existing components/tokens: yes — semantic Tailwind tokens, Noto Sans SC, IBM Plex Mono, Lucide, and existing interaction styles
- Avoids unnecessary dependencies: yes
- Does not create parallel source of truth: yes, this lives under OpenSpec
- Next.js conventions: yes — App Router page, production `notFound()`, client boundary only where interaction is required
- Runtime coupling at that historical stage: none. The current Direction C instead embeds the formal
  standalone session and therefore reuses its capability-read path while leaving draft mutations inactive.

## Agent-readable state

- `state.json`: yes
- `events.jsonl`: yes
- `handoff.md`: yes
- Resume evidence: current artifacts in this folder

## Scorecard

| Dimension | Score | Notes |
| --- | ---: | --- |
| Visual taste | 8.7/10 | Dense, quiet, and consistent with OpenCLI while giving the active project a clear center of gravity |
| UX clarity | 9.6/10 | Workspace portfolio and active project editor are now separate screens with an explicit entry/return path |
| Accessibility | 8.2/10 | Project lifecycle and workspace project navigation have distinct semantic names; mobile targets still need a production pass |
| Responsiveness | 8.3/10 | Desktop has no overflow and the responsive structure is deliberate; fresh 390 px automation is pending |
| Motion quality | 8.5/10 | Restrained interaction feedback with shared reduced-motion behavior |
| Engineering fit | 9.4/10 | Reuses the existing Studio and WorkflowEditorSession contract; no dependency, API, or production-route expansion |
| Performance risk | 9.2/10 | Static data and CSS layout only; no editor/runtime payload added to product routes |

## Decision audit

| Decision | Principle | Result | Risk |
| --- | --- | --- | --- |
| Prototype before integration | Validate structure before data contracts | Three switchable static directions | Prototype must not leak to production |
| Existing tokens and components | Preserve product identity | No new design system or dependency | Existing token inconsistencies remain outside scope |
| Workspace → Project → Workflow → Node as baseline | Match the formal data model and keep the IDE task clear | Direction C is selected | Production route needs an explicit Workflow switcher |

## Historical verdict before formal-node integration

- Verdict at that time: Direction C demonstrated Project → Workflow selection and a node execution-binding prototype; that binding prototype is now superseded and removed.
- Blocking issues: none for static/build/production isolation; fresh browser interaction automation is tooling-gated
- Follow-up: extend the existing Studio and WorkflowEditorSession only after this object model is approved; do not create a parallel workspace implementation

## Four-layer canonical node integration verification (2026-07-14)

- Canonical hierarchy: passed — L1 business/operator nodes wrap the existing L2 OpenCLI package nodes; L3 component nodes and L4 primitives remain editable and persisted in the same recursive `WorkflowProject` graph.
- Depth boundary: passed — frontend paste/add guards and backend schema/compile validation reject L5 while allowing executable empty leaves at L1-L4.
- Canonical editing: passed — root and nested add/move/connect/delete/layout, parameter bindings, duplicate/cut/paste, and scope re-entry persist through the canonical graph.
- Atomic history: passed — “Add Internal Primitive” initializes fallback internals and adds the primitive in one history frame; one Undo restores the exact prior project.
- Backend compile/runtime: passed — recursive compile, boundary-edge rewriting, stable topological order, primitive port projection, runtime `nodePath`, run events/state/dispatch, evidence projection, and structural status aggregation cover all four levels.
- Frontend workflow regressions: passed — `19/19`, including a real cross-frontend/backend compile of `PACKAGED_WORKFLOW_PROJECT`.
- Workflow contract assertions: passed.
- TypeScript: passed — `pnpm exec tsc --noEmit`.
- Targeted frontend ESLint: passed.
- Backend workflow tests: passed — `73/73`; the post-run pytest temp-directory cleanup emitted a Windows permission warning after exit code 0 and did not affect test results.
- Final Plan IR gate: passed — compile success now requires `validate_plan_graph(plan_ir).valid`; the default operator graph lowers root and HDA internal boundaries to actual `out → in` leaf ports.
- Ruff on all modified Python files: passed.
- Next.js 16.2.6 production build: passed.
- Development smoke: passed — port 8030 returned 200 for Direction C with the product-shell marker; port 8031 returned `{"status":"ok"}`.
- Fresh production isolation: passed — port 8040 returned 404 without the prototype marker and `/dashboard` returned 200.
- Browser interaction automation: tooling-gated — the in-app browser controller still fails initialization with `Cannot redefine property: process`; no automated visual interaction claim is made for this pass.

### Remaining design boundary

- A compound node with multiple internal entries and exits currently expands an external boundary edge across all matching executable leaves. This is deterministic and tested, but explicit operator-level input/output port mapping should replace the Cartesian fallback before complex multi-boundary packages are published.
