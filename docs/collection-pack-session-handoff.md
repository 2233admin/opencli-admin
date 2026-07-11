# Collection Pack Session Handoff

## Core Conclusion

`opencli-admin` already has the lower-level collection primitives:

- edge nodes;
- browser instances;
- browser/site bindings;
- data sources;
- collection tasks;
- cron schedules;
- AI agents and model providers;
- pipeline collection, normalization, storage, AI enrichment, and notifications.

The current issue is not that collection nodes are missing. The product gap is that users cannot naturally install a complete business collection plan, such as "A-share quant collection", without manually understanding and wiring source, node, binding, schedule, task, and AI agent objects.

The bootstrap scripts created in the previous session should be treated as temporary implementation probes, not as the desired long-term UX.

## Current Working Hypothesis

The product needs a first-class **Collection Pack / 采集方案** feature.

A Collection Pack should let a user:

1. Choose a scenario, such as `A 股量化采集`.
2. See required node capabilities:
   - public web/API node;
   - browser/CDP node;
   - logged-in account/profile node;
   - AI post-processing model;
   - licensed data vendor gaps.
3. Check whether existing nodes satisfy the requirements.
4. Bind existing nodes or create/register missing nodes.
5. Preview changes before install.
6. Install the pack, creating or updating:
   - data sources;
   - browser/site bindings;
   - cron schedules;
   - AI agent bindings;
   - optional smoke tasks.
7. See pack health after installation:
   - runnable sources;
   - sources needing login;
   - sources needing credentials/licensed vendor;
   - recent failures;
   - latest collection result counts.

## Temporary Artifacts Created

In `D:\projects\opencli-admin`:

- `configs/a-share-quant-pack.json`
  - Node-aware A-share pack draft.
  - Contains `node_classes`, optional `bindings`, `sources`, `schedules`, and `immediate_tasks`.
- `scripts/bootstrap-a-share-pack.sh`
  - Temporary pack installer using existing OpenCLI Admin APIs.
  - Creates/updates sources and schedules.
  - Optionally creates browser/site bindings from env vars.
  - Optionally triggers smoke task.
- `configs/a-share-quant-sources.json`
  - Older source-only A-share draft.
  - Keep as reference only; not the preferred product shape.
- `scripts/bootstrap-a-share-sources.sh`
  - Older source-only installer.
  - Keep as reference only.
- `scripts/bootstrap-xr-ai-providers.sh`
  - Temporary installer for XR AI providers/agents.
  - Creates MiniMax, StepFun, and local Ollama provider/agent entries through API.
- `docs/a-share-quant-data-map.md`
  - Data-domain map for A-share quant collection.
- `backend/processors/claude_processor.py`
  - Updated to pass `base_url` into `anthropic.AsyncAnthropic`.
  - Needed for MiniMax Anthropic-compatible endpoint.

## Validation Already Run

Pack validation:

```text
A_SHARE_PACK_JSON_OK sources=8 schedules=9 bindings=2
A_SHARE_PACK_BOOTSTRAP_SYNTAX_OK
```

Related API tests:

```text
23 passed
```

AI provider/agent related tests:

```text
20 passed
```

XR model routing was previously smoke-tested:

- MiniMax returned `MINIMAX_OK`.
- StepFun returned `STEPFUN_OK`.
- Local Hermes/Ollama returned `LOCAL_OK`.
- `hermes-smart` default cloud route returned `SMART_CLOUD_OK`.
- `hermes-smart --local` returned `SMART_LOCAL_OK`.
- large prompt route returned `SMART_BIG_LOCAL_OK`.
- `hermes-smart --stepfun` returned `SMART_STEPFUN_OK`.

## Next Session First Task

Do not add more bootstrap scripts first.

Start with product and code audit of whether the current UI can naturally express "install a collection pack".

Inspect:

- `frontend/src/pages/SourcesPage.tsx`
- `frontend/src/pages/NodesPage.tsx`
- `frontend/src/pages/BrowsersPage.tsx`
- `frontend/src/pages/AgentsPage.tsx`
- `frontend/src/pages/ProvidersPage.tsx`
- schedules-related frontend entry points
- `backend/api/v1/sources.py`
- `backend/api/v1/nodes.py`
- `backend/api/v1/browsers.py`
- `backend/api/v1/schedules.py`
- `backend/api/v1/agents.py`
- `backend/api/v1/providers.py`
- `backend/channels/opencli_channel.py`
- `backend/pipeline/pipeline.py`

Answer:

**Can existing UI/API naturally express "install and operate a collection pack"?**

If not, identify the smallest product change that makes it natural.

## Likely Product Direction

Add first-class pack support.

Possible backend additions:

- `backend/models/collection_pack.py`
- `backend/schemas/collection_pack.py`
- `backend/api/v1/packs.py`
- `backend/services/pack_service.py`

Backend capabilities:

- list available pack templates;
- validate pack requirements against current nodes/providers/agents;
- preview install diff;
- install/update pack;
- run smoke tasks;
- report pack health.

Possible frontend additions:

- `CollectionPacksPage`
- pack detail view;
- install wizard;
- node capability checklist;
- existing-node matcher;
- install preview/diff;
- smoke test result panel;
- pack health panel.

## Design Principle

Move the logic currently proven by scripts into the product.

The desired user experience is not:

```bash
scripts/bootstrap-a-share-pack.sh
```

The desired experience is:

1. Open UI.
2. Select "A 股量化采集".
3. Bind or create required nodes.
4. Pick AI processing route.
5. Preview and install.
6. Watch health and smoke result.

The scripts should either disappear or become developer-only migration/seed helpers after the product flow exists.
