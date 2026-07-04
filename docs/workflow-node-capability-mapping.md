# Workflow Node Capability Mapping

Status: audit note before continuing `07/08/09`.

Purpose: stop inventing replacement nodes. This maps the nodes already visible in the frontend and backend to real executable capability, current wiring, and collection usefulness.

Implementation slice:

- Backend now exposes `GET /api/v1/workflows/capabilities`.
- Frontend proxies it through `GET /api/workflow/capabilities`.
- Canvas catalog, command palette, node cards, and Node Management can show `REAL`, `BLOCKED`, `PREVIEW`, or `DESIGN` status from the capability projection.
- This does not execute blocked nodes. It only makes runtime truth visible before the full run/SSE/result workbench wiring.

## Hard conclusion

The system has three real but misaligned surfaces:

1. Frontend Canvas catalog: 22 addable catalog nodes in `frontend/lib/workflow/node-catalog.ts`.
2. Frontend primitive library: 107 primitive/import nodes in `frontend/lib/workflow/node-primitives.ts`.
3. Backend collection capability: 7 real `DataSource.channel_type` runners under `backend/channels`.

Today, Canvas workflow runtime execution is only wired for `source/fetch` with an OpenCLI adapter (`provider=opencli` or `config.channel=opencli`). Everything else may compile or display, but it does not yet have an authoritative workflow runtime binding.

So the next step is not more hand-made nodes. The next step is to project existing backend source/channel/runtime/notifier capabilities into the Canvas catalog, and to mark any unmapped visible node as blocked or design/import-only.

## Current runnable axis

| Surface | Count | Real capability | Canvas runtime state |
|---|---:|---|---|
| Catalog nodes | 22 | Authoring palette and contracts | Only OpenCLI source/fetch internals have runtime metadata; others surface `missing_runtime_binding` |
| Primitive nodes | 107 | n8n/import/design vocabulary | Accepted by backend origin guard, but no primitive executor binding |
| DataSource channels | 7 | `opencli`, `web_scraper`, `api`, `rss`, `cli`, `skill`, `crawl4ai` | Real outside Canvas through channel runner; not projected as executable Canvas source nodes except OpenCLI-HDA path |
| Frontend source adapters | 1 direct adapter | `jin10` fixture/live frontend adapter | Local/simulated path, not authoritative backend workflow runtime |
| Backend workflow run events | 1 event API family | `/api/v1/workflows/runs` + events + SSE | Backend exists; frontend `/api/workflow/run` still creates local run artifacts after compile |

## Adapter/source mapping

| Capability | Existing implementation | Frontend visibility | Runtime state | Can serve real collection need now? |
|---|---|---|---|---|
| OpenCLI source/fetch | `backend/channels/opencli_channel.py`; workflow runtime registry recognizes OpenCLI source adapters | `intelligence.source.opencli-slot`; `package.opencli.multi-source-hda`; HDA internals materialize source slots | Partially wired: backend compile/materializer/event stream exists; frontend run binding/result projection pending | Backend-side yes for current HDA proof; Canvas UI direct-use is not complete |
| JIN10 source | Frontend adapter `frontend/lib/workflow/adapter-registry.ts`; catalog `intelligence.source.jin10` | Visible as catalog/source and local adapter | Not wired to backend workflow runtime | Not authoritative from Canvas; only frontend/local artifact path |
| RSS source | `backend/channels/rss_channel.py` | Only Data Sources page label and primitive vocabulary, not a real Canvas source catalog item | Not wired to workflow runtime | Real backend capability, blocked on Canvas projection |
| API/HTTP source | `backend/channels/api_channel.py`; primitives `core.http-request`, `ops.plugin-http-request` | Primitive/import vocabulary only | Not wired to workflow runtime | Real backend capability, blocked on Canvas projection |
| CLI source | `backend/channels/cli_channel.py` | Data Sources page label only | Not wired to workflow runtime | Real backend capability, blocked on Canvas projection |
| Web scraper source | `backend/channels/web_scraper_channel.py` | Data Sources page label only | Not wired to workflow runtime | Real backend capability, blocked on Canvas projection |
| Crawl4AI source | `backend/channels/crawl4ai_channel.py` | Data Sources page label only | Not wired to workflow runtime | Real backend capability, blocked on Canvas projection |
| Skill source | `backend/channels/skill_channel.py` | Data Sources page label only | Not wired to workflow runtime | Real backend capability, blocked on Canvas projection |

## Catalog node mapping

