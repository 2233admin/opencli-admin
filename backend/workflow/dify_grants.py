"""Resolve saved model providers into ephemeral Graphon execution grants."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.provider import ModelProvider
from backend.schemas.workflow import WorkflowProjectNode


async def resolve_dify_ephemeral_grants(
    package: WorkflowProjectNode,
    *,
    session: AsyncSession | None,
) -> dict[str, Any]:
    """Return only matching enabled provider credentials for this package run."""

    model_requests = _model_requests(package)
    if not model_requests or session is None:
        return {}
    providers = list(
        (
            await session.execute(
                select(ModelProvider).where(ModelProvider.enabled.is_(True))
            )
        )
        .scalars()
        .all()
    )
    grants: list[dict[str, Any]] = []
    used_provider_ids: set[str] = set()
    for requested_provider, requested_model in model_requests:
        provider = _match_provider(providers, requested_provider)
        if provider is None or provider.id in used_provider_ids:
            continue
        used_provider_ids.add(provider.id)
        values = {
            key: value
            for key, value in {
                "api_key": provider.api_key,
                "base_url": provider.base_url,
                "model": requested_model or provider.default_model,
            }.items()
            if value
        }
        grants.append(
            {
                "provider": requested_provider or provider.provider_type,
                "providerId": provider.id,
                "values": values,
            }
        )
    return {"model_credentials": grants} if grants else {}


def _model_requests(package: WorkflowProjectNode) -> list[tuple[str | None, str | None]]:
    requests: list[tuple[str | None, str | None]] = []
    if package.internals is None:
        return requests
    for node in package.internals.nodes:
        if node.params.get("difyType") != "llm":
            continue
        config = _record(node.params.get("config"))
        model = _record(config.get("model"))
        requests.append(
            (
                _text(model.get("provider")),
                _text(model.get("name")) or _text(model.get("model")),
            )
        )
    return requests


def _match_provider(
    providers: list[ModelProvider],
    requested_provider: str | None,
) -> ModelProvider | None:
    if requested_provider:
        needle = _identity(requested_provider)
        for provider in providers:
            identities = {
                _identity(provider.provider_type),
                _identity(provider.name),
            }
            if needle in identities or any(
                needle.endswith(identity) or identity.endswith(needle)
                for identity in identities
                if identity
            ):
                return provider
    return providers[0] if len(providers) == 1 else None


def _identity(value: str) -> str:
    return "".join(character for character in value.lower() if character.isalnum())


def _record(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _text(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None
