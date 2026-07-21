"""Interpret the public Dify plugin manifest as registry metadata."""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Any

import yaml
from yaml.events import AliasEvent

from backend.plugins.dify_package import DifyPackageError, DifyPackagePayload

SUPPORTED_FAMILIES = {
    "tools": "tool",
    "models": "model",
    "datasources": "datasource",
    "triggers": "trigger",
    "agent_strategies": "agent_strategy",
    "endpoints": "endpoint",
    "extensions": "endpoint",
}
FLOW_FAMILIES = {"tool", "datasource", "trigger", "agent_strategy"}
_IDENTIFIER_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")
_SECRET_KEYS = {
    "api_key",
    "apikey",
    "access_token",
    "authorization",
    "client_secret",
    "password",
    "private_key",
    "secret",
    "token",
}


class _NoAliasSafeLoader(yaml.SafeLoader):
    def compose_node(self, parent: object, index: object) -> yaml.Node:
        if self.check_event(AliasEvent):
            raise DifyPackageError(
                "dify_plugin_manifest_alias_not_allowed",
                "YAML aliases are not allowed in Dify plugin manifests.",
            )
        return super().compose_node(parent, index)


@dataclass(frozen=True)
class ParsedDifyManifest:
    provider_key: str
    name: str
    author: str
    version: str
    manifest_spec_version: str
    manifest: dict[str, Any]
    labels: dict[str, str]
    descriptions: dict[str, str]
    icon: str | None
    plugin_types: list[str]
    capabilities: list[dict[str, Any]]
    permissions: dict[str, Any]
    required_credentials: list[dict[str, Any]]
    blockers: list[dict[str, Any]]


def parse_dify_manifest(payload: DifyPackagePayload) -> ParsedDifyManifest:
    if len(payload.manifest_bytes) > 2 * 1024 * 1024:
        raise DifyPackageError(
            "dify_plugin_manifest_too_large",
            "The Dify manifest exceeds the 2 MiB metadata limit.",
        )
    try:
        raw = yaml.load(payload.manifest_bytes, Loader=_NoAliasSafeLoader)
    except DifyPackageError:
        raise
    except (UnicodeDecodeError, yaml.YAMLError) as exc:
        raise DifyPackageError(
            "dify_plugin_manifest_invalid_yaml", "The Dify manifest is not valid YAML."
        ) from exc
    if not isinstance(raw, dict):
        raise DifyPackageError(
            "dify_plugin_manifest_invalid", "The Dify manifest root must be an object."
        )

    author = _required_identifier(raw, "author")
    name = _required_identifier(raw, "name")
    version = _required_string(raw, "version", max_length=64)
    if raw.get("type") != "plugin":
        raise DifyPackageError(
            "dify_plugin_manifest_type_invalid", 'The Dify manifest type must be "plugin".'
        )
    meta = raw.get("meta")
    if not isinstance(meta, dict):
        raise DifyPackageError(
            "dify_plugin_manifest_meta_missing", "The Dify manifest must declare meta.version."
        )
    spec_version = _required_string(meta, "version", max_length=32)
    plugins = raw.get("plugins")
    if not isinstance(plugins, dict) or not plugins:
        raise DifyPackageError(
            "dify_plugin_manifest_plugins_missing",
            "The Dify manifest must declare at least one plugin capability.",
        )

    capabilities: list[dict[str, Any]] = []
    plugin_types: list[str] = []
    for manifest_key, family in SUPPORTED_FAMILIES.items():
        declarations = plugins.get(manifest_key)
        if declarations is None:
            continue
        if not isinstance(declarations, list) or not all(
            isinstance(item, str) and item.strip() for item in declarations
        ):
            raise DifyPackageError(
                "dify_plugin_manifest_capability_invalid",
                f'Dify plugin capability "{manifest_key}" must be a list of paths.',
            )
        plugin_types.append(family)
        for declaration in declarations:
            source_path = _safe_reference_path(declaration)
            capability_key = PurePosixPath(source_path).stem
            capabilities.append(
                {
                    "id": f"{author}/{name}:{family}:{capability_key}",
                    "family": family,
                    "key": capability_key,
                    "label": capability_key.replace("_", " ").replace("-", " ").title(),
                    "sourcePath": source_path,
                    "status": "BLOCKED",
                    "runtimeAdapterId": None,
                    "blockers": [
                        {
                            "code": "dify_plugin_runtime_adapter_required",
                            "message": (
                                f"No OpenCLI runtime adapter is registered for Dify {family} "
                                f'capability "{capability_key}".'
                            ),
                        }
                    ],
                    "flowCapability": family in FLOW_FAMILIES,
                }
            )

    if not capabilities:
        raise DifyPackageError(
            "dify_plugin_manifest_capability_missing",
            "The Dify manifest does not declare a supported capability family.",
        )

    permissions = _mapping_or_empty(_mapping_or_empty(raw.get("resource")).get("permission"))
    required_credentials = _read_required_credentials(capabilities, payload.metadata_files)
    blockers = [
        {
            "code": "dify_plugin_execution_disabled",
            "message": (
                "Plugin code was imported as metadata only. Execution requires an explicit "
                "OpenCLI runtime adapter."
            ),
        }
    ]
    return ParsedDifyManifest(
        provider_key=f"{author}/{name}",
        name=name,
        author=author,
        version=version,
        manifest_spec_version=spec_version,
        manifest=_sanitize_manifest(raw),
        labels=_localized_text(raw.get("label")),
        descriptions=_localized_text(raw.get("description")),
        icon=raw.get("icon") if isinstance(raw.get("icon"), str) else None,
        plugin_types=plugin_types,
        capabilities=capabilities,
        permissions={
            "declared": _sanitize_manifest(permissions),
            "requiredCredentials": required_credentials,
        },
        required_credentials=required_credentials,
        blockers=blockers,
    )


