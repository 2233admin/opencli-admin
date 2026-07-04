"""Compile Canvas WorkflowProject documents into executable-plan previews."""

from collections import Counter, defaultdict, deque
from typing import Literal

from backend.schemas.plan_ir import PlanEdge, PlanGraph, PlanNode, PlanPort
from backend.schemas.workflow import (
    CompiledWorkflowAdapterBinding,
    CompiledWorkflowEdge,
    CompiledWorkflowNode,
    WorkflowAdapterBinding,
    WorkflowAuthoringMetadata,
    WorkflowCompiledPlanPreview,
    WorkflowCompileError,
    WorkflowCompileResponse,
    WorkflowProject,
    WorkflowProjectNode,
    WorkflowRuntimePreview,
)

INTERNAL_ID_SEPARATOR = "::"


def compile_workflow_project(project: WorkflowProject) -> WorkflowCompileResponse:
    """Validate and compile a WorkflowProject without dispatching execution."""

    errors = _validate_project(project)
    if errors:
        return WorkflowCompileResponse(valid=False, errors=errors, plan=None)

    adapter_by_id = {adapter.id: adapter for adapter in project.adapters}
    depends_on = _dependency_map(project)
    compiled_nodes: list[CompiledWorkflowNode] = []
    compiled_edges: list[CompiledWorkflowEdge] = []
    plan_nodes: list[PlanNode] = []
    plan_edges: list[PlanEdge] = []

    for node in project.nodes:
        package_metadata = _package_metadata(node)
        compiled_nodes.append(
            _compile_node(
                node,
                adapter_by_id.get(node.adapter or ""),
                depends_on[node.id],
                package=package_metadata,
            )
        )
        plan_nodes.append(_to_plan_node(node))

        if node.internals:
            bound_internal_nodes = _bind_internal_parameters(node)
            internal_depends_on = _dependency_map_for_nodes(
                bound_internal_nodes, node.internals.edges
            )
            locked = _package_locked(node)
            for internal_node in bound_internal_nodes:
                internal_id = _internal_id(node.id, internal_node.id)
                internal_upstream = internal_depends_on[internal_node.id]
                compiled_nodes.append(
                    _compile_node(
                        internal_node,
                        adapter_by_id.get(internal_node.adapter or ""),
                        [_internal_id(node.id, upstream) for upstream in internal_upstream]
                        or [node.id],
                        id_override=internal_id,
                        runtime={
                            "package_parent_id": node.id,
                            "package_internal_id": internal_node.id,
                            "editable": not locked,
                        },
                    )
                )
                plan_nodes.append(_to_plan_node(internal_node, id_override=internal_id))

            for edge in node.internals.edges:
                compiled_edges.append(
                    CompiledWorkflowEdge(
                        id=_internal_id(node.id, edge.id),
                        source=_internal_id(node.id, edge.source),
                        target=_internal_id(node.id, edge.target),
                        sourcePort=edge.sourcePort or "records",
                        targetPort=edge.targetPort or "records",
                        contractId=edge.contractId,
                        condition=edge.condition,
                    )
                )
                plan_edges.append(
                    PlanEdge(
                        id=_internal_id(node.id, edge.id),
                        source_node=_internal_id(node.id, edge.source),
                        source_port=edge.sourcePort or "records",
                        target_node=_internal_id(node.id, edge.target),
                        target_port=edge.targetPort or "records",
                    )
                )

    compiled_edges = [
        CompiledWorkflowEdge(
            id=edge.id,
            source=edge.source,
            target=edge.target,
            sourcePort=edge.sourcePort or "records",
            targetPort=edge.targetPort or "records",
            contractId=edge.contractId,
            condition=edge.condition,
        )
        for edge in project.edges
    ] + compiled_edges
    plan_edges = [
        PlanEdge(
            id=edge.id,
            source_node=edge.source,
            source_port=edge.sourcePort or "records",
            target_node=edge.target,
            target_port=edge.targetPort or "records",
        )
        for edge in project.edges
    ] + plan_edges
    plan_ir = PlanGraph(name=project.name, draft=True, nodes=plan_nodes, edges=plan_edges)

    return WorkflowCompileResponse(
        valid=True,
        errors=[],
        plan=WorkflowCompiledPlanPreview(
            authoring=WorkflowAuthoringMetadata(
                project_id=project.id,
                project_name=project.name,
                project_version=project.version,
                profile=project.profile,
                node_count=len(project.nodes),
                edge_count=len(project.edges),
                adapter_count=len(project.adapters),
                settings=project.settings,
                agentPermissions=project.agentPermissions,
            ),
            runtime=WorkflowRuntimePreview(
                node_ids=[node.id for node in compiled_nodes],
                nodes=compiled_nodes,
                edges=compiled_edges,
                plan_ir=plan_ir,
            ),
        ),
    )


