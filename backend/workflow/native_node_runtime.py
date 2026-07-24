"""Pure, deterministic runtime for workflow control and data primitives.

These nodes deliberately avoid network, credential, and persistence access.  A
caller can therefore validate them during compile/prepare and execute them in
the workflow process without an adapter or external worker.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

NativeNodeType = Literal[
    "template-transform",
    "variable-assign",
    "variable-aggregate",
    "list-filter",
    "list-sort",
    "if",
    "switch",
    "iteration",
    "loop",
]

NATIVE_BINDING_IDS: dict[NativeNodeType, str] = {
    "template-transform": "workflow.native.template-transform",
    "variable-assign": "workflow.native.variable-assign",
    "variable-aggregate": "workflow.native.variable-aggregate",
    "list-filter": "workflow.native.list-filter",
    "list-sort": "workflow.native.list-sort",
    "if": "workflow.native.if",
    "switch": "workflow.native.switch",
    "iteration": "workflow.native.iteration",
    "loop": "workflow.native.loop",
}

NATIVE_PRIMITIVE_IDS = frozenset(f"primitive.core.{node_type}" for node_type in NATIVE_BINDING_IDS)

_STATIC_NODE_ALIASES: dict[str, NativeNodeType] = {
    "primitive.core.template-transform": "template-transform",
    "compat.dify.template-transform": "template-transform",
    "primitive.core.variable-assign": "variable-assign",
    "compat.dify.assigner": "variable-assign",
    "primitive.core.variable-aggregate": "variable-aggregate",
    "primitive.core.aggregate": "variable-aggregate",
    "compat.dify.variable-aggregator": "variable-aggregate",
    "compat.dify.variable-assigner": "variable-aggregate",
    "primitive.core.list-filter": "list-filter",
    "primitive.core.filter": "list-filter",
    "compat.dify.list-filter": "list-filter",
    "primitive.core.list-sort": "list-sort",
    "primitive.core.sort": "list-sort",
    "primitive.core.if": "if",
    "compat.dify.if-else": "if",
    "primitive.core.switch": "switch",
    "primitive.core.iteration": "iteration",
    "primitive.core.loop-over-items": "iteration",
    "compat.dify.iteration": "iteration",
    "primitive.core.loop": "loop",
    "compat.dify.loop": "loop",
}

_TEMPLATE_REFERENCE = re.compile(
    r"{{\s*(?:#\s*)?([A-Za-z_][\w.-]*(?:\.[A-Za-z_][\w.-]*)*)(?:\s*#)?\s*}}"
)


class NativeNodeValidationError(ValueError):
    """Raised when a native node cannot be prepared for execution."""

    def __init__(self, node_type: NativeNodeType, errors: list[str]) -> None:
        super().__init__(f"Invalid {node_type} configuration: {'; '.join(errors)}")
        self.node_type = node_type
        self.errors = errors


class _NativeConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")


class TemplateTransformConfig(_NativeConfig):
    template: str = Field(..., min_length=1)
    output_key: str = Field("text", min_length=1)


class VariableAssignConfig(_NativeConfig):
    assignments: dict[str, Any] = Field(..., min_length=1)

    @field_validator("assignments")
    @classmethod
    def validate_targets(cls, value: dict[str, Any]) -> dict[str, Any]:
        if any(not key.strip() for key in value):
            raise ValueError("assignment targets must not be blank")
        return value


class VariableAggregateConfig(_NativeConfig):
    variables: list[str] = Field(..., min_length=1)
    strategy: Literal["first_non_null", "list", "object"] = "first_non_null"
    output_key: str = Field("value", min_length=1)


class ConditionConfig(_NativeConfig):
    field: str = ""
    operator: Literal[
        "eq",
        "ne",
        "gt",
        "gte",
        "lt",
        "lte",
        "contains",
        "not_contains",
        "in",
        "exists",
        "is_empty",
    ] = "eq"
    value: Any = None


class ListFilterConfig(_NativeConfig):
    field: str = ""
    operator: Literal[
        "eq",
        "ne",
        "gt",
        "gte",
        "lt",
        "lte",
        "contains",
        "not_contains",
        "in",
        "exists",
        "is_empty",
    ] = "eq"
    value: Any = None


class ListSortConfig(_NativeConfig):
    field: str = ""
    direction: Literal["asc", "desc"] = "asc"


class IfConfig(_NativeConfig):
    condition: ConditionConfig


class SwitchCase(_NativeConfig):
    id: str = Field(..., min_length=1)
    condition: ConditionConfig


class SwitchConfig(_NativeConfig):
    cases: list[SwitchCase] = Field(..., min_length=1)
    default: str = "default"


class IterationConfig(_NativeConfig):
    max_items: int = Field(100, ge=1, le=1000)


class LoopConfig(_NativeConfig):
    condition: ConditionConfig
    max_iterations: int = Field(100, ge=1, le=1000)


NativeConfig = (
    TemplateTransformConfig
    | VariableAssignConfig
    | VariableAggregateConfig
    | ListFilterConfig
    | ListSortConfig
    | IfConfig
    | SwitchConfig
    | IterationConfig
    | LoopConfig
)


class NativeNodePreparation(BaseModel):
    status: Literal["ready", "blocked"]
    node_type: NativeNodeType
    binding_id: str
    executor: str = "backend.workflow.native_node_runtime.execute_native_node"
    config: dict[str, Any] = Field(default_factory=dict)
    errors: list[str] = Field(default_factory=list)


class NativeNodeExecutionResult(BaseModel):
    node_type: NativeNodeType
    output: Any
    route: str | None = None
    meta: dict[str, Any] = Field(default_factory=dict)


_CONFIG_MODELS: dict[NativeNodeType, type[_NativeConfig]] = {
    "template-transform": TemplateTransformConfig,
    "variable-assign": VariableAssignConfig,
    "variable-aggregate": VariableAggregateConfig,
    "list-filter": ListFilterConfig,
    "list-sort": ListSortConfig,
    "if": IfConfig,
    "switch": SwitchConfig,
    "iteration": IterationConfig,
    "loop": LoopConfig,
}


def resolve_native_node_type(
    node_library_id: str | None,
    params: Mapping[str, Any] | None = None,
) -> NativeNodeType | None:
    """Resolve canonical, legacy primitive, and Dify compatibility aliases."""

    if node_library_id == "compat.dify.list-operator":
        config = _raw_config(params or {})
        operation = _string(config.get("operation") or config.get("mode")).lower()
        return "list-sort" if operation in {"sort", "order", "order_by"} else "list-filter"
    return _STATIC_NODE_ALIASES.get(node_library_id or "")


def prepare_native_node(
    node_library_id: str,
    params: Mapping[str, Any] | None = None,
) -> NativeNodePreparation | None:
    """Validate a native node and return serializable runtime readiness."""

    node_type = resolve_native_node_type(node_library_id, params)
    if node_type is None:
        return None
    normalized = _normalize_config(node_type, _raw_config(params or {}))
    try:
        config = _CONFIG_MODELS[node_type].model_validate(normalized)
    except ValidationError as error:
        errors = [
            f"{'.'.join(str(part) for part in item['loc'])}: {item['msg']}"
            for item in error.errors(include_url=False)
        ]
        return NativeNodePreparation(
            status="blocked",
            node_type=node_type,
            binding_id=NATIVE_BINDING_IDS[node_type],
            errors=errors,
        )
    return NativeNodePreparation(
        status="ready",
        node_type=node_type,
        binding_id=NATIVE_BINDING_IDS[node_type],
        config=config.model_dump(mode="json"),
    )


def execute_native_node(
    node_library_id: str,
    inputs: Any,
    params: Mapping[str, Any] | None = None,
) -> NativeNodeExecutionResult:
    """Execute one prepared pure node without I/O side effects."""

    prepared = prepare_native_node(node_library_id, params)
    if prepared is None:
        raise ValueError(f'Unknown native node "{node_library_id}"')
    if prepared.status != "ready":
        raise NativeNodeValidationError(prepared.node_type, prepared.errors)

    config = _CONFIG_MODELS[prepared.node_type].model_validate(prepared.config)
    if isinstance(config, TemplateTransformConfig):
        context = _context(inputs)
        rendered = _TEMPLATE_REFERENCE.sub(
            lambda match: _render_value(_lookup(context, match.group(1))),
            config.template,
        )
        return _result(prepared.node_type, {config.output_key: rendered})
    if isinstance(config, VariableAssignConfig):
        context = _context(inputs)
        assigned = {
            target: _resolve_assignment(value, context)
            for target, value in config.assignments.items()
        }
        return _result(prepared.node_type, {**context, **assigned}, assigned=list(assigned))
    if isinstance(config, VariableAggregateConfig):
        context = _context(inputs)
        values = [_lookup(context, path) for path in config.variables]
        if config.strategy == "list":
            aggregate: Any = values
        elif config.strategy == "object":
            aggregate = dict(zip(config.variables, values, strict=True))
        else:
            aggregate = next((value for value in values if value is not None), None)
        return _result(prepared.node_type, {config.output_key: aggregate})
    if isinstance(config, ListFilterConfig):
        items = _items(inputs)
        condition = ConditionConfig(
            field=config.field,
            operator=config.operator,
            value=config.value,
        )
        output = [item for item in items if _matches(item, condition)]
        return _result(prepared.node_type, output, input_count=len(items), output_count=len(output))
    if isinstance(config, ListSortConfig):
        items = _items(inputs)
        output = sorted(
            items,
            key=lambda item: _sort_key(_lookup(item, config.field) if config.field else item),
            reverse=config.direction == "desc",
        )
        return _result(prepared.node_type, output, item_count=len(output))
    if isinstance(config, IfConfig):
        matched = _matches(inputs, config.condition)
        return _result(prepared.node_type, inputs, route="true" if matched else "false")
    if isinstance(config, SwitchConfig):
        selected = next(
            (case.id for case in config.cases if _matches(inputs, case.condition)),
            config.default,
        )
        return _result(prepared.node_type, inputs, route=selected)
    if isinstance(config, IterationConfig):
        items = _items(inputs)[: config.max_items]
        iterations = [
            {"index": index, "item": item, "isLast": index == len(items) - 1}
            for index, item in enumerate(items)
        ]
        return _result(prepared.node_type, iterations, item_count=len(iterations))
    if isinstance(config, LoopConfig):
        context = _context(inputs)
        raw_iteration = context.get("iteration", 0)
        iteration = raw_iteration if isinstance(raw_iteration, int) and raw_iteration >= 0 else 0
        continue_loop = iteration < config.max_iterations and _matches(context, config.condition)
        output = {**context, "iteration": iteration + 1 if continue_loop else iteration}
        return _result(
            prepared.node_type,
            output,
            route="continue" if continue_loop else "done",
            iteration=iteration,
            max_iterations=config.max_iterations,
        )
    raise AssertionError(f"Unhandled native node config {type(config).__name__}")


def _normalize_config(node_type: NativeNodeType, config: dict[str, Any]) -> dict[str, Any]:
    value = dict(config)
    if node_type == "template-transform":
        value["output_key"] = value.get("output_key") or value.get("outputKey") or "text"
    elif node_type == "variable-assign":
        assignments = value.get("assignments")
        if not isinstance(assignments, dict):
            assignments = _assignment_map(value.get("variables"))
        value["assignments"] = assignments
    elif node_type == "variable-aggregate":
        value["variables"] = _variable_paths(value.get("variables"))
        value["output_key"] = value.get("output_key") or value.get("outputKey") or "value"
        value["strategy"] = value.get("strategy") or value.get("aggregation") or "first_non_null"
    elif node_type in {"list-filter", "list-sort"}:
        value["field"] = _selector_path(
            value.get("field") or value.get("key") or value.get("sortBy") or ""
        )
        value["direction"] = value.get("direction") or value.get("order") or "asc"
    elif node_type in {"if", "loop"}:
        value["condition"] = _condition(value.get("condition") or value.get("conditions"))
        if node_type == "loop":
            value["max_iterations"] = (
                value.get("max_iterations") or value.get("maxIterations") or 100
            )
    elif node_type == "switch":
        value["cases"] = [
            {
                "id": _string(case.get("id") or case.get("case_id") or case.get("label")),
                "condition": _condition(case.get("condition") or case.get("conditions")),
            }
            for case in value.get("cases", [])
            if isinstance(case, Mapping)
        ]
    elif node_type == "iteration":
        value["max_items"] = value.get("max_items") or value.get("maxItems") or 100
    return value


def _raw_config(params: Mapping[str, Any]) -> dict[str, Any]:
    nested = params.get("config")
    return dict(nested) if isinstance(nested, Mapping) else dict(params)


def _assignment_map(value: Any) -> dict[str, Any]:
    if not isinstance(value, list):
        return {}
    result: dict[str, Any] = {}
    for item in value:
        if not isinstance(item, Mapping):
            continue
        target = _selector_path(
            item.get("name")
            or item.get("target")
            or item.get("variable")
            or item.get("variable_selector")
        )
        if target:
            result[target] = item.get("value")
    return result


def _variable_paths(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [path for item in value if (path := _selector_path(item))]


def _condition(value: Any) -> dict[str, Any]:
    if isinstance(value, list):
        value = next((item for item in value if isinstance(item, Mapping)), {})
    if not isinstance(value, Mapping):
        return {}
    return {
        "field": _selector_path(
            value.get("field") or value.get("variable") or value.get("variable_selector") or ""
        ),
        "operator": _operator(value.get("operator") or value.get("comparison_operator")),
        "value": value.get("value"),
    }


def _operator(value: Any) -> str:
    normalized = _string(value).lower().replace(" ", "_").replace("-", "_")
    return {
        "is": "eq",
        "equals": "eq",
        "not_equals": "ne",
        "not_equal": "ne",
        "greater_than": "gt",
        "greater_than_or_equal": "gte",
        "less_than": "lt",
        "less_than_or_equal": "lte",
        "not_contains": "not_contains",
        "empty": "is_empty",
        "not_empty": "exists",
    }.get(normalized, normalized or "eq")


def _selector_path(value: Any) -> str:
    if isinstance(value, list):
        return ".".join(_string(part) for part in value if _string(part))
    return _string(value)


def _context(inputs: Any) -> dict[str, Any]:
    return dict(inputs) if isinstance(inputs, Mapping) else {"value": inputs}


def _items(inputs: Any) -> list[Any]:
    if isinstance(inputs, list):
        return list(inputs)
    if isinstance(inputs, Mapping):
        for key in ("items", "records", "value"):
            value = inputs.get(key)
            if isinstance(value, list):
                return list(value)
    return []


def _lookup(value: Any, path: str) -> Any:
    current = value
    if not path:
        return current
    for part in path.split("."):
        if isinstance(current, Mapping):
            current = current.get(part)
        elif isinstance(current, list) and part.isdigit():
            index = int(part)
            current = current[index] if index < len(current) else None
        else:
            return None
    return current


def _resolve_assignment(value: Any, context: Mapping[str, Any]) -> Any:
    if isinstance(value, Mapping) and isinstance(value.get("from"), str):
        return _lookup(context, value["from"])
    if isinstance(value, str):
        exact = _TEMPLATE_REFERENCE.fullmatch(value)
        if exact:
            return _lookup(context, exact.group(1))
        return _TEMPLATE_REFERENCE.sub(
            lambda match: _render_value(_lookup(context, match.group(1))), value
        )
    return value


def _matches(value: Any, condition: ConditionConfig) -> bool:
    actual = _lookup(value, condition.field)
    expected = condition.value
    match condition.operator:
        case "eq":
            return actual == expected
        case "ne":
            return actual != expected
        case "gt" | "gte" | "lt" | "lte":
            try:
                if condition.operator == "gt":
                    return actual > expected
                if condition.operator == "gte":
                    return actual >= expected
                if condition.operator == "lt":
                    return actual < expected
                return actual <= expected
            except TypeError:
                return False
        case "contains":
            try:
                return expected in actual
            except TypeError:
                return False
        case "not_contains":
            try:
                return expected not in actual
            except TypeError:
                return True
        case "in":
            try:
                return actual in expected
            except TypeError:
                return False
        case "exists":
            return actual is not None and actual != "" and actual != [] and actual != {}
        case "is_empty":
            return actual is None or actual == "" or actual == [] or actual == {}


def _sort_key(value: Any) -> tuple[bool, str, Any]:
    if value is None:
        return True, "", ""
    if isinstance(value, bool | int | float | str):
        return False, type(value).__name__, value
    return False, type(value).__name__, repr(value)


def _render_value(value: Any) -> str:
    return "" if value is None else str(value)


def _string(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _result(
    node_type: NativeNodeType,
    output: Any,
    *,
    route: str | None = None,
    **meta: Any,
) -> NativeNodeExecutionResult:
    return NativeNodeExecutionResult(
        node_type=node_type,
        output=output,
        route=route,
        meta=meta,
    )


__all__ = [
    "NATIVE_BINDING_IDS",
    "NATIVE_PRIMITIVE_IDS",
    "NativeNodeExecutionResult",
    "NativeNodePreparation",
    "NativeNodeType",
    "NativeNodeValidationError",
    "execute_native_node",
    "prepare_native_node",
    "resolve_native_node_type",
]
