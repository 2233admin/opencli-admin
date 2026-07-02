"""Integration tests for the /api/v1/sources endpoints."""

from unittest.mock import AsyncMock, patch

import pytest
from cryptography.fernet import Fernet
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from backend.auth import crypto

_KEY = Fernet.generate_key().decode()


def _sessionmaker(db_engine):
    return async_sessionmaker(db_engine, class_=AsyncSession, expire_on_commit=False)


@pytest.mark.asyncio
async def test_list_sources_empty(client):
    response = await client.get("/api/v1/sources")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["data"] == []
    assert data["meta"]["total"] == 0


@pytest.mark.asyncio
async def test_create_source(client, sample_source_data):
    response = await client.post("/api/v1/sources", json=sample_source_data)
    assert response.status_code == 201
    data = response.json()
    assert data["success"] is True
    assert data["data"]["name"] == sample_source_data["name"]
    assert data["data"]["channel_type"] == "rss"
    assert "id" in data["data"]


@pytest.mark.asyncio
async def test_get_source(client, sample_source_data):
    create_resp = await client.post("/api/v1/sources", json=sample_source_data)
    source_id = create_resp.json()["data"]["id"]

    response = await client.get(f"/api/v1/sources/{source_id}")
    assert response.status_code == 200
    assert response.json()["data"]["id"] == source_id


