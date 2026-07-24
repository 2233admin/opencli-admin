from __future__ import annotations

import pytest

from backend.plugins.capability_catalog import get_plugin_node_capability
from backend.schemas.workflow import WorkflowProjectNode
from backend.workflow.native_node_runtime import (
    NATIVE_PRIMITIVE_IDS,
    NativeNodeValidationError,
    execute_native_node,
    prepare_native_node,
)
from backend.workflow.node_registry import WORKFLOW_PRIMITIVE_IDS
from backend.workflow.runtime_registry import resolve_runtime_metadata


def test_compiler_registry_accepts_every_native_primitive() -> None:
    assert NATIVE_PRIMITIVE_IDS <= WORKFLOW_PRIMITIVE_IDS


@pytest.mark.parametrize(
    ("primitive_id", "parameter_names", "required_config", "inputs", "node_type"),
    [
        (
            "primitive.core.template-transform",
            ["template", "output_key"],
            {"template": "Hello {{ value }}"},
            {"value": "Ada"},
            "template-transform",
        ),
        (
            "primitive.core.variable-assign",
            ["assignments"],
            {"assignments": {"copy": "{{ value }}"}},
            {"value": "Ada"},
            "variable-assign",
        ),
        (
            "primitive.core.variable-aggregate",
            ["variables", "strategy", "output_key"],
            {"variables": ["value"]},
            {"value": "Ada"},
            "variable-aggregate",
        ),
        (
            "primitive.core.list-filter",
            ["field", "operator", "value"],
            {},
            ["Ada"],
            "list-filter",
        ),
        (
            "primitive.core.list-sort",
            ["field", "direction"],
            {},
            [2, 1],
            "list-sort",
        ),
        (
            "primitive.core.if",
            ["condition"],
            {"condition": {"field": "ready", "operator": "exists"}},
            {"ready": True},
            "if",
        ),
        (
            "primitive.core.switch",
            ["cases", "default"],
            {"cases": [{"id": "ready", "condition": {"field": "ready", "operator": "exists"}}]},
            {"ready": True},
            "switch",
        ),
        (
            "primitive.core.iteration",
            ["max_items"],
            {},
            ["Ada"],
            "iteration",
        ),
        (
            "primitive.core.loop",
            ["condition", "max_iterations"],
            {"condition": {"field": "ready", "operator": "exists"}},
            {"ready": True},
            "loop",
        ),
    ],
)
def test_catalog_native_parameters_prepare_and_execute_against_runtime_contract(
    primitive_id: str,
    parameter_names: list[str],
    required_config: dict,
    inputs: object,
    node_type: str,
) -> None:
    capability = get_plugin_node_capability(primitive_id)

    assert capability is not None
    assert [parameter.name for parameter in capability.parameters] == parameter_names
    config = {
        parameter.name: parameter.default
        for parameter in capability.parameters
        if parameter.default is not None
    }
    config.update(required_config)

    prepared = prepare_native_node(primitive_id, config)

    assert prepared is not None
    assert prepared.status == "ready"
    assert prepared.node_type == node_type
    assert execute_native_node(primitive_id, inputs, config).node_type == node_type


def test_template_transform_is_typed_prepared_and_executable() -> None:
    prepared = prepare_native_node(
        "primitive.core.template-transform",
        {"template": "Hello {{ user.name }}", "outputKey": "message"},
    )

    assert prepared is not None
    assert prepared.status == "ready"
    assert prepared.binding_id == "workflow.native.template-transform"
    assert prepared.config == {
        "template": "Hello {{ user.name }}",
        "output_key": "message",
    }
    result = execute_native_node(
        "primitive.core.template-transform",
        {"user": {"name": "Ada"}},
        {"template": "Hello {{ user.name }}", "outputKey": "message"},
    )
    assert result.output == {"message": "Hello Ada"}


def test_invalid_native_config_is_honestly_blocked() -> None:
    prepared = prepare_native_node("primitive.core.template-transform", {})

    assert prepared is not None
    assert prepared.status == "blocked"
    assert prepared.errors[0].startswith("template:")
    with pytest.raises(NativeNodeValidationError):
        execute_native_node("primitive.core.template-transform", {}, {})