def _validate_project(project: WorkflowProject) -> list[WorkflowCompileError]:
    errors: list[WorkflowCompileError] = []
    node_counts = Counter(node.id for node in project.nodes)
    duplicate_nodes = {node_id for node_id, count in node_counts.items() if count > 1}
    for node_id in sorted(duplicate_nodes):
        errors.append(
            WorkflowCompileError(
                code="duplicate_node_id",
                message=f'Workflow node id "{node_id}" is duplicated',
                node_id=node_id,
                path=["nodes"],
            )
        )

    edge_counts = Counter(edge.id for edge in project.edges)
    for edge_id, count in sorted(edge_counts.items()):
        if count > 1:
            errors.append(
                WorkflowCompileError(
                    code="duplicate_edge_id",
                    message=f'Workflow edge id "{edge_id}" is duplicated',
                    edge_id=edge_id,
                    path=["edges"],
                )
            )

    node_ids = {node.id for node in project.nodes}
    adapter_by_id = {adapter.id: adapter for adapter in project.adapters}
    for edge in project.edges:
        if edge.source not in node_ids:
            errors.append(
                WorkflowCompileError(
                    code="missing_edge_source",
                    message=f'Workflow edge "{edge.id}" references missing source "{edge.source}"',
                    edge_id=edge.id,
                    path=["edges", edge.id, "source"],
                )
            )
        if edge.target not in node_ids:
            errors.append(
                WorkflowCompileError(
                    code="missing_edge_target",
                    message=f'Workflow edge "{edge.id}" references missing target "{edge.target}"',
                    edge_id=edge.id,
                    path=["edges", edge.id, "target"],
                )
            )

    for node in project.nodes:
        if node.adapter and node.adapter not in adapter_by_id:
            errors.append(
                WorkflowCompileError(
                    code="missing_adapter_binding",
                    message=(
                        f'Workflow node "{node.id}" references missing adapter '
                        f'"{node.adapter}"'
                    ),
                    node_id=node.id,
                    path=["nodes", node.id, "adapter"],
                )
            )
        elif _requires_adapter(node) and not node.adapter:
            errors.append(
                WorkflowCompileError(
                    code="missing_adapter_binding",
                    message=f'Workflow node "{node.id}" requires an adapter binding',
                    node_id=node.id,
                    path=["nodes", node.id, "adapter"],
                )
            )

        if node.internals:
            errors.extend(_validate_package_internals(node, adapter_by_id))

    errors.extend(_cycle_errors(project))
    return errors


def _requires_adapter(node: WorkflowProjectNode) -> bool:
    return node.kind == "source" or node.capability in {"fetch", "send"}


def _cycle_errors(project: WorkflowProject) -> list[WorkflowCompileError]:
    node_ids = [node.id for node in project.nodes]
    indegree = {node_id: 0 for node_id in node_ids}
    adjacency: dict[str, list[str]] = defaultdict(list)
    for edge in project.edges:
        if edge.source in indegree and edge.target in indegree:
            adjacency[edge.source].append(edge.target)
            indegree[edge.target] += 1

    queue = deque([node_id for node_id, degree in indegree.items() if degree == 0])
    visited: set[str] = set()
    while queue:
        node_id = queue.popleft()
        visited.add(node_id)
        for target in adjacency[node_id]:
            indegree[target] -= 1
            if indegree[target] == 0:
                queue.append(target)

    cycle_node_ids = sorted(set(node_ids) - visited)
    return [
        WorkflowCompileError(
            code="cycle",
            message=f'Workflow graph contains a cycle at node "{node_id}"',
            node_id=node_id,
            path=["nodes", node_id],
        )
        for node_id in cycle_node_ids
    ]


def _dependency_map(project: WorkflowProject) -> dict[str, list[str]]:
    return _dependency_map_for_nodes(project.nodes, project.edges)


def _dependency_map_for_nodes(
    nodes: list[WorkflowProjectNode],
    edges: list,
) -> dict[str, list[str]]:
    upstream: dict[str, list[str]] = {node.id: [] for node in nodes}
    for edge in edges:
        if edge.target in upstream:
            upstream[edge.target].append(edge.source)
    return upstream


