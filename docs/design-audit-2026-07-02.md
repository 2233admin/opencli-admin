# Design System Audit — 2026-07-02

Scope: `frontend/` (Vite + React + Tailwind + shadcn/ui). Method: static scan (token
inventory + violation counts, exact file:line) + live checks against the running app
(contrast measured from computed styles, responsive at 375px, focus/touch probing).

## Scorecard

| # | Dimension | Score | Verdict |
|---|---|---|---|
| 1 | Color consistency | 3/10 | Real palette exists (tailwind `primary/signal/ops` + shadcn HSL vars + `--oc-*` skins = THREE parallel systems), but 158 raw hex + 91 rgba() + 28 arbitrary color classes layered on top. Topology/node-kit least disciplined. 4+ competing "near-black" panel values. |
| 2 | Typography hierarchy | 4/10 | Semantics good (single h1 in PageHeader, consistent h2/h3). Size tokens are soup: 178 arbitrary-px (`text-[9/10/11px]`) vs 587 scale usages — 1 in 4 bypasses the scale. |
| 3 | Spacing rhythm | 8/10 | Zero arbitrary bracket spacing. Cleanest dimension. |
| 4 | Component consistency | 3/10 | Stat tile ×3 (`StatTile` / `MiniStat` SourcesPage:1442 / `MetricBox` SourcesPage:1888); badge ×2 systems + 15 files hand-rolling pills; 12 hand-rolled `fixed inset-0` modals bypassing ConfirmDialog/ui-dialog; 2 raw `<table>` bypassing DataTable; 4 shadcn primitives each hardcoding their own `bg-[#090b0c]` popover color. |
| 5 | Responsive | 8/10 | Live-verified at 375px: no horizontal scroll, sidebar collapses to 64px rail, tables scroll inside `overflow-x-auto`. Minor TH clipping only. |
| 6 | Dark mode | 2/10 | Dark-only by hardcode, not by theme: shadcn semantic tokens (`bg-background`/`border-border`/`bg-card`) defined in index.css but **zero** usages in TSX. `border-white/10` ×52 in SourcesPage alone. Light theme = rewrite, not toggle. |
| 7 | Animation | 8/10 | 34 usages, all spin/pulse/radix-in-out. Zero decorative. |
| 8 | Accessibility | 4/10 | **Live-measured contrast: `text-zinc-500` = 4.12:1 (fails AA 4.5 for small text, used pervasively at 10–11px); `text-zinc-600` = 2.57:1 (breadcrumbs, hard fail).** shadcn buttons have focus-visible ring; raw `<Link>` action buttons have none. xs buttons 28px tall (desktop tool — acceptable, noted). |
| 9 | Information density | 7/10 | Control-room density is a deliberate, coherent language (font-code, tight tiles). The 9px micro-labels push past readable at that contrast. |
| 10 | Polish | 6/10 | Hover states consistent, loading spinners, **honest empty states are a genuine strength** (pre-measurement "—", no fabricated zeros). Gaps: gray-500 vs zinc-500 mix in DataTable headers; hand-rolled modals have no transition parity with radix ones. |

**Total: 53/100** — structure and honesty are strong; token discipline and component reuse are the debt.

## AI slop check: mostly clean

Gradients (13) are grid-texture/vignette set-dressing, purposeful. Blur (11) is mostly
modal overlays, legitimate. No bounce/ping decorative animation. The one smell: a
copy-pasted purple `900/700/300/100` category-badge snippet repeated across 6+ pages, and
node-kit accents using raw `violet-500/fuchsia-500/purple-400` instead of the existing
`signal.violet` token. Copy-paste debt, not generated-slop aesthetic.

## i18n discipline: collapsing in new code

i18next is a dependency; 11/16 pages import it. But the two NEWEST pages have **zero**
`t()` calls: ActionHistoryPage (7 hardcoded Chinese lines — toasts:77, dialog:237–243)
and SourceControlRoomPage (10 lines — headers:188/214/260, buttons:316/325, help:297).
SourcesPage is 167 Chinese lines vs 18 `t()` calls (~9:1). New code is being written
outside the established i18n pattern.

## Top-10 fixes (impact/effort ranked)

1. Migrate `border-white/N`+`bg-black/N` → semantic shadcn tokens (start Layout.tsx:222,226; SourcesPage 52+). Unblocks theming, kills the 4 competing blacks. High/high — start now or never.
2. `t()`-wrap ActionHistoryPage + SourceControlRoomPage Chinese strings. High/low.
3. Delete `MiniStat`+`MetricBox`, extend shared `StatTile` with `danger` prop. Med/low.
4. Migrate 12 hand-rolled modals → ConfirmDialog/ui-dialog (list in dimension 4). Med-high/med.
5. Extract shared `--popover` color for tooltip.tsx:22 / select.tsx:76 / dialog.tsx:39 / alert-dialog.tsx:37. Med/low.
6. Consolidate pills onto ui/badge.tsx; merge/delete StatusBadge.tsx. High/high.
7. Codify micro-label sizes: add 1–2 named fontSize tokens in tailwind.config, kill the 9/10/11px spread (178 sites). Med/med.
8. **Contrast: raise zinc-500→zinc-400 for ≤11px text; kill zinc-600 on breadcrumbs (2.57:1).** Med/low — accessibility hard-fail today.
9. DashboardPage:421 + RecordsPage:566 raw tables → DataTable; DataTable header gray-500 → zinc. Low-med/low.
10. node-kit purple accents → `signal.violet` token. Low/low.

## Explicit non-goals

- No light theme until #1 lands (would be fake toggle).
- Do not "fix" the density language itself — the control-room look is the product's
  identity; fix its token plumbing, not its character.
