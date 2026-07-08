"""Read-only listing over the persisted source_measurements sensor table.

Sibling to backend/services/control_ledger_service.py (row-level Evidence
Ledger listing): same page/limit/newest-first shape, different table. This is
the raw per-run sensor history an operator drills into from the Source
Control Room — distinct from GET /sources/{id}/control-state, which folds the
LATEST measurement (plus a rolling trend) into one decision snapshot rather
than exposing the full series.

Pure read: nothing here ever writes to source_measurements.
"""

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.source_measurement import SourceMeasurement


async def list_measurements(
    session: AsyncSession,
    source_id: str,
    page: int = 1,
    limit: int = 20,
) -> tuple[list[SourceMeasurement], int]:
    """List a source's source_measurements rows, newest (created_at) first."""
    query = (
        select(SourceMeasurement)
        .where(SourceMeasurement.source_id == source_id)
        .order_by(SourceMeasurement.created_at.desc())
    )
    count_query = (
        select(func.count())
        .select_from(SourceMeasurement)
        .where(SourceMeasurement.source_id == source_id)
    )

    total = (await session.execute(count_query)).scalar_one()
    offset = (page - 1) * limit
    result = await session.execute(query.offset(offset).limit(limit))
    return result.scalars().all(), total