def _internal_id(package_node_id: str, internal_node_id: str) -> str:
    return f"{package_node_id}{INTERNAL_ID_SEPARATOR}{internal_node_id}"


def _package_locked(node: WorkflowProjectNode) -> bool:
    if node.internals and node.internals.locked is not None:
        return node.internals.locked
    return bool(node.topicCollapse and node.topicCollapse.mode == "locked")


def _package_metadata(node: WorkflowProjectNode) -> dict[str, object] | None:
    if not (node.topicCollapse or node.miniNetwork or node.internals):
        return None

    locked = _package_locked(node)
    internal_node_ids = (
        [_internal_id(node.id, internal_node.id) for internal_node in node.internals.nodes]
        if node.internals
        else []
    )
    return {
        "miniNetwork": node.miniNetwork.model_dump() if node.miniNetwork else None,
        "topicCollapse": node.topicCollapse.model_dump() if node.topicCollapse else None,
        "locked": locked,
        "editable": not locked,
        "internal_node_ids": internal_node_ids,
        "internal_edge_ids": (
            [_internal_id(node.id, edge.id) for edge in node.internals.edges]
            if node.internals
            else []
        ),
    }


def _bind_internal_parameters(node: WorkflowProjectNode) -> list[WorkflowProjectNode]:
    if not node.internals:
        return []

    internal_by_id = {internal_node.id: internal_node for internal_node in node.internals.nodes}
    params_by_node = {
        internal_node.id: dict(internal_node.params) for internal_node in node.internals.nodes
    }
    if node.parameterInterface:
        for field in node.parameterInterface.fields:
            if field.binding.source != "params":
                continue
            value = node.params.get(field.id, field.value)
            if value is None:
                continue
            params_by_node[field.binding.nodeId][field.binding.fieldId] = value

    return [
        internal_by_id[internal_node.id].model_copy(
            update={"params": params_by_node[internal_node.id]}
        )
        for internal_node in node.internals.nodes
    ]


def _validate_package_internals(
    node: WorkflowProjectNode,
    adapter_by_id: dict[str, WorkflowAdapterBinding],
) -> list[WorkflowCompileError]:
    errors: list[WorkflowCompileError] = []
    assert node.internals is not None

    internal_counts = Counter(internal_node.id for internal_node in node.internals.nodes)
    for internal_node_id, count in sorted(internal_counts.items()):
        if count > 1:
            errors.append(
                WorkflowCompileError(
                    code="duplicate_internal_node_id",
                    message=(
                        f'Package node "{node.id}" has duplicated internal node '
                        f'"{internal_node_id}"'
                    ),
                    node_id=node.id,
                    path=["nodes", node.id, "internals", "nodes", internal_node_id],
                )
            )

    internal_node_ids = {internal_node.id for internal_node in node.internals.nodes}
    for edge in node.internals.edges:
        if edge.source not in internal_node_ids:
            errors.append(
                WorkflowCompileError(
                    code="missing_internal_edge_source",
                    message=(
                        f'Package node "{node.id}" internal edge "{edge.id}" '
                        f'references missing source "{edge.source}"'
                    ),
                    node_id=node.id,
                    edge_id=edge.id,
                    path=["nodes", node.id, "internals", "edges", edge.id, "source"],
                )
            )
        if edge.target not in internal_node_ids:
            errors.append(
                WorkflowCompileError(
                    code="missing_internal_edge_target",
                    message=(
                        f'Package node "{node.id}" internal edge "{edge.id}" '
                        f'references missing target "{edge.target}"'
                    ),
                    node_id=node.id,
                    edge_id=edge.id,
                    path=["nodes", node.id, "internals", "edges", edge.id, "target"],
                )
            )

    for internal_node in node.internals.nodes:
        if internal_node.adapter and internal_node.adapter not in adapter_by_id:
            errors.append(
                WorkflowCompileError(
                    code="missing_adapter_binding",
                    message=(
                        f'Package node "{node.id}" internal node '
                        f'"{internal_node.id}" references missing adapter '
                        f'"{internal_node.adapter}"'
                    ),
                    node_id=node.id,
                    path=[
                        "nodes",
                        node.id,
                        "internals",
                        "nodes",
                        internal_node.id,
                        "adapter",
                    ],
                )
            )
        elif _requires_adapter(internal_node) and not internal_node.adapter:
            errors.append(
                WorkflowCompileError(
                    code="missing_adapter_binding",
                    message=(
                        f'Package node "{node.id}" internal node '
                        f'"{internal_node.id}" requires an adapter binding'
                    ),
                    node_id=node.id,
                    path=[
                        "nodes",
                        node.id,
                        "internals",
                        "nodes",
                        internal_node.id,
                        "adapter",
                    ],
                )
            )

    if node.parameterInterface:
        for field in node.parameterInterface.fields:
            if field.binding.nodeId not in internal_node_ids:
                errors.append(
                    WorkflowCompileError(
                        code="invalid_parameter_binding",
                        message=(
                            f'Package node "{node.id}" public parameter '
                            f'"{field.id}" binds missing internal node '
                            f'"{field.binding.nodeId}"'
                        ),
                        node_id=node.id,
                        path=[
                            "nodes",
                            node.id,
                            "parameterInterface",
                            "fields",
                            field.id,
                            "binding",
                        ],
                    )
                )

    errors.extend(_cycle_errors_for_nodes(node.id, node.internals.nodes, node.internals.edges))
    return errors


