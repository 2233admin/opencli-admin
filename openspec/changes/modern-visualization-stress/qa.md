# QA

Status: passed for the current Recharts/Tremor-Raw validation slice.

## Evidence

- Design-pipeline dependency self-check: `OK`; all visual, motion, React/Next.js, and engineering companion groups available.
- Targeted ESLint: passed.
- TypeScript `--noEmit`: passed.
- Next.js 16 production build: passed; 23/23 static pages generated.
- Browser: stress toggle changed `data-point-count` from 14 to 5,000 and visible copy clearly labelled the synthetic fixture.
- 3,004ms requestAnimationFrame sample while the 5,000-point chart was visible: 481 frames, 160.1 FPS, 6.4ms maximum frame gap in the attached Chrome environment.
- Initial switch into 5,000 points: 289ms task time, including 221ms script, 41ms layout, and 7ms style recalculation.
- 828px-wide visual inspection: chart and header control remained within the card; no horizontal clipping was visible.

## Gates

- Visual: 4/5 — compact operational hierarchy and existing tokens retained.
- UX clarity: 5/5 — fake data is opt-in, labelled, and reversible.
- Accessibility: 4/5 — `aria-pressed` and Recharts accessibility layer present; full screen-reader audit not run.
- Responsive: 4/5 — verified at attached 828px viewport; smaller phone viewport not measured.
- Motion: 5/5 — avoids expensive decorative SVG tweening and keeps tooltip feedback.
- Engineering fit: 5/5 — no dependency or second chart runtime added.
- Performance risk: 4/5 — steady-state cadence is strong; frequent full replacement of all 5,000 SVG points would still incur a roughly 289ms rebuild and should use a windowed series or Canvas.

## Known unrelated signal

Chrome logged `Access to storage is not allowed from this context.` once while using the local development login flow. The dashboard and stress fixture remained functional; this change does not access storage.
