"""Integration tests for the /api/v1/sources endpoints."""

from unittest.mock import patch

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
async def test_store_credential_source_not_found(client):
    response = await client.post(
        "/api/v1/sources/nonexistent-id/credentials",
        json={"key_name": "token", "secret": "x"},
    )
    assert response.status_code == 404


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
