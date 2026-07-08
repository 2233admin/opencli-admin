## Context

The current workflow work has made HDA source slots dynamic and exposed source internals, but the remaining user-visible flow still needs one end-to-end contract for input, adapter resolution, webhook ingress, output projection, and Canvas run binding. The user demand is a need, not a node strategy: low-level resource details must be assembled from existing nodes, catalog entries, adapters, and runtime metadata.

The Code Intel Pipeline run for this repo completed in normal mode and recommends OpenSpec OPSX for this brownfield change. It also reports Sentrux gate passed with no structural regression, while `.sentrux/rules.toml` is still missing, so governance check is skipped.

## Goals / Non-Goals

**Goals:**

- Make every workflow node surfaced on Canvas correspond to a real backend catalog/runtime contract.
- Provide typed input and output attachment points for need, trigger, webhook, source, normalize, and EvidenceBatch result flow.
- Resolve cookie, profile, worker, concurrency, and OpenCLI command details implicitly through existing adapter/resource metadata.
- Make Canvas mini/full cards, inspector, run result, and trace panels consume backend projections and run events.
- Keep 07/08/09 issue docs ready-for-agent with acceptance contracts that do not mislead agents into asking users for resource internals.

**Non-Goals:**

- Do not introduce a separate hand-authored node DSL outside the existing catalog/runtime registry.
- Do not ask users to fill cookie, browser profile, raw OpenCLI command, or worker policy fields.
- Do not claim unsupported adapters are runnable; unresolved resources must be blocked explicitly.
- Do not rebuild the whole Canvas interaction model in this change.

## Decisions

1. Use existing node catalog and runtime registry as the source of truth.
   - Rationale: The user explicitly rejected hand-rolled nodes. New frontend nodes must be projections of existing backend/catalog/runtime capabilities.
   - Alternative considered: add special-case Canvas-only nodes. Rejected because it creates fake runnable states.

2. Treat adapter resources as runtime-resolved dependencies.
   - Rationale: Cookie/profile/worker strategy is infrastructure state, not user need. The runtime can block with a missing-resource reason when resolution fails.
   - Alternative considered: expose fields in params. Rejected because it trains agents and users to hand-fill implicit resource internals.

3. Use EvidenceBatch as the output contract for collection results.
   - Rationale: EvidenceBatch gives a stable projection surface for run result panels, webhook callbacks, and later collection evidence APIs.
   - Alternative considered: show raw OpenCLI output directly in Canvas. Rejected because it cannot provide stable node/source/run linkage.

4. Drive Canvas status from node run events.
   - Rationale: Canvas must show real queued/running/blocked/succeeded/failed/result-ready state, and the inspector must bind to the selected node's schema.
   - Alternative considered: keep local fixture state for demos. Rejected because the next work requires real runtime collection and capture.

## Risks / Trade-offs

- [Risk] Existing adapter metadata may not contain enough resource hints for every source.
  -> Mitigation: return structured missing-resource blocked states and add tests for both resolved and missing resources.
- [Risk] Canvas can regress into generic schedule trigger inspector fields.
  -> Mitigation: add frontend tests or fixture assertions that selected nodes render their own schemas and never fall back silently.
- [Risk] EvidenceBatch projection may duplicate replayed run events.
  -> Mitigation: require stable workflow/run/node/source ids and idempotent projection tests.
- [Risk] Sentrux governance remains amber because `.sentrux/rules.toml` is missing.
  -> Mitigation: keep this visible as governance debt; do not confuse it with runtime failure.

## Migration Plan

1. Land the OpenSpec contract and align 07/08/09 docs.
2. Implement backend runtime/resource/projection changes behind existing compile/run APIs.
3. Bind frontend Canvas catalog, inspector, mini/full cards, result, and trace panels to backend projections.
4. Run targeted backend integration tests, frontend typecheck/lint, OpenSpec validation, and Code Intel/Sentrux verification.

## Open Questions

- Which existing adapter registry field is authoritative for browser session resource resolution?
- Should missing resource remediation be exposed as a separate admin node or only as runtime status in this change?
