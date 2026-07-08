# OpenCLI Admin Backend System Map

Status: guardrail note for future Canvas/workflow changes.

Purpose: prevent duplicate runtimes. Before adding a new Canvas node, binding, worker, webhook path, or collection flow, check the existing backend axis below and reuse it unless the new work explicitly replaces that layer.

## Golden Rule

Canvas is an authoring and projection surface. It should not invent a parallel backend runtime.

The backend already has these axes:

| Need | Existing axis | Primary files |
|---|---|---|
| User collection intent | WorkflowProject + demand draft patches | `backend/api/v1/workflows.py`, `backend/workflow/demand_assembler.py`, `backend/workflow/patcher.py` |
| Canvas validation/compile | Workflow compiler and node origin guard | `backend/workflow/compiler.py`, `backend/workflow/node_registry.py`, `backend/schemas/workflow.py` |
| Runtime binding truth | Workflow runtime registry and capability projection | `backend/workflow/runtime_registry.py`, `backend/workflow/capability_projection.py` |
| OpenCLI node fanout | OpenCLI source/fetch node dispatch envelopes | `backend/workflow/opencli_hda_tracer.py`, `iii/workers/collector-opencli/src/main.py` |
| Data collection channels | DataSource channel registry/runners | `backend/channels/*`, `backend/services/source_service.py` |
| Source execution pipeline | Task/pipeline runner and scheduler bridge | `backend/pipeline/*`, `backend/worker/*`, `iii/workers/schedule-bootstrap/src/main.py` |
| Evidence fact path | ODP contract and Rust hot path | `backend/odp/*`, `odp-rs/crates/*`, `iii/workers/odp-ingest-bridge/src/main.py` |
| Notifications | Notifier registry and notification rules | `backend/notifiers/*`, `backend/api/v1/notifications.py` |
| Inbound source webhooks | Source webhook trigger endpoint | `backend/api/v1/webhooks.py` |
| Browser/session resources | Browser pool and agent runtime | `backend/api/v1/browsers.py`, `backend/agent_runtimes/*`, `backend/services/browser_*` |
| Control/observability | Advisory, kill switch, ODP metrics | `backend/control/*`, `backend/api/v1/control.py` |

## Reuse Checklist

Before implementing:

1. If the work starts from a human need like "抓小红书热帖", model it as `intelligence.input.collection-need` plus `/api/v1/workflows/demand-draft`, not as a bespoke source textbox.
2. If the work collects data, check `backend/channels` and saved DataSource configuration before adding a new Canvas source.
3. If the work uses OpenCLI/browser state, route through OpenCLI source/fetch nodes, their dispatch envelopes, and resource resolution. Do not ask the user for raw cookies, profile ids, worker pools, or raw OpenCLI commands.
4. If the work emits data, send projection refs, batch refs, artifact refs, counts, and links. Do not push raw evidence records through SSE or webhook responses.
5. If the work notifies, check `backend/notifiers` first. A notifier implementation is not automatically a Canvas REAL delivery path.
6. If the work is scheduled, bind workflow run creation to the scheduler axis instead of inventing a second cron runtime.
7. If the work imports n8n/primitive vocabulary, keep primitive ids as design/import vocabulary until a real executor binding is added.

## Webhook Boundary

There are three separate webhook concepts:

| Concept | Existing basis | Current rule |
|---|---|---|
| Inbound trigger | `backend/api/v1/webhooks.py` | Source webhook ingress exists; workflow-run trigger binding is still blocked. |
| Outbound action | `backend/notifiers/webhook_notifier.py` | Backend notifier exists; Canvas live delivery stays blocked until EvidenceBatch projection, permission, and URL resources are resolved. |
| Respond-to-webhook | Design contract | Requires a workflow run input envelope and projection API; do not implement as a side path. |

`workflow.notifier.webhook.send` means "notifier contract exists". It does not mean Canvas can claim full REAL delivery until the event/projection spine and delivery resources are connected.

## Current Canvas REAL Surface

| Canvas item | Runtime truth |
|---|---|
| `intelligence.input.collection-need` | Real demand-draft/patch path. |
| `intelligence.schedule.cron` | Real manual schedule tick binding; automatic scheduler-to-run creation is separate. |
| `intelligence.source.opencli-slot` | Real OpenCLI source binding when adapter params resolve. |
| `package.opencli.multi-source-hda` | Compatibility catalog id for a package wrapper that composes real OpenCLI source/fetch nodes; OpenCLI itself is not an HDA. |
| `intelligence.output.webhook` | Backend notifier contract exists, but Canvas delivery remains blocked until projection/permission/URL closure. |

Anything else visible on Canvas must be `blocked`, `preview_only`, or `design_only` until it maps to one of the backend axes above.

## Verification Habit

Use the local code-intel pipeline and Sentrux before broad workflow changes:

```powershell
C:\c\Users\Administrator\projects\code-intel-pipeline\check-code-intel-tools.ps1 -RepoPath C:\c\Users\Administrator\projects\opencli-admin-backend -Json
C:\c\Users\Administrator\projects\code-intel-pipeline\invoke-code-intel.ps1 -RepoPath C:\c\Users\Administrator\projects\opencli-admin-backend -Mode normal
C:\c\Users\Administrator\projects\code-intel-pipeline\Invoke-SentruxAgentTool.ps1 check_rules C:\c\Users\Administrator\projects\opencli-admin-backend
```

If code-intel reports `graph_missing`, run the emitted Understand Anything command. Do not fabricate `.understand-anything/knowledge-graph.json`.
