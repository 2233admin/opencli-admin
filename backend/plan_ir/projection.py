"""Degenerate single-node Plan projection (issue 01, ADR-0009 "zero-migration
bridge"). Projects any existing ``DataSource`` into the trivial Plan that
contains exactly one source node wired straight to one sink node.

Pure function of the source's channel config: no DB writes, no side effects,
callable with an in-memory ``DataSource`` (or anything with the same
attributes) that was never persisted. This is the read-only degenerate view
the PRD describes ("existing sources keep working untouched — each is the
degenerate single-node Plan") — not a migration and not a cache.
"""

from typing import Any, Protocol

from backend.schemas.plan_ir import PlanEdge, PlanGraph, PlanNode, PlanPort


class _SourceLike(Protocol):
    """The minimal shape ``project_source_to_plan`` needs — matches
    ``backend.models.source.DataSource`` without importing the ORM model,
    so a router can project a DB row or a lightweight fixture identically."""

    id: str
    name: str
    channel_type: str
    channel_config: dict[str, Any]


def project_source_to_plan(source: _SourceLike) -> PlanGraph:
    """Render ``source`` as its degenerate single-node Plan: one ``source``
    node (type ``f"{channel_type}_source"``, params = the source's raw
    ``channel_config``, referencing the source by id) wired through a single
    ``records`` output/input port to one terminal ``sink`` node representing
    "where this source already writes today" (the existing per-source
    collection pipeline — not a new destination).

    The result always has ``draft=True`` (a projection is never a saved
    Plan) and round-trips through ``backend.plan_ir.validation.
    validate_plan_graph`` with zero errors for every channel type — that
    round-trip is the issue 01 acceptance criterion this function exists
    to satisfy.
    """
    source_node_id = f"source:{source.id}"
    sink_node_id = f"sink:{source.id}"

    source_node = PlanNode(
        id=source_node_id,
        kind="source",
        type=f"{source.channel_type}_source",
        label=source.name,
        params={"channel_type": source.channel_type, **source.channel_config},
        source_id=source.id,
        draft=False,
        outputs=[PlanPort(name="records", type="records")],
    )
    sink_node = PlanNode(
        id=sink_node_id,
        kind="sink",
        type="collection_store",
        label=f"{source.name} (collection store)",
        params={},
        inputs=[PlanPort(name="records", type="records")],
    )
    edge = PlanEdge(
        id=f"edge:{source.id}",
        source_node=source_node_id,
        source_port="records",
        target_node=sink_node_id,
        target_port="records",
    )

    return PlanGraph(
        name=f"{source.name} (degenerate)",
        draft=True,
        nodes=[source_node, sink_node],
        edges=[edge],
    )
