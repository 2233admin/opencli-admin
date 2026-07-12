# DSL Translation Core

## Decision

DSL is an interchange and translation boundary, not an execution model.

```text
Dify DSL ───────┐
n8n JSON ───────┼─ translator ─ compatibility report ─ WorkflowProject
OpenCLI JSON ───┘                                      │
                                                      ├─ compiler
                                                      ├─ scheduler
                                                      └─ workers
```

`WorkflowProject` is the only graph accepted beyond the translation boundary. The compiler,
scheduler and run model operate on that canonical graph. Only the runtime-binding resolver reads
the canonical `compatRuntime.target` marker to select a replaceable compatibility worker.

## Contract

The translation entry point returns either:

- `ok`, canonical `WorkflowProject`, detected source format and an optional compatibility report; or
- `error`, without creating a Project, Workflow, version or run.

Every translator owns four jobs only:

1. recognize its source document;
2. translate nodes, edges, parameters and adapter references;
3. preserve source anchors needed for review and round-trip diagnostics;
4. report unsupported or degraded constructs.

It does not schedule, execute, retry, persist credentials or silently invent runtime capability.

## Lifecycle

```text
upload → recognize → translate → review report → create WorkflowDraft → publish → run
```

Translation must finish before persistence. A failed translation cannot leave an orphan Project or
Workflow. Publishing still passes through the normal canonical compiler and validation gates.

Translated workflows are packaged as expandable HDA nodes. The canvas shows one outer tool by
default, while the preserved source graph lives in `internals`; compilation materializes those
nodes as `packageId::nodeId` for inspection, tracing and debugging.

## Format adapters

- OpenCLI JSON: validates directly as `WorkflowProject`.
- n8n JSON: implemented by `n8n-translator.ts` and routed through `codec.ts`.
- Dify DSL: plugs into the same codec contract; it must translate to `WorkflowProject` before the
  existing compiler or execution paths can see it.

Adding another DSL means adding one translator and compatibility report. It must not add conditions
to the compiler, scheduler or worker protocol.

## Compatibility workers

- `workflow.compat.n8n.execute` dispatches to `n8n-compat`.
- `workflow.compat.dify.execute` dispatches to `dify-compat`.

Both bindings publish stable I/O contracts. The compatibility workers are execution backends, not
parallel authoring or scheduling systems.
