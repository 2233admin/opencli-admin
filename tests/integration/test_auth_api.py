"""Integration tests for fleet auth (ADR-0005, closeout issue 04).

FleetAuthMiddleware guards every HTTP /api route with a static bearer token.
These tests mutate the lru_cached Settings instance via monkeypatch.setattr —
the middleware reads ``get_settings().api_auth_token`` per request, so the
change is visible immediately and undone automatically after each test.
"""

import pytest

from backend.config import get_settings
from backend.main import app
from backend.security.identity import (
    IdentitySettings,
    get_request_identity,
    identity_dependency,
)

TOKEN = "fleet-test-token"


@pytest.fixture
def auth_enabled(monkeypatch):
    monkeypatch.setattr(get_settings(), "api_auth_token", TOKEN)


@pytest.fixture
def auth_disabled(monkeypatch):
    monkeypatch.setattr(get_settings(), "api_auth_token", "")


# ── dev posture: no token configured ──────────────────────────────────────────


@pytest.mark.asyncio
async def test_api_open_when_no_token_configured(client, auth_disabled):
    """No token configured -> /api routes answer without any Authorization header."""
    response = await client.get("/api/v1/system/config")
    assert response.status_code == 200
    assert response.json()["success"] is True


# ── token configured ───────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_missing_header_is_401(client, auth_enabled):
    response = await client.get("/api/v1/system/config")
    assert response.status_code == 401
    body = response.json()
    assert body == {"success": False, "error": "Invalid or missing API token"}
    assert response.headers["www-authenticate"] == "Bearer"


@pytest.mark.asyncio
async def test_wrong_token_is_401(client, auth_enabled):
    response = await client.get(
        "/api/v1/system/config", headers={"Authorization": "Bearer wrong-token"}
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_wrong_scheme_is_401(client, auth_enabled):
    response = await client.get(
        "/api/v1/system/config", headers={"Authorization": f"Basic {TOKEN}"}
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_correct_token_is_200(client, auth_enabled):
    response = await client.get(
        "/api/v1/system/config", headers={"Authorization": f"Bearer {TOKEN}"}
    )
    assert response.status_code == 200
    assert response.json()["success"] is True


@pytest.mark.asyncio
async def test_correct_token_on_db_backed_route(client, auth_enabled):
    """The guard sits in front of every /api route, not just /system."""
    response = await client.get("/api/v1/sources", headers={"Authorization": f"Bearer {TOKEN}"})
    assert response.status_code == 200

    response = await client.get("/api/v1/sources")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_fleet_token_header_leaves_authorization_for_oidc(client, auth_enabled):
    app.dependency_overrides[get_request_identity] = identity_dependency(
        IdentitySettings(
            "https://id.example",
            "opencli",
            bootstrap_admin_token="bootstrap-token",
        )
    )

    response = await client.get(
        "/api/v1/auth/me",
        headers={
            "X-API-Token": TOKEN,
            "Authorization": "Bearer bootstrap-token",
        },
    )

    assert response.status_code == 200
    assert response.json()["data"] == {
        "subject": "bootstrap-admin",
        "email": None,
        "name": "Bootstrap Admin",
        "is_platform_admin": True,
        "auth_method": "bootstrap",
    }


# ── exemptions ─────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_health_exempt_and_leaks_nothing(client, auth_enabled):
    """/health stays open for unauthenticated liveness probes (docker
    healthcheck) and therefore must expose liveness only — no version, no
    config flags (issue 04: exempt iff it leaks nothing)."""
    response = await client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