def _required_identifier(raw: dict[str, Any], key: str) -> str:
    value = _required_string(raw, key, max_length=128)
    if not _IDENTIFIER_RE.fullmatch(value):
        raise DifyPackageError(
            "dify_plugin_manifest_identifier_invalid",
            f'Dify manifest field "{key}" contains unsupported characters.',
        )
    return value


def _required_string(raw: dict[str, Any], key: str, *, max_length: int) -> str:
    value = raw.get(key)
    if not isinstance(value, (str, int, float)):
        raise DifyPackageError(
            "dify_plugin_manifest_field_missing",
            f'Dify manifest field "{key}" is required.',
        )
    text = str(value).strip()
    if not text or len(text) > max_length:
        raise DifyPackageError(
            "dify_plugin_manifest_field_invalid",
            f'Dify manifest field "{key}" is invalid.',
        )
    return text


def _safe_reference_path(value: str) -> str:
    normalized = value.replace("\\", "/")
    path = PurePosixPath(normalized)
    if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        raise DifyPackageError(
            "dify_plugin_manifest_reference_unsafe",
            f'Dify manifest contains an unsafe metadata reference: "{value}".',
        )
    return path.as_posix()


def _read_required_credentials(
    capabilities: list[dict[str, Any]], metadata_files: dict[str, bytes]
) -> list[dict[str, Any]]:
    credentials: dict[str, dict[str, Any]] = {}
    for capability in capabilities:
        source_path = capability["sourcePath"]
        content = metadata_files.get(source_path)
        if content is None:
            continue
        try:
            document = yaml.load(content, Loader=_NoAliasSafeLoader)
        except (DifyPackageError, yaml.YAMLError, UnicodeDecodeError):
            continue
        if not isinstance(document, dict):
            continue
        for container_key in (
            "credentials_for_provider",
            "credential_schema",
            "oauth_schema",
        ):
            container = document.get(container_key)
            if isinstance(container, list):
                entries = container
            elif isinstance(container, dict):
                entries = container.get("client_schema", [])
            else:
                entries = []
            for entry in entries:
                if not isinstance(entry, dict):
                    continue
                variable = entry.get("name") or entry.get("variable")
                if not isinstance(variable, str) or not variable:
                    continue
                credentials[variable] = {
                    "name": variable,
                    "type": entry.get("type") if isinstance(entry.get("type"), str) else "secret",
                    "required": entry.get("required") is not False,
                    "sourcePath": source_path,
                }
    return list(credentials.values())


def _sanitize_manifest(value: Any, *, key: str | None = None) -> Any:
    if key is not None and key.casefold() in _SECRET_KEYS and not isinstance(value, (dict, list)):
        return "[REDACTED]"
    if isinstance(value, dict):
        return {
            str(nested_key): _sanitize_manifest(nested, key=str(nested_key))
            for nested_key, nested in value.items()
        }
    if isinstance(value, list):
        return [_sanitize_manifest(item) for item in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def _mapping_or_empty(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _localized_text(value: Any) -> dict[str, str]:
    if isinstance(value, str):
        return {"en_US": value}
    if not isinstance(value, dict):
        return {}
    return {str(key): text for key, text in value.items() if isinstance(text, str)}
