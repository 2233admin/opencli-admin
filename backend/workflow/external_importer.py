"""Import external runtime graphs as native OpenCLI Admin WorkflowProject patches."""

from __future__ import annotations

import re
from typing import Any

from backend.schemas.workflow import (
    WorkflowExternalImportRequest,
    WorkflowPatchOperation,
    WorkflowPatchResponse,
    WorkflowProjectEdge,
    WorkflowProjectNode,
)
from backend.workflow.patcher import preview_workflow_patch

EXTERNAL_TOOL_CAPABILITY_ID = "external.tool.capability"


def import_external_workflow(body: WorkflowExternalImportRequest) -> WorkflowPatchResponse:
    """Convert an external runtime graph into reviewable OpenCLI native nodes.

    LangGraph/LangChain remain provenance only. Imported nodes always reference
    OpenCLI Admin catalog capabilities and never carry external executors.
    """

    external_nodes = _extract_nodes(body.graph, body.runtime)
    external_edges = _extract_edges(body.graph, body.runtime)
    for edge in external_edges:
        external_nodes.setdefault(edge["source"], {"id": edge["source"]})
        external_nodes.setdefault(edge["target"], {"id": edge["target"]})

    operations: list[WorkflowPatchOperation] = []
    used_node_ids = {node.id for node in body.project.nodes}
    used_edge_ids = {edge.id for edge in body.project.edges}
    imported_node_ids: dict[str, str] = {}
    merge_input_counts: dict[str, int] = {}

    prefer_name = body.runtime == "n8n"
    for index, external_node in enumerate(external_nodes.values()):
        external_id = _node_id(external_node, prefer_name=prefer_name)
        node_id = _unique_id(used_node_ids, _slug(external_id))
        imported_node_ids[external_id] = node_id
        operations.append(
            WorkflowPatchOperation(
                op="add_node",
                node=_to_workflow_node(
                    external_node,
                    node_id=node_id,
                    runtime=body.runtime,
                    graph_name=body.name,
                    index=index,
                ),
            )
        )

    for index, external_edge in enumerate(external_edges):
        source_id = imported_node_ids[external_edge["source"]]
        target_id = imported_node_ids[external_edge["target"]]
        source_node = operations[_operation_node_index(operations, source_id)].node
        target_node = operations[_operation_node_index(operations, target_id)].node
        assert source_node is not None
        assert target_node is not None
        target_port = _target_port(target_node, merge_input_counts)
        operations.append(
            WorkflowPatchOperation(
                op="connect_nodes",
                edge=WorkflowProjectEdge(
                    id=_unique_id(used_edge_ids, f"e-{source_id}-{target_id}"),
                    source=source_id,
                    target=target_id,
                    sourcePort=_source_port(source_node),
                    targetPort=target_port,
                    label=_read_string(external_edge.get("label")),
                    condition=_read_string(external_edge.get("condition")),
                    ui={
                        "externalWorkflow": {
                            "runtime": body.runtime,
                            "sourceNodeId": external_edge["source"],
                            "targetNodeId": external_edge["target"],
                            "edgeId": external_edge.get("id"),
                        }
                    },
                ),
            )
        )

    return preview_workflow_patch(body.project, operations)


