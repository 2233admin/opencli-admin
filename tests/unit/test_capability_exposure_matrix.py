from __future__ import annotations

import re
from pathlib import Path

import yaml

from backend.main import app
from backend.workflow.capability_projection import build_workflow_capabilities

REPO_ROOT = Path(__file__).resolve().parents[2]
MATRIX_PATH = REPO_ROOT / "docs" / "backend-capability-exposure-matrix.yaml"
ENDPOINTS_PATH = REPO_ROOT / "frontend" / "lib" / "api" / "endpoints.ts"
HTTP_METHODS = {"get", "post", "put", "patch", "delete", "options", "head"}
DISPOSITIONS = {
    "operator_ui",
    "studio_binding",
    "setup_status",
    "machine_ingress",
    "internal_only",
    "retire",
}
PROJECTIONS = {"plugin_provider", "studio_node", "operator_resource", "setup_card"}
DISTRIBUTIONS = {"builtin", "package", "marketplace"}
LIFECYCLES = {"active", "deprecated", "retired"}
PLUGIN_CATEGORIES = {
    "model",
    "tool",
    "datasource",
    "agent",
    "trigger",
    "extension",
    "bundle",
}
READINESS_SOURCES = {
    "backend_plugin_catalog",
    "workflow_capabilities",
    "opencli_registry",
}
COMMON_CAPABILITY_GROUP_FIELDS = {
    "capability_id",
    "label",
    "projection",
    "distribution",
    "lifecycle",
    "lifecycle_note",
    "owner",
    "wrapper_names",
    "workflow_node_ids",
}
PLUGIN_PROVIDER_FIELDS = {
    "provider_key",
    "provider_aliases",
    "primary_category",
    "plugin_types",
    "readiness_sources",
    "target_route",
    "configuration_route",
}
SECRET_CANARY = "opencli-capability-secret-canary-9f8e7d6c"
FORBIDDEN_SECRET_FIELD = re.compile(
    r"(?:^|_)(?:secret|token|password|credential_value|api_key|webhook_url)(?:$|_)",
    flags=re.IGNORECASE,
)
FORBIDDEN_SECRET_VALUE = re.compile(
    r"(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+\S+|"
    r"\bsk-[A-Za-z0-9_-]{12,}|\bghp_[A-Za-z0-9]{12,})",
    flags=re.IGNORECASE,
)


def _load_matrix() -> dict:
    assert MATRIX_PATH.exists(), f"missing capability exposure matrix: {MATRIX_PATH}"
    return yaml.safe_load(MATRIX_PATH.read_text(encoding="utf-8"))


def _openapi_operations() -> set[tuple[str, str, str]]:
    operations: set[tuple[str, str, str]] = set()
    for path, path_item in app.openapi()["paths"].items():
        for method, operation in path_item.items():
            if method.lower() not in HTTP_METHODS:
                continue
            operations.add((method.upper(), path, operation["operationId"]))
    return operations


def _exported_api_wrappers() -> set[str]:
    source = ENDPOINTS_PATH.read_text(encoding="utf-8")
    return set(re.findall(r"^export const (\w+)", source, flags=re.MULTILINE))


def _referenced_api_wrappers() -> set[str]:
    source_roots = [
        REPO_ROOT / "frontend" / "app",
        REPO_ROOT / "frontend" / "components",
        REPO_ROOT / "frontend" / "lib",
    ]
    sources: list[str] = []
    for root in source_roots:
        for path in root.rglob("*"):
            if path == ENDPOINTS_PATH or path.suffix not in {".ts", ".tsx", ".js", ".jsx", ".mjs"}:
                continue
            sources.append(path.read_text(encoding="utf-8", errors="ignore"))
    combined = "\n".join(sources)
    return {
        wrapper
        for wrapper in _exported_api_wrappers()
        if re.search(rf"\b{re.escape(wrapper)}\b", combined)
    }


def _workflow_node_ids() -> set[str]:
    projection = build_workflow_capabilities().model_dump(mode="python")
    return {
        row["id"]
        for surface, rows in projection.items()
        if surface != "version"
        for row in rows
    }


def _assert_sorted_unique(values: object, field: str) -> list[str]:
    assert isinstance(values, list), f"{field} must be an array"
    assert all(isinstance(value, str) and value for value in values), (
        f"{field} entries must be non-empty strings"
    )
    assert values == sorted(set(values)), f"{field} must be unique and stably sorted"
    return values


def _iter_key_values(value: object, path: tuple[str, ...] = ()):
    if isinstance(value, dict):
        for key, child in value.items():
            child_path = (*path, str(key))
            yield child_path, child
            yield from _iter_key_values(child, child_path)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from _iter_key_values(child, (*path, str(index)))


