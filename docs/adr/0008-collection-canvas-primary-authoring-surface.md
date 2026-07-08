# The Collection Canvas is the primary authoring surface — the graph is the program

The original console language (2026-07) deliberately demoted the canvas: "Diagnostic
Canvas … a secondary view … not the default place to configure routine collection
work." Living with that for one iteration produced the opposite evidence: collection
definitions lived in per-channel JSON config edited through forms, the canvas was a
derived picture of the database, and three disconnected node representations grew
(topology view, per-source dive, node-kit workbench with a browser-only toy runtime).
Operators could not author anything where they could see it.

Decision (2026-07-02, supersedes the Diagnostic Canvas posture): the canvas — renamed
**Collection Canvas** — is the primary authoring surface. Defining and editing what
gets collected happens on the graph; forms survive only as the inspector panel of a
selected node. The old diagnostic role is absorbed as a second lens on the same
canvas (edit lens / observe lens), not a separate surface. The per-source
"dive" pseudo-expansion and the standalone node-kit page as a product surface are
retired; the NodeSpec registry and KitNode renderer remain as the rendering wheel.

Trade-off accepted: canvas-first authoring is more implementation surface than forms
(draft states, inspector panels, graph persistence) and it re-opens a decision the
glossary had settled. We take that cost because the alternative — keeping forms as
the program and the canvas as a picture — is exactly the fracture that made the node
editor unusable, and no amount of palette/layout polish on a picture fixes it.