def _to_workflow_node(
    external_node: dict[str, Any],
    *,
    node_id: str,
    runtime: str,
    graph_name: str | None,
    index: int,
) -> WorkflowProjectNode:
    external_id = _node_id(external_node, prefer_name=(runtime == "n8n"))
    external_type = _node_type(external_node)
    catalog_id, kind, capability, params = _native_capability_for_external_node(
        external_type
    )
    ui: dict[str, Any] = {
        "catalogId": catalog_id,
        "label": _node_label(external_node),
        "position": {"x": 180 + (index % 4) * 260, "y": 180 + (index // 4) * 140},
        "externalWorkflow": {
            "runtime": runtime,
            "graphName": graph_name,
            "nodeId": external_id,
            "nodeType": external_type,
            "raw": _safe_external_snapshot(external_node),
        },
    }
    if runtime == "n8n":
        ui["n8n"] = {"source": "n8n", "nodeId": external_id, "nodeType": external_type}
    return WorkflowProjectNode(
        id=node_id,
        kind=kind,
        capability=capability,
        params={
            **params,
            **_tool_capability_params(external_node),
            "externalWorkflow": {
                "runtime": runtime,
                "graphName": graph_name,
                "nodeId": external_id,
                "nodeType": external_type,
            },
        },
        ui=ui,
    )


def _tool_capability_params(external_node: dict[str, Any]) -> dict[str, Any]:
    tool_capability = external_node.get("toolCapability")
    if isinstance(tool_capability, dict):
        return {"toolCapability": tool_capability}

    capability_id = _read_string(external_node.get("toolCapabilityId")) or _read_string(
        external_node.get("opencliCapabilityId")
    )
    executor = external_node.get("executor")
    if not capability_id or not isinstance(executor, dict):
        return {}
    return {"toolCapability": {"id": capability_id, "executor": executor}}


def _native_capability_for_external_node(
    external_type: str,
) -> tuple[str, str, str, dict[str, Any]]:
    normalized = external_type.lower()
    if "merge" in normalized or "join" in normalized:
        return (
            "intelligence.flow.merge",
            "flow",
            "merge",
            {
                "strategy": "concat",
                "preserveLineage": True,
                "inputType": "recordCandidate[]",
                "outputType": "recordCandidate[]",
            },
        )
    if "normaliz" in normalized or "transform" in normalized or "parser" in normalized:
        return (
            "intelligence.processing.normalize",
            "agent",
            "normalize",
            {"language": "zh-CN", "preserveSourceRefs": True},
        )
    return (
        EXTERNAL_TOOL_CAPABILITY_ID,
        "action",
        "store",
        {"mode": "external_tool_capability", "reviewRequired": True},
    )


def _extract_nodes(
    graph: dict[str, Any], runtime: str | None = None
) -> dict[str, dict[str, Any]]:
    raw_nodes = graph.get("nodes") or graph.get("vertices") or []
    prefer_name = runtime == "n8n"
    nodes: dict[str, dict[str, Any]] = {}
    if isinstance(raw_nodes, dict):
        for key, value in raw_nodes.items():
            node = dict(value) if isinstance(value, dict) else {"value": value}
            node.setdefault("id", str(key))
            nodes[_node_id(node, prefer_name=prefer_name)] = node
        return nodes
    if isinstance(raw_nodes, list):
        for index, value in enumerate(raw_nodes):
            node = dict(value) if isinstance(value, dict) else {"value": value}
            node.setdefault("id", str(index))
            nodes[_node_id(node, prefer_name=prefer_name)] = node
    return nodes


def _extract_edges(graph: dict[str, Any], runtime: str | None = None) -> list[dict[str, Any]]:
    if runtime == "n8n":
        connections = graph.get("connections")
        if isinstance(connections, dict):
            return _extract_n8n_connection_edges(connections)

    raw_edges = graph.get("edges") or graph.get("links") or []
    edges: list[dict[str, Any]] = []
    if not isinstance(raw_edges, list):
        return edges
    for index, value in enumerate(raw_edges):
        if isinstance(value, dict):
            source = _read_string(
                value.get("source")
                or value.get("from")
                or value.get("start")
                or value.get("sourceNodeId")
            )
            target = _read_string(
                value.get("target")
                or value.get("to")
                or value.get("end")
                or value.get("targetNodeId")
            )
            if source and target:
                edge = dict(value)
                edge.setdefault("id", f"edge-{index + 1}")
                edge["source"] = source
                edge["target"] = target
                edges.append(edge)
    return edges


def _extract_n8n_connection_edges(connections: dict[str, Any]) -> list[dict[str, Any]]:
    """Flatten n8n's ``{sourceName: {main: [[{node, type, index}, ...]]}}`` shape.

    n8n's export keys ``connections`` by node *name* (not the node's ``id``
    field), and each output port fans out to a list of connection chains —
    unlike the list-of-{source,target} shape every other runtime exports.
    """

    edges: list[dict[str, Any]] = []
    for source_name, outputs in connections.items():
        source = _read_string(source_name)
        if not source or not isinstance(outputs, dict):
            continue
        for port_name, chains in outputs.items():
            if not isinstance(chains, list):
                continue
            for chain in chains:
                if not isinstance(chain, list):
                    continue
                for connection in chain:
                    if not isinstance(connection, dict):
                        continue
                    target = _read_string(connection.get("node"))
                    if not target:
                        continue
                    edges.append(
                        {
                            "id": f"edge-{len(edges) + 1}",
                            "source": source,
                            "target": target,
                            "sourcePort": _read_string(port_name) or "main",
                        }
                    )
    return edges


def _operation_node_index(operations: list[WorkflowPatchOperation], node_id: str) -> int:
    for index, operation in enumerate(operations):
        if operation.node and operation.node.id == node_id:
            return index
    raise ValueError(f"Imported node {node_id} was not materialized")


def _source_port(node: WorkflowProjectNode) -> str:
    catalog_id = (node.ui or {}).get("catalogId")
    if catalog_id in {"intelligence.flow.merge", "intelligence.processing.normalize"}:
        return "out"
    return "out"


def _target_port(
    node: WorkflowProjectNode,
    merge_input_counts: dict[str, int],
) -> str:
    catalog_id = (node.ui or {}).get("catalogId")
    if catalog_id == "intelligence.flow.merge":
        index = merge_input_counts.get(node.id, 0) + 1
        merge_input_counts[node.id] = index
        return f"in{min(index, 2)}"
    if catalog_id == "intelligence.processing.normalize":
        return "in"
    return "in"


def _node_id(node: dict[str, Any], *, prefer_name: bool = False) -> str:
    if prefer_name:
        return (
            _read_string(node.get("name"))
            or _read_string(node.get("id"))
            or _read_string(node.get("key"))
            or "external-node"
        )
    return (
        _read_string(node.get("id"))
        or _read_string(node.get("key"))
        or _read_string(node.get("name"))
        or "external-node"
    )


def _node_label(node: dict[str, Any]) -> str:
    return _read_string(node.get("label")) or _read_string(node.get("name")) or _node_id(node)


def _node_type(node: dict[str, Any]) -> str:
    return (
        _read_string(node.get("type"))
        or _read_string(node.get("class"))
        or _read_string(node.get("kind"))
        or _read_string(node.get("runnable"))
        or "external.tool"
    )


def _safe_external_snapshot(node: dict[str, Any]) -> dict[str, Any]:
    allowed = {}
    for key in ("id", "name", "label", "type", "class", "kind", "runnable"):
        if key in node:
            allowed[key] = node[key]
    return allowed


def _unique_id(used: set[str], base: str) -> str:
    candidate = base or "external-node"
    if candidate not in used:
        used.add(candidate)
        return candidate
    index = 2
    while f"{candidate}-{index}" in used:
        index += 1
    unique = f"{candidate}-{index}"
    used.add(unique)
    return unique


def _slug(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", value.strip().lower()).strip("-")
    return slug or "external-node"


def _read_string(value: object) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None
