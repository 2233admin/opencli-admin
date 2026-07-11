"""Structural validation for Plan IR graphs (issue 01).

Checks exactly the four classes called out in the issue's acceptance
criteria — cycles, orphan merges, missing required params, port type
mismatches — plus the source-node entity-reference rule from ADR-0009.
Every error is node-anchored: the payload names the offending node (or, for
edge-scoped errors, the edge and the nodes it connects) so a canvas can
render the error in place (PRD "Graph validation" decision).

This module is deliberately NOT a general graph-editing API: it only
answers "is this PlanGraph structurally valid", returning a list of
``PlanValidationError``. Callers decide what to do with a non-empty list
(422 the request, refuse a save, etc.) — this module never raises.
"""

from dataclasses import dataclass, field

from backend.schemas.plan_ir import PlanGraph, PlanNode
from backend.workflow.tool_capabilities import (
    validate_workflow_tool_capability_version_pin,
)


@dataclass
class PlanValidationError:
    """One structural problem, anchored to the node (and, for edge issues,
    the edge) it was found on."""

    code: str
    message: str
    node_id: str | None = None
    edge_id: str | None = None

    def to_dict(self) -> dict:
        d: dict = {"code": self.code, "message": self.message}
        if self.node_id is not None:
            d["node_id"] = self.node_id
        if self.edge_id is not None:
            d["edge_id"] = self.edge_id
        return d


@dataclass
class PlanValidationResult:
    errors: list[PlanValidationError] = field(default_factory=list)

    @property
    def valid(self) -> bool:
        return not self.errors

    def to_dict(self) -> dict:
        return {"valid": self.valid, "errors": [e.to_dict() for e in self.errors]}


def validate_plan_graph(plan: PlanGraph) -> PlanValidationResult:
    """Run every structural check against ``plan`` and return the combined
    result. Checks are independent — a graph can fail more than one class
    at once, and all applicable errors are returned together rather than
    stopping at the first failure, so a canvas can surface every problem in
    one pass instead of a fix-one-resubmit-see-the-next loop."""
    errors: list[PlanValidationError] = []
    nodes_by_id = {n.id: n for n in plan.nodes}

    errors.extend(_check_duplicate_node_ids(plan))
    errors.extend(_check_source_node_entity_refs(plan))
    errors.extend(_check_dangling_edges(plan, nodes_by_id))
    errors.extend(_check_missing_required_params(plan))
    errors.extend(_check_capability_version_pins(plan))
    errors.extend(_check_orphan_merges(plan, nodes_by_id))
    errors.extend(_check_port_type_mismatches(plan, nodes_by_id))
    errors.extend(_check_cycles(plan, nodes_by_id))

    return PlanValidationResult(errors=errors)


def _check_capability_version_pins(plan: PlanGraph) -> list[PlanValidationError]:
    """Prevent persisted executable Plans from floating registered tools."""

    errors: list[PlanValidationError] = []
    for node in plan.nodes:
        tool_capability = node.params.get("toolCapability")
        if not isinstance(tool_capability, dict):
            continue
        tool_id = tool_capability.get("id")
        if not isinstance(tool_id, str) or not tool_id.strip():
            continue
        issue = validate_workflow_tool_capability_version_pin(
            tool_id.strip(),
            tool_capability.get("versionPin"),
        )
        if issue is not None:
            errors.append(
                PlanValidationError(
                    code=issue.code,
                    message=f"Node {node.id!r} {issue.message}",
                    node_id=node.id,
                )
            )
    return errors


def _check_duplicate_node_ids(plan: PlanGraph) -> list[PlanValidationError]:
    seen: set[str] = set()
    errors: list[PlanValidationError] = []
    for n in plan.nodes:
        if n.id in seen:
            errors.append(
                PlanValidationError(
                    code="duplicate_node_id",
                    message=f"Node id {n.id!r} is used by more than one node.",
                    node_id=n.id,
                )
            )
        seen.add(n.id)
    return errors


def _check_source_node_entity_refs(plan: PlanGraph) -> list[PlanValidationError]:
    """ADR-0009: a source node carries source_id XOR draft=True; every other
    node kind carries neither."""
    errors: list[PlanValidationError] = []
    for n in plan.nodes:
        if n.kind == "source":
            has_ref = n.source_id is not None
            if has_ref and n.draft:
                errors.append(
                    PlanValidationError(
                        code="source_node_ambiguous_reference",
                        message=(
                            f"Source node {n.id!r} carries both source_id and "
                            "draft=True; exactly one must be set."
                        ),
                        node_id=n.id,
                    )
                )
            elif not has_ref and not n.draft:
                errors.append(
                    PlanValidationError(
                        code="source_node_missing_reference",
                        message=(
                            f"Source node {n.id!r} carries neither source_id nor "
                            "draft=True; a source node must reference an existing "
                            "DataSource or be explicitly marked draft."
                        ),
                        node_id=n.id,
                    )
                )
        else:
            if n.source_id is not None or n.draft:
                errors.append(
                    PlanValidationError(
                        code="entity_reference_on_non_source_node",
                        message=(
                            f"Node {n.id!r} (kind={n.kind}) carries a source_id/draft "
                            "entity reference; only source nodes may reference an "
                            "entity."
                        ),
                        node_id=n.id,
                    )
                )
    return errors


