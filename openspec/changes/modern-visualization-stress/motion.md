# Motion

- Trigger: dashboard feed refresh or switching into the 5,000-point fixture.
- Purpose: communicate new data without hiding the current operational state.
- Behavior: no SVG path tween for the 5,000-point series; the chart updates atomically. Tooltip feedback remains 100ms via the upstream Tremor/Recharts pattern.
- Interruption: toggling back immediately restores the live series.
- Library: existing Recharts 3.8.
- Budget: target the display refresh rate during idle observation and avoid long tasks over 50ms after the initial stress render.
- Reduced motion: no continuous or essential animation is introduced.