def _cycle_errors_for_nodes(
    package_node_id: str,
    nodes: list[WorkflowProjectNode],
    edges: list,
) -> list[WorkflowCompileError]:
    node_ids = [node.id for node in nodes]
    indegree = {node_id: 0 for node_id in node_ids}
    adjacency: dict[str, list[str]] = defaultdict(list)
    for edge in edges:
        if edge.source in indegree and edge.target in indegree:
            adjacency[edge.source].append(edge.target)
            indegree[edge.target] += 1

    queue = deque([node_id for node_id, degree in indegree.items() if degree == 0])
    visited: set[str] = set()
    while queue:
        node_id = queue.popleft()
        visited.add(node_id)
        for target in adjacency[node_id]:
            indegree[target] -= 1
            if indegree[target] == 0:
                queue.append(target)

    return [
        WorkflowCompileError(
            code="cycle",
            message=(
                f'Package node "{package_node_id}" internal graph contains '
                f'a cycle at node "{node_id}"'
            ),
            node_id=package_node_id,
            path=["nodes", package_node_id, "internals", "nodes", node_id],
        )
        for node_id in sorted(set(node_ids) - visited)
    ]


def _compile_node(
    node: WorkflowProjectNode,
    adapter: WorkflowAdapterBinding | None,
    depends_on: list[str],
    *,
    id_override: str | None = None,
    package: dict[str, object] | None = None,
    runtime: dict[str, object] | None = None,
) -> CompiledWorkflowNode:
    node_id = id_override or node.id
    runtime_metadata: dict[str, object] = {
        "node_id": node_id,
        "authoring_node_id": node.id,
        "status_anchor": node_id,
        "capability": node.capability,
        "dispatch": "preview",
    }
    if runtime:
        runtime_metadata.update(runtime)

    return CompiledWorkflowNode(
        id=node_id,
        kind=node.kind,
        capability=node.capability,
        params=node.params,
        depends_on=depends_on,
        adapter=(
            CompiledWorkflowAdapterBinding(
                id=adapter.id,
                type=adapter.type,
                provider=adapter.provider,
                mode=adapter.mode,
                config=adapter.config,
            )
            if adapter
            else None
        ),
        sourceAnchor=node.sourceAnchor,
        runArtifact=node.runArtifact,
        package=package,
        runtime=runtime_metadata,
    )


def _to_plan_ir(project: WorkflowProject) -> PlanGraph:
    return PlanGraph(
        name=project.name,
        draft=True,
        nodes=[_to_plan_node(node) for node in project.nodes],
        edges=[
            PlanEdge(
                id=edge.id,
                source_node=edge.source,
                source_port=edge.sourcePort or "records",
                target_node=edge.target,
                target_port=edge.targetPort or "records",
            )
            for edge in project.edges
        ],
    )


def _to_plan_node(node: WorkflowProjectNode, id_override: str | None = None) -> PlanNode:
    kind: Literal["source", "transform", "merge", "sink"]
    if node.kind in {"schedule", "source"}:
        kind = "source"
    elif node.kind in {"notify", "inbox"}:
        kind = "sink"
    else:
        kind = "transform"
    return PlanNode(
        id=id_override or node.id,
        kind=kind,
        type=f"workflow.{node.kind}.{node.capability}",
        label=node.id,
        params={
            **node.params,
            "workflow": {
                "kind": node.kind,
                "capability": node.capability,
                "adapter": node.adapter,
            },
        },
        inputs=[] if kind == "source" else [PlanPort(name="records", type="records")],
        outputs=[] if kind == "sink" else [PlanPort(name="records", type="records")],
        source_id=None,
        draft=kind == "source",
    )
