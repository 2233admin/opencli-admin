# Design

- Header: title and context left, compact stress toggle right; stack on narrow screens.
- Chart: 256px stable height, existing chart tokens, grid and tooltip preserved.
- Data: default remains backend/demo feed. Stress mode swaps in 5,000 deterministic points and exposes `data-point-count` for automated evidence.
- Accessibility: toggle uses `aria-pressed`; chart enables Recharts' accessibility layer; fake-data state is described in visible text.
- Performance: 5,000 points are memoized. Series animation stays disabled, matching Tremor Raw's official large-path behavior. Live motion is provided by data updates, not decorative tweening.
