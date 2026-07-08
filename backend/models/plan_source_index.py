from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from backend.models.base import TimestampMixin


class PlanSourceIndex(TimestampMixin):
    """Cheap (plan, source) membership index for dataflow triggering (issue
    05, ADR-0009 dataflow-triggering decision, docs/plan-ir-issues/05).

    A source's own collection completing (scheduled OR manual) must ask "is
    this source part of any runnable Plan?" on every delivery — a source not
    wired into any Plan must pay zero extra query cost beyond this one
    indexed lookup (acceptance criterion: "Sources not part of any runnable
    Plan ... zero extra queries in the hot path beyond an efficient
    plan-membership check"). ``plans.graph`` is an opaque JSON blob with no
    SQL-queryable source_id column, and re-parsing every Plan's graph JSON
    on every single-source delivery would be the "extra queries in the hot
    path" this issue explicitly rules out — so this table is maintained
    (delete+reinsert, see ``backend.services.plan_service``) as a derived
    index alongside ``Plan.graph``, never authoritative on its own: the
    graph JSON remains the source of truth, this table exists purely so
    ``source_id -> plan_id`` is an indexed point lookup instead of a
    full-table JSON scan.

    One row per materialized source node in a Plan's graph (draft source
    nodes have no ``source_id`` and are never indexed here — they cannot
    trigger anything, matching ``Plan.runnable`` semantics). A Plan with the
    same ``source_id`` wired into two distinct source nodes gets two rows
    (one per ``source_node_id``) so a delivery triggers the shared segment
    once per node it actually occupies in the graph.
    """

    __tablename__ = "plan_source_index"
    __table_args__ = (
        UniqueConstraint("plan_id", "source_node_id", name="uq_plan_source_node"),
    )

    plan_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("plans.id", ondelete="CASCADE"), nullable=False, index=True
    )
    #: Not a DB FK — mirrors ``CollectedRecord.source_id`` (plain string, no
    #: FK) since a source can be deleted independently of a Plan that still
    #: references it in its graph JSON (detaching a node only touches the
    #: graph, PRD story 24); this index row is cleaned up on the Plan's own
    #: next save, not cascaded from DataSource deletion.
    source_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    #: The Plan IR node id (``PlanNode.id``) this source occupies in the
    #: graph — carried through so the incremental trigger knows exactly
    #: which node's downstream shared segment to walk (a Plan with the same
    #: source wired into two different source nodes triggers each
    #: independently).
    source_node_id: Mapped[str] = mapped_column(String(255), nullable=False)
