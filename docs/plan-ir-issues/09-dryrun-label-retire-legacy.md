# 09 — Dry-Run Preview labeling + legacy surface retirement

Labels: ready-for-agent
Parent: docs/plan-ir-PRD.md (ADR-0008)

## What to build

Close the convergence: the in-browser node-kit runtime becomes an explicitly-labeled
Dry-Run Preview — it runs Plans on fixture data only, is visually unmistakable as a
preview, and never calls collection APIs or writes records. The per-source dive
pseudo-expansion on the network view is retired; the standalone node-kit workbench
page moves out of the product navigation (kept only as a component-library demo
route). One canvas remains (stories 21, 22, 29, 30).

## Acceptance criteria

- [ ] Dry-Run Preview is visually labeled during and after preview runs; preview results are marked as fixture-derived
- [ ] Preview execution provably performs no collection API calls and persists nothing (test-enforced at the engine seam)
- [ ] The per-source dive pseudo-expansion is removed from the Collection Canvas
- [ ] The node-kit workbench page is out of product navigation; its route survives only as a component-library demo
- [ ] Navigation and docs (CONTEXT.md references) reflect the single-canvas reality; dead FlowGram/rete dependencies are flagged (removal PR separate if heavy)
- [ ] All existing node-kit engine tests still pass; new labeling/isolation behavior covered

## Blocked by

- 07-canvas-edit-lens
- 08-canvas-observe-lens-run