| Catalog node | Current role | Real backend counterpart | Current state | Decision |
|---|---|---|---|---|
| `intelligence.schedule.cron` | Scheduled trigger | Existing scheduler/task concepts | Compiles/displays; no workflow runtime trigger binding | Blocked until trigger/run-input binding exists |
| `intelligence.source.jin10` | JIN10 source | Frontend `jin10` adapter only | Not authoritative backend runtime | Keep, but mark not runnable from Canvas |
| `intelligence.source.opencli-slot` | OpenCLI source slot | `OpenCLIChannel` + runtime registry OpenCLI source binding | Real if adapter binding exists; UI cannot yet resolve resources/args fully | Keep as real executable source slot; add materialization/resource resolver |
| `intelligence.processing.normalize` | Normalize items | Internal HDA normalize step exists as trace node | No generic runtime executor | Use as package internal for now; blocked as standalone |
| `intelligence.processing.dedupe` | Dedupe items | No workflow executor binding | Compile/display only | Blocked |
| `intelligence.agent.summary` | LLM summary | Existing provider/AI concepts elsewhere | No workflow executor binding | Blocked |
| `intelligence.agent.score` | Importance score | No workflow executor binding | Compile/display only | Blocked |
| `intelligence.agent.tag` | Auto tag | No workflow executor binding | Compile/display only | Blocked |
| `intelligence.router.importance` | Route by score | Compiler can build dependency edges | No workflow router executor | Blocked |
| `intelligence.output.inbox` | Store for review | Existing inbox/storage concepts | No workflow sink binding | Blocked |
| `intelligence.output.webhook` | Outbound notification | Backend `WebhookNotifier`, Feishu, DingTalk, WeCom notifiers | Catalog says simulated; no workflow notifier binding | Blocked until notifier sink binding |
| `package.collection.pipeline` | Packaged collection pipeline | Real channels exist: JIN10/RSS/HTTP idea, DataSource runners | Package shell only; not generated from channel registry | Keep as design shell until backed by real channel nodes |
| `package.opencli.multi-source-hda` | OpenCLI HDA package | HDA materializer + OpenCLI source slots + node run events | Best current executable proof, but frontend run/result binding pending | Primary real path; do not replace with custom nodes |
| `package.dispatch.fanout` | Notification fanout | Backend notifiers exist | Package shell only | Blocked until notifier/resource mapping |
| `package.intelligence.pipeline` | Intelligence pipeline | Existing primitive groups | Package shell only | Blocked |
| `package.ops.event` | Task/run event package | Backend task/run/event concepts | Package shell only | Blocked |
| `package.ops.monitor-guard` | Monitor/guard package | Control and ODP measurement concepts | Package shell only | Blocked |
| `package.ops.alert-response` | Alert response package | Notifier/task concepts | Package shell only | Blocked |
| `package.ai.prompt-experiment` | Prompt experiment package | Provider/prompt concepts | Package shell only | Blocked |
| `package.verify.regression-gate` | Regression gate package | Test/evaluator concepts | Package shell only | Blocked |
| `package.map.knowledge-map` | Knowledge map package | Source anchors/export vocabulary | Package shell only | Blocked |
| `package.review.human-review` | Human review package | Inbox/review concepts | Package shell only | Blocked |

## Primitive library mapping

The 107 primitives are not useless, but they are not runtime bindings. They are vocabulary/import atoms. Backend `node_registry.py` accepts the known primitive ids so imported or AI-patched nodes cannot smuggle arbitrary executor definitions, but accepting an id is not the same as executing it.

| Primitive group | Count | Useful for collection needs? | Mapping rule |
|---|---:|---|---|
| `input` | 2 | Yes: adapter/manual sample concepts | Map to runtime input envelope and DataSource/channel binding, not raw params |
| `core` | 23 | Yes: n8n-style trigger/http/transform/control vocabulary | Keep for import and future generated bindings; blocked until executor mapping |
| `ops` | 41 | Yes: scheduling, limits, retry, webhook, queue, plugin actions | Reuse for Canvas functions only after mapped to real scheduler/notifier/task/runtime capability |
| `transform` | 4 | Yes: parse/map/filter/limit | Can become pure data executors after EvidenceBatch/projection contracts exist |
| `state` | 2 | Yes: cache/inbox concepts | Map to storage/inbox services before exposing as runnable |
| `output` | 2 | Yes: payload formatting and mock-send | Mock-send stays preview-only; real send maps to notifier sink |
| `business` | 10 | Yes: health/freshness/entity/topic/evidence/digest | Use as domain transforms after runtime evidence model exists |
| `ai` | 6 | Yes for AI processing | Needs provider/resource binding and execution policy |
| `verify` | 8 | Yes for regression/contract gates | Needs evaluator/test runtime binding |
| `logic` | 2 | Yes: condition/branch | Needs router executor |
| `map` | 7 | Mostly UI/evidence navigation | Keep as UI/evidence features, not collection source strategy |

Important existing primitives for input/output/webhook:

