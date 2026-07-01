"""Integration test for POST /api/v1/cookies/sync."""

from unittest.mock import patch

import pytest

from backend.auth.cookiecloud_sync import CookieCloudSyncError


@pytest.mark.asyncio
async def test_sync_cookies_success(client):
    with patch("backend.api.v1.cookies.sync_from_cookiecloud", return_value=7):
        response = await client.post(
            "/api/v1/cookies/sync",
            json={"url": "http://cc.local", "uuid": "u1", "password": "pw"},
        )
    assert response.status_code == 200
    assert response.json()["data"] == {"synced": 7}


@pytest.mark.asyncio
async def test_sync_cookies_upstream_failure_returns_502(client):
    with patch(
        "backend.api.v1.cookies.sync_from_cookiecloud",
        side_effect=CookieCloudSyncError("could not fetch/decrypt"),
    ):
        response = await client.post(
            "/api/v1/cookies/sync",
            json={"url": "http://cc.local", "uuid": "u1", "password": "wrong"},
        )
    assert response.status_code == 502
