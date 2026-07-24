"""Retry-safe delivery for the native intelligence transactional outbox."""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from backend.models.intelligence import IntelligenceOutbox

OutboxPublisher = Callable[[str, dict], Awaitable[None]]
logger = logging.getLogger(__name__)


class IntelligenceOutboxDispatcher:
    """Best-effort dispatcher; authoritative state is always committed first."""

    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        publisher: OutboxPublisher,
    ) -> None:
        self._session_factory = session_factory
        self._publisher = publisher

    async def dispatch_event(self, event_id: str) -> bool:
        async with self._session_factory() as session:
            row = await session.scalar(
                select(IntelligenceOutbox).where(IntelligenceOutbox.event_id == event_id)
            )
            if row is None or row.state == "delivered":
                return False
            row.attempts += 1
            try:
                await self._publisher(row.event_id, row.payload)
            except Exception as exc:
                row.last_error = str(exc)[:2_000]
                await session.commit()
                raise
            row.state = "delivered"
            row.delivered_at = datetime.now(UTC)
            row.last_error = None
            await session.commit()
            return True

    async def dispatch_pending(self, *, limit: int = 100) -> int:
        now = datetime.now(UTC)
        async with self._session_factory() as session:
            event_ids = (
                await session.scalars(
                    select(IntelligenceOutbox.event_id)
                    .where(
                        IntelligenceOutbox.state == "pending",
                        IntelligenceOutbox.available_at <= now,
                    )
                    .order_by(IntelligenceOutbox.created_at, IntelligenceOutbox.event_id)
                    .limit(limit)
                )
            ).all()
        delivered = 0
        for event_id in event_ids:
            try:
                delivered += int(await self.dispatch_event(event_id))
            except Exception:
                logger.warning(
                    "Native intelligence outbox delivery failed for event %s",
                    event_id,
                    exc_info=True,
                )
                continue
        return delivered


__all__ = ["IntelligenceOutboxDispatcher", "OutboxPublisher"]
