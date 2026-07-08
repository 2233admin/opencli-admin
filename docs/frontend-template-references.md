# Frontend Template References

Curated + **verified** (GitHub API, 2026-07-02) template/reference repos for evolving the
frontend. Strategy: templates supply page structure, interaction shape, and information
density — never wholesale migration. Our core stays NodeSpec + ControlState (+ future
content layer); stack stays React (Vite today) + TypeScript + Tailwind + shadcn/ui +
TanStack Query + xyflow.

## Verified inventory

| Repo | License | Stars | Last push | Verdict |
|---|---|---|---|---|
| satnaing/shadcn-admin | MIT | 12.5k | 2026-06 | ✅ primary layout reference (Vite+shadcn, same stack as us) |
| Kiranism/next-shadcn-dashboard-starter | MIT | 6.6k | 2026-06 | ✅ if/when we move to Next.js — feature-folder org, auth, charts |
| arhamkhnz/next-shadcn-admin-dashboard | MIT | 2.6k | 2026-07 | ✅ multi-dashboard switching, theme presets, layout density |
| tremorlabs/template-dashboard-oss | Apache-2.0 | 507 | 2025-10 | ✅ metric cards / usage dashboards (Tremor components) |
| xyflow/xyflow | MIT | 37.4k | 2026-06 | ✅ already our canvas — do not switch |
| synergycodes/workflowbuilder | Apache-2.0 | 254 | 2026-07 | ✅ schema-driven node config, swappable execution engine (NOTE: repo name is `workflowbuilder`, no hyphen) |
| ant-design/pro-flow | MIT | 351 | 2025-01 | ⚠️ stale + AntD visual line — abstractions only |
| PaloAltoNetworks/docusaurus-openapi-docs | MIT | 1.1k | 2026-07 | ✅ long-term public docs site |
| scalar/scalar | MIT | 15.4k | 2026-07 | ✅ first choice for embedded API reference / OpenAPI portal |
| Open-Dev-Society/OpenStock | **AGPL-3.0** | 13.6k | 2026-07 | ⚠️ shape/UX reference ONLY — AGPL, never copy code |
| adrianhajdin/signalist_stock-tracker-app | **NO LICENSE** | 481 | 2025-09 | ⚠️ visual reference ONLY — unlicensed, never copy code |
| Tejeswar001/news-dash | MIT | 4 | 2026-03 | ⚠️ toy repo (4★) — skim for feed layout ideas at most |
| mickasmt/next-saas-stripe-starter | MIT | 3.0k | **2024-08** | ⚠️ stale ~2yr — structure reference, expect dep rot |
| TailAdmin/free-react-tailwind-admin-dashboard | MIT | 1.2k | 2026-04 | ⚠️ page inventory only; generic SaaS look, not control-room |

## Page packages → our surfaces

### A. Control Room (current product, highest priority)
References: shadcn-admin (layout/sidebar/table/settings), tremor template (metric
cards, source-health/usage dashboards), React Flow Workflow Editor template +
synergycodes/workflowbuilder (editor chrome, node config panel).

Maps to: Control Console (`/control/actions` — gate report, kill switch, ledger),
topology canvas (`/labs/topology`), NodeWorkbench (`/labs/node-kit`), ODP state node,
`SourcesPage` control strips, future Run Evidence views over `source_measurements`.

Concrete near-term steals:
- Tremor-style metric cards for advisory-report totals + ODP metrics
- shadcn-admin's table/filter/settings idioms as our `DataTable` evolves
- workflowbuilder's schema-driven node configuration for NodeSpec config panels

### B. Market News / content layer (future direction)
References: OpenStock + signalist (shape only — see license flags), news-dash (feed
layout ideas). Target pages: Live Feed, Event Detail, Ticker, Search/Archive, Review
Inbox. No code reuse from AGPL/unlicensed repos — re-implement shapes on our stack.

### C. API SaaS (future: keys/usage/billing)
References: nextjs/saas-starter, next-saas-stripe-starter (structure; stale),
ixartz/SaaS-Boilerplate. Target: Login, API Keys, Usage, Billing, Team, Settings.

### D. Developer Portal (future: /v1/* public API)
Scalar for embedded OpenAPI reference (fastest path — we already serve OpenAPI via
FastAPI); docusaurus-openapi-docs for a standalone public docs site later.

## Rules
1. Take layout/interaction/density; keep our domain components (ControlBadge,
   SourceControlStrip, KitNode, honest-empty-state discipline).
2. License gate before any code copy: MIT/Apache OK; AGPL/unlicensed = eyes only.
3. One package at a time, driven by an actual page need — no big-bang reskin.
4. Index sites for further search: shadcn.io/template, birobirobiro/awesome-shadcn-ui.
