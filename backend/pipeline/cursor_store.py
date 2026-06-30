"""Per-source cursor persistence (Phase 1).

A cursor is the channel's "where we left off" — an etag / last-modified for RSS,
a since_id for an id-based API, a since_ts for a time-based one, a page_token for
pagination. The runner loads it before fetching and saves what the channel
returns, so collection resumes incrementally instead of re-fetching everything
and survives crashes mid-pagination.

This module is the seam: a ``CursorStore`` Protocol, an in-memory adapter for
tests and single-process use, and ``DBCursorStore`` backed by the
``source_cursors`` table. The runner depends only on the Protocol, so swapping
adapters changes nothing above.
"""

from typing import Any, Protocol


class CursorStore(Protocol):
    """Load/save a per-source cursor. The runner depends on this Protocol, never a
    concrete store (accept dependencies, don't create them)."""

    async def load(self, source_id: str) -> dict[str, Any] | None: ...

    async def save(self, source_id: str, cursor: dict[str, Any]) -> None: ...


class InMemoryCursorStore:
    """Process-local CursorStore. Used by tests and the not-yet-wired runner; the
    DB adapter replaces it for real incremental collection."""

    def __init__(self) -> None:
        self._cursors: dict[str, dict[str, Any]] = {}

    async def load(self, source_id: str) -> dict[str, Any] | None:
        return self._cursors.get(source_id)

    async def save(self, source_id: str, cursor: dict[str, Any]) -> None:
        self._cursors[source_id] = dict(cursor)


class DBCursorStore:
    """CursorStore backed by the ``source_cursors`` table.

    Owns a short-lived session per call (mirrors the sinks), so it satisfies the
    runner's ``CursorStore`` Protocol without threading a session through. One row
    per source, upserted on save.
    """

    async def load(self, source_id: str) -> dict[str, Any] | None:
        from sqlalchemy import select

        from backend.database import AsyncSessionLocal
        from backend.models.source_cursor import SourceCursor

        async with AsyncSessionLocal() as session:
            row = (
                await session.execute(
                    select(SourceCursor).where(SourceCursor.source_id == source_id)
                )
            ).scalar_one_or_none()
            return dict(row.cursor) if row and row.cursor else None

    async def save(self, source_id: str, cursor: dict[str, Any]) -> None:
        from sqlalchemy import select

        from backend.database import AsyncSessionLocal
        from backend.models.source_cursor import SourceCursor

        async with AsyncSessionLocal() as session:
            row = (
                await session.execute(
                    select(SourceCursor).where(SourceCursor.source_id == source_id)
                )
            ).scalar_one_or_none()
            if row is not None:
                row.cursor = dict(cursor)
            else:
                session.add(SourceCursor(source_id=source_id, cursor=dict(cursor)))
            await session.commit()
