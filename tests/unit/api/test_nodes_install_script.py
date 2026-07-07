"""Install-script rendering tests for edge node bootstrap."""

import pytest

from backend.api.v1.nodes import _install_script_template
from backend.config import Settings, get_settings


@pytest.mark.parametrize("provider", ["lan", "netbird", "wireguard", "ssh", "custom"])
def test_settings_accepts_reachability_fleet_providers(provider):
    settings = Settings(fleet_network_provider=provider)

    assert settings.fleet_network_provider == provider


@pytest.mark.asyncio
async def test_install_script_endpoint_injects_netbird_and_agent_auth(client, monkeypatch):
    monkeypatch.setenv("PUBLIC_URL", "http://center.netbird:8031")
    monkeypatch.setenv("API_AUTH_TOKEN", "center-token")
    monkeypatch.setenv("IMAGE_TAG", "fleet-20260705")
    monkeypatch.setenv("FLEET_NETWORK_PROVIDER", "netbird")
    monkeypatch.setenv("NETBIRD_MODE", "host")
    monkeypatch.setenv("NETBIRD_SETUP_KEY", "nb-setup-key")
    monkeypatch.setenv("NETBIRD_MANAGEMENT_URL", "https://netbird.example:443")
    monkeypatch.setenv("NETBIRD_IMAGE_TAG", "0.58.0")
    get_settings.cache_clear()
    try:
        response = await client.get(
            "/api/v1/nodes/install/agent.sh",
            headers={"Authorization": "Bearer center-token"},
        )
    finally:
        get_settings.cache_clear()

    assert response.status_code == 200
    body = response.text
    assert "CENTRAL_API_URL=${CENTRAL_API_URL:-http://center.netbird:8031}" in body
    assert "AGENT_API_TOKEN=${AGENT_API_TOKEN:-${API_AUTH_TOKEN:-center-token}}" in body
    assert "FLEET_NETWORK_PROVIDER=${FLEET_NETWORK_PROVIDER:-netbird}" in body
    assert "NETBIRD_MODE=${NETBIRD_MODE:-host}" in body
    assert "NETBIRD_SETUP_KEY=${NETBIRD_SETUP_KEY:-nb-setup-key}" in body
    assert "NETBIRD_MANAGEMENT_URL=${NETBIRD_MANAGEMENT_URL:-https://netbird.example:443}" in body
    assert "NETBIRD_IMAGE_TAG=${NETBIRD_IMAGE_TAG:-0.58.0}" in body
    assert "netbird up" in body
    assert '-e AGENT_ADVERTISE_URL="$AGENT_ADVERTISE_URL"' in body


@pytest.mark.asyncio
async def test_install_script_endpoint_keeps_ssh_as_reachability_provider(client, monkeypatch):
    monkeypatch.setenv("PUBLIC_URL", "http://center.ssh:8031")
    monkeypatch.setenv("API_AUTH_TOKEN", "center-token")
    monkeypatch.setenv("FLEET_NETWORK_PROVIDER", "ssh")
    get_settings.cache_clear()
    try:
        response = await client.get(
            "/api/v1/nodes/install/agent.sh",
            headers={"Authorization": "Bearer center-token"},
        )
    finally:
        get_settings.cache_clear()

    assert response.status_code == 200
    body = response.text
    assert "CENTRAL_API_URL=${CENTRAL_API_URL:-http://center.ssh:8031}" in body
    assert "FLEET_NETWORK_PROVIDER=${FLEET_NETWORK_PROVIDER:-ssh}" in body
    assert "NETBIRD_MODE=${NETBIRD_MODE:-off}" in body
    assert "ssh)" in body
    assert "SSH provider selected; assuming the SSH tunnel is already established." in body
    assert '-e AGENT_ADVERTISE_URL="$AGENT_ADVERTISE_URL"' in body


def test_inline_install_script_template_keeps_netbird_bootstrap():
    body = _install_script_template(
        "http://center.example:8031",
        image_tag="test-image",
        agent_api_token="center-token",
        fleet_network_provider="netbird",
        netbird_mode="docker",
        netbird_setup_key="setup-key",
        netbird_management_url="https://netbird.example:443",
        netbird_image_tag="0.58.0",
    )

    assert "NETBIRD_MODE=${NETBIRD_MODE:-docker}" in body
    assert "NETBIRD_SETUP_KEY=${NETBIRD_SETUP_KEY:-setup-key}" in body
    assert 'NB_MANAGEMENT_URL="$NETBIRD_MANAGEMENT_URL"' in body
    assert "netbirdio/netbird:${NETBIRD_IMAGE_TAG}" in body
    assert 'AGENT_API_TOKEN="$AGENT_API_TOKEN"' in body
    assert 'AGENT_ADVERTISE_URL="$AGENT_ADVERTISE_URL"' in body


def test_inline_install_script_template_keeps_wireguard_reachability_only():
    body = _install_script_template(
        "http://center.example:8031",
        fleet_network_provider="wireguard",
    )

    assert "FLEET_NETWORK_PROVIDER=${FLEET_NETWORK_PROVIDER:-wireguard}" in body
    assert "wireguard)" in body
    assert "WireGuard provider selected; assuming the WireGuard interface is already up." in body
    assert "install_fleet_network" in body
    assert "install_netbird" in body
