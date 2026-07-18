from __future__ import annotations

import time
from typing import Any
from urllib.parse import urlencode, urlsplit

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.feed_provider import FeedProvider
from backend.schemas.feed_provider import FeedProviderWorkflowNodeRequest
from backend.security.url_guard import SSRFValidationError, guarded_async_client


class FeedProviderError(ValueError):
    def __init__(self, message: str, *, kind: str = "generator_unavailable") -> None:
        super().__init__(message)
        self.kind = kind


async def list_feed_providers(db: AsyncSession) -> list[FeedProvider]:
    result = await db.execute(select(FeedProvider).order_by(FeedProvider.created_at.desc()))
    return list(result.scalars().all())


async def get_feed_provider(db: AsyncSession, provider_id: str) -> FeedProvider | None:
    return await db.get(FeedProvider, provider_id)


def provider_allowed_domains(provider: FeedProvider) -> list[str]:
    host = (urlsplit(provider.base_url).hostname or "").lower()
    configured = [
        str(item).strip().lower().lstrip(".")
        for item in (provider.config or {}).get("allowed_domains", [])
    ]
    return list(dict.fromkeys([item for item in [host, *configured] if item]))


def build_provider_feed_url(
    provider: FeedProvider,
    *,
    route: str | None = None,
    bridge: str | None = None,
    parameters: dict[str, str] | None = None,
    include_token: bool = False,
) -> str:
    parameters = dict(parameters or {})
    if provider.provider_type == "rsshub":
        route_value = (route or "").strip()
        if not route_value or "://" in route_value or ".." in route_value.split("/"):
            raise FeedProviderError(
                "RSSHub route must be a relative route path", kind="route_not_found"
            )
        path = "/" + route_value.lstrip("/")
        if include_token and provider.access_token:
            parameters["key"] = provider.access_token
        query = urlencode(parameters, doseq=True)
        return f"{provider.base_url.rstrip('/')}{path}" + (f"?{query}" if query else "")

    bridge_value = (bridge or "").strip().removesuffix("Bridge")
    if not bridge_value:
        raise FeedProviderError("RSS-Bridge bridge is required", kind="route_not_found")
    query_values: dict[str, str] = {
        "action": "display",
        "bridge": bridge_value,
        "format": "Atom",
        **parameters,
    }
    if include_token and provider.access_token:
        query_values["token"] = provider.access_token
    return f"{provider.base_url.rstrip('/')}?{urlencode(query_values)}"


def build_workflow_node(
    provider: FeedProvider, body: FeedProviderWorkflowNodeRequest
) -> dict[str, Any]:
    if provider.provider_type == "rsshub" and not body.route:
        raise FeedProviderError("route is required for RSSHub", kind="route_not_found")
    if provider.provider_type == "rss_bridge" and not body.bridge:
        raise FeedProviderError("bridge is required for RSS-Bridge", kind="route_not_found")
    feed_url = build_provider_feed_url(
        provider,
        route=body.route,
        bridge=body.bridge,
        parameters=body.parameters,
        include_token=False,
    )
    selection = (
        {"route": body.route, "parameters": body.parameters}
        if provider.provider_type == "rsshub"
        else {"bridge": body.bridge, "parameters": body.parameters}
    )
    return {
        "nodeType": "intelligence.source.rss",
        "label": f"{provider.name} · {body.site}",
        "params": {
            "feedUrl": feed_url,
            "sourceGroup": body.source_group,
            "site": body.site,
            "maxEntries": body.max_entries,
            "providerId": provider.id,
            "generatorType": provider.provider_type,
            "generatorSelection": selection,
        },
        "allowedDomains": provider_allowed_domains(provider),
    }


