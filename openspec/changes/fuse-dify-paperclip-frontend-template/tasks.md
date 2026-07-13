# Tasks

## Inventory and design

- [x] Inventory current routes, shell, workflow editor, operations types, and tokens.
- [x] Inventory Dify's global/resource and app-lifecycle logic from official sources.
- [x] Inventory Paperclip's task/control-plane logic from the official repository.
- [x] Define unified vocabulary, object hierarchy, and three structural directions.

## Prototype

- [x] Add a development-only `/prototype/product-shell` route.
- [x] Implement three structurally different variants selected by `?variant=`.
- [x] Add a reusable development-only prototype switcher with keyboard controls.
- [x] Use static, clearly labelled representative data and no API hooks.

## QA

- [x] Run targeted lint and TypeScript checks.
- [x] Run a production build and confirm the prototype does not ship as a usable route.
- [x] Inspect A/B/C in the browser at desktop width.
- [x] Inspect the recommended C direction at mobile width.
- [x] Record screenshot observations and the final scorecard in `qa.md`.

## Dify-led revision

- [x] Reframe the selected direction around a node-based Dify workspace.
- [x] Move data pipelines, triggers/schedules, runtime data, versions, and plugins into the workspace panel.
- [x] Keep global “待我处理” as Inbox and retain Linear-style work-item behavior.
- [x] Limit Paperclip influence to attention, visualization, evidence, approval, and activity surfaces.
- [x] Rework Direction C and update the prototype switcher label.
- [x] Re-run targeted lint and TypeScript checks.
- [x] Re-run desktop browser QA and verify no horizontal overflow or runtime errors.
- [ ] Re-run the production build after Google Fonts is reachable; two fresh attempts failed during external font download.
- [ ] Re-run automated 390 px metrics when the selected browser exposes viewport emulation; the browser security policy rejected the isolated harness.
