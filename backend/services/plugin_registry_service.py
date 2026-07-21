"""Persist and project plugin metadata without loading plugin-owned code."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.plugin_installation import PluginInstallation
from backend.models.studio import StudioWorkflowDraft
from backend.plugins.dify_manifest import parse_dify_manifest
from backend.plugins.dify_package import DifyPackageError, read_dify_plugin_payload
from backend.schemas.plugin import PluginInstallationRead
from backend.workflow.dify_graphon_client import DIFY_GRAPHON_BINDING_ID


class PluginRegistryError(RuntimeError):
    def __init__(self, code: str, message: str, *, status_code: int) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


async def list_plugin_installations(session: AsyncSession) -> list[PluginInstallationRead]:
    rows = (
        await session.scalars(
            select(PluginInstallation).order_by(
                PluginInstallation.provider_key, PluginInstallation.version
            )
        )
    ).all()
    return [*_bundled_installations(), *[_to_read(row) for row in rows]]


async def get_plugin_installation(
    session: AsyncSession, installation_id: str
) -> PluginInstallationRead | None:
    bundled = next((item for item in _bundled_installations() if item.id == installation_id), None)
    if bundled is not None:
        return bundled
    row = await session.get(PluginInstallation, installation_id)
    return _to_read(row) if row is not None else None


async def import_dify_plugin(
    session: AsyncSession,
    *,
    filename: str,
    content: bytes,
) -> PluginInstallationRead:
    payload = read_dify_plugin_payload(content, filename=filename)
    parsed = parse_dify_manifest(payload)

    existing = await _find_exact_installation(
        session,
        provider_key=parsed.provider_key,
        version=parsed.version,
        source_digest=payload.source_digest,
    )
    if existing is not None:
        return _to_read(existing)

    conflicting = await session.scalar(
        select(PluginInstallation).where(
            PluginInstallation.provider_key == parsed.provider_key,
            PluginInstallation.version == parsed.version,
        )
    )
    if conflicting is not None:
        raise PluginRegistryError(
            "dify_plugin_version_conflict",
            (
                f'Plugin "{parsed.provider_key}" version "{parsed.version}" is already '
                "installed with different content."
            ),
            status_code=409,
        )

    row = PluginInstallation(
        provider_key=parsed.provider_key,
        name=parsed.name,
        author=parsed.author,
        version=parsed.version,
        source_kind=payload.source_kind,
        source_digest=payload.source_digest,
        manifest_spec_version=parsed.manifest_spec_version,
        signature_state=payload.signature_state,
        manifest_json={
            "raw": parsed.manifest,
            "labels": parsed.labels,
            "descriptions": parsed.descriptions,
            "icon": parsed.icon,
            "pluginTypes": parsed.plugin_types,
        },
        capabilities_json=parsed.capabilities,
        permissions_json=parsed.permissions,
        runtime_status="BLOCKED",
        blockers_json=parsed.blockers,
    )
    session.add(row)
    try:
        await session.flush()
    except IntegrityError as exc:
        await session.rollback()
        duplicate = await _find_exact_installation(
            session,
            provider_key=parsed.provider_key,
            version=parsed.version,
            source_digest=payload.source_digest,
        )
        if duplicate is not None:
            return _to_read(duplicate)
        raise PluginRegistryError(
            "dify_plugin_version_conflict",
            f'Plugin "{parsed.provider_key}" version "{parsed.version}" is already installed.',
            status_code=409,
        ) from exc
    return _to_read(row)


async def delete_plugin_installation(session: AsyncSession, installation_id: str) -> None:
    if installation_id.startswith("bundled:"):
        raise PluginRegistryError(
            "bundled_plugin_cannot_uninstall",
            "Bundled OpenCLI capabilities cannot be uninstalled from the plugin catalog.",
            status_code=409,
        )
    row = await session.get(PluginInstallation, installation_id)
    if row is None:
        raise PluginRegistryError(
            "plugin_installation_not_found",
            "Plugin installation not found.",
            status_code=404,
        )
    if await _referencing_draft_ids(session, row):
        raise PluginRegistryError(
            "plugin_installation_in_use",
            "A stored workflow draft still references this plugin installation.",
            status_code=409,
        )
    await session.delete(row)
    await session.flush()


async def _find_exact_installation(
    session: AsyncSession,
    *,
    provider_key: str,
    version: str,
    source_digest: str,
) -> PluginInstallation | None:
    return await session.scalar(
        select(PluginInstallation).where(
            PluginInstallation.provider_key == provider_key,
            PluginInstallation.version == version,
            PluginInstallation.source_digest == source_digest,
        )
    )


async def _referencing_draft_ids(
    session: AsyncSession, installation: PluginInstallation
) -> list[str]:
    drafts = (await session.scalars(select(StudioWorkflowDraft))).all()
    return [
        draft.id
        for draft in drafts
        if _graph_references_installation(
            draft.graph,
            installation_id=installation.id,
            provider_key=installation.provider_key,
            version=installation.version,
        )
    ]


def _graph_references_installation(
    value: Any,
    *,
    installation_id: str,
    provider_key: str,
    version: str,
) -> bool:
    if isinstance(value, dict):
        direct_id = value.get("pluginInstallationId") or value.get("installationId")
        if direct_id == installation_id:
            return True
        direct_provider = value.get("pluginProviderKey") or value.get("providerKey")
        direct_version = value.get("pluginVersion")
        if direct_provider == provider_key and direct_version == version:
            return True
        return any(
            _graph_references_installation(
                nested,
                installation_id=installation_id,
                provider_key=provider_key,
                version=version,
            )
            for nested in value.values()
        )
    if isinstance(value, list):
        return any(
            _graph_references_installation(
                nested,
                installation_id=installation_id,
                provider_key=provider_key,
                version=version,
            )
            for nested in value
        )
    return False


def _to_read(row: PluginInstallation) -> PluginInstallationRead:
    manifest = row.manifest_json or {}
    capabilities = list(row.capabilities_json or [])
    return PluginInstallationRead(
        id=row.id,
        providerKey=row.provider_key,
        name=row.name,
        author=row.author,
        version=row.version,
        sourceKind=row.source_kind,
        sourceDigest=row.source_digest,
        manifestSpecVersion=row.manifest_spec_version,
        signatureState=row.signature_state,
        labels=_dict_of_strings(manifest.get("labels")),
        descriptions=_dict_of_strings(manifest.get("descriptions")),
        icon=manifest.get("icon") if isinstance(manifest.get("icon"), str) else None,
        pluginTypes=_list_of_strings(manifest.get("pluginTypes")),
        manifest=manifest.get("raw") if isinstance(manifest.get("raw"), dict) else {},
        capabilities=capabilities,
        permissions=row.permissions_json or {},
        runtimeStatus=row.runtime_status,
        blockers=row.blockers_json or [],
        nodeDefinitions=_node_definitions(
            capabilities,
            installation_id=row.id,
            provider_key=row.provider_key,
            version=row.version,
        ),
        bundled=False,
        installedAt=row.created_at,
        updatedAt=row.updated_at,
    )


def _node_definitions(
    capabilities: list[dict[str, Any]],
    *,
    installation_id: str,
    provider_key: str,
    version: str,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for capability in capabilities:
        if capability.get("flowCapability") is not True:
            continue
        status = capability.get("status") if capability.get("status") == "READY" else "BLOCKED"
        rows.append(
            {
                "id": (
                    f"plugin.{installation_id}.{capability.get('family')}.{capability.get('key')}"
                ),
                "label": str(capability.get("label") or capability.get("key") or "Plugin"),
                "family": str(capability.get("family") or "tool"),
                "status": status,
                "locked": status != "READY",
                "lockReason": (
                    None
                    if status == "READY"
                    else "Install or configure a compatible OpenCLI runtime adapter."
                ),
                "installationId": installation_id,
                "providerKey": provider_key,
                "pluginVersion": version,
                "capabilityId": str(capability.get("id") or ""),
            }
        )
    return rows


def _bundled_installations() -> list[PluginInstallationRead]:
    timestamp = datetime(2026, 7, 21, tzinfo=UTC)
    specs = [
        (
            "bundled:opencli-adapters",
            "opencli-admin/opencli-adapters",
            "opencli-adapters",
            "OpenCLI 网站适配器",
            [
                _bundled_capability(
                    "opencli-admin/opencli-adapters:datasource:site-read",
                    "datasource",
                    "site-read",
                    "网站读取",
                    "iii.collector-opencli.snapshot",
                ),
                _bundled_capability(
                    "opencli-admin/opencli-adapters:tool:site-action",
                    "tool",
                    "site-action",
                    "网站操作",
                    "external.tool.capability",
                ),
            ],
        ),
        (
            "bundled:native-data-sources",
            "opencli-admin/native-data-sources",
            "native-data-sources",
            "RSS 与 API 数据源",
            [
                _bundled_capability(
                    "opencli-admin/native-data-sources:datasource:rss",
                    "datasource",
                    "rss",
                    "RSS / Atom",
                    "workflow.source.fetch",
                ),
                _bundled_capability(
                    "opencli-admin/native-data-sources:datasource:http",
                    "datasource",
                    "http",
                    "HTTP / API",
                    "workflow.source.fetch",
                ),
            ],
        ),
        (
            "bundled:dify-graphon-runtime",
            "opencli-admin/dify-graphon-runtime",
            "dify-graphon-runtime",
            "Dify / Graphon 兼容运行时",
            [
                _bundled_capability(
                    "opencli-admin/dify-graphon-runtime:tool:workflow-package",
                    "tool",
                    "workflow-package",
                    "Dify 工作流包",
                    DIFY_GRAPHON_BINDING_ID,
                )
            ],
        ),
    ]
    return [
        PluginInstallationRead(
            id=installation_id,
            providerKey=provider_key,
            name=name,
            author="opencli-admin",
            version="builtin",
            sourceKind="bundled",
            sourceDigest="bundled",
            manifestSpecVersion="opencli.plugin.v1",
            signatureState="bundled",
            labels={"zh_Hans": label, "en_US": name.replace("-", " ").title()},
            descriptions={},
            pluginTypes=sorted({item["family"] for item in capabilities}),
            manifest={"source": "opencli-admin", "bundled": True},
            capabilities=capabilities,
            permissions={},
            runtimeStatus="READY",
            blockers=[],
            nodeDefinitions=_node_definitions(
                capabilities,
                installation_id=installation_id,
                provider_key=provider_key,
                version="builtin",
            ),
            bundled=True,
            installedAt=timestamp,
            updatedAt=timestamp,
        )
        for installation_id, provider_key, name, label, capabilities in specs
    ]


def _bundled_capability(
    capability_id: str,
    family: str,
    key: str,
    label: str,
    runtime_adapter_id: str,
) -> dict[str, Any]:
    return {
        "id": capability_id,
        "family": family,
        "key": key,
        "label": label,
        "sourcePath": None,
        "status": "READY",
        "runtimeAdapterId": runtime_adapter_id,
        "blockers": [],
        "flowCapability": True,
    }


def _dict_of_strings(value: Any) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    return {str(key): item for key, item in value.items() if isinstance(item, str)}


def _list_of_strings(value: Any) -> list[str]:
    return [item for item in value if isinstance(item, str)] if isinstance(value, list) else []


__all__ = [
    "DifyPackageError",
    "PluginRegistryError",
    "delete_plugin_installation",
    "get_plugin_installation",
    "import_dify_plugin",
    "list_plugin_installations",
]
