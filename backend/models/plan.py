from typing import Any

from sqlalchemy import JSON, Boolean, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from backend.models.base import TimestampMixin


class Plan(TimestampMixin):
    """A persisted Plan IR graph (issue 02, ADR-0009 "Persistence" decision).

    ``graph`` stores the caller-supplied Plan IR JSON verbatim (byte-faithful
    round-trip — issue 02 acceptance criterion): this table never re-derives
    or normalizes the graph shape, it stores exactly the dict that was
    validated at save time and returns exactly that dict on read.

    ``draft`` and ``runnable`` are derived at save time from the graph's
    node set (a Plan containing any unmaterialized Draft Source Node is
    draft; a Plan whose source nodes are all materialized is runnable) and
    persisted alongside the graph so list/detail reads don't need to
    re-walk the JSON to answer "is this safe to execute" (issues 03/04 own
    execution itself — no scheduling hooks live here).
    """

    __tablename__ = "plans"

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    graph: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    draft: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    runnable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
