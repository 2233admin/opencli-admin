from datetime import UTC, datetime

import pytest

from backend import browser_pool
from backend.models.browser import BrowserBinding, BrowserInstance
from backend.models.edge_node import EdgeNode


def _fixture_opencli_catalog() -> tuple[dict, ...]:
    return (
        {
            "site": "bbc",
            "name": "news",
            "description": "BBC news",
            "access": "read",
            "browser": False,
            "strategy": "public",
            "args": [],
            "columns": ["title", "url"],
        },
        {
            "site": "twitter",
            "name": "search",
            "description": "X search",
            "access": "read",
            "browser": True,
            "strategy": "cookie",
            "args": [
                {
                    "name": "query",
                    "type": "str",
                    "required": True,
                    "positional": True,
                }
            ],
            "columns": ["id", "text"],
        },
    )


def _install_test_pool(monkeypatch) -> None:
    pool = browser_pool.LocalBrowserPool(
        ["http://agent-x:19823", "http://public-browser:9222"]
    )
    pool.set_mode("http://agent-x:19823", "bridge")
    pool.set_agent_url("http://agent-x:19823", "http://agent-x:19823")
    pool.set_agent_protocol("http://agent-x:19823", "ws")
    pool.set_node_type("http://agent-x:19823", "shell")
    pool.set_mode("http://public-browser:9222", "cdp")
    monkeypatch.setattr(browser_pool, "_pool", pool)


async def _seed_fleet_state(db_session) -> None:
    db_session.add_all(
        [
            BrowserInstance(
                endpoint="http://agent-x:19823",
                mode="bridge",
                label="X desk",
                agent_url="http://agent-x:19823",
                agent_protocol="ws",
            ),
            EdgeNode(
                url="http://agent-x:19823",
                label="X desk",
                protocol="ws",
                mode="bridge",
                node_type="shell",
                status="online",
                last_seen_at=datetime.now(UTC),
                runtimes=["pi", "miniflow"],
            ),
            BrowserBinding(
                site="twitter",
                browser_endpoint="http://agent-x:19823",
                notes="Logged into X",
            ),
        ]
    )
    await db_session.commit()


@pytest.mark.asyncio
async def test_workflow_fleet_inventory_projects_existing_agent_state(
    client,
    db_session,
    monkeypatch,
):
    _install_test_pool(monkeypatch)
    await _seed_fleet_state(db_session)
    monkeypatch.setattr(
        "backend.workflow.fleet_inventory.ws_agent_manager.list_connected",
        lambda: ["http://agent-x:19823"],
    )

    response = await client.get("/api/v1/workflows/fleet/inventory")

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["summary"]["clusterModel"] == "private-agent-pod"
    assert data["summary"]["routingPolicy"] == "site_binding_agent_first"
    assert data["summary"]["agents"] == 2
    assert data["summary"]["siteBindings"] == 1
    agents = {agent["endpoint"]: agent for agent in data["agents"]}
    x_agent = agents["http://agent-x:19823"]
    assert x_agent["label"] == "X desk"
    assert x_agent["agentProtocol"] == "ws"
    assert x_agent["nodeType"] == "shell"
    assert x_agent["connected"] is True
    assert x_agent["available"] is True
    assert x_agent["sites"] == ["twitter"]
    assert "site.twitter" in x_agent["capabilities"]
    assert "runtime.pi" in x_agent["capabilities"]
    assert "runtime.miniflow" in x_agent["capabilities"]
    assert data["siteBindings"] == [
        {
            "site": "twitter",
            "browserEndpoint": "http://agent-x:19823",
            "notes": "Logged into X",
        }
    ]


@pytest.mark.asyncio
async def test_workflow_fleet_match_prefers_site_bound_browser_agent(
    client,
    db_session,
    monkeypatch,
):
    _install_test_pool(monkeypatch)
    await _seed_fleet_state(db_session)
    monkeypatch.setattr(
        "backend.workflow.fleet_inventory.ws_agent_manager.list_connected",
        lambda: ["http://agent-x:19823"],
    )
    monkeypatch.setattr(
        "backend.workflow.opencli_adapter_nodes._load_opencli_catalog",
        _fixture_opencli_catalog,
    )

    response = await client.post(
        "/api/v1/workflows/fleet/match",
        json={"adapterNodeId": "opencli.adapter.twitter.search"},
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["matched"] is True
    assert data["requiresBrowser"] is True
    assert data["requiresSiteBinding"] is True
    assert data["missing"] == []
    assert data["selected"]["endpoint"] == "http://agent-x:19823"
    assert data["selected"]["agentProtocol"] == "ws"
    assert data["selected"]["missing"] == []
    assert "site_binding" in data["selected"]["reasons"]


@pytest.mark.asyncio
async def test_workflow_fleet_match_non_browser_adapter_uses_local_opencli(
    client,
    monkeypatch,
):
    monkeypatch.setattr(
        "backend.workflow.opencli_adapter_nodes._load_opencli_catalog",
        _fixture_opencli_catalog,
    )

    response = await client.post(
        "/api/v1/workflows/fleet/match",
        json={"adapterNodeId": "opencli.adapter.bbc.news"},
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["matched"] is True
    assert data["requiresBrowser"] is False
    assert data["selected"] == {
        "endpoint": "local-opencli",
        "label": "Local OpenCLI",
        "mode": "direct",
        "agentUrl": None,
        "agentProtocol": "local",
        "status": "runnable",
        "connected": True,
        "available": True,
        "score": 100,
        "reasons": ["adapter_does_not_require_browser"],
        "missing": [],
        "sites": [],
    }


@pytest.mark.asyncio
async def test_workflow_fleet_match_reports_missing_site_binding(
    client,
    monkeypatch,
):
    _install_test_pool(monkeypatch)
    monkeypatch.setattr(
        "backend.workflow.fleet_inventory.ws_agent_manager.list_connected",
        lambda: ["http://agent-x:19823"],
    )
    monkeypatch.setattr(
        "backend.workflow.opencli_adapter_nodes._load_opencli_catalog",
        _fixture_opencli_catalog,
    )

    response = await client.post(
        "/api/v1/workflows/fleet/match",
        json={"adapterNodeId": "opencli.adapter.twitter.search"},
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["matched"] is False
    assert data["selected"] is None
    assert data["missing"] == ["site_binding:twitter"]
    assert data["candidates"]
