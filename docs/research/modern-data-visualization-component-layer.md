# Modern data-visualization component layer

Research date: 2026-07-12. Sources are limited to official project repositories, documentation, and examples.

## Decision

**Primary recommendation: adopt Tremor Raw as the dashboard/chart recipe library, while keeping the existing shadcn `Chart` + Recharts 3.8 runtime.** Copy only the cards and chart compositions needed by each screen into the repository, then restyle them with the existing tokens. Do not install a second general-purpose chart engine.

This is the lowest-risk way to get the “modern, unified component layer” requested:

- The repository already has React 19, Next.js 16, Tailwind 4, shadcn, Recharts 3.8, and `components/ui/chart.tsx`.
- shadcn's official chart layer is explicitly built on Recharts, provides copyable source rather than a wrapper, supports CSS-variable theming and accessibility, and has already been updated for Recharts v3 ([chart documentation](https://ui.shadcn.com/docs/components/radix/chart), [chart gallery](https://ui.shadcn.com/charts/radar)).
- Tremor Raw is a copy-and-paste collection of 35+ React components built with Tailwind and Radix; its repository is Apache-2.0 and explicitly targets charts and dashboards ([Tremor Raw repository](https://github.com/tremorlabs/tremor)). Its official dashboard template is Next.js + Recharts + Tailwind + Radix and is also Apache-2.0 ([dashboard template](https://github.com/tremorlabs/template-dashboard-oss)).
- Copying recipes avoids two competing tooltip, legend, responsive-container, and color-token systems. The copied source can be adapted directly to the IDE visual language, which is the actual product requirement.

The practical component set should start with existing official recipes, not an invented abstraction: metric card with sparkline, interactive time-series area chart, stacked throughput/error bar chart, source-distribution donut, and run/activity table. Add a shared wrapper only after two screens demonstrate an identical API.

## Supplementary choice

**Use Unovis only for topology and flow visualizations that Recharts does not express cleanly**—not as the default dashboard engine. Relevant examples are graph, Sankey, timeline, and maps.

Unovis is Apache-2.0, modular and tree-shakable, supports component-level imports and CSS-variable customization, and ships a React package ([repository](https://github.com/f5/unovis), [introduction](https://unovis.dev/docs/intro/)). Its official gallery exposes copyable/live examples, and the repository's latest release shown by GitHub is 1.6.7 dated 2026-06-28, so it is actively maintained in 2026 ([gallery](https://unovis.dev/gallery/), [repository releases](https://github.com/f5/unovis/releases)). This makes it a reasonable later dependency for collection-to-consumption topology or workflow execution traces, where its network/flow primitives materially replace custom code ([Graph documentation](https://unovis.dev/docs/networks-and-flows/Graph/)).

Ceiling: Unovis adds a second rendering and interaction vocabulary. Add it only when an accepted screen needs a graph/Sankey/map and the existing XYFlow/Recharts stack cannot meet it without substantial custom rendering.

## Candidate comparison

| Candidate | License and activity | Fit with current stack | Templates / editable source | Decision |
|---|---|---|---|---|
| Tremor Raw + existing shadcn/Recharts | Tremor Raw Apache-2.0; Recharts is active, with 3.8.x releases in 2026 ([Tremor](https://github.com/tremorlabs/tremor), [Recharts releases](https://github.com/recharts/recharts/releases)) | Highest: same Tailwind/Radix/Recharts family; no new chart runtime | 35+ copyable components plus official OSS Next.js dashboard | **Primary** |
| shadcn charts alone | shadcn is MIT/open-code; official chart docs target Recharts v3 ([repository](https://github.com/shadcn-ui/ui), [docs](https://ui.shadcn.com/docs/components/radix/chart)) | Already installed and themed | Large copy/paste gallery; less complete as a dashboard composition source | Foundation retained under Tremor recipes |
| Unovis | Apache-2.0; 1.6.7 released 2026-06-28 ([repository](https://github.com/f5/unovis)) | React package works independently of Tailwind; CSS variables aid theming | Gallery and code snippets; strong graph/flow/map coverage | **Supplement only** |
| Nivo | MIT; latest repository release visible is 0.99.0 from 2025-05-23 ([repository](https://github.com/plouc/nivo)) | React/D3 package family introduces its own theme, motion, tooltip, and responsive conventions | Excellent component explorer, SVG/canvas/SSR breadth | Do not adopt: duplicates Recharts for ordinary dashboard charts; React 19 support is not explicitly established by the cited official material |
| Apache ECharts + React wrapper | ECharts Apache-2.0 and actively released (6.1.0 on 2026-05-19); `echarts-for-react` MIT ([ECharts](https://github.com/apache/echarts), [wrapper package](https://github.com/hustcc/echarts-for-react/blob/master/package.json)) | Powerful canvas/SVG engine, but option-object styling does not naturally reuse shadcn/Tailwind component source | Huge official example surface, but examples are configuration objects rather than editable dashboard components | Do not adopt as default; reserve for a proven high-volume/advanced-chart performance requirement |

## Explicit non-selections

- **Do not replace Recharts with Nivo.** It broadens chart types but duplicates what is already installed, while bringing D3/react-spring package families and a separate theming model. Its official repository documents SSR, SVG/canvas, motion and rich packages, but that breadth is unnecessary for the current overview screen ([Nivo repository](https://github.com/plouc/nivo)).
- **Do not add ECharts plus `echarts-for-react` for normal dashboard charts.** ECharts is the strongest choice here for dense, high-volume canvas rendering and advanced interactions, and its core supports modular imports; however, it is not a copyable Tailwind component system. The commonly used React wrapper currently advertises broad React peer compatibility but carries older React 17-era development typings, increasing integration ownership ([wrapper package](https://github.com/hustcc/echarts-for-react/blob/master/package.json)). Reconsider only after measurement shows Recharts cannot handle a required dataset or chart type.
- **Do not install the legacy Tremor npm component package as the new foundation.** Use Tremor Raw/source recipes. The Raw repository describes the intended copy-and-paste ownership model; copying selected compositions avoids another opaque component dependency ([Tremor Raw repository](https://github.com/tremorlabs/tremor)).

## Adoption boundary

For the first implementation, copy one official Tremor dashboard composition and adapt it to the existing `ChartContainer`, tokens, and live overview data. No new dependency is necessary. If the result proves reusable on a second page, promote only the repeated card/chart pattern into the local component layer. Add Unovis later only for one accepted topology/flow requirement.

