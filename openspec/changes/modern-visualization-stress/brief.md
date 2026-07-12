# Brief

- Goal: replace the opaque chart demo with an official-library-based time-series composition and a visible 5,000-point stress fixture.
- Audience: operators checking collection, processing, and delivery health on the overview page.
- Surface: dashboard throughput chart on desktop and narrow layouts.
- Constraints: keep Recharts 3.8 and shadcn already in the repo; reuse Tremor Raw's Apache-2.0 recipe; no second chart runtime; fake data must be deterministic and explicitly labelled.
- Non-goals: topology/Sankey, backend benchmark, or claiming 5,000 display FPS.
- Acceptance: one-click 5,000-point mode, real data remains the default, no clipped controls, typecheck/lint pass, and browser FPS/long-task evidence is recorded.
