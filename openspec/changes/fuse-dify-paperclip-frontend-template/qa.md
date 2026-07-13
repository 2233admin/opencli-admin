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
- Tests: prototype intentionally has no behavioral test suite
- Build: passed — `pnpm build` with Next.js 16.2.6
- Production isolation: passed — `/prototype/product-shell?variant=C` returned 404 and did not contain prototype markup; `/dashboard` returned 200 on the same production server

## Browser / visual checks

- 390x812: passed for Direction C using device metrics override; `innerWidth`, document scroll width, and body scroll width all measured 390 px
- 500x812: passed as a narrow-stack visual check
- 1280x720: passed for A/B/C in the in-app browser
- 768x1024: static breakpoint inspection only; no separate screenshot retained
- 1920x1080: optional

Observed desktop captures:

- A keeps the workflow graph and debug trace dominant while retaining work, run, evidence, and approval context.
- B makes the project queue and selected work item cockpit dominant; the workflow becomes execution context.
- C expresses one object chain from goal through workflow, work item, run, evidence, review, and approval.

Observed mobile capture:

- C collapses to one column, hides the persistent workspace tree, and moves the attention rail below the main surface.
- The lifecycle navigation remains horizontally scrollable and the prototype switcher remains URL-stable.
- The first narrow-width pass exposed horizontal overflow; base grids were corrected to `minmax(0, 1fr)` and the final 390 px metrics showed no overflow.

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
| Visual taste | 8.4/10 | Dense, quiet, and consistent with the current OpenCLI console rather than importing Dify/Paperclip styling |
| UX clarity | 8.8/10 | C makes the operating loop explicit; A and B remain useful comparison anchors |
| Accessibility | 8.0/10 | Good semantics and naming; production mobile touch targets still need a dedicated pass |
| Responsiveness | 8.5/10 | C has no horizontal overflow at 390 px and collapses deliberately |
| Motion quality | 8.5/10 | Restrained interaction feedback with shared reduced-motion behavior |
| Engineering fit | 9.3/10 | No dependency or API expansion; production route is inert |
| Performance risk | 9.2/10 | Static data and CSS layout only; no editor/runtime payload added to product routes |

## Decision audit

| Decision | Principle | Result | Risk |
| --- | --- | --- | --- |
| Prototype before integration | Validate structure before data contracts | Three switchable static directions | Prototype must not leak to production |
| Existing tokens and components | Preserve product identity | No new design system or dependency | Existing token inconsistencies remain outside scope |
| Unified Loop as baseline | Keep build and operate in one context | Direction C is recommended | Three-pane density must be tested on mobile |

## Final verdict

- Verdict: ready for product review; Direction C is the recommended integration baseline
- Blocking issues: none for the static-template goal
- Follow-up: choose the winning direction, then map its objects and routes onto existing OpenCLI contracts before connecting data
