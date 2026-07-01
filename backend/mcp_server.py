"""MCP server exposing OpenCLI Admin as agent tools.

Thin wrapper: every tool is one HTTP call to `backend/api/v1/*` on a running
instance of this project's own FastAPI app. Runs as its own process (stdio
transport) — deliberately decoupled from the FastAPI/uvicorn lifecycle so it
can be started, restarted, or run from a different machine independently of
the API server.

v1 tool set is intentionally narrow: the highest-frequency actions an agent
needs to drive collection (list/create/test sources, discover feeds, trigger
a run, check its status, query records) — not a 1:1 mirror of all ~56 REST
endpoints. Schedules/skills/cookies management stay UI/CLI-only for now.

No auth: the REST API itself has none today (`api_key_enabled`/`api_key` in
backend/config.py are read but never enforced by any dependency). This server
inherits that trust boundary — only point OPENCLI_ADMIN_API_URL at a
localhost/LAN instance you trust, never at a publicly reachable one.
"""

from __future__ import annotations

import os
from typing import Any

import httpx
from mcp.server.fastmcp import FastMCP

API_BASE_URL = os.environ.get("OPENCLI_ADMIN_API_URL", "http://localhost:8031").rstrip("/")

mcp = FastMCP("opencli-admin")


async def _request(method: str, path: str, **kwargs: Any) -> dict:
    """Call the REST API and normalize both success and error shapes into one dict.

    FastAPI's default HTTPException body is ``{"detail": ...}``, this project's
    own ``ApiResponse.fail`` is ``{"success": false, "error": ...}`` — callers
    (agents) shouldn't have to know which one they got.
    """
    async with httpx.AsyncClient(base_url=API_BASE_URL, timeout=30.0) as client:
        resp = await client.request(method, path, **kwargs)
        try:
            body = resp.json()
        except ValueError:
            resp.raise_for_status()
            raise
        if resp.status_code >= 400:
            return {"success": False, "error": body.get("detail") or body.get("error") or resp.text}
        return body


@mcp.tool()
async def list_sources(
    enabled: bool | None = None,
    channel_type: str | None = None,
    page: int = 1,
    limit: int = 20,
) -> dict:
    """List configured data sources. Filter by enabled state or channel_type
    (opencli/web_scraper/api/rss/cli/skill/crawl4ai)."""
    params: dict[str, Any] = {"page": page, "limit": limit}
    if enabled is not None:
        params["enabled"] = enabled
    if channel_type is not None:
        params["channel_type"] = channel_type
    return await _request("GET", "/api/v1/sources", params=params)


@mcp.tool()
async def create_source(
    name: str,
    channel_type: str,
    channel_config: dict[str, Any],
    description: str | None = None,
    enabled: bool = True,
    tags: list[str] | None = None,
) -> dict:
    """Create a data source. channel_type is one of
    opencli/web_scraper/api/rss/cli/skill/crawl4ai; channel_config's shape
    depends on it (e.g. rss needs {"feed_url": "..."}). Use discover_feed
    first if you only have a site's homepage."""
    body = {
        "name": name,
        "channel_type": channel_type,
        "channel_config": channel_config,
        "description": description,
        "enabled": enabled,
        "tags": tags or [],
    }
    return await _request("POST", "/api/v1/sources", json=body)


@mcp.tool()
async def test_source(source_id: str) -> dict:
    """Dry-run a source's connectivity/config — no records collected or stored."""
    return await _request("POST", f"/api/v1/sources/{source_id}/test")


@mcp.tool()
async def discover_feed(url: str) -> dict:
    """Given a site's homepage URL, find candidate RSS/Atom feed URLs (setup
    helper for building an rss-channel source). Returns every candidate found,
    never guesses "the main one" — empty list if none found."""
    return await _request("POST", "/api/v1/sources/discover-feed", json={"url": url})


@mcp.tool()
async def trigger_task(
    source_id: str,
    parameters: dict[str, Any] | None = None,
    priority: int = 5,
    agent_id: str | None = None,
) -> dict:
    """Manually trigger a collection run for a source. Returns immediately
    (task dispatched, not finished) — poll get_task for status."""
    body = {
        "source_id": source_id,
        "parameters": parameters or {},
        "priority": priority,
        "agent_id": agent_id,
    }
    return await _request("POST", "/api/v1/tasks/trigger", json=body)


@mcp.tool()
async def get_task(task_id: str) -> dict:
    """Get a collection task's current status (pending/running/completed/failed/...)."""
    return await _request("GET", f"/api/v1/tasks/{task_id}")


@mcp.tool()
async def list_records(
    source_id: str | None = None,
    task_id: str | None = None,
    status: str | None = None,
    search: str | None = None,
    page: int = 1,
    limit: int = 20,
) -> dict:
    """Query collected records — filter by source, task, status, or full-text search."""
    params: dict[str, Any] = {"page": page, "limit": limit}
    if source_id is not None:
        params["source_id"] = source_id
    if task_id is not None:
        params["task_id"] = task_id
    if status is not None:
        params["status"] = status
    if search is not None:
        params["search"] = search
    return await _request("GET", "/api/v1/records", params=params)


def main() -> None:
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