| Primitive | Existing backend counterpart | Current Canvas decision |
|---|---|---|
| `primitive.input.adapter-read` | DataSource/channel runner | Use as concept for generated real source nodes; not standalone executor yet |
| `primitive.core.webhook-trigger` / `primitive.ops.trigger-webhook` | `backend/api/v1/webhooks.py` inbound source trigger | Existing backend source webhook, but not workflow-run trigger binding yet |
| `primitive.ops.action-webhook` / `intelligence.output.webhook` | `backend/notifiers/webhook_notifier.py` and notifier registry | Real notifier capability exists; workflow sink binding missing |
| `primitive.core.respond-webhook` | Short-wait webhook response concept | Must depend on runtime input envelope and projection API; not implemented |
| `primitive.core.http-request` / `primitive.ops.plugin-http-request` | `api` channel / HTTP client concepts | Real source capability exists through `api_channel`; no Canvas binding |

## Input/resource answer

The operator says a Collection Need, for example "抓小红书热帖". That is not a node strategy and should not force the operator to fill account, keyword, OpenCLI command, profile, cookie, or worker policy by hand.

The correct translation is:

1. Runtime-Aware Plan Drafting matches the need against existing capability metadata.
2. Source/channel candidates come from real DataSource channels, OpenCLI source metadata, saved DataSources, and presets generated from backend metadata.
3. Credentials, cookies, profiles, browser capacity, and worker pools are Execution Resources. They are resolved through saved source credentials, cookie/session stores, browser pool, and worker/resource policy.
4. If a resource cannot be resolved, the node is visible but blocked with a missing-resource reason. It must not look runnable.
5. User-provided text like "抓小红书热帖" becomes plan intent and optional query args, not raw secret/session/runtime params.

This means the "input point" is not a generic textbox inside a source node. There are several typed inputs:

| Input kind | Existing basis | Canvas requirement |
|---|---|---|
| Manual/AI run input | Workflow run request envelope | Add typed run input to backend run API and frontend run panel |
| Schedule trigger | scheduler/task concepts; cron catalog node | Bind trigger nodes to real run creation |
| Inbound webhook trigger | `/api/v1/webhooks/{source_id}` for source trigger | Add workflow-level webhook trigger mode and response/projection policy |
| Source input | DataSource/channel config or OpenCLI source slot | Generate source nodes from backend capability metadata |
| Execution resource input | credentials/cookies/browser profile/worker pool | Resolve implicitly; show blocked gaps, never raw cookie text boxes |

## Output/webhook answer

Outputs should not push raw records through events or webhook responses. The existing design note in `docs/workflow-hda-demand-runtime-io-webhook-linkage.md` is still right:

- Events carry node status, counts, error details, evidence batch refs, artifact refs, and projection links.
- Result views read projection APIs.
- Outbound webhook/notifier nodes send compact payloads plus links/refs.
- Respond-to-webhook only works for inbound webhook runs and should return a short-wait projection summary or `202` with a run id/projection link.

Current state:

| Output mode | Existing backend | Canvas state |
|---|---|---|
| Node run events | `/api/v1/workflows/runs/{run_id}/events` and `/events/stream` | Backend exists; frontend not subscribed |
| Evidence/result projection | Issue `07` pending | Not ready |
| Inbox store | Existing concepts, catalog node | No workflow sink binding |
| Outbound webhook | Backend notifier registry | No workflow sink binding |
| Respond-to-webhook | Design only | Not ready |

## Can this be used directly now?

Backend tests can exercise the OpenCLI HDA trace/run event proof. The frontend Canvas cannot yet be treated as a fully real collection surface because:

1. `/api/workflow/run` still compiles and writes a local artifact instead of calling `/api/v1/workflows/runs`.
2. The frontend has no `WorkflowRunProjection` / `WorkflowNodeRunEvent` client types or SSE reducer that patches existing Canvas node state.
3. The source catalog is not generated from backend channel capability metadata.
4. Most catalog and primitive nodes are visible but lack runtime bindings.
5. Resource resolution for cookies/profile/credentials/worker pool is not connected to Canvas source materialization.

So the answer is: not directly, except for the backend OpenCLI HDA proof path. To make it directly usable, we should wire existing capabilities instead of adding new node concepts.

## Implementation order implied by the mapping

1. Add a backend capability projection endpoint for real source/channel/notifier/trigger capabilities, backed by existing registries.
2. Generate/annotate Canvas source nodes from that projection, including runnable/blocked/design-only status.
3. Add resource resolution for source nodes: saved DataSource, source credentials, cookie/session/profile, browser pool, worker policy.
4. Wire frontend Canvas run to backend `/api/v1/workflows/runs` and SSE events, patching existing node states.
5. Finish EvidenceBatch/projection API so outputs are references and workbench-ready.
6. Wire real webhook/notifier sinks and inbound webhook triggers to the same run axis.

This keeps "抓小红书热帖" as a Collection Need. The system should assemble the plan from real OpenCLI/DataSource/resource/notifier capabilities and show blocked gaps only when an existing required capability/resource is absent.
