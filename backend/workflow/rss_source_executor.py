"""Live RSS/Atom executor behind the generic workflow source-fetch binding."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlparse

from sqlalchemy.ext.asyncio import AsyncSession

from backend.channels.rss_channel import RSSChannel
from backend.services import feed_provider_service

_SUPPORTED_PROVIDERS = {"rss", "atom", "feed"}


@dataclass(frozen=True)
class WorkflowRSSSourceResult:
    items: list[dict[str, Any]]
    url: str
    feed_title: str
    total_entries: int


@dataclass(frozen=True)
class WorkflowRSSSourceExecutionError(Exception):
    code: str
    message: str
    status: str = "failed"
    details: dict[str, Any] = field(default_factory=dict)

    def __str__(self) -> str:
        return self.message


def supports_rss_source(binding_input: dict[str, Any]) -> bool:
    provider = _read_string(binding_input.get("provider")).lower()
    channel_type = _read_string(binding_input.get("channelType")).lower()
    return provider in _SUPPORTED_PROVIDERS or channel_type in _SUPPORTED_PROVIDERS


async def execute_workflow_rss_source(
    binding_input: dict[str, Any],
    *,
    allowed_domains: list[str],
    max_items: int,
    session: AsyncSession | None = None,
) -> WorkflowRSSSourceResult | None:
    if not supports_rss_source(binding_input):
        return None

    config = _read_dict(binding_input.get("adapterConfig"))
    params = _read_dict(binding_input.get("params"))
    public_feed_url = _first_string(
        config.get("feed_url"),
        config.get("feedUrl"),
        config.get("url"),
        params.get("feed_url"),
        params.get("feedUrl"),
        params.get("url"),
        params.get("sourceUrl"),
    )
    provider_id = _first_string(config.get("providerId"), params.get("providerId"))
    provider = None
    feed_url = public_feed_url
    if provider_id:
        if session is None:
            raise WorkflowRSSSourceExecutionError(
                code="source_provider_session_required",
                message="RSS generator Provider resolution requires a database session.",
                status="blocked",
            )
        provider = await feed_provider_service.get_feed_provider(session, provider_id)
        if provider is None or not provider.enabled:
            raise WorkflowRSSSourceExecutionError(
                code="source_provider_unavailable",
                message="RSS generator Provider is missing or disabled.",
                status="blocked",
                details={"providerId": provider_id},
            )
        selection = _read_dict(
            _first_value(config.get("generatorSelection"), params.get("generatorSelection"))
        )
        generator_type = _first_string(
            config.get("generatorType"), params.get("generatorType")
        )
        if generator_type and generator_type != provider.provider_type:
            raise WorkflowRSSSourceExecutionError(
                code="source_provider_type_mismatch",
                message="RSS generator Provider type does not match the workflow node.",
                status="blocked",
                details={"providerId": provider_id},
            )
        try:
            feed_url = feed_provider_service.build_provider_feed_url(
                provider,
                route=_first_string(selection.get("route")),
                bridge=_first_string(selection.get("bridge")),
                parameters={
                    str(key): str(value)
                    for key, value in _read_dict(selection.get("parameters")).items()
                },
                include_token=True,
            )
        except feed_provider_service.FeedProviderError as exc:
            blocked = exc.kind in {"route_not_found", "domain_not_allowed"}
            raise WorkflowRSSSourceExecutionError(
                code=exc.kind,
                message=str(exc),
                status="blocked" if blocked else "failed",
                details={"providerId": provider_id},
            ) from exc

    if not feed_url:
        raise WorkflowRSSSourceExecutionError(
            code="source_url_required",
            message="RSS source requires a configured feed URL.",
            status="blocked",
        )

    hostname = (urlparse(feed_url).hostname or "").lower()
    normalized_domains = {
        domain.strip().lower().lstrip(".") for domain in allowed_domains if domain.strip()
    }
    if not hostname or not any(
        hostname == domain or hostname.endswith(f".{domain}") for domain in normalized_domains
    ):
        raise WorkflowRSSSourceExecutionError(
            code="source_domain_not_allowed",
            message=(
                f"RSS source host {hostname or feed_url!r} is not in "
                "agentPermissions.allowedDomains."
            ),
            status="blocked",
            details={"hostname": hostname, "allowedDomains": sorted(normalized_domains)},
        )

    configured_limit = _positive_int(
        _first_value(
            config.get("max_entries"),
            config.get("maxEntries"),
            params.get("max_entries"),
            params.get("maxEntries"),
            params.get("limit"),
        ),
        fallback=max_items,
    )
    max_entries = min(max(1, max_items), configured_limit)
    provider_config = provider.config if provider is not None else {}
    timeout = _positive_int(
        _first_value(config.get("timeout"), params.get("timeout")),
        fallback=_positive_int(provider_config.get("timeout_seconds"), fallback=30),
    )
    max_attempts = min(
        _positive_int(
            _first_value(
                config.get("max_attempts"),
                config.get("maxAttempts"),
                params.get("max_attempts"),
                params.get("maxAttempts"),
            ),
            fallback=2,
        ),
        3,
    )

    channel = RSSChannel()
    for attempt in range(1, max_attempts + 1):
        channel_config = {
            "feed_url": feed_url,
            "max_entries": max_entries,
            "timeout": min(timeout, 60),
        }
        if provider is not None:
            channel_config.update(
                {
                    "allow_private_network": bool(
                        provider_config.get("allow_private_network")
                    ),
                    "allowed_domains": feed_provider_service.provider_allowed_domains(
                        provider
                    ),
                }
            )
        result = await channel.collect(
            channel_config,
            {},
        )
        if result.success or result.error_type == "SSRFValidationError":
            break
        if attempt < max_attempts:
            await asyncio.sleep(0.25 * attempt)

    if not result.success:
        blocked = result.error_type == "SSRFValidationError"
        failure_code = _classify_generator_failure(result.error, result.error_type)
        if provider is None and failure_code == "generator_unavailable":
            failure_code = "source_fetch_failed"
        raise WorkflowRSSSourceExecutionError(
            code="source_url_rejected" if blocked else failure_code,
            message=result.error or "RSS source request failed.",
            status="blocked" if blocked else "failed",
            details={
                **({"errorType": result.error_type} if result.error_type else {}),
                **({"providerId": provider_id} if provider_id else {}),
                "attempts": attempt,
            },
        )

    return WorkflowRSSSourceResult(
        items=result.items[:max_entries],
        url=public_feed_url or _redact_url(feed_url),
        feed_title=_read_string(result.metadata.get("feed_title")),
        total_entries=_positive_int(
            result.metadata.get("total_entries"),
            fallback=len(result.items),
        ),
    )


def _read_dict(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, dict) else {}


def _read_string(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _first_string(*values: Any) -> str | None:
    for value in values:
        resolved = _read_string(value)
        if resolved:
            return resolved
    return None


def _first_value(*values: Any) -> Any:
    return next((value for value in values if value is not None), None)


def _positive_int(value: Any, *, fallback: int) -> int:
    try:
        resolved = int(value)
    except (TypeError, ValueError):
        resolved = fallback
    return max(1, resolved)


def _classify_generator_failure(error: str | None, error_type: str | None) -> str:
    detail = (error or "").lower()
    if "http 401" in detail or "http 403" in detail:
        return "auth_failed"
    if "http 404" in detail:
        return "route_not_found"
    if "http 429" in detail:
        return "upstream_rate_limited"
    if any(token in detail for token in ("webdriver", "selenium", "browser")):
        return "browser_dependency_unavailable"
    if error_type in {"ConnectError", "ConnectTimeout", "ReadTimeout", "TimeoutException"}:
        return "generator_unavailable"
    return "generator_unavailable"


def _redact_url(value: str) -> str:
    parsed = urlparse(value)
    return parsed._replace(query="", fragment="").geturl()
