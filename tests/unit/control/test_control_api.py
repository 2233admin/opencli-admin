"""Unit tests for backend.api.v1.control (C2's GET /control/odp-state).

Calls the endpoint function directly (no app/lifespan/DB needed — this
endpoint has no DB dependency at all) with backend.control.collectors.
odp_metrics.collect mocked, to verify the ApiResponse wrapping and that a
fully-degraded collector snapshot still yields a 200-shaped ApiResponse
(never an exception) with each section's ``available`` flag preserved.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from backend.api.v1 import control as control_api
from backend.control.collectors.odp_metrics import (
    DlqState,
    IngestHealthState,
    OdpMetricsSnapshot,
    StreamState,
)


@pytest.mark.asyncio
async def test_odp_state_endpoint_wraps_healthy_snapshot(monkeypatch):
    snapshot = OdpMetricsSnapshot(
        stream=StreamState(
            available=True, name="odp.ingest.raw", group="odp-store", lag=5, pending=1
        ),
        dlq=DlqState(available=True, total=0, last_24h=0),
        ingest=IngestHealthState(available=True, healthy=True),
        collected_at=datetime(2026, 7, 2, tzinfo=UTC),
    )

    async def fake_collect():
        return snapshot

    monkeypatch.setattr(control_api.odp_metrics, "collect", fake_collect)

    response = await control_api.get_odp_state()

    assert response.success is True
    assert response.data.stream.lag == 5
    assert response.data.stream.pending == 1
    assert response.data.dlq.available is True
    assert response.data.ingest.healthy is True
    # store/outbox are always reported unavailable — never fabricated
    assert response.data.store.available is False
    assert response.data.store.healthy is None
    assert response.data.outbox.available is False
    assert response.data.outbox.unpublished is None


@pytest.mark.asyncio
async def test_odp_state_endpoint_never_raises_when_everything_is_degraded(monkeypatch):
    """Even a fully-down ODP data plane must produce a normal ApiResponse —
    this endpoint must not turn a down dependency into a 500."""
    snapshot = OdpMetricsSnapshot(
        stream=StreamState(
            available=False, name="odp.ingest.raw", group="odp-store", error="redis down"
        ),
        dlq=DlqState(available=False, error="db down"),
        ingest=IngestHealthState(available=False, error="connection refused"),
        collected_at=datetime(2026, 7, 2, tzinfo=UTC),
    )

    async def fake_collect():
        return snapshot

    monkeypatch.setattr(control_api.odp_metrics, "collect", fake_collect)

    response = await control_api.get_odp_state()

    assert response.success is True  # the endpoint call itself succeeded
    assert response.data.stream.available is False
    assert response.data.dlq.available is False
    assert response.data.ingest.available is False
