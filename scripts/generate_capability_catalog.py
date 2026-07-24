"""Generate the frontend capability catalog from the exposure matrix.

This module is intentionally independent from the application runtime.  It only
parses the reviewed YAML ledger and emits an allowlisted, deterministic JSON
projection for the frontend.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any, NoReturn

import yaml

_TOP_LEVEL_FIELDS = {
    "version",
    "source",
    "openapi_operation_count",
    "allowed_dispositions",
    "operations",
    "unreferenced_wrappers",
    "capability_groups",
}
_OPERATION_FIELDS = {
    "method",
    "path",
    "operation_id",
    "disposition",
    "frontend_route",
    "wrapper",
    "decision",
    "target_epic",
    "capability_id",
    "projection_reason",
}
_WRAPPER_FIELDS = {
    "wrapper",
    "operation_id",
    "disposition",
    "target_epic",
    "decision",
    "capability_id",
}
_GROUP_BASE_FIELDS = {
    "capability_id",
    "label",
    "projection",
    "distribution",
    "lifecycle",
    "wrapper_names",
    "workflow_node_ids",
    "owner",
    "lifecycle_note",
}
_PROVIDER_FIELDS = {
    "provider_key",
    "provider_aliases",
    "primary_category",
    "plugin_types",
    "readiness_sources",
    "target_route",
    "configuration_route",
}
_READINESS_FIELDS = {"required", "optional"}

_PROJECTIONS = {"plugin_provider", "studio_node", "operator_resource", "setup_card"}
_DISTRIBUTIONS = {"builtin", "package", "marketplace"}
_LIFECYCLES = {"active", "deprecated", "retired"}
_PLUGIN_TYPES = {"model", "tool", "datasource", "agent", "trigger", "extension", "bundle"}
_READINESS_SOURCES = {
    "backend_plugin_catalog",
    "workflow_capabilities",
    "opencli_registry",
}
_DISPOSITIONS = {
    "operator_ui",
    "studio_binding",
    "setup_status",
    "machine_ingress",
    "internal_only",
    "retire",
}
_HTTP_METHODS = {"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"}

_SECRET_KEY = re.compile(
    r"(?:^|_)(?:api_?key|api_?token|access_?token|refresh_?token|auth_?token|"
    r"secret|password|passwd|private_?key|credential(?:_?value)?)(?:$|_)",
    re.IGNORECASE,
)
_SECRET_VALUE_PATTERNS = (
    re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    re.compile(r"\bBearer\s+[A-Za-z0-9._~+/=-]{16,}", re.IGNORECASE),
    re.compile(r"\b(?:sk|ghp|gho|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{16,}\b"),
    re.compile(
        r"\b(?:api_?key|api_?token|access_?token|refresh_?token|password|secret)"
        r"\s*[:=]\s*['\"]?[A-Za-z0-9._~+/=-]{12,}",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b(?:secret|token|password|api[-_]?key)[-_](?:canary|sentinel)"
        r"[-_][A-Za-z0-9_-]{6,}\b",
        re.IGNORECASE,
    ),
)


def _fail(message: str) -> NoReturn:
    raise ValueError(message)


def _mapping(value: Any, context: str) -> dict[str, Any]:
    if not isinstance(value, dict) or not all(isinstance(key, str) for key in value):
        _fail(f"{context} must be an object with string keys")
    return value


def _closed_schema(value: dict[str, Any], allowed: set[str], context: str) -> None:
    unknown = sorted(set(value) - allowed)
    if unknown:
        _fail(f"{context} contains unknown fields: {', '.join(unknown)}")


def _required(value: dict[str, Any], fields: set[str], context: str) -> None:
    missing = sorted(fields - set(value))
    if missing:
        _fail(f"{context} is missing required fields: {', '.join(missing)}")


def _non_empty_string(value: Any, context: str) -> str:
    if not isinstance(value, str) or not value.strip():
        _fail(f"{context} must be a non-empty string")
    return value


def _is_application_route(value: Any) -> bool:
    return (
        isinstance(value, str)
        and value.startswith("/")
        and not value.startswith("//")
        and "\\" not in value
        and "://" not in value
    )


def _optional_route(value: Any, context: str) -> None:
    if value is not None and not _is_application_route(value):
        _fail(f"{context} must be null or an absolute application route")


def _string_list(
    value: Any,
    context: str,
    *,
    non_empty: bool = False,
    choices: set[str] | None = None,
) -> list[str]:
    if not isinstance(value, list):
        _fail(f"{context} must be an array")
    if non_empty and not value:
        _fail(f"{context} must not be empty")
    if any(not isinstance(item, str) or not item.strip() for item in value):
        _fail(f"{context} must contain only non-empty strings")
    if len(value) != len(set(value)):
        _fail(f"{context} must not contain duplicates")
    if choices is not None:
        invalid = sorted(set(value) - choices)
        if invalid:
            _fail(f"{context} contains unsupported values: {', '.join(invalid)}")
    return value


def _scan_for_secrets(value: Any, context: str = "matrix") -> None:
    """Reject credential-shaped keys and high-confidence secret values."""

    if isinstance(value, dict):
        for key, child in value.items():
            key_text = str(key)
            if _SECRET_KEY.search(key_text):
                _fail(f"{context}.{key_text} is a forbidden secret-bearing field")
            _scan_for_secrets(child, f"{context}.{key_text}")
        return
    if isinstance(value, list):
        for index, child in enumerate(value):
            _scan_for_secrets(child, f"{context}[{index}]")
        return
    if isinstance(value, str) and any(pattern.search(value) for pattern in _SECRET_VALUE_PATTERNS):
        _fail(f"{context} contains a credential-shaped value")


def validate_matrix(matrix: dict[str, Any]) -> None:
    """Validate the closed capability-ledger schema and its local references."""

    matrix = _mapping(matrix, "matrix")
    _closed_schema(matrix, _TOP_LEVEL_FIELDS, "matrix")
    _required(matrix, _TOP_LEVEL_FIELDS, "matrix")
    _scan_for_secrets(matrix)

    if matrix["version"] != 1:
        _fail("matrix.version must be 1")
    if matrix["source"] != "backend.main.app.openapi":
        _fail("matrix.source must be backend.main.app.openapi")

    allowed_dispositions = _string_list(
        matrix["allowed_dispositions"],
        "matrix.allowed_dispositions",
        non_empty=True,
        choices=_DISPOSITIONS,
    )

    operations = matrix["operations"]
    if not isinstance(operations, list):
        _fail("matrix.operations must be an array")
    if (
        not isinstance(matrix["openapi_operation_count"], int)
        or isinstance(matrix["openapi_operation_count"], bool)
        or matrix["openapi_operation_count"] != len(operations)
    ):
        _fail("matrix.openapi_operation_count must equal the number of operations")

    groups = matrix["capability_groups"]
    if not isinstance(groups, list):
        _fail("matrix.capability_groups must be an array")

    capability_ids: set[str] = set()
    provider_keys: set[str] = set()
    provider_aliases: set[str] = set()
    group_by_id: dict[str, dict[str, Any]] = {}

    for index, raw_group in enumerate(groups):
        context = f"matrix.capability_groups[{index}]"
        group = _mapping(raw_group, context)
        _closed_schema(group, _GROUP_BASE_FIELDS | _PROVIDER_FIELDS, context)
        _required(
            group,
            {
                "capability_id",
                "label",
                "projection",
                "distribution",
                "lifecycle",
                "wrapper_names",
                "workflow_node_ids",
                "owner",
            },
            context,
        )

        capability_id = _non_empty_string(group["capability_id"], f"{context}.capability_id")
        if capability_id in capability_ids:
            _fail(f"duplicate capability_id: {capability_id}")
        capability_ids.add(capability_id)
        group_by_id[capability_id] = group

        _non_empty_string(group["label"], f"{context}.label")
        _non_empty_string(group["owner"], f"{context}.owner")
        if group["projection"] not in _PROJECTIONS:
            _fail(f"{context}.projection is outside the supported enum")
        if group["distribution"] not in _DISTRIBUTIONS:
            _fail(f"{context}.distribution is outside the supported enum")
        if group["lifecycle"] not in _LIFECYCLES:
            _fail(f"{context}.lifecycle is outside the supported enum")
        if group["lifecycle"] == "deprecated":
            _non_empty_string(group.get("lifecycle_note"), f"{context}.lifecycle_note")
        elif "lifecycle_note" in group:
            _fail(f"{context}.lifecycle_note is only valid for deprecated capabilities")

        _string_list(group["wrapper_names"], f"{context}.wrapper_names")
        _string_list(group["workflow_node_ids"], f"{context}.workflow_node_ids")

        if group["projection"] != "plugin_provider":
            provider_only = sorted(set(group) & _PROVIDER_FIELDS)
            if provider_only:
                _fail(
                    f"{context} uses plugin_provider-only fields: "
                    f"{', '.join(provider_only)}"
                )
            continue

        _required(group, _PROVIDER_FIELDS, context)
        provider_key = _non_empty_string(group["provider_key"], f"{context}.provider_key")
        aliases = _string_list(group["provider_aliases"], f"{context}.provider_aliases")
        if provider_key in provider_keys:
            _fail(f"duplicate provider_key: {provider_key}")
        provider_keys.add(provider_key)
        if provider_key in aliases:
            _fail(f"{context}.provider_aliases collides with its canonical provider_key")
        overlap = set(aliases) & provider_aliases
        if overlap:
            _fail(f"provider aliases are not unique: {', '.join(sorted(overlap))}")
        provider_aliases.update(aliases)

        if group["primary_category"] not in _PLUGIN_TYPES:
            _fail(f"{context}.primary_category is outside the supported enum")
        plugin_types = _string_list(
            group["plugin_types"],
            f"{context}.plugin_types",
            non_empty=True,
            choices=_PLUGIN_TYPES,
        )
        if group["primary_category"] not in plugin_types:
            _fail(f"{context}.primary_category must also appear in plugin_types")

        readiness = _mapping(group["readiness_sources"], f"{context}.readiness_sources")
        _closed_schema(readiness, _READINESS_FIELDS, f"{context}.readiness_sources")
        _required(readiness, _READINESS_FIELDS, f"{context}.readiness_sources")
        required_sources = _string_list(
            readiness["required"],
            f"{context}.readiness_sources.required",
            non_empty=True,
            choices=_READINESS_SOURCES,
        )
        optional_sources = _string_list(
            readiness["optional"],
            f"{context}.readiness_sources.optional",
            choices=_READINESS_SOURCES,
        )
        source_overlap = set(required_sources) & set(optional_sources)
        if source_overlap:
            _fail(
                f"{context}.readiness_sources repeats sources across required and optional: "
                f"{', '.join(sorted(source_overlap))}"
            )
        for route_field in ("target_route", "configuration_route"):
            route = _non_empty_string(group[route_field], f"{context}.{route_field}")
            if not _is_application_route(route):
                _fail(f"{context}.{route_field} must be an absolute application route")

    canonical_alias_overlap = provider_keys & provider_aliases
    if canonical_alias_overlap:
        _fail(
            "provider aliases collide with canonical provider keys: "
            + ", ".join(sorted(canonical_alias_overlap))
        )

    operation_ids: set[str] = set()
    operation_pairs: set[tuple[str, str]] = set()
    operation_wrappers: set[str] = set()
    referenced_capability_ids: set[str] = set()

    operation_required = {
        "method",
        "path",
        "operation_id",
        "disposition",
        "frontend_route",
        "wrapper",
        "decision",
        "target_epic",
    }
    for index, raw_operation in enumerate(operations):
        context = f"matrix.operations[{index}]"
        operation = _mapping(raw_operation, context)
        _closed_schema(operation, _OPERATION_FIELDS, context)
        _required(operation, operation_required, context)

        method = _non_empty_string(operation["method"], f"{context}.method").upper()
        if method not in _HTTP_METHODS or operation["method"] != method:
            _fail(f"{context}.method must be a supported uppercase HTTP method")
        path = _non_empty_string(operation["path"], f"{context}.path")
        if not path.startswith("/"):
            _fail(f"{context}.path must start with /")
        operation_id = _non_empty_string(
            operation["operation_id"], f"{context}.operation_id"
        )
        if operation_id in operation_ids:
            _fail(f"duplicate operation_id: {operation_id}")
        operation_ids.add(operation_id)
        pair = (method, path)
        if pair in operation_pairs:
            _fail(f"duplicate operation route: {method} {path}")
        operation_pairs.add(pair)

        disposition = operation["disposition"]
        if disposition not in allowed_dispositions:
            _fail(f"{context}.disposition is not declared in allowed_dispositions")
        _optional_route(operation["frontend_route"], f"{context}.frontend_route")
        wrapper = operation["wrapper"]
        if wrapper is not None:
            operation_wrappers.add(_non_empty_string(wrapper, f"{context}.wrapper"))
        _non_empty_string(operation["decision"], f"{context}.decision")
        _non_empty_string(operation["target_epic"], f"{context}.target_epic")

        has_capability = "capability_id" in operation
        has_reason = "projection_reason" in operation
        if has_capability == has_reason:
            _fail(
                f"{context} must declare exactly one of capability_id or projection_reason"
            )
        if disposition in {"operator_ui", "studio_binding", "setup_status"} and not has_capability:
            _fail(f"{context}.disposition {disposition} requires capability_id")
        if has_capability:
            capability_id = _non_empty_string(
                operation["capability_id"], f"{context}.capability_id"
            )
            if capability_id not in group_by_id:
                _fail(f"{context}.capability_id references unknown group {capability_id}")
            referenced_capability_ids.add(capability_id)
        else:
            _non_empty_string(operation["projection_reason"], f"{context}.projection_reason")

    raw_wrappers = matrix["unreferenced_wrappers"]
    if not isinstance(raw_wrappers, list):
        _fail("matrix.unreferenced_wrappers must be an array")
    wrapper_names: set[str] = set()
    for index, raw_wrapper in enumerate(raw_wrappers):
        context = f"matrix.unreferenced_wrappers[{index}]"
        wrapper = _mapping(raw_wrapper, context)
        _closed_schema(wrapper, _WRAPPER_FIELDS, context)
        _required(
            wrapper,
            {"wrapper", "operation_id", "disposition", "target_epic", "decision"},
            context,
        )
        name = _non_empty_string(wrapper["wrapper"], f"{context}.wrapper")
        if name in wrapper_names:
            _fail(f"duplicate unreferenced wrapper: {name}")
        wrapper_names.add(name)
        disposition = wrapper["disposition"]
        if disposition not in allowed_dispositions:
            _fail(f"{context}.disposition is not declared in allowed_dispositions")
        raw_operation_id = wrapper["operation_id"]
        if raw_operation_id is None:
            if disposition != "retire":
                _fail(f"{context}.operation_id may be null only for retire")
        else:
            operation_id = _non_empty_string(
                raw_operation_id, f"{context}.operation_id"
            )
            if operation_id not in operation_ids:
                _fail(
                    f"{context}.operation_id references unknown operation {operation_id}"
                )
        _non_empty_string(wrapper["target_epic"], f"{context}.target_epic")
        _non_empty_string(wrapper["decision"], f"{context}.decision")
        if "capability_id" in wrapper:
            capability_id = _non_empty_string(
                wrapper["capability_id"], f"{context}.capability_id"
            )
            if capability_id not in group_by_id:
                _fail(f"{context}.capability_id references unknown group {capability_id}")
            referenced_capability_ids.add(capability_id)

    known_wrappers = operation_wrappers | wrapper_names
    for capability_id, group in group_by_id.items():
        unknown_wrappers = sorted(set(group["wrapper_names"]) - known_wrappers)
        if unknown_wrappers:
            _fail(
                f"capability group {capability_id} references unknown wrappers: "
                f"{', '.join(unknown_wrappers)}"
            )
        if (
            capability_id not in referenced_capability_ids
            and not group["wrapper_names"]
            and not group["workflow_node_ids"]
        ):
            _fail(f"capability group {capability_id} has no operation, wrapper, or node reference")


def build_catalog(matrix: dict[str, Any]) -> dict[str, Any]:
    """Build the allowlisted camelCase plugin-provider projection."""

    validate_matrix(matrix)
    operation_ids_by_capability: dict[str, list[str]] = defaultdict(list)
    for operation in matrix["operations"]:
        capability_id = operation.get("capability_id")
        if capability_id is not None:
            operation_ids_by_capability[capability_id].append(operation["operation_id"])

    providers: list[dict[str, Any]] = []
    for group in matrix["capability_groups"]:
        if group["projection"] != "plugin_provider" or group["lifecycle"] == "retired":
            continue
        provider = {
            "capabilityId": group["capability_id"],
            "configurationRoute": group["configuration_route"],
            "distribution": group["distribution"],
            "label": group["label"],
            "lifecycle": group["lifecycle"],
            "operationIds": sorted(operation_ids_by_capability[group["capability_id"]]),
            "owner": group["owner"],
            "pluginTypes": sorted(group["plugin_types"]),
            "primaryCategory": group["primary_category"],
            "projection": group["projection"],
            "providerAliases": sorted(group["provider_aliases"]),
            "providerKey": group["provider_key"],
            "readinessSources": {
                "optional": sorted(group["readiness_sources"]["optional"]),
                "required": sorted(group["readiness_sources"]["required"]),
            },
            "targetRoute": group["target_route"],
            "workflowNodeIds": sorted(group["workflow_node_ids"]),
            "wrapperNames": sorted(group["wrapper_names"]),
        }
        if group["lifecycle"] == "deprecated":
            provider["lifecycleNote"] = group["lifecycle_note"]
        providers.append(provider)

    providers.sort(key=lambda provider: provider["capabilityId"])
    return {
        "capabilityIds": [provider["capabilityId"] for provider in providers],
        "providers": providers,
        "version": matrix["version"],
    }


def serialize_catalog(catalog: dict[str, Any]) -> bytes:
    """Serialize a catalog as canonical UTF-8 JSON with LF line endings."""

    return (
        json.dumps(catalog, ensure_ascii=False, indent=2, sort_keys=True, separators=(",", ": "))
        + "\n"
    ).encode("utf-8")


def _regeneration_command(matrix_path: Path, output_path: Path) -> str:
    return (
        "python -m scripts.generate_capability_catalog "
        f'--matrix "{matrix_path}" --output "{output_path}"'
    )


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--matrix", type=Path, required=True, help="capability matrix YAML")
    parser.add_argument("--output", type=Path, required=True, help="generated JSON artifact")
    parser.add_argument(
        "--check",
        action="store_true",
        help="fail if the output is missing or differs; never modify it",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    try:
        loaded = yaml.safe_load(args.matrix.read_text(encoding="utf-8"))
        matrix = _mapping(loaded, "matrix")
        generated = serialize_catalog(build_catalog(matrix))
    except (OSError, UnicodeError, yaml.YAMLError, ValueError) as exc:
        print(f"capability catalog generation failed: {exc}", file=sys.stderr)
        return 2

    if args.check:
        try:
            current = args.output.read_bytes()
        except FileNotFoundError:
            current = None
        except OSError as exc:
            print(f"capability catalog check failed: {exc}", file=sys.stderr)
            return 2
        if current != generated:
            print(
                "generated capability catalog is stale; regenerate it with:\n"
                f"  {_regeneration_command(args.matrix, args.output)}",
                file=sys.stderr,
            )
            return 1
        return 0

    try:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_bytes(generated)
    except OSError as exc:
        print(f"capability catalog write failed: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