def test_capability_exposure_matrix_covers_every_openapi_operation() -> None:
    matrix = _load_matrix()
    entries = matrix["operations"]
    exported_wrappers = _exported_api_wrappers()
    recorded = {
        (entry["method"], entry["path"], entry["operation_id"])
        for entry in entries
    }
    linked_wrappers = [entry["wrapper"] for entry in entries if entry["wrapper"]]

    assert recorded == _openapi_operations()
    assert len(recorded) == len(entries), "matrix contains duplicate operations"
    assert len(linked_wrappers) == len(set(linked_wrappers)), "wrapper maps to multiple operations"
    assert set(linked_wrappers) <= exported_wrappers
    for entry in entries:
        assert entry["disposition"] in DISPOSITIONS
        assert entry["decision"]
        assert "frontend_route" in entry
        assert "wrapper" in entry
        assert entry["target_epic"]


def test_every_unreferenced_api_wrapper_has_an_explicit_decision() -> None:
    matrix = _load_matrix()
    exported = _exported_api_wrappers()
    unreferenced = exported - _referenced_api_wrappers()
    explanations = matrix["unreferenced_wrappers"]
    explained = {entry["wrapper"] for entry in explanations}
    operations_by_id = {entry["operation_id"]: entry for entry in matrix["operations"]}

    assert explained == unreferenced
    assert len(explained) == len(explanations), "matrix contains duplicate wrapper decisions"
    for entry in explanations:
        assert entry["wrapper"] in exported
        assert entry["disposition"] in DISPOSITIONS
        assert entry["decision"]
        assert entry["target_epic"]
        operation_id = entry["operation_id"]
        if operation_id is None:
            assert entry["disposition"] == "retire"
            continue
        operation = operations_by_id[operation_id]
        assert operation["wrapper"] == entry["wrapper"]
        assert operation["disposition"] == entry["disposition"]
        assert operation["target_epic"] == entry["target_epic"]


def test_every_operation_has_exactly_one_user_projection_decision() -> None:
    matrix = _load_matrix()
    groups = matrix.get("capability_groups")
    assert isinstance(groups, list), "matrix must define capability_groups"
    capability_ids = {
        group["capability_id"]
        for group in groups
        if isinstance(group, dict) and isinstance(group.get("capability_id"), str)
    }

    for entry in matrix["operations"]:
        capability_id = entry.get("capability_id")
        projection_reason = entry.get("projection_reason")
        has_capability = isinstance(capability_id, str) and bool(capability_id.strip())
        has_reason = isinstance(projection_reason, str) and bool(projection_reason.strip())
        assert has_capability ^ has_reason, (
            f"{entry['operation_id']} must define exactly one of capability_id "
            "or non-empty projection_reason"
        )
        if has_capability:
            assert capability_id in capability_ids, (
                f"{entry['operation_id']} references unknown capability {capability_id}"
            )
        if entry["disposition"] in {"operator_ui", "studio_binding", "setup_status"}:
            assert has_capability, (
                f"{entry['operation_id']} disposition {entry['disposition']} requires "
                "a user-visible capability_id"
            )


