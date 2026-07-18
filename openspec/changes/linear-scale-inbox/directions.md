# Directions

## Selected: Operational split workbench

- Visual thesis: remove the card and oversized page intro; use a compact 56 px page bar followed by an edge-to-edge list/detail split.
- Interaction thesis: the queue is the primary navigation surface, with sticky section headers, independent scrolling, URL-backed filters, J/K navigation, and progressive loading.
- Fit: matches the frequency and scale of an operations inbox while preserving OpenCLI's existing shell and semantic status colors.
- Risk: two panes need a deliberate single-column fallback below the desktop breakpoint.

## Rejected: Bento dashboard

- The generated design-system search suggested bento cards, glass effects, and multiple feature sections.
- Rejected because this is a repeated-use operational queue, not a marketing or overview surface. Cards and atmospheric effects reduce usable area and scan speed.

## Rejected: Three-column command center

- A persistent filter rail, queue, and detail pane would add hierarchy but duplicate the global application sidebar.
- Rejected for this iteration because the global sidebar already consumes the left rail; queue filters fit in the list toolbar.
