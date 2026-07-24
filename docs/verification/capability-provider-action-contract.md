# Capability Provider Action Contract

Verified for A1 on 2026-07-22. This table is the A2 entry contract: every
provider resolves to one primary action, and no required readiness source or
route is unresolved.

| provider_key | distribution | required_sources | optional_sources | observed_readiness | primary_action | target_route | evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `opencli-admin/opencli-adapters` | `builtin` | `opencli_registry` | `workflow_capabilities` | `ready` | `use_in_studio` | `/studio` | Local registry summary returned 1,528 adapters, including 728 ready source slots; both declared workflow nodes are runnable. |
| `opencli-admin/native-data-sources` | `builtin` | `workflow_capabilities` | `backend_plugin_catalog` | `blocked` | `inspect_current_detail` | `/plugins` | Authoritative `channel.rss` capability is backend-available but blocked; the existing card opens its local detail state, so no unsupported provider deep-link is claimed. |
| `opencli-admin/model-runtime` | `builtin` | `workflow_capabilities` | `backend_plugin_catalog` | `blocked` | `inspect_current_detail` | `/plugins` | `intelligence.agent.score`, `summary`, and `tag` include blocked capabilities; blocked wins, and the current card detail is the only diagnostic surface. |
| `opencli-admin/dify-graphon-runtime` | `builtin` | `workflow_capabilities` | `backend_plugin_catalog` | `blocked` | `inspect_current_detail` | `/plugins` | The declared set includes runnable components and blocked `intelligence.processing.dedupe`; the current card detail shows the conservative blocked result. |

## Pass condition

- Four rows are present.
- Each row has exactly one `primary_action`.
- Each row names every required and optional source declared in the generated
  catalog.
- Every action has one resolvable in-app route.
- A blocked provider never exposes `use_in_studio`.

The generated `configurationRoute` query values are an A2 contract, not a claim
that the current frontend already supports provider deep-links. A2 must either
implement and test `?provider=` selection or replace those routes with another
real detail/configuration surface before resolving `configuration_required`.

## Reproduction

```powershell
uv run --python 3.13 --extra dev python -c "from backend.workflow.opencli_adapter_nodes import get_opencli_adapter_node_summary as s; print(s())"
uv run --python 3.13 --extra dev pytest tests/unit/test_capability_exposure_matrix.py tests/unit/test_generate_capability_catalog.py --no-cov -q
uv run --python 3.13 python -m scripts.generate_capability_catalog --matrix docs/backend-capability-exposure-matrix.yaml --output frontend/lib/plugins/generated-capability-catalog.json --check
```
