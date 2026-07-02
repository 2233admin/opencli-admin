"""SourceMeasurement: a single sensor reading for one source's run.

See docs/CONTROL_THEORY_ARCHITECTURE.md §4. This module is a pure data
contract plus a pure derivation helper for rate fields. It does NOT read
from the database or ODP — callers pass in raw counts they already have.
"""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class SourceMeasurement(BaseModel):
    """Aggregated sensor readings for one source, for one run (or window)."""

    source_id: str
    run_id: str

    accepted: int
    duplicates: int
    rejected: int

    fetch_latency_ms: int
    ingest_latency_ms: Optional[int] = None
    store_latency_ms: Optional[int] = None

    error_rate: float
    duplicate_rate: float

    freshness_lag_seconds: Optional[int] = None
    cursor_advanced: bool

    odp_stream_lag: Optional[int] = None
    odp_pending: Optional[int] = None
    dlq_count: int = 0

    observed_at: datetime

    @classmethod
    def derive(
        cls,
        *,
        source_id: str,
        run_id: str,
        accepted: int,
        duplicates: int,
        rejected: int,
        fetch_latency_ms: int,
        observed_at: datetime,
        cursor_advanced: bool,
        ingest_latency_ms: Optional[int] = None,
        store_latency_ms: Optional[int] = None,
        freshness_lag_seconds: Optional[int] = None,
        odp_stream_lag: Optional[int] = None,
        odp_pending: Optional[int] = None,
        dlq_count: int = 0,
    ) -> "SourceMeasurement":
        """Construct a SourceMeasurement, safely deriving error/duplicate rates.

        error_rate = rejected / total_seen
        duplicate_rate = duplicates / total_seen
        where total_seen = accepted + duplicates + rejected.

        When a run produced zero items (total_seen == 0), both rates are
        defined as 0.0 rather than raising ZeroDivisionError — an empty run
        is not evidence of errors or duplicates.
        """
        total_seen = accepted + duplicates + rejected
        if total_seen > 0:
            error_rate = rejected / total_seen
            duplicate_rate = duplicates / total_seen
        else:
            error_rate = 0.0
            duplicate_rate = 0.0

        return cls(
            source_id=source_id,
            run_id=run_id,
            accepted=accepted,
            duplicates=duplicates,
            rejected=rejected,
            fetch_latency_ms=fetch_latency_ms,
            ingest_latency_ms=ingest_latency_ms,
            store_latency_ms=store_latency_ms,
            error_rate=error_rate,
            duplicate_rate=duplicate_rate,
            freshness_lag_seconds=freshness_lag_seconds,
            cursor_advanced=cursor_advanced,
            odp_stream_lag=odp_stream_lag,
            odp_pending=odp_pending,
            dlq_count=dlq_count,
            observed_at=observed_at,
        )