@pytest.mark.asyncio
async def test_get_source_not_found(client):
    response = await client.get("/api/v1/sources/nonexistent-id")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_update_source(client, sample_source_data):
    create_resp = await client.post("/api/v1/sources", json=sample_source_data)
    source_id = create_resp.json()["data"]["id"]

    response = await client.patch(
        f"/api/v1/sources/{source_id}",
        json={"name": "Updated Name", "enabled": False},
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["name"] == "Updated Name"
    assert data["enabled"] is False


@pytest.mark.asyncio
async def test_delete_source(client, sample_source_data):
    create_resp = await client.post("/api/v1/sources", json=sample_source_data)
    source_id = create_resp.json()["data"]["id"]

    delete_resp = await client.delete(f"/api/v1/sources/{source_id}")
    assert delete_resp.status_code == 200

    get_resp = await client.get(f"/api/v1/sources/{source_id}")
    assert get_resp.status_code == 404


@pytest.mark.asyncio
async def test_list_sources_pagination(client, sample_source_data):
    # Create 3 sources
    for i in range(3):
        data = {**sample_source_data, "name": f"Source {i}"}
        await client.post("/api/v1/sources", json=data)

    response = await client.get("/api/v1/sources?page=1&limit=2")
    assert response.status_code == 200
    body = response.json()
    assert len(body["data"]) == 2
    assert body["meta"]["total"] == 3
    assert body["meta"]["pages"] == 2


@pytest.mark.asyncio
async def test_test_source_connectivity(client, sample_source_data):
    create_resp = await client.post("/api/v1/sources", json=sample_source_data)
    source_id = create_resp.json()["data"]["id"]

    response = await client.post(f"/api/v1/sources/{source_id}/test")
    assert response.status_code == 200
    data = response.json()
    assert "connected" in data["data"]


# ── credentials: AuthManager reads/writes its own session (backend.database.
# AsyncSessionLocal), separate from the client fixture's injected get_db — point
# it at the same in-memory db_engine so a credential actually lands where the
# source lookup (via get_db) can see it. ──────────────────────────────────────

@pytest.mark.asyncio
async def test_store_and_list_source_credential(client, db_engine, sample_source_data, monkeypatch):
    monkeypatch.setenv(crypto.ENV_KEY, _KEY)
    create_resp = await client.post("/api/v1/sources", json=sample_source_data)
    source_id = create_resp.json()["data"]["id"]

    with patch("backend.database.AsyncSessionLocal", _sessionmaker(db_engine)):
        store_resp = await client.post(
            f"/api/v1/sources/{source_id}/credentials",
            json={"key_name": "token", "secret": "s3cr3t"},
        )
        assert store_resp.status_code == 201
        assert store_resp.json()["success"] is True

        list_resp = await client.get(f"/api/v1/sources/{source_id}/credentials")
    assert list_resp.status_code == 200
    keys = [k["key_name"] for k in list_resp.json()["data"]]
    assert keys == ["token"]
    # The secret itself never appears in a response body.
    assert "s3cr3t" not in list_resp.text


@pytest.mark.asyncio
async def test_store_credential_key_name_too_long_rejected(client, sample_source_data):
    """key_name must fit the DB column (String(64)) — a value that passes
    Pydantic but doesn't fit the column would otherwise reach Postgres as an
    unhandled DataError (SQLite doesn't enforce VARCHAR length, so this only
    manifested in production before the max_length was aligned to 64)."""
    create_resp = await client.post("/api/v1/sources", json=sample_source_data)
    source_id = create_resp.json()["data"]["id"]

    response = await client.post(
        f"/api/v1/sources/{source_id}/credentials",
        json={"key_name": "x" * 65, "secret": "s"},
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_store_credential_source_not_found(client):
    response = await client.post(
        "/api/v1/sources/nonexistent-id/credentials",
        json={"key_name": "token", "secret": "x"},
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_delete_source_cascades_credentials(client, db_engine, sample_source_data, monkeypatch):
    """Deleting a source must not orphan its encrypted credentials — there's no
    DB-level FK/cascade (AuthManager writes via a separate session), so
    delete_source() cleans up source_credentials itself."""
    from backend.auth.manager import AuthManager

    monkeypatch.setenv(crypto.ENV_KEY, _KEY)
    create_resp = await client.post("/api/v1/sources", json=sample_source_data)
    source_id = create_resp.json()["data"]["id"]

    with patch("backend.database.AsyncSessionLocal", _sessionmaker(db_engine)):
        await client.post(
            f"/api/v1/sources/{source_id}/credentials",
            json={"key_name": "token", "secret": "s3cr3t"},
        )

        delete_resp = await client.delete(f"/api/v1/sources/{source_id}")
        assert delete_resp.status_code == 200

        assert await AuthManager().resolve(source_id) == {}


@pytest.mark.asyncio
async def test_delete_source_credential(client, db_engine, sample_source_data, monkeypatch):
    monkeypatch.setenv(crypto.ENV_KEY, _KEY)
    create_resp = await client.post("/api/v1/sources", json=sample_source_data)
    source_id = create_resp.json()["data"]["id"]

    with patch("backend.database.AsyncSessionLocal", _sessionmaker(db_engine)):
        await client.post(
            f"/api/v1/sources/{source_id}/credentials",
            json={"key_name": "token", "secret": "s3cr3t"},
        )
        delete_resp = await client.delete(f"/api/v1/sources/{source_id}/credentials/token")
        assert delete_resp.status_code == 200

        list_resp = await client.get(f"/api/v1/sources/{source_id}/credentials")
    assert list_resp.json()["data"] == []


# ── RSS onboarding: discover-feed + import-opml ─────────────────────────────────
@pytest.mark.asyncio
async def test_discover_feed_endpoint(client):
    with patch(
        "backend.api.v1.sources.source_service.discover_feeds",
        AsyncMock(return_value=[{"url": "https://example.com/feed.xml", "title": "Feed"}]),
    ):
        response = await client.post("/api/v1/sources/discover-feed", json={"url": "https://example.com"})
    assert response.status_code == 200
    assert response.json()["data"] == [{"url": "https://example.com/feed.xml", "title": "Feed"}]


@pytest.mark.asyncio
async def test_import_opml_endpoint_creates_disabled_sources(client):
    opml = b"""<?xml version="1.0"?><opml><body>
    <outline title="Feed A" xmlUrl="https://a.example.com/rss" />
    </body></opml>"""
    response = await client.post(
        "/api/v1/sources/import-opml",
        files={"file": ("feeds.opml", opml, "text/x-opml")},
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert len(data["created"]) == 1
    assert data["created"][0]["channel_type"] == "rss"
    assert data["created"][0]["enabled"] is False
    assert data["skipped_existing"] == []


@pytest.mark.asyncio
async def test_import_opml_endpoint_invalid_xml_returns_400(client):
    response = await client.post(
        "/api/v1/sources/import-opml",
        files={"file": ("feeds.opml", b"<not-xml", "text/x-opml")},
    )
    assert response.status_code == 400


# ── control-state (PR-Control-2): read-only sensor readings + derived state ────
@pytest.mark.asyncio
async def test_control_state_not_found(client):
    response = await client.get("/api/v1/sources/nonexistent-id/control-state")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_control_state_source_never_ran(client, sample_source_data):
    create_resp = await client.post("/api/v1/sources", json=sample_source_data)
    source_id = create_resp.json()["data"]["id"]

    response = await client.get(f"/api/v1/sources/{source_id}/control-state")
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["source_id"] == source_id
    assert data["measurement"] is None
    assert data["control_state"] is None
    # objective defaults are always present
    assert data["objective"]["max_error_rate"] == 0.05
    assert data["objective"]["max_pending"] == 1000


@pytest.mark.asyncio
async def test_control_state_with_run_evidence(client, db_session, sample_source_data):
    """A healthy completed run yields a populated measurement + HEALTHY state.

    The client fixture and db_session share the same injected session, so
    evidence inserted here is visible to the endpoint's aggregation query.
    """
    from datetime import datetime, timezone

    from backend.models.task import CollectionTask, TaskRun, TaskRunEvent

    create_resp = await client.post("/api/v1/sources", json=sample_source_data)
    source_id = create_resp.json()["data"]["id"]

    task = CollectionTask(source_id=source_id, trigger_type="manual", parameters={})
    db_session.add(task)
    await db_session.flush()

    run = TaskRun(
        task_id=task.id,
        status="completed",
        finished_at=datetime(2026, 7, 2, tzinfo=timezone.utc),
        duration_ms=1000,
        records_collected=9,
    )
    db_session.add(run)
    await db_session.flush()
    db_session.add(
        TaskRunEvent(
            run_id=run.id, level="info", step="complete", message="done",
            detail={"collected": 10, "stored": 9, "skipped": 1},
        )
    )
    await db_session.flush()

    response = await client.get(f"/api/v1/sources/{source_id}/control-state")
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["measurement"] is not None
    assert data["measurement"]["accepted"] == 9
    assert data["measurement"]["duplicates"] == 1
    assert data["measurement"]["rejected"] == 0  # 10 - 9 - 1
    # error_rate = 0/10 = 0.0 -> HEALTHY
    assert data["control_state"] == "healthy"


@pytest.mark.asyncio
async def test_control_state_degraded_when_errors(client, db_session, sample_source_data):
    from datetime import datetime, timezone

    from backend.models.task import CollectionTask, TaskRun, TaskRunEvent

    create_resp = await client.post("/api/v1/sources", json=sample_source_data)
    source_id = create_resp.json()["data"]["id"]

    task = CollectionTask(source_id=source_id, trigger_type="manual", parameters={})
    db_session.add(task)
    await db_session.flush()

    run = TaskRun(
        task_id=task.id,
        status="completed",
        finished_at=datetime(2026, 7, 2, tzinfo=timezone.utc),
        duration_ms=1000,
        records_collected=1,
    )
    db_session.add(run)
    await db_session.flush()
    # collected=10, stored=1, skipped=0 -> rejected=9 -> error_rate=9/10=0.9 > 0.05
    db_session.add(
        TaskRunEvent(
            run_id=run.id, level="info", step="complete", message="done",
            detail={"collected": 10, "stored": 1, "skipped": 0},
        )
    )
    await db_session.flush()

    response = await client.get(f"/api/v1/sources/{source_id}/control-state")
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["measurement"]["rejected"] == 9
    assert data["control_state"] == "degraded"