def test_capability_groups_follow_the_closed_schema() -> None:
    matrix = _load_matrix()
    groups = matrix.get("capability_groups")
    assert isinstance(groups, list) and groups, "capability_groups must be non-empty"

    ids = [group.get("capability_id") for group in groups]
    assert all(isinstance(value, str) and value for value in ids)
    assert len(ids) == len(set(ids)), "capability_id values must be unique"

    operations_by_capability = {
        entry.get("capability_id")
        for entry in matrix["operations"]
        if entry.get("capability_id")
    }
    for group in groups:
        projection = group.get("projection")
        allowed_fields = set(COMMON_CAPABILITY_GROUP_FIELDS)
        if projection == "plugin_provider":
            allowed_fields |= PLUGIN_PROVIDER_FIELDS
        unknown_fields = set(group) - allowed_fields
        assert not unknown_fields, (
            f"{group.get('capability_id', '<unknown>')} has unknown fields: "
            f"{sorted(unknown_fields)}"
        )

        required = COMMON_CAPABILITY_GROUP_FIELDS - {"lifecycle_note"}
        missing = required - set(group)
        assert not missing, (
            f"{group.get('capability_id', '<unknown>')} is missing fields: {sorted(missing)}"
        )
        assert isinstance(group["label"], str) and group["label"].strip()
        assert group["projection"] in PROJECTIONS
        assert group["distribution"] in DISTRIBUTIONS
        assert group["lifecycle"] in LIFECYCLES
        assert isinstance(group["owner"], str) and group["owner"].strip()
        if group["lifecycle"] == "deprecated":
            assert isinstance(group.get("lifecycle_note"), str) and group[
                "lifecycle_note"
            ].strip(), "deprecated groups require lifecycle_note"

        wrapper_names = _assert_sorted_unique(
            group["wrapper_names"], f"{group['capability_id']}.wrapper_names"
        )
        workflow_node_ids = _assert_sorted_unique(
            group["workflow_node_ids"], f"{group['capability_id']}.workflow_node_ids"
        )
        assert (
            group["capability_id"] in operations_by_capability
            or wrapper_names
            or workflow_node_ids
        ), f"{group['capability_id']} must have at least one authoritative reference"

        if projection != "plugin_provider":
            continue
        missing_provider_fields = PLUGIN_PROVIDER_FIELDS - set(group)
        assert not missing_provider_fields, (
            f"{group['capability_id']} is missing plugin provider fields: "
            f"{sorted(missing_provider_fields)}"
        )
        assert isinstance(group["provider_key"], str) and group["provider_key"].strip()
        _assert_sorted_unique(
            group["provider_aliases"], f"{group['capability_id']}.provider_aliases"
        )
        assert group["primary_category"] in PLUGIN_CATEGORIES
        plugin_types = _assert_sorted_unique(
            group["plugin_types"], f"{group['capability_id']}.plugin_types"
        )
        assert plugin_types, f"{group['capability_id']}.plugin_types must be non-empty"
        assert set(plugin_types) <= PLUGIN_CATEGORIES
        assert group["primary_category"] in plugin_types

        readiness = group["readiness_sources"]
        assert isinstance(readiness, dict)
        assert set(readiness) == {"required", "optional"}, (
            f"{group['capability_id']}.readiness_sources has unknown or missing fields"
        )
        required_sources = _assert_sorted_unique(
            readiness["required"], f"{group['capability_id']}.readiness_sources.required"
        )
        optional_sources = _assert_sorted_unique(
            readiness["optional"], f"{group['capability_id']}.readiness_sources.optional"
        )
        assert required_sources, (
            f"{group['capability_id']}.readiness_sources.required must be non-empty"
        )
        assert set(required_sources) | set(optional_sources) <= READINESS_SOURCES
        assert set(required_sources).isdisjoint(optional_sources)
        for route_field in ("target_route", "configuration_route"):
            route = group[route_field]
            assert isinstance(route, str) and route.startswith("/"), (
                f"{group['capability_id']}.{route_field} must be an absolute app route"
            )


def test_capability_group_references_are_unique_and_resolvable() -> None:
    groups = _load_matrix().get("capability_groups")
    assert isinstance(groups, list), "matrix must define capability_groups"
    exported_wrappers = _exported_api_wrappers()
    workflow_node_ids = _workflow_node_ids()

    group_wrappers = [
        wrapper for group in groups for wrapper in group.get("wrapper_names", [])
    ]
    group_nodes = [
        node_id for group in groups for node_id in group.get("workflow_node_ids", [])
    ]
    provider_identifiers = [
        identifier
        for group in groups
        if group.get("projection") == "plugin_provider"
        for identifier in [group.get("provider_key"), *group.get("provider_aliases", [])]
    ]

    assert len(group_wrappers) == len(set(group_wrappers)), (
        "a frontend wrapper cannot belong to multiple capability groups"
    )
    assert set(group_wrappers) <= exported_wrappers, "capability group has unknown wrapper"
    assert len(group_nodes) == len(set(group_nodes)), (
        "a workflow node cannot belong to multiple capability groups"
    )
    assert set(group_nodes) <= workflow_node_ids, "capability group has unknown workflow node"
    assert all(isinstance(value, str) and value for value in provider_identifiers)
    assert len(provider_identifiers) == len(set(provider_identifiers)), (
        "provider_key and provider_aliases must be globally unique and non-overlapping"
    )


def test_capability_projection_contract_contains_no_secret_material() -> None:
    matrix = _load_matrix()
    raw_matrix = MATRIX_PATH.read_text(encoding="utf-8")
    assert SECRET_CANARY not in raw_matrix

    violations: list[str] = []
    for path, value in _iter_key_values(matrix):
        field = path[-1]
        if FORBIDDEN_SECRET_FIELD.search(field) and value not in (None, "", [], {}):
            violations.append(".".join(path))
        if isinstance(value, str) and (
            SECRET_CANARY in value or FORBIDDEN_SECRET_VALUE.search(value)
        ):
            violations.append(".".join(path))
    assert not violations, f"secret material found in capability matrix: {violations}"
