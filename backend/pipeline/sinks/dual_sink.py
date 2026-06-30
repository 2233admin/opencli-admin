"""DualSink — legacy DB write (authoritative) + ODP shadow forward (exactly once).

Shadow-validation destination: the legacy table stays the source of truth (its
records feed the AI/notify steps), and the same items are forwarded to ODP once
for comparison. The legacy leg is constructed with ``forward_to_odp=False`` so
the storer's own forward stays off — otherwise ODP would receive the batch twice
(once from storer, once from OdpSink) and the shadow metrics would be polluted.

ODP being down must never block the legacy write, so the forward is best-effort:
failures are logged and recorded in ``SinkResult.errors``, and the legacy result
is returned unchanged.
"""

from __future__ import annotations

import logging
from typing import Sequence

from backend.pipeline.sinks.base import ItemSink, RunContext, SinkResult
from backend.pipeline.sinks.legacy_db_sink import LegacyDbSink
from backend.pipeline.sinks.odp_sink import OdpSink

logger = logging.getLogger(__name__)


class DualSink:
    """Write to the legacy table and shadow-forward to ODP without double-sending."""

    def __init__(self, legacy: ItemSink | None = None, odp: ItemSink | None = None) -> None:
        # The default legacy leg must NOT forward — OdpSink is the single ODP sender.
        self.legacy = legacy if legacy is not None else LegacyDbSink(forward_to_odp=False)
        self.odp = odp if odp is not None else OdpSink()

    async def write_batch(self, ctx: RunContext, items: Sequence[dict]) -> SinkResult:
        result = await self.legacy.write_batch(ctx, items)  # authoritative
        try:
            shadow = await self.odp.write_batch(ctx, items)
            logger.info(
                "odp shadow | accepted=%d duplicates=%d rejected=%d",
                shadow.accepted,
                shadow.duplicates,
                shadow.rejected,
            )
        except Exception as exc:  # ODP must never break the legacy path
            logger.warning("odp shadow forward failed (legacy unaffected): %s", exc)
            result.errors.append(f"odp shadow: {exc}")
        return result
