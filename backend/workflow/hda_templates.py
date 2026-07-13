"""Template expansion for package/HDA workflow nodes."""

from __future__ import annotations

import re
from typing import Any

from backend.schemas.workflow import (
    WorkflowAdapterBinding,
    WorkflowPackageInternals,
    WorkflowProject,
    WorkflowProjectEdge,
    WorkflowProjectNode,
    WorkflowTopicCollapse,
)

OPENCLI_MULTI_SOURCE_TEMPLATE = "opencli-multi-source"
OPENCLI_SOURCE_POOL_CATALOG_ID = "intelligence.source.pool"
OPENCLI_SOURCE_SLOT_CATALOG_ID = "intelligence.source.opencli-slot"
OPENCLI_COLLECTION_OUTPUT_CATALOG_ID = "intelligence.output.collection-result"
OPENCLI_HDA_CATALOG_ID = "package.opencli.multi-source-hda"


def materialize_hda_templates(project: WorkflowProject) -> WorkflowProject:
    """Expand known package templates before validation/compile.

    The frontend and AI clients should treat HDA internals as derived from
    public package parameters. This keeps AI calls small and prevents callers
    from inventing raw internal primitive graphs.
    """

    nodes = [_materialize_node(node) for node in project.nodes]
    adapters = _merge_adapters(project.adapters, nodes)
    return project.model_copy(update={"nodes": nodes, "adapters": adapters})


def _materialize_node(node: WorkflowProjectNode) -> WorkflowProjectNode:
    if not _is_opencli_multi_source_hda(node):
        return node

    sources = _source_slots(node.params.get("sources"))
    if not sources:
        return node

    internals = _opencli_multi_source_internals(sources)
    topic = _topic_collapse(node, len(internals.nodes))
    params = {
        **node.params,
        "template": OPENCLI_MULTI_SOURCE_TEMPLATE,
        "runtime": node.params.get("runtime", "iii"),
        "lockedInternals": node.params.get("lockedInternals", True),
        "execution": {
            "fanout": "parallel",
        },
    }
    ui = {**(node.ui or {}), "catalogId": OPENCLI_HDA_CATALOG_ID}
    return node.model_copy(
        update={
            "params": params,
            "topicCollapse": topic,
            "internals": internals,
            "ui": ui,
        }
    )


def _is_opencli_multi_source_hda(node: WorkflowProjectNode) -> bool:
    template = _read_string(node.params.get("template"))
    catalog_id = _read_string((node.ui or {}).get("catalogId"))
    return template == OPENCLI_MULTI_SOURCE_TEMPLATE or catalog_id == OPENCLI_HDA_CATALOG_ID