def _check_dangling_edges(
    plan: PlanGraph, nodes_by_id: dict[str, PlanNode]
) -> list[PlanValidationError]:
    """An edge naming a node id (or port name) that doesn't exist. Reported
    up front because every later check (cycles, merges, port types) assumes
    edges resolve to real node/port pairs."""
    errors: list[PlanValidationError] = []
    for e in plan.edges:
        src = nodes_by_id.get(e.source_node)
        tgt = nodes_by_id.get(e.target_node)
        if src is None:
            errors.append(
                PlanValidationError(
                    code="dangling_edge_source",
                    message=f"Edge {e.id!r} references unknown source node {e.source_node!r}.",
                    edge_id=e.id,
                )
            )
        elif e.source_port not in {p.name for p in src.outputs}:
            errors.append(
                PlanValidationError(
                    code="unknown_source_port",
                    message=(
                        f"Edge {e.id!r} references port {e.source_port!r} which is "
                        f"not an output of node {e.source_node!r}."
                    ),
                    node_id=e.source_node,
                    edge_id=e.id,
                )
            )
        if tgt is None:
            errors.append(
                PlanValidationError(
                    code="dangling_edge_target",
                    message=f"Edge {e.id!r} references unknown target node {e.target_node!r}.",
                    edge_id=e.id,
                )
            )
        elif e.target_port not in {p.name for p in tgt.inputs}:
            errors.append(
                PlanValidationError(
                    code="unknown_target_port",
                    message=(
                        f"Edge {e.id!r} references port {e.target_port!r} which is "
                        f"not an input of node {e.target_node!r}."
                    ),
                    node_id=e.target_node,
                    edge_id=e.id,
                )
            )
    return errors


def _check_missing_required_params(plan: PlanGraph) -> list[PlanValidationError]:
    errors: list[PlanValidationError] = []
    for n in plan.nodes:
        for name in n.required_params:
            if n.params.get(name) is None:
                errors.append(
                    PlanValidationError(
                        code="missing_required_param",
                        message=f"Node {n.id!r} is missing required param {name!r}.",
                        node_id=n.id,
                    )
                )
    return errors


def _check_orphan_merges(
    plan: PlanGraph, nodes_by_id: dict[str, PlanNode]
) -> list[PlanValidationError]:
    """A merge node exists to combine two or more upstream branches — one
    with fewer than two connected inputs is not merging anything and is
    reported as orphaned (PRD story 23 / issue 01 acceptance criterion)."""
    errors: list[PlanValidationError] = []
    incoming_count: dict[str, int] = {n.id: 0 for n in plan.nodes}
    for e in plan.edges:
        if e.target_node in incoming_count:
            incoming_count[e.target_node] += 1

    for n in plan.nodes:
        if n.kind != "merge":
            continue
        if incoming_count.get(n.id, 0) < 2:
            errors.append(
                PlanValidationError(
                    code="orphan_merge",
                    message=(
                        f"Merge node {n.id!r} has "
                        f"{incoming_count.get(n.id, 0)} incoming edge(s); a merge "
                        "requires at least 2."
                    ),
                    node_id=n.id,
                )
            )
    return errors


def _check_port_type_mismatches(
    plan: PlanGraph, nodes_by_id: dict[str, PlanNode]
) -> list[PlanValidationError]:
    """An edge's source-port type and target-port type must match, unless
    either side is declared "any". Dangling edges (already reported by
    ``_check_dangling_edges``) are skipped here to avoid duplicate noise."""
    errors: list[PlanValidationError] = []
    for e in plan.edges:
        src = nodes_by_id.get(e.source_node)
        tgt = nodes_by_id.get(e.target_node)
        if src is None or tgt is None:
            continue
        src_port = next((p for p in src.outputs if p.name == e.source_port), None)
        tgt_port = next((p for p in tgt.inputs if p.name == e.target_port), None)
        if src_port is None or tgt_port is None:
            continue  # already reported as unknown_source_port / unknown_target_port
        if src_port.type != tgt_port.type and "any" not in (src_port.type, tgt_port.type):
            errors.append(
                PlanValidationError(
                    code="port_type_mismatch",
                    message=(
                        f"Edge {e.id!r} connects {e.source_node}:{e.source_port} "
                        f"(type={src_port.type!r}) to {e.target_node}:{e.target_port} "
                        f"(type={tgt_port.type!r})."
                    ),
                    node_id=e.target_node,
                    edge_id=e.id,
                )
            )
    return errors


def _check_cycles(plan: PlanGraph, nodes_by_id: dict[str, PlanNode]) -> list[PlanValidationError]:
    """DFS-based cycle detection over the directed node graph induced by
    edges. Every node on a detected cycle gets its own node-anchored error
    so a canvas can highlight the whole loop, not just one arbitrary node."""
    adjacency: dict[str, list[str]] = {n.id: [] for n in plan.nodes}
    for e in plan.edges:
        if e.source_node in adjacency and e.target_node in nodes_by_id:
            adjacency[e.source_node].append(e.target_node)

    white, gray, black = 0, 1, 2
    color: dict[str, int] = {n.id: white for n in plan.nodes}
    cyclic_nodes: set[str] = set()

    def visit(node_id: str, stack: list[str]) -> None:
        color[node_id] = gray
        stack.append(node_id)
        for nxt in adjacency.get(node_id, []):
            if color.get(nxt) == gray:
                # Found a back-edge: everything from nxt's position in the
                # stack onward (inclusive) is on the cycle.
                idx = stack.index(nxt)
                cyclic_nodes.update(stack[idx:])
            elif color.get(nxt) == white:
                visit(nxt, stack)
        stack.pop()
        color[node_id] = black

    for n in plan.nodes:
        if color[n.id] == white:
            visit(n.id, [])

    return [
        PlanValidationError(
            code="cycle",
            message=f"Node {node_id!r} is part of a cycle.",
            node_id=node_id,
        )
        for node_id in sorted(cyclic_nodes)
    ]
