# Design

- Layout: compact two-column strip; status and three metrics left, local clock right. Stack cleanly below 640px.
- Color: neutral white/gray baseline; amber only when failures exist; muted white for demo state.
- Type: 10px utility status, 9px metric labels, 16–18px metric values, enlarged pixel clock.
- Copy states: demo telemetry, attention required, or healthy; never claim normal while failures exist.
- Motion: retain the existing one-second clock update only. No new animation.
- Accessibility: keep timer role and spoken full time; state meaning must not rely on color alone.
