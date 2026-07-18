# Handoff

## Current state

- Change id: `linear-scale-inbox`
- Status: complete
- Phase: stage 6, verified handoff
- Last updated: 2026-07-18 18:54 +08:00

## Goal

Replace the constrained card-based Inbox with a full-height Linear-style workbench that remains usable for hundreds of signals.

## Artifacts

- Proposal: `proposal.md`
- Brief: `brief.md`
- Directions: `directions.md`
- Design: `design.md`
- Motion: not required
- Tasks: `tasks.md`
- QA: `qa.md`
- State: `state.json`
- Events: `events.jsonl`

## Decisions

- Keep the global app sidebar and use a two-pane queue/detail workbench.
- Remove the outer card, max-width, and large page intro.
- Use infinite API paging in 100-row chunks plus `content-visibility` for the first hundreds-scale target.
- Preserve existing destination links and do not invent missing backend actions.

## Evidence

- Browser baseline at 1440×1288: workbench y=246, width=1121, height=809, list height=237, about 49% viewport-area use.
- Final browser result at 1440×1288: workbench y=56, height=1232, queue viewport about 1077 px, and 77.6% total viewport-area use including the persistent sidebar.
- 1440×900 and 1920×1080 use a fixed-height two-pane workbench with no document scrolling.
- 768×1024 and 375×812 stack without horizontal overflow.
- Inbox regression 4/4, control plane 10/10, navigation 8/8, ESLint, and TypeScript all passed.
- Authenticated interaction checks passed for filtering, URL search state, clearing search, and J/K selection.
- Design Pipeline dependency check passed.

## Blockers

None. Independent verifier agents were unavailable because the agent runtime returned `Store must be set to false`; all available main-thread checks passed.

## Next actions

1. Keep the current implementation for hundreds-scale operational queues.
2. Add true row virtualization if expanded unique themes reach the many-thousands range.
3. Add a backend attention filter if exact notification-wide queue totals become a product requirement.