def test_variable_assign_and_aggregate_support_runtime_references() -> None:
    assigned = execute_native_node(
        "primitive.core.variable-assign",
        {"profile": {"name": "Ada"}, "fallback": "unknown"},
        {
            "assignments": {
                "displayName": "{{#profile.name#}}",
                "greeting": "Hi {{ profile.name }}",
            }
        },
    )
    assert assigned.output["displayName"] == "Ada"
    assert assigned.output["greeting"] == "Hi Ada"

    aggregated = execute_native_node(
        "primitive.core.variable-aggregate",
        assigned.output,
        {
            "variables": ["missing", "displayName", "fallback"],
            "strategy": "first_non_null",
            "outputKey": "selected",
        },
    )
    assert aggregated.output == {"selected": "Ada"}


def test_list_filter_and_sort_execute_without_external_runtime() -> None:
    items = [
        {"name": "low", "score": 2},
        {"name": "high", "score": 9},
        {"name": "mid", "score": 5},
    ]
    filtered = execute_native_node(
        "primitive.core.list-filter",
        items,
        {"field": "score", "operator": "gte", "value": 5},
    )
    assert [item["name"] for item in filtered.output] == ["high", "mid"]
    assert filtered.meta == {"input_count": 3, "output_count": 2}

    sorted_result = execute_native_node(
        "primitive.core.list-sort",
        filtered.output,
        {"field": "score", "direction": "asc"},
    )
    assert [item["score"] for item in sorted_result.output] == [5, 9]


def test_if_and_switch_emit_explicit_routes() -> None:
    if_result = execute_native_node(
        "primitive.core.if",
        {"score": 8},
        {"condition": {"field": "score", "operator": "gte", "value": 5}},
    )
    assert if_result.route == "true"

    switch_result = execute_native_node(
        "primitive.core.switch",
        {"tier": "pro"},
        {
            "cases": [
                {
                    "id": "enterprise",
                    "condition": {"field": "tier", "operator": "eq", "value": "ent"},
                },
                {
                    "id": "paid",
                    "condition": {"field": "tier", "operator": "in", "value": ["pro", "ent"]},
                },
            ],
            "default": "free",
        },
    )
    assert switch_result.route == "paid"


def test_iteration_and_loop_are_bounded_primitives() -> None:
    iteration = execute_native_node(
        "primitive.core.iteration",
        ["a", "b", "c"],
        {"maxItems": 2},
    )
    assert iteration.output == [
        {"index": 0, "item": "a", "isLast": False},
        {"index": 1, "item": "b", "isLast": True},
    ]

    continuing = execute_native_node(
        "primitive.core.loop",
        {"iteration": 1, "enabled": True},
        {
            "condition": {"field": "enabled", "operator": "eq", "value": True},
            "maxIterations": 2,
        },
    )
    assert continuing.route == "continue"
    assert continuing.output["iteration"] == 2

    stopped = execute_native_node(
        "primitive.core.loop",
        continuing.output,
        {
            "condition": {"field": "enabled", "operator": "eq", "value": True},
            "maxIterations": 2,
        },
    )
    assert stopped.route == "done"
    assert stopped.output["iteration"] == 2


