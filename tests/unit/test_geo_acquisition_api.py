"""Black-box contract tests for GEO managed acquisition executions."""

from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from backend.database import get_db
from backend.main import create_app

BASE = "/api/v1/internal/geo-acquisition"


def _request(**overrides) -> dict:
    body = {
        "request_id": "request-1",
        "idempotency_key": "attempt-1",
        "capability": {
            "id": "managed-acquisition.handshake",
            "version": "1.0.0",
        },
        "output_schema_version": "1",
        "input": {"probe": "round-trip"},
        "environment": {"locale": "zh-CN", "region": "CN"},
        "required_artifacts": ["trace"],
        "geo_refs": {"trial_id": "trial-1", "attempt_id": "attempt-1"},
    }
    body.update(overrides)
    return body


@pytest.mark.asyncio
async def test_geo_can_discover_submit_observe_and_cancel_an_execution(client):
    capabilities = await client.get(f"{BASE}/capabilities")
    assert capabilities.status_code == 200
    assert capabilities.json() == {
        "capabilities": [
            {
                "capability_id": "managed-acquisition.handshake",
                "capability_version": "1.0.0",
                "output_schema_version": "1",
                "ready": True,
            }
        ]
    }

    submitted = await client.post(f"{BASE}/executions", json=_request())
    assert submitted.status_code == 202
    assert '"created_at":"' in submitted.text
    assert "+00:00" in submitted.text
    execution = submitted.json()
    assert execution["request_id"] == "request-1"
    assert execution["capability_id"] == "managed-acquisition.handshake"
    assert execution["capability_version"] == "1.0.0"
    assert execution["output_schema_version"] == "1"
    assert execution["status"] == "accepted"
    assert execution["result"] is None
    assert execution["failure"] is None
    assert execution["trace_ref"] is None
    assert execution["artifact_refs"] == []

    observed = await client.get(f"{BASE}/executions/{execution['execution_id']}")
    assert observed.status_code == 200
    assert observed.json() == execution

    cancelled = await client.post(
        f"{BASE}/executions/{execution['execution_id']}/cancel"
    )
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"


@pytest.mark.asyncio
async def test_attempt_idempotency_returns_the_existing_execution(client):
    first = await client.post(f"{BASE}/executions", json=_request())
    repeated = await client.post(f"{BASE}/executions", json=_request())

    assert first.status_code == 202
    assert repeated.status_code == 200
    assert repeated.json()["execution_id"] == first.json()["execution_id"]


@pytest.mark.asyncio
async def test_idempotency_key_cannot_be_reused_for_different_work(client):
    first = await client.post(f"{BASE}/executions", json=_request())
    conflicting = await client.post(
        f"{BASE}/executions",
        json=_request(request_id="request-2", input={"probe": "different"}),
    )

    assert first.status_code == 202
    assert conflicting.status_code == 409
    assert conflicting.json()["detail"]["code"] == "idempotency_conflict"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("capability", "schema", "code"),
    [
        (
            {"id": "unknown", "version": "1.0.0"},
            "1",
            "unsupported_capability",
        ),
        (
            {"id": "managed-acquisition.handshake", "version": "2.0.0"},
            "1",
            "unsupported_capability_version",
        ),
        (
            {"id": "managed-acquisition.handshake", "version": "1.0.0"},
            "2",
            "unsupported_output_schema_version",
        ),
    ],
)
async def test_unknown_or_mismatched_versions_are_rejected(
    client, capability, schema, code
):
    response = await client.post(
        f"{BASE}/executions",
        json=_request(capability=capability, output_schema_version=schema),
    )

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == code


@pytest.mark.asyncio
async def test_execution_is_observable_from_a_new_app_after_restart(db_engine):
    session_factory = async_sessionmaker(
        db_engine, class_=AsyncSession, expire_on_commit=False
    )

    async def sessions() -> AsyncIterator[AsyncSession]:
        async with session_factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    first_app = create_app()
    first_app.dependency_overrides[get_db] = sessions
    async with AsyncClient(
        transport=ASGITransport(app=first_app), base_url="http://first-process"
    ) as first_client:
        submitted = await first_client.post(f"{BASE}/executions", json=_request())
        assert submitted.status_code == 202
        execution_id = submitted.json()["execution_id"]

    restarted_app = create_app()
    restarted_app.dependency_overrides[get_db] = sessions
    async with AsyncClient(
        transport=ASGITransport(app=restarted_app), base_url="http://restarted-process"
    ) as restarted_client:
        observed = await restarted_client.get(f"{BASE}/executions/{execution_id}")

    assert observed.status_code == 200
    assert observed.json()["execution_id"] == execution_id
    assert observed.json()["status"] == "accepted"