async def probe_feed_provider(provider: FeedProvider) -> dict[str, Any]:
    started = time.perf_counter()
    config = provider.config or {}
    capabilities = {
        "browser_routes": bool(config.get("browser_routes")),
        "authenticated_routes": bool(config.get("authenticated_routes")),
        "private_network": bool(config.get("allow_private_network")),
    }
    try:
        if provider.provider_type == "rsshub":
            url = f"{provider.base_url.rstrip('/')}/healthz"
        else:
            query = {"action": "list"}
            if provider.access_token:
                query["token"] = provider.access_token
            url = f"{provider.base_url.rstrip('/')}?{urlencode(query)}"
        response = await _get(provider, url)
        _raise_for_generator_status(response)
        if provider.provider_type == "rss_bridge":
            payload = response.json()
            if not isinstance(payload, dict) or not isinstance(payload.get("bridges"), dict):
                raise FeedProviderError("RSS-Bridge list action returned invalid JSON")
        return {
            "ok": True,
            "latency_ms": round((time.perf_counter() - started) * 1000, 2),
            "error": None,
            "error_kind": None,
            "capabilities": capabilities,
        }
    except FeedProviderError as exc:
        return {
            "ok": False,
            "latency_ms": round((time.perf_counter() - started) * 1000, 2),
            "error": str(exc),
            "error_kind": exc.kind,
            "capabilities": capabilities,
        }
    except (httpx.TimeoutException, httpx.ConnectError, SSRFValidationError) as exc:
        return {
            "ok": False,
            "latency_ms": round((time.perf_counter() - started) * 1000, 2),
            "error": str(exc) or type(exc).__name__,
            "error_kind": "generator_unavailable",
            "capabilities": capabilities,
        }
    except Exception as exc:
        detail = str(exc) or type(exc).__name__
        browser_failure = any(
            token in detail.lower() for token in ("webdriver", "selenium", "browser")
        )
        kind = "browser_dependency_unavailable" if browser_failure else "generator_unavailable"
        return {
            "ok": False,
            "latency_ms": round((time.perf_counter() - started) * 1000, 2),
            "error": detail,
            "error_kind": kind,
            "capabilities": capabilities,
        }


async def discover_feed_provider_catalog(provider: FeedProvider) -> dict[str, Any]:
    if provider.provider_type == "rsshub":
        return {
            "provider_type": "rsshub",
            "supports_custom_routes": True,
            "routes": [
                {
                    "id": "rsshub-new-routes",
                    "label": "RSSHub new routes",
                    "route": "/rsshub/routes/en",
                    "parameters": [],
                    "requires_browser": False,
                    "requires_auth": False,
                }
            ],
        }
    query = {"action": "list"}
    if provider.access_token:
        query["token"] = provider.access_token
    response = await _get(provider, f"{provider.base_url.rstrip('/')}?{urlencode(query)}")
    _raise_for_generator_status(response)
    payload = response.json()
    bridges = payload.get("bridges") if isinstance(payload, dict) else None
    if not isinstance(bridges, dict):
        raise FeedProviderError("RSS-Bridge list action returned invalid JSON")
    return {
        "provider_type": "rss_bridge",
        "supports_custom_routes": False,
        "total": payload.get("total", len(bridges)),
        "bridges": [
            {"id": key, **(value if isinstance(value, dict) else {})}
            for key, value in bridges.items()
        ],
    }


async def _get(provider: FeedProvider, url: str) -> httpx.Response:
    config = provider.config or {}
    timeout = min(60, max(1, int(config.get("timeout_seconds", 15))))
    host = (urlsplit(url).hostname or "").lower()
    if not _domain_allowed(host, provider_allowed_domains(provider)):
        raise FeedProviderError(f"Provider host {host!r} is not allowed", kind="domain_not_allowed")
    if config.get("allow_private_network"):
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
            return await client.get(url, headers={"User-Agent": "opencli-admin/1.0"})
    client, guarded_url = await guarded_async_client(url, timeout=timeout, follow_redirects=False)
    async with client as opened_client:
        return await opened_client.get(guarded_url, headers={"User-Agent": "opencli-admin/1.0"})


def _domain_allowed(host: str, allowed_domains: list[str]) -> bool:
    return any(host == domain or host.endswith(f".{domain}") for domain in allowed_domains)


def _raise_for_generator_status(response: httpx.Response) -> None:
    status = response.status_code
    if status in {401, 403}:
        raise FeedProviderError(
            f"Generator authentication failed (HTTP {status})", kind="auth_failed"
        )
    if status == 404:
        raise FeedProviderError("Generator route was not found (HTTP 404)", kind="route_not_found")
    if status == 429:
        raise FeedProviderError(
            "Generator upstream rate limit reached (HTTP 429)",
            kind="upstream_rate_limited",
        )
    if status >= 500:
        detail = response.text[:300]
        browser_failure = any(
            token in detail.lower() for token in ("webdriver", "selenium", "browser")
        )
        kind = "browser_dependency_unavailable" if browser_failure else "generator_unavailable"
        raise FeedProviderError(f"Generator failed (HTTP {status})", kind=kind)
    try:
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise FeedProviderError(f"Generator request failed (HTTP {status})") from exc