@pytest.mark.parametrize(
    ("primitive_id", "kind", "capability", "params", "binding_id"),
    [
        (
            "primitive.core.template-transform",
            "agent",
            "normalize",
            {"template": "{{ value }}"},
            "workflow.native.template-transform",
        ),
        (
            "primitive.core.variable-assign",
            "agent",
            "normalize",
            {"assignments": {"value": 1}},
            "workflow.native.variable-assign",
        ),
        (
            "primitive.core.variable-aggregate",
            "agent",
            "normalize",
            {"variables": ["value"]},
            "workflow.native.variable-aggregate",
        ),
        (
            "primitive.core.list-filter",
            "agent",
            "normalize",
            {"operator": "exists"},
            "workflow.native.list-filter",
        ),
        (
            "primitive.core.list-sort",
            "agent",
            "normalize",
            {},
            "workflow.native.list-sort",
        ),
        (
            "primitive.core.if",
            "router",
            "route",
            {"condition": {"operator": "exists"}},
            "workflow.native.if",
        ),
        (
            "primitive.core.switch",
            "router",
            "route",
            {"cases": [{"id": "one", "condition": {"operator": "exists"}}]},
            "workflow.native.switch",
        ),
        (
            "primitive.core.iteration",
            "router",
            "route",
            {},
            "workflow.native.iteration",
        ),
        (
            "primitive.core.loop",
            "router",
            "route",
            {"condition": {"operator": "exists"}},
            "workflow.native.loop",
        ),
    ],
)
def test_runtime_registry_binds_every_p0_native_node_with_contract(
    primitive_id: str,
    kind: str,
    capability: str,
    params: dict,
    binding_id: str,
) -> None:
    node = WorkflowProjectNode.model_validate(
        {
            "id": "native-node",
            "kind": kind,
            "capability": capability,
            "params": params,
            "ui": {"primitiveId": primitive_id},
        }
    )

    runtime = resolve_runtime_metadata(node, None)

    assert "missing_runtime" not in runtime
    assert runtime["binding"]["binding_id"] == binding_id
    assert runtime["binding"]["contract"]["status"] == "executable"
    assert runtime["native"]["readiness"]["status"] == "ready"


def test_runtime_registry_reports_invalid_config_instead_of_fake_binding() -> None:
    node = WorkflowProjectNode(
        id="bad-template",
        kind="agent",
        capability="normalize",
        params={},
        ui={"primitiveId": "primitive.core.template-transform"},
    )

    runtime = resolve_runtime_metadata(node, None)

    assert "binding" not in runtime
    assert runtime["missing_runtime"]["code"] == "invalid_native_node_config"
    assert runtime["native"]["readiness"]["status"] == "blocked"


@pytest.mark.parametrize("window", ["90m", "tomorrow", " 12H ", ""])
def test_runtime_registry_preserves_studio_dedupe_window_for_hygiene_validation(
    window: str,
) -> None:
    node = WorkflowProjectNode(
        id="dedupe",
        kind="agent",
        capability="dedupe",
        params={"window": window, "windowHours": 24, "windowSeconds": 86400},
        ui={"catalogId": "intelligence.processing.dedupe"},
    )

    runtime = resolve_runtime_metadata(node, None)
    binding_input = runtime["binding"]["input"]

    assert binding_input["window"] == window
    assert "windowHours" not in binding_input
    assert "windowSeconds" not in binding_input


@pytest.mark.parametrize(
    ("params", "expected_hours", "expected_seconds"),
    [
        ({}, 24.0, 86400.0),
        ({"windowHours": 12}, 12.0, 43200.0),
        ({"windowSeconds": 5400}, 1.5, 5400.0),
    ],
)
def test_runtime_registry_keeps_numeric_dedupe_window_compatibility_without_studio_window(
    params: dict,
    expected_hours: float,
    expected_seconds: float,
) -> None:
    node = WorkflowProjectNode(
        id="dedupe",
        kind="agent",
        capability="dedupe",
        params=params,
        ui={"catalogId": "intelligence.processing.dedupe"},
    )

    runtime = resolve_runtime_metadata(node, None)
    binding_input = runtime["binding"]["input"]

    assert "window" not in binding_input
    assert binding_input["windowHours"] == expected_hours
    assert binding_input["windowSeconds"] == expected_seconds


def test_dify_compat_aliases_resolve_to_same_native_runtime() -> None:
    prepared = prepare_native_node(
        "compat.dify.list-operator",
        {"config": {"operation": "sort", "field": "rank"}},
    )

    assert prepared is not None
    assert prepared.status == "ready"
    assert prepared.binding_id == "workflow.native.list-sort"

    legacy_assigner = prepare_native_node(
        "compat.dify.variable-assigner",
        {"config": {"variables": [["source", "value"]]}},
    )
    assert legacy_assigner is not None
    assert legacy_assigner.status == "ready"
    assert legacy_assigner.binding_id == "workflow.native.variable-aggregate"
