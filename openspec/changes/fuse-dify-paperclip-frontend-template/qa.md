# QA

## Self-check

- Command: `node C:\Users\Administrator\.codex\skills\design-pipeline\scripts\check-deps.cjs --json`
- Result: OK
- Missing required skills: none
- Missing enhancement skills: none
- Missing optional skills: none
- Fallbacks: GBrain is not enabled; decisions remain in this OpenSpec change.

## Static checks

- Lint: passed — targeted ESLint returned zero warnings and zero errors
- Typecheck: passed — `pnpm exec tsc --noEmit`
- Independent product-boundary review: passed after moving the global Inbox explanation out of the Linear work-item card and naming the right attention rail `Inbox · 需要处理`
- Independent hierarchy review: passed with no P0/P1/P2 findings for Workspace → Project → Node ownership
- Tests: prototype intentionally has no behavioral test suite
- Build: passed — `pnpm build` completed with Next.js 16.2.6
- Production isolation: passed — the fresh production server returned 404 for `/prototype/product-shell?variant=C`, contained no prototype marker, and returned 200 for `/dashboard`

## Browser / visual checks

- 390x812: passed for the earlier C structure; fresh revised-C metrics are an explicit gap because the selected browser exposes no viewport resize and rejected the isolated harness under its security policy
- 500x812: passed for the earlier C structure as a narrow-stack visual check
- 1280x720: passed for revised C in the in-app browser; `innerWidth=1280`, document/body scroll width `1265`, no horizontal overflow
- Hierarchy semantics: passed in the DOM snapshot — workspace project list, sibling project types, active project lifecycle, project work items, project runs, and global Inbox were distinct named regions
- 768x1024: static breakpoint inspection only; no separate screenshot retained
- 1920x1080: optional

Observed desktop captures:

- A keeps the workflow graph and debug trace dominant while retaining work, run, evidence, and approval context.
- B makes the project queue and selected work item cockpit dominant; the workflow becomes execution context.
- C now preserves the existing two-step product structure: the workspace owns a project index
  and shared capabilities; opening one project leads to its node graph and project lifecycle.
- Acquisition, cleaning, knowledge, workflow, and delivery appear as sibling projects rather
  than one overloaded workspace menu.
- Linear-style work items sit below the canvas and Paperclip-style attention, evidence, approval,
  activity, and runtime visualization stay contextual rather than becoming the product hierarchy.
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
- Runtime coupling: none — no API hooks, query libraries, or backend dependencies

## Agent-readable state

- `state.json`: yes
- `events.jsonl`: yes
- `handoff.md`: yes
- Resume evidence: current artifacts in this folder

## Scorecard

| Dimension | Score | Notes |
| --- | ---: | --- |
| Visual taste | 8.7/10 | Dense, quiet, and consistent with OpenCLI while giving the active project a clear center of gravity |
| UX clarity | 9.4/10 | Workspace, project portfolio, active node project, Linear work, and Paperclip attention now have explicit ownership |
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
| Workspace → Project → Node as baseline | Reuse the existing product route and ownership model | Direction C is selected | Cross-project relationships need a future production treatment |

## Final verdict

- Verdict: ready for product review; Direction C is the selected integration baseline
- Blocking issues: none for the static-template implementation; only fresh 390 px automation remains environment-gated
- Follow-up: extend the existing Studio and WorkflowEditorSession only after this project hierarchy is approved; do not create a parallel workspace implementation
