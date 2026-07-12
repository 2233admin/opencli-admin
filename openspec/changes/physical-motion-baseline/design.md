# Design

- Press: 70ms force-in to `translateY(1px) scale(.965)`.
- Release and hover: 180ms overshoot-free/low-overshoot settle curve.
- Sidebar: 300ms spatial curve `cubic-bezier(.32,.72,0,1)` across its three states.
- Cards: one-pixel composited lift; no added shadows.
- Navigation: two-pixel hover pull and three-pixel active anchoring.
- Reduced motion: all durations collapse to 0.01ms with one iteration.
- Switch: the Base UI thumb stretches toward travel while pressed, then settles from the destination edge.
- Toggle/Tabs/Slider: pressed depth, tension reveal, and grab-weight feedback reuse the same shared settle curve.