def _source_slots(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    slots: list[dict[str, Any]] = []
    used_ids: set[str] = set()
    for index, raw in enumerate(value, start=1):
        if not isinstance(raw, dict):
            continue
        site = _read_string(raw.get("site"))
        command = _read_string(raw.get("command"))
        if not site or not command:
            continue
        source_group = (
            _read_string(raw.get("sourceGroup"))
            or _read_string(raw.get("source_group"))
            or site
        )
        requested_id = _read_string(raw.get("id")) or source_group or site or f"source-{index}"
        slot_id = _unique_id(_safe_id(requested_id), used_ids)
        slots.append(
            {
                **raw,
                "id": slot_id,
                "sourceGroup": source_group,
                "site": site,
                "command": command,
            }
        )
    return slots


def _opencli_multi_source_internals(sources: list[dict[str, Any]]) -> WorkflowPackageInternals:
    source_pool_node = _source_pool_node(sources)
    source_nodes = [_opencli_source_node(source, index) for index, source in enumerate(sources)]
    normalize_node = WorkflowProjectNode(
        id="internal-normalize",
        kind="agent",
        capability="normalize",
        params={"language": "zh-CN", "preserveSourceRefs": True},
        ui={
            "catalogId": "intelligence.processing.normalize",
            "label": "Internal Normalize",
            "position": {"x": 620, "y": 64 + max(len(sources) - 1, 0) * 72},
        },
    )
    output_node = WorkflowProjectNode(
        id="collection-output",
        kind="inbox",
        capability="store",
        params={"queue": "opencli-hda-output", "archive": False},
        ui={
            "catalogId": OPENCLI_COLLECTION_OUTPUT_CATALOG_ID,
            "label": "Collection Output",
            "position": {"x": 920, "y": 64 + max(len(sources) - 1, 0) * 72},
        },
    )
    edges = [
        WorkflowProjectEdge(
            id=f"source-pool-{source.id}",
            source=source_pool_node.id,
            target=source.id,
            sourcePort="out",
            targetPort="in",
        )
        for source in source_nodes
    ] + [
        WorkflowProjectEdge(
            id=f"{source.id}-normalize",
            source=source.id,
            target=normalize_node.id,
            sourcePort="out",
            targetPort="in",
        )
        for source in source_nodes
    ] + [
        WorkflowProjectEdge(
            id="internal-normalize-output",
            source=normalize_node.id,
            target=output_node.id,
            sourcePort="out",
            targetPort="in",
        )
    ]
    return WorkflowPackageInternals(
        locked=True,
        nodes=[source_pool_node, *source_nodes, normalize_node, output_node],
        edges=edges,
    )


def _source_pool_node(sources: list[dict[str, Any]]) -> WorkflowProjectNode:
    return WorkflowProjectNode(
        id="source-pool",
        kind="agent",
        capability="normalize",
        params={
            "sourceCount": len(sources),
            "sourceGroups": [
                _read_string(source.get("sourceGroup"))
                or _read_string(source.get("site"))
                or "source"
                for source in sources
            ],
            "fanout": "parallel",
        },
        ui={
            "catalogId": OPENCLI_SOURCE_POOL_CATALOG_ID,
            "label": "Source Pool",
            "position": {"x": 0, "y": 64 + max(len(sources) - 1, 0) * 72},
        },
    )


def _opencli_source_node(source: dict[str, Any], index: int) -> WorkflowProjectNode:
    source_id = f"source-{source['id']}"
    args = _read_dict(source.get("args"))
    adapter_id = _adapter_id(source)
    return WorkflowProjectNode(
        id=source_id,
        kind="source",
        capability="fetch",
        adapter=adapter_id,
        params={
            "site": source["site"],
            "command": source["command"],
            "args": args,
            "sourceGroup": source["sourceGroup"],
            "format": _read_string(source.get("format")) or "json",
            **_optional_source_runtime_params(source),
        },
        ui={
            "catalogId": OPENCLI_SOURCE_SLOT_CATALOG_ID,
            "label": _read_string(source.get("label")) or f"OpenCLI {source['site']}",
            "position": {"x": 280, "y": index * 150},
            "sourceSlot": {
                "sourceGroup": source["sourceGroup"],
                "parallel": True,
            },
        },
    )


def _optional_source_runtime_params(source: dict[str, Any]) -> dict[str, Any]:
    optional: dict[str, Any] = {}
    for key in (
        "mode",
        "positionalArgs",
        "positional_args",
    ):
        if key in source:
            optional[key] = source[key]
    return optional


def _topic_collapse(node: WorkflowProjectNode, node_count: int) -> WorkflowTopicCollapse:
    topic = node.topicCollapse
    if topic:
        return topic.model_copy(update={"nodeCount": node_count, "mode": "locked"})
    return WorkflowTopicCollapse(
        groupId="opencli-package",
        nodeCount=node_count,
        mode="locked",
        packageInternal=True,
    )


def _merge_adapters(
    existing: list[WorkflowAdapterBinding],
    nodes: list[WorkflowProjectNode],
) -> list[WorkflowAdapterBinding]:
    adapter_by_id = {adapter.id: adapter for adapter in existing}
    for node in nodes:
        if not _is_opencli_multi_source_hda(node) or not node.internals:
            continue
        for internal_node in node.internals.nodes:
            if internal_node.kind != "source" or not internal_node.adapter:
                continue
            adapter_by_id.setdefault(
                internal_node.adapter,
                WorkflowAdapterBinding(
                    id=internal_node.adapter,
                    type="source",
                    provider="opencli",
                    mode="live",
                    config={"channel": "opencli"},
                ),
            )
    return list(adapter_by_id.values())


def _adapter_id(source: dict[str, Any]) -> str:
    return _read_string(source.get("adapterId")) or f"opencli-{_safe_id(str(source['site']))}"


def _unique_id(value: str, used: set[str]) -> str:
    base = value or "source"
    candidate = base
    suffix = 2
    while candidate in used:
        candidate = f"{base}-{suffix}"
        suffix += 1
    used.add(candidate)
    return candidate


def _safe_id(value: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9_-]+", "-", value.strip().lower()).strip("-")
    return normalized or "source"


def _read_string(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _read_dict(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, dict) else {}
