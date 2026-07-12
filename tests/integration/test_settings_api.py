import pytest


@pytest.mark.asyncio
async def test_settings_defaults_sources_and_apply_modes(client):
    response = await client.get("/api/v1/settings")
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["values"]["timezone"] == "Asia/Shanghai"
    assert data["values"]["theme"] == "system"
    assert data["sources"]["timezone"] == "default"
    assert data["apply_modes"]["timezone"] == "immediate"
    assert data["apply_modes"]["default_concurrency"] == "next_run"
    assert data["revision"] == 0


@pytest.mark.asyncio
async def test_settings_patch_is_partial_versioned_and_persistent(client):
    response = await client.patch(
        "/api/v1/settings",
        json={"timezone": "UTC", "default_concurrency": 12},
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["values"]["timezone"] == "UTC"
    assert data["values"]["default_concurrency"] == 12
    assert data["sources"]["timezone"] == "override"
    assert data["sources"]["retention_days"] == "default"
    assert data["revision"] == 1

    second = await client.patch("/api/v1/settings", json={"retention_days": 90})
    assert second.json()["data"]["revision"] == 2
    read = await client.get("/api/v1/settings")
    assert read.json()["data"]["values"]["timezone"] == "UTC"


@pytest.mark.asyncio
async def test_settings_validation_rejects_invalid_values(client):
    response = await client.patch("/api/v1/settings", json={"default_concurrency": 0})
    assert response.status_code == 422
    response = await client.patch("/api/v1/settings", json={"timezone": "Mars/Olympus"})
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_settings_reset_restores_defaults_and_advances_revision(client):
    await client.patch("/api/v1/settings", json={"retention_days": 365})
    response = await client.delete("/api/v1/settings")
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["values"]["retention_days"] == 30
    assert data["sources"]["retention_days"] == "default"
    assert data["revision"] == 2
