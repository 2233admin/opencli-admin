"""Stable workflow-run block reason taxonomy."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

BlockReasonCategory = Literal[
    "missing_config",
    "missing_source_credential",
    "missing_runtime_resource",
    "missing_permission",
    "missing_runtime_binding",
]

FETCH_PERMISSION_REQUIRED = "fetch_permission_required"
SEND_PERMISSION_REQUIRED = "send_permission_required"
MISSING_DELIVERY_PROJECTION = "missing_delivery_projection"
MISSING_RUNTIME_BINDING = "missing_runtime_binding"
MISSING_RUNTIME_IO_CONTRACT = "missing_runtime_io_contract"
MISSING_RUNTIME_PARAMETER = "missing_runtime_parameter"
MISSING_SOURCE_CREDENTIAL = "missing_source_credential"
MISSING_TOOL_CAPABILITY_BINDING = "missing_tool_capability_binding"
MISSING_TURBOPUSH_CONTENT_TYPE = "missing_turbopush_content_type"
MISSING_TURBOPUSH_SERVICE = "missing_turbopush_service"
SOURCE_OUTPUT_REQUIRED = "source_output_required"


@dataclass(frozen=True)
class WorkflowBlockReasonDefinition:
    code: str
    category: BlockReasonCategory
    stable_fields: tuple[str, ...]
    volatile_fields: tuple[str, ...] = ()
    description: str = ""


WORKFLOW_BLOCK_REASON_TAXONOMY: dict[str, WorkflowBlockReasonDefinition] = {
    FETCH_PERMISSION_REQUIRED: WorkflowBlockReasonDefinition(
        code=FETCH_PERMISSION_REQUIRED,
        category="missing_permission",
        stable_fields=("code", "source", "details.bindingId", "details.requiredPermission"),
        description="Source fetch is blocked because canFetchNetwork is false.",
    ),
    SEND_PERMISSION_REQUIRED: WorkflowBlockReasonDefinition(
        code=SEND_PERMISSION_REQUIRED,
        category="missing_permission",
        stable_fields=("code", "source", "details.bindingId", "details.requiredPermission"),
        description="Notification delivery is blocked because canSendNotifications is false.",
    ),
    MISSING_DELIVERY_PROJECTION: WorkflowBlockReasonDefinition(
        code=MISSING_DELIVERY_PROJECTION,
        category="missing_config",
        stable_fields=("code", "source", "details.bindingId", "details.required_params"),
        volatile_fields=("message",),
        description="Delivery is blocked until webhook URL and projection inputs are configured.",
    ),
    MISSING_RUNTIME_BINDING: WorkflowBlockReasonDefinition(
        code=MISSING_RUNTIME_BINDING,
        category="missing_runtime_binding",
        stable_fields=("code", "source", "details.kind", "details.capability"),
        volatile_fields=("message",),
        description="Compiled node has no registered runtime binding.",
    ),
    MISSING_RUNTIME_IO_CONTRACT: WorkflowBlockReasonDefinition(
        code=MISSING_RUNTIME_IO_CONTRACT,
        category="missing_runtime_binding",
        stable_fields=("code", "source", "details.bindingId"),
        volatile_fields=("message",),
        description="Runtime binding exists but has no declared node I/O contract.",
    ),
    MISSING_RUNTIME_PARAMETER: WorkflowBlockReasonDefinition(
        code=MISSING_RUNTIME_PARAMETER,
        category="missing_config",
        stable_fields=("code", "source", "details.required_params"),
        volatile_fields=("message",),
        description="Runtime binding cannot be built because required node params are absent.",
    ),
    MISSING_SOURCE_CREDENTIAL: WorkflowBlockReasonDefinition(
        code=MISSING_SOURCE_CREDENTIAL,
        category="missing_source_credential",
        stable_fields=(
            "code",
            "source",
            "details.bindingId",
            "details.requiredCredentialKey",
        ),
        volatile_fields=("message",),
        description="Source fetch requires a saved credential reference that is absent.",
    ),
    MISSING_TOOL_CAPABILITY_BINDING: WorkflowBlockReasonDefinition(
        code=MISSING_TOOL_CAPABILITY_BINDING,
        category="missing_runtime_binding",
        stable_fields=("code", "source", "details.toolCapabilityId"),
        volatile_fields=("message",),
        description="Tool-capability node has no registered backend tool binding.",
    ),
    MISSING_TURBOPUSH_CONTENT_TYPE: WorkflowBlockReasonDefinition(
        code=MISSING_TURBOPUSH_CONTENT_TYPE,
        category="missing_config",
        stable_fields=("code", "source", "details.required_params"),
        volatile_fields=("message",),
        description="TurboPush publish cannot bind without a supported content type.",
    ),
    MISSING_TURBOPUSH_SERVICE: WorkflowBlockReasonDefinition(
        code=MISSING_TURBOPUSH_SERVICE,
        category="missing_runtime_resource",
        stable_fields=("code", "source", "details.provider"),
        volatile_fields=("message", "details.required_params"),
        description="TurboPush local runtime service resource is not configured.",
    ),
    SOURCE_OUTPUT_REQUIRED: WorkflowBlockReasonDefinition(
        code=SOURCE_OUTPUT_REQUIRED,
        category="missing_config",
        stable_fields=("code", "source", "details.bindingId", "details.liveMode"),
        volatile_fields=("message",),
        description="Fixture/mock source fetch needs source outputs before downstream execution.",
    ),
}


def block_reason_definition(code: str) -> WorkflowBlockReasonDefinition | None:
    return WORKFLOW_BLOCK_REASON_TAXONOMY.get(code)


def block_reason_category(code: str) -> BlockReasonCategory | None:
    definition = block_reason_definition(code)
    return definition.category if definition else None


__all__ = [
    "BlockReasonCategory",
    "FETCH_PERMISSION_REQUIRED",
    "MISSING_DELIVERY_PROJECTION",
    "MISSING_RUNTIME_BINDING",
    "MISSING_RUNTIME_IO_CONTRACT",
    "MISSING_RUNTIME_PARAMETER",
    "MISSING_SOURCE_CREDENTIAL",
    "MISSING_TOOL_CAPABILITY_BINDING",
    "MISSING_TURBOPUSH_CONTENT_TYPE",
    "MISSING_TURBOPUSH_SERVICE",
    "SEND_PERMISSION_REQUIRED",
    "SOURCE_OUTPUT_REQUIRED",
    "WORKFLOW_BLOCK_REASON_TAXONOMY",
    "WorkflowBlockReasonDefinition",
    "block_reason_category",
    "block_reason_definition",
]
