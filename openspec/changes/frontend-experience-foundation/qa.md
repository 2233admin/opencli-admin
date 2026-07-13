# QA

## Static contracts

- Navigation transition contract: `pnpm check:navigation-transitions` — 4/4 passed.
- Workflow regressions: `pnpm check:workflow-regressions` — 8/8 passed.
- Workflow contracts: `pnpm test:workflow-contracts` — passed.

## Engineering gates

- ESLint: `pnpm lint` — passed with 10 pre-existing warnings and no errors.
- TypeScript: `pnpm exec tsc --noEmit --incremental false --pretty false` — passed.
- Next production build: `pnpm build` — passed; 21 static pages generated.

## Browser

- Desktop shell/navigation/theme/recovery: passed in the Codex in-app browser. The persistent shell remained mounted across dashboard, studio, and sources navigation; the theme toggle switched to light mode; the command palette opened, filtered to `工作区`, and closed without a runtime error.
- Route ownership: passed. Each settled route had one `data-ssgoi-transition` boundary keyed by pathname; `/studio?type=process` remained keyed as `/studio`.
- Reduced motion: passed with CDP-emulated `prefers-reduced-motion: reduce`; route navigation retained a single boundary without an exit/enter overlap.
- Mobile shell/overflow: passed at 390×844. Dashboard overflow was 0 px; Studio stayed within the viewport; the sidebar opened as a sheet and now closes after navigation.
- Console/runtime errors: clean browser session reported no error-level console entries.
