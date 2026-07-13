## 1. Contract And Docs

- [x] 1.1 Keep 07/08/09 issue docs marked ready-for-agent only where each has explicit acceptance criteria and runtime verification commands.
- [x] 1.2 Remove or rewrite wording that asks users, AI patches, or agents to hand-fill cookie, browser profile, raw OpenCLI command, or worker policy fields.
- [x] 1.3 Align `docs/workflow-hda-demand-runtime-io-webhook-linkage.md` with need input -> adapter/resource resolution -> webhook/run events -> EvidenceBatch output.
- [x] 1.4 Align `docs/workflow-node-capability-mapping.md` so frontend node entries map to existing catalog/runtime capabilities or explicit unsupported states.

## 2. Backend Runtime I/O

- [x] 2.1 Add or verify the real need/input node contract in compile output with stable ports and node ids.
- [x] 2.2 Add adapter/resource resolution for source nodes using existing catalog, adapter registry, and runtime metadata.
- [x] 2.3 Return structured blocked/missing-resource states when adapter, cookie, profile, worker, concurrency, or OpenCLI command resolution fails.
- [x] 2.4 Add webhook-trigger input handling that emits node run events with workflow id, run id, node id, and source id.
- [x] 2.5 Add idempotent EvidenceBatch projection for source/normalize outputs and replayed run events.

## 3. Canvas Runtime Binding

- [x] 3.1 Project adapter/source nodes to frontend catalog entries from backend contracts instead of Canvas-only placeholders.
- [x] 3.2 Bind node inspector forms to the selected node schema so schedule fields never appear for unrelated nodes.
- [x] 3.3 Implement compact and full node views from the same real node contract, including identity, status, ports, params, internals, outputs, and trace.
- [x] 3.4 Apply backend run event patches to Canvas nodes, edges, result workbench, and trace panel.
- [x] 3.5 Show blocked/missing-resource reasons without exposing cookie/profile/worker fields as user inputs.
- [x] 3.6 Preserve the complete product shell, place node workflow inside `/studio/workflow`, retain `/canvas` as a compatibility redirect, and support package-level nested networks with scoped ids.

## 4. Verification

- [x] 4.1 Add backend integration tests for compile, resource resolution, blocked states, webhook ingress, run events, and EvidenceBatch projection.
- [x] 4.2 Add frontend tests or fixture assertions for catalog projection, inspector binding, mini/full node views, runtime patches, result, and trace.
- [ ] 4.3 Run `npm run typecheck:frontend` and `npm run lint:frontend` (targeted workflow assertions pass, but the canonical worktree still has unresolved cross-branch TypeScript imports; repository-wide lint is also blocked by generated `frontend/dist` debt).
- [x] 4.4 Run targeted pytest suites for workflow compile, OpenCLI HDA trace, run events, webhook, and EvidenceBatch APIs.
- [x] 4.5 Run `openspec validate real-node-io-webhook-runtime --strict`.
- [x] 4.6 Run Code Intel Pipeline normal mode after implementation and record Sentrux gate/check status (orchestration and doctor pass; Sentrux Pro/rules are available, but the baseline is missing and the pipeline stage hangs without output, so the owned process was stopped after bounded waiting).
