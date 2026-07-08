## 1. Contract And Docs

- [ ] 1.1 Keep 07/08/09 issue docs marked ready-for-agent only where each has explicit acceptance criteria and runtime verification commands.
- [ ] 1.2 Remove or rewrite wording that asks users, AI patches, or agents to hand-fill cookie, browser profile, raw OpenCLI command, or worker policy fields.
- [ ] 1.3 Align `docs/workflow-hda-demand-runtime-io-webhook-linkage.md` with need input -> adapter/resource resolution -> webhook/run events -> EvidenceBatch output.
- [ ] 1.4 Align `docs/workflow-node-capability-mapping.md` so frontend node entries map to existing catalog/runtime capabilities or explicit unsupported states.

## 2. Backend Runtime I/O

- [ ] 2.1 Add or verify the real need/input node contract in compile output with stable ports and node ids.
- [ ] 2.2 Add adapter/resource resolution for source nodes using existing catalog, adapter registry, and runtime metadata.
- [ ] 2.3 Return structured blocked/missing-resource states when adapter, cookie, profile, worker, concurrency, or OpenCLI command resolution fails.
- [ ] 2.4 Add webhook-trigger input handling that emits node run events with workflow id, run id, node id, and source id.
- [ ] 2.5 Add idempotent EvidenceBatch projection for source/normalize outputs and replayed run events.

## 3. Canvas Runtime Binding

- [ ] 3.1 Project adapter/source nodes to frontend catalog entries from backend contracts instead of Canvas-only placeholders.
- [ ] 3.2 Bind node inspector forms to the selected node schema so schedule fields never appear for unrelated nodes.
- [ ] 3.3 Implement compact and full node views from the same real node contract, including identity, status, ports, params, internals, outputs, and trace.
- [ ] 3.4 Apply backend run event patches to Canvas nodes, edges, result workbench, and trace panel.
- [ ] 3.5 Show blocked/missing-resource reasons without exposing cookie/profile/worker fields as user inputs.

## 4. Verification

- [ ] 4.1 Add backend integration tests for compile, resource resolution, blocked states, webhook ingress, run events, and EvidenceBatch projection.
- [ ] 4.2 Add frontend tests or fixture assertions for catalog projection, inspector binding, mini/full node views, runtime patches, result, and trace.
- [ ] 4.3 Run `npm run typecheck:frontend` and `npm run lint:frontend`.
- [ ] 4.4 Run targeted pytest suites for workflow compile, OpenCLI HDA trace, run events, webhook, and EvidenceBatch APIs.
- [ ] 4.5 Run `openspec validate real-node-io-webhook-runtime --strict`.
- [ ] 4.6 Run Code Intel Pipeline normal mode after implementation and record Sentrux gate/check status.
