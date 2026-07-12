# Design

- Layout: compact three-zone strip on desktop; status, metrics, and clock share one scan line. Metrics drop below status on narrower screens.
- Color: neutral white/gray baseline; amber only when failures exist; muted white for demo state.
- Type: 10px utility status, 9px metric labels, 16–18px metric values, 6–8px clock pixels with stronger spacing.
- Copy states: demo telemetry, attention required, or healthy; never claim normal while failures exist.
- Motion: retain the existing one-second clock update only. No new animation.
- Accessibility: keep timer role and spoken full time; state meaning must not rely on color alone.
