from unittest.mock import AsyncMock, patch

import pytest


@pytest.fixture
def rsshub_provider_data():
    return {
        "name": "Local RSSHub",
        "provider_type": "rsshub",
        "base_url": "http://127.0.0.1:1200",
        "access_token": "rsshub-secret-token",
        "config": {
            "timeout_seconds": 12,
            "allowed_domains": ["127.0.0.1"],
            "allow_private_network": True,
            "browser_routes": False,
            "authenticated_routes": True,
        },
        "enabled": True,
    }


@pytest.mark.asyncio
async def test_feed_provider_crud_masks_access_token(client, rsshub_provider_data):
    created = await client.post("/api/v1/providers/feed-generators", json=rsshub_provider_data)
    assert created.status_code == 201
    data = created.json()["data"]
    assert data["provider_type"] == "rsshub"
    assert data["has_access_token"] is True
    assert data["access_token_preview"] == "...oken"
    assert rsshub_provider_data["access_token"] not in created.text

    listed = await client.get("/api/v1/providers/feed-generators")
    assert listed.status_code == 200
    assert listed.json()["data"][0]["id"] == data["id"]
    assert rsshub_provider_data["access_token"] not in listed.text

    updated = await client.patch(
        f"/api/v1/providers/feed-generators/{data['id']}",
        json={"name": "RSSHub Production", "config": {"timeout_seconds": 20}},
    )
    assert updated.status_code == 200
    assert updated.json()["data"]["name"] == "RSSHub Production"
    assert updated.json()["data"]["config"]["timeout_seconds"] == 20

    deleted = await client.delete(f"/api/v1/providers/feed-generators/{data['id']}")
    assert deleted.status_code == 200
    assert (await client.get("/api/v1/providers/feed-generators")).json()["data"] == []


@pytest.mark.asyncio
async def test_feed_provider_test_returns_classified_health(client, rsshub_provider_data):
    created = await client.post("/api/v1/providers/feed-generators", json=rsshub_provider_data)
    provider_id = created.json()["data"]["id"]
    probe = AsyncMock(
        return_value={
            "ok": False,
            "latency_ms": 9.5,
            "error": "Generator authentication failed",
            "error_kind": "auth_failed",
            "capabilities": {"authenticated_routes": True},
        }
    )
    with patch("backend.api.v1.providers.feed_provider_service.probe_feed_provider", probe):
        response = await client.post(
            f"/api/v1/providers/feed-generators/{provider_id}/test"
        )
    assert response.status_code == 200
    assert response.json()["data"]["error_kind"] == "auth_failed"
    assert rsshub_provider_data["access_token"] not in response.text


@pytest.mark.asyncio
async def test_feed_provider_builds_rss_node_without_leaking_token(
    client, rsshub_provider_data
):
    created = await client.post("/api/v1/providers/feed-generators", json=rsshub_provider_data)
    provider_id = created.json()["data"]["id"]
    response = await client.post(
        f"/api/v1/providers/feed-generators/{provider_id}/workflow-node",
        json={
            "route": "/rsshub/routes/en",
            "parameters": {"limit": "10"},
            "source_group": "rsshub-ecosystem",
            "site": "rsshub-routes",
            "max_entries": 25,
        },
    )
    assert response.status_code == 200
    node = response.json()["data"]
    assert node["nodeType"] == "intelligence.source.rss"
    assert node["params"]["providerId"] == provider_id
    assert node["params"]["generatorType"] == "rsshub"
    assert node["params"]["feedUrl"] == "http://127.0.0.1:1200/rsshub/routes/en?limit=10"
    assert node["allowedDomains"] == ["127.0.0.1"]
    assert rsshub_provider_data["access_token"] not in response.text


@pytest.mark.asyncio
async def test_rss_bridge_catalog_uses_instance_metadata(client):
    created = await client.post(
        "/api/v1/providers/feed-generators",
        json={
            "name": "Local RSS-Bridge",
            "provider_type": "rss_bridge",
            "base_url": "http://127.0.0.1:3001",
            "config": {
                "allowed_domains": ["127.0.0.1"],
                "allow_private_network": True,
            },
        },
    )
    provider_id = created.json()["data"]["id"]
    with patch(
        "backend.api.v1.providers.feed_provider_service.discover_feed_provider_catalog",
        AsyncMock(
            return_value={
                "provider_type": "rss_bridge",
                "total": 1,
                "bridges": [{"id": "BearBlog"}],
            }
        ),
    ):
        response = await client.get(
            f"/api/v1/providers/feed-generators/{provider_id}/catalog"
        )
    assert response.status_code == 200
    assert response.json()["data"]["bridges"][0]["id"] == "BearBlog"
