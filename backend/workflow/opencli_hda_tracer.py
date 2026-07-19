"""Build III dispatch envelopes for Multi Source OpenCLI HDA nodes."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.record import CollectedRecord
from backend.models.source import DataSource
from backend.models.task import CollectionTask
from backend.models.workflow_run import WorkflowRun as WorkflowRunRow
from backend.models.workflow_run import WorkflowRunEvent as WorkflowRunEventRow
from backend.pipeline.normalizer import normalize_item
from backend.pipeline.storer import store_records
from backend.schemas.workflow import (
    CompiledWorkflowNode,
    WorkflowCompileError,
    WorkflowFleetCapabilityMatchRequest,
    WorkflowFleetCapabilityMatchResponse,
    WorkflowNodeRunEvent,
    WorkflowNodeRunEventType,
    WorkflowOpenCLIHDATraceDispatch,
    WorkflowOpenCLIHDATraceResponse,
    WorkflowProject,
    WorkflowRunBatchReference,
    WorkflowRunBlockReason,
    WorkflowRunCheckpoint,
    WorkflowRunNodeState,
    WorkflowRunProjection,
    WorkflowRunSourceOutputsRequest,
    WorkflowRunStartRequest,
    WorkflowRunStatus,
)
from backend.workflow.block_reasons import (
    FETCH_PERMISSION_REQUIRED,
    MISSING_DELIVERY_PROJECTION,
    MISSING_SOURCE_CREDENTIAL,
    SEND_PERMISSION_REQUIRED,
    SOURCE_OUTPUT_REQUIRED,
)
from backend.workflow.compiler import INTERNAL_ID_SEPARATOR, compile_workflow_project
from backend.workflow.event_mirror import publish_workflow_run_event_mirror
from backend.workflow.fleet_inventory import match_workflow_fleet_capability
from backend.workflow.http_source_executor import (
    WorkflowHTTPSourceExecutionError,
    execute_workflow_http_source,
)
from backend.workflow.joyai_vl_executor import (
    JOYAI_VL_INTERACTION_EXECUTOR,
    JOYAI_VL_TOOL_CAPABILITY_ID,
    JoyAIVLExecutionError,
    execute_joyai_vl_interaction,
)
from backend.workflow.realtime_market_executor import (
    OKX_MARKET_TICKER_SNAPSHOT_EXECUTOR,
    RealtimeMarketExecutionError,
    execute_okx_market_ticker_snapshot,
)
from backend.workflow.rss_source_executor import (
    WorkflowRSSSourceExecutionError,
    execute_workflow_rss_source,
)
from backend.workflow.runtime_registry import (
    EXTERNAL_TOOL_BINDING_ID,
    INBOX_STORE_BINDING_ID,
    MERGE_BINDING_ID,
    NORMALIZE_BINDING_ID,
    NOTIFY_SEND_BINDING_ID,
    OPENCLI_BINDING_ID,
    OPENCLI_FUNCTION_ID,
    OPENCLI_WORKER,
    RECORD_ACCEPTANCE_BINDING_ID,
    RECORD_SINK_BINDING_ID,
    ROUTER_ROUTE_BINDING_ID,
    SCHEDULE_TRIGGER_BINDING_ID,
    SOURCE_FETCH_BINDING_ID,
    WEBHOOK_NOTIFY_BINDING_ID,
    WEBHOOK_TRIGGER_BINDING_ID,
)
from backend.workflow.runtime_resources import resolve_runtime_resources
from backend.workflow.turbopush_executor import (
    TurboPushPublishError,
    execute_turbopush_publish,
)
from backend.workflow.turbopush_runtime import TURBOPUSH_BINDING_ID
from backend.workflow.webhook_delivery import (
    WorkflowWebhookDeliveryError,
    execute_workflow_webhook_delivery,
)


@dataclass
class _StoredWorkflowRun:
    request: WorkflowRunStartRequest
    projection: WorkflowRunProjection
    events: list[WorkflowNodeRunEvent]


_RUNS: dict[str, _StoredWorkflowRun] = {}


def build_opencli_hda_trace(
    project: WorkflowProject,
    *,
    package_node_id: str | None = None,
    run_id: str | None = None,
    trace_id: str | None = None,
) -> WorkflowOpenCLIHDATraceResponse:
    """Compile a WorkflowProject and return OpenCLI HDA fanout trigger envelopes."""

    resolved_run_id = run_id or str(uuid.uuid4())
    resolved_trace_id = trace_id or str(uuid.uuid4())
    compile_result = compile_workflow_project(project)
    if not compile_result.valid or compile_result.plan is None:
        return WorkflowOpenCLIHDATraceResponse(
            valid=False,
            errors=compile_result.errors,
            workflowId=project.id,
            runId=resolved_run_id,
            traceId=resolved_trace_id,
            packageNodeId=package_node_id,
            dispatch=_dispatch_metadata(),
            dispatches=[],
        )

    runtime_nodes = compile_result.plan.runtime.nodes
    selected_package_id = _select_package_id(runtime_nodes, package_node_id)
    if selected_package_id is None:
        return WorkflowOpenCLIHDATraceResponse(
            valid=False,
            errors=[
                WorkflowCompileError(
                    code="missing_opencli_hda_package",
                    message="No Multi Source OpenCLI HDA package node is available to trace",
                    node_id=package_node_id,
                    path=["nodes", package_node_id] if package_node_id else ["nodes"],
                )
            ],
            workflowId=project.id,
            runId=resolved_run_id,
            traceId=resolved_trace_id,
            packageNodeId=package_node_id,
            dispatch=_dispatch_metadata(),
            dispatches=[],
        )

    dispatches = [
        _to_dispatch(
            project,
            node,
            package_node_id=selected_package_id,
            run_id=resolved_run_id,
            trace_id=resolved_trace_id,
        )
        for node in runtime_nodes
        if _is_opencli_internal_source(node, selected_package_id)
    ]
    if not dispatches:
        return WorkflowOpenCLIHDATraceResponse(
            valid=False,
            errors=[
                WorkflowCompileError(
                    code="missing_opencli_hda_sources",
                    message=(
                        f'Multi Source OpenCLI HDA "{selected_package_id}" has no '
                        "compiled OpenCLI source bindings"
                    ),
                    node_id=selected_package_id,
                    path=["nodes", selected_package_id, "internals"],
                )
            ],
            workflowId=project.id,
            runId=resolved_run_id,
            traceId=resolved_trace_id,
            packageNodeId=selected_package_id,
            dispatch=_dispatch_metadata(),
            dispatches=[],
        )

    return WorkflowOpenCLIHDATraceResponse(
        valid=True,
        errors=[],
        workflowId=project.id,
        runId=resolved_run_id,
        traceId=resolved_trace_id,
        packageNodeId=selected_package_id,
        dispatch=_dispatch_metadata(),
        dispatches=dispatches,
    )


async def start_workflow_run(
    body: WorkflowRunStartRequest,
    *,
    session: AsyncSession | None = None,
    existing_events: list[WorkflowNodeRunEvent] | None = None,
) -> WorkflowRunProjection:
    """Create a replayable workflow run projection from a compiled WorkflowProject."""

    run_id = body.runId or str(uuid.uuid4())
    trace_id = body.traceId or str(uuid.uuid4())
    started_at = _utcnow()
    prior_events = list(existing_events or [])
    compile_result = compile_workflow_project(body.project)

    if not compile_result.valid or compile_result.plan is None:
        events = _compile_failure_events(
            workflow_id=body.project.id,
            run_id=run_id,
            trace_id=trace_id,
            errors=compile_result.errors,
        )
        projection = _build_projection(
            workflow_id=body.project.id,
            run_id=run_id,
            trace_id=trace_id,
            package_node_id=body.packageNodeId,
            started_at=started_at,
            valid=False,
            errors=compile_result.errors,
            runtime_nodes=[],
            events=events,
        )
        stored_events = [*prior_events, *events]
        projection = _build_projection(
            workflow_id=body.project.id,
            run_id=run_id,
            trace_id=trace_id,
            package_node_id=body.packageNodeId,
            started_at=started_at,
            valid=False,
            errors=compile_result.errors,
            runtime_nodes=[],
            events=stored_events,
        )
        await _store_workflow_run(
            run_id,
            request=body,
            projection=projection,
            events=stored_events,
            session=session,
        )
        return projection

    emitter = _WorkflowRunEventEmitter(
        workflow_id=body.project.id,
        run_id=run_id,
        trace_id=trace_id,
        source_id=(
            body.input.sourceId or body.input.source
            if body.trigger.kind == "webhook"
            else None
        ),
        initial_sequence=len(prior_events),
    )
    runtime_nodes, trigger_selection_error = _select_runtime_nodes_for_trigger(
        compile_result.plan.runtime.nodes,
        trigger_kind=body.trigger.kind,
        trigger_node_id=body.trigger.triggerNodeId,
    )
    if trigger_selection_error is not None:
        errors = [trigger_selection_error]
        events = _compile_failure_events(
            workflow_id=body.project.id,
            run_id=run_id,
            trace_id=trace_id,
            errors=errors,
        )
        stored_events = [*prior_events, *events]
        projection = _build_projection(
            workflow_id=body.project.id,
            run_id=run_id,
            trace_id=trace_id,
            package_node_id=body.packageNodeId,
            started_at=started_at,
            valid=False,
            errors=errors,
            runtime_nodes=[],
            events=stored_events,
        )
        await _store_workflow_run(
            run_id,
            request=body,
            projection=projection,
            events=stored_events,
            session=session,
        )
        return projection

    runtime_nodes_by_id = {node.id: node for node in runtime_nodes}
    should_trace_opencli = (
        body.packageNodeId is not None or _select_package_id(runtime_nodes, None) is not None
    )
    trace = (
        build_opencli_hda_trace(
            body.project,
            package_node_id=body.packageNodeId,
            run_id=run_id,
            trace_id=trace_id,
        )
        if should_trace_opencli
        else None
    )
    package_nodes = [node for node in runtime_nodes if node.package is not None]
    package_ids = {node.id for node in package_nodes}
    dispatches_by_node = {
        dispatch.nodeId: dispatch for dispatch in (trace.dispatches if trace else [])
    }
    for node in runtime_nodes:
        if (
            _binding_id(node) != OPENCLI_BINDING_ID
            or node.id in dispatches_by_node
            or not _read_string(node.params.get("opencliAdapterNodeId"))
        ):
            continue
        dispatches_by_node[node.id] = _to_dispatch(
            body.project,
            node,
            package_node_id=None,
            run_id=run_id,
            trace_id=trace_id,
        )
    blocked_by_package: dict[str, list[WorkflowRunBlockReason]] = {}
    outputs_by_node: dict[str, list[dict[str, Any]]] = {}
    materialized_source_tasks: dict[str, tuple[str, str]] = {}

    for node in runtime_nodes:
        emitter.emit(node, "queued", message="Node queued for workflow run")

    for node in runtime_nodes:
        if node.id in package_ids:
            emitter.emit(node, "started", message="Package node started")
            continue

        missing_runtime = _read_dict(node.runtime.get("missing_runtime"))
        if missing_runtime:
            reason = WorkflowRunBlockReason(
                code=_read_string(missing_runtime.get("code")) or "missing_runtime",
                message=_read_string(missing_runtime.get("message"))
                or "Node has no executable runtime binding",
                source="runtime_registry",
                details=missing_runtime,
            )
            emitter.emit(
                node,
                "blocked",
                message=reason.message,
                block_reason=reason,
            )
            for ancestor_id in _package_ancestor_ids(node):
                blocked_by_package.setdefault(ancestor_id, []).append(reason)
            continue

        if _binding_id(node) == WEBHOOK_TRIGGER_BINDING_ID:
            if body.trigger.kind != "webhook" or body.trigger.triggerNodeId != node.id:
                reason = WorkflowRunBlockReason(
                    code="workflow_webhook_input_required",
                    message="Webhook trigger requires workflow webhook ingress input.",
                    source="workflow_webhook_ingress",
                    details={
                        "nodeId": node.id,
                        "bindingId": WEBHOOK_TRIGGER_BINDING_ID,
                    },
                )
                emitter.emit(node, "blocked", message=reason.message, block_reason=reason)
                continue

            envelope = _webhook_runtime_input_envelope(body, node)
            outputs_by_node[node.id] = [envelope]
            emitter.emit(node, "started", message="Workflow webhook input accepted")
            emitter.emit(
                node,
                "partial",
                message="Webhook request projected as runtime input",
                details={
                    "bindingId": WEBHOOK_TRIGGER_BINDING_ID,
                    "outputPort": "request",
                    "workflowId": body.project.id,
                    "runId": run_id,
                    "nodeId": node.id,
                    "sourceId": body.input.sourceId or body.input.source,
                    "requestId": body.trigger.requestId,
                    "runtimeInputEnvelope": envelope,
                },
            )
            emitter.emit(node, "completed", message="Workflow webhook input completed")
            continue

        request_items = _request_source_items(node, body.sourceOutputs)
        if request_items:
            outputs_by_node[node.id] = request_items
            emitter.emit(node, "started", message="Runtime source output started")
            emitter.emit(
                node,
                "partial",
                message="Runtime source output loaded as workflow items",
                batch=_node_batch_reference(
                    body.project.id,
                    run_id,
                    node,
                    item_count=len(request_items),
                ),
                details={
                    "itemCount": len(request_items),
                    "outputPort": "items[]",
                    "lineage": _lineage_pointer(node),
                },
            )
            emitter.emit(node, "completed", message="Runtime source output completed")
            continue

        fixture_items = _fixture_source_items(node)
        if fixture_items:
            outputs_by_node[node.id] = fixture_items
            emitter.emit(node, "started", message="Fixture source items started")
            emitter.emit(
                node,
                "partial",
                message="Fixture source items ready",
                batch=_node_batch_reference(
                    body.project.id,
                    run_id,
                    node,
                    item_count=len(fixture_items),
                ),
                details={
                    "itemCount": len(fixture_items),
                    "outputPort": "items[]",
                    "lineage": _lineage_pointer(node),
                },
            )
            emitter.emit(node, "completed", message="Fixture source items completed")
            continue

        persisted_items = await _bound_source_record_items(node, session=session)
        if persisted_items:
            outputs_by_node[node.id] = persisted_items
            emitter.emit(node, "started", message="Bound source records started")
            emitter.emit(
                node,
                "partial",
                message="Bound source records loaded as workflow items",
                batch=_node_batch_reference(
                    body.project.id,
                    run_id,
                    node,
                    item_count=len(persisted_items),
                    record_count=len(persisted_items),
                    adapter_task_id=_bound_task_id(node),
                ),
                details={
                    "itemCount": len(persisted_items),
                    "outputPort": "items[]",
                    "taskId": _bound_task_id(node),
                    "sourceId": _bound_source_id_from_items(persisted_items),
                    "lineage": _lineage_pointer(node),
                },
            )
            emitter.emit(node, "completed", message="Bound source records completed")
            continue

        if _is_workflow_source_fetch_node(node):
            emitter.emit(node, "started", message="Workflow source fetch binding started")
            binding = _read_dict(node.runtime.get("binding"))
            binding_input = _read_dict(binding.get("input"))
            try:
                rss_result = await execute_workflow_rss_source(
                    binding_input,
                    allowed_domains=body.project.agentPermissions.allowedDomains,
                    max_items=body.project.settings.maxItemsPerRun,
                    session=session,
                )
            except WorkflowRSSSourceExecutionError as exc:
                reason = WorkflowRunBlockReason(
                    code=exc.code,
                    message=exc.message,
                    source="workflow_rss_source",
                    details={"nodeId": node.id, **exc.details},
                )
                emitter.emit(
                    node,
                    "blocked" if exc.status == "blocked" else "failed",
                    message=reason.message,
                    block_reason=reason,
                )
                continue

            if rss_result is not None:
                live_items = _live_source_items(
                    node,
                    rss_result.items,
                    artifact="live_rss_source",
                )
                outputs_by_node[node.id] = live_items
                emitter.emit(
                    node,
                    "partial",
                    message="Live RSS source loaded as workflow items",
                    batch=_node_batch_reference(
                        body.project.id,
                        run_id,
                        node,
                        item_count=len(live_items),
                    ),
                    details={
                        "bindingId": SOURCE_FETCH_BINDING_ID,
                        "itemCount": len(live_items),
                        "outputPort": "items[]",
                        "channelType": "rss",
                        "url": rss_result.url,
                        "feedTitle": rss_result.feed_title,
                        "totalEntries": rss_result.total_entries,
                        "lineage": _lineage_pointer(node),
                    },
                )
                emitter.emit(node, "completed", message="Live RSS source completed")
                continue

            try:
                live_result = await execute_workflow_http_source(
                    binding_input,
                    allowed_domains=body.project.agentPermissions.allowedDomains,
                    max_items=body.project.settings.maxItemsPerRun,
                )
            except WorkflowHTTPSourceExecutionError as exc:
                reason = WorkflowRunBlockReason(
                    code=exc.code,
                    message=exc.message,
                    source="workflow_http_source",
                    details={"nodeId": node.id, **exc.details},
                )
                emitter.emit(
                    node,
                    "blocked" if exc.status == "blocked" else "failed",
                    message=reason.message,
                    block_reason=reason,
                )
                continue

            if live_result is not None:
                live_items = _live_source_items(node, live_result.items)
                outputs_by_node[node.id] = live_items
                emitter.emit(
                    node,
                    "partial",
                    message="Live HTTP source loaded as workflow items",
                    batch=_node_batch_reference(
                        body.project.id,
                        run_id,
                        node,
                        item_count=len(live_items),
                    ),
                    details={
                        "bindingId": SOURCE_FETCH_BINDING_ID,
                        "itemCount": len(live_items),
                        "outputPort": "items[]",
                        "method": live_result.method,
                        "statusCode": live_result.status_code,
                        "url": live_result.url,
                        "resultPath": live_result.result_path,
                        "lineage": _lineage_pointer(node),
                    },
                )
                emitter.emit(node, "completed", message="Live HTTP source completed")
                continue

            reason = _source_fetch_block_reason(node, body.project.agentPermissions)
            emitter.emit(
                node,
                "blocked",
                message=reason.message,
                block_reason=reason,
            )
            for ancestor_id in _package_ancestor_ids(node):
                blocked_by_package.setdefault(ancestor_id, []).append(reason)
            continue

        if _is_turbopush_publish_node(node):
            if not body.project.agentPermissions.canSendNotifications:
                reason = WorkflowRunBlockReason(
                    code="send_permission_required",
                    message=(
                        "TurboPush Publish is bound, but workflow "
                        "agentPermissions.canSendNotifications is false."
                    ),
                    source="workflow_permissions",
                    details={
                        "nodeId": node.id,
                        "requiredPermission": "canSendNotifications",
                    },
                )
                emitter.emit(
                    node,
                    "blocked",
                    message=reason.message,
                    block_reason=reason,
                )
                continue

            binding = _read_dict(node.runtime.get("binding"))
            binding_input = _read_dict(binding.get("input"))
            emitter.emit(node, "started", message="TurboPush publish binding started")
            try:
                result = execute_turbopush_publish(binding_input)
            except TurboPushPublishError as exc:
                reason = WorkflowRunBlockReason(
                    code=exc.code,
                    message=exc.message,
                    source="turbopush_runtime",
                    details=exc.details,
                )
                emitter.emit(
                    node,
                    "blocked" if exc.status == "blocked" else "failed",
                    message=exc.message,
                    block_reason=reason,
                )
                continue

            emitter.emit(
                node,
                "partial",
                message="TurboPush publish SSE result received",
                details={
                    "bindingId": TURBOPUSH_BINDING_ID,
                    **result,
                },
            )
            emitter.emit(node, "completed", message="TurboPush publish completed")
            continue

        if _is_workflow_notify_node(node) or _is_webhook_notify_node(node):
            reason = _notify_send_block_reason(
                node,
                body.project.agentPermissions,
                outputs_by_node=outputs_by_node,
            )
            if reason is not None:
                emitter.emit(node, "started", message="Workflow notification binding started")
                emitter.emit(
                    node,
                    "blocked",
                    message=reason.message,
                    block_reason=reason,
                )
                continue

        if _is_first_loop_native_node(node):
            try:
                details, output_items = await _execute_native_node(
                    node,
                    outputs_by_node,
                    run_id,
                    workflow_id=body.project.id,
                    session=session,
                    runtime_nodes_by_id=runtime_nodes_by_id,
                    materialized_source_tasks=materialized_source_tasks,
                )
            except WorkflowWebhookDeliveryError as exc:
                reason = WorkflowRunBlockReason(
                    code=exc.code,
                    message=exc.message,
                    source="workflow_webhook_delivery",
                    details=exc.details,
                )
                emitter.emit(
                    node,
                    "failed",
                    message=exc.message,
                    block_reason=reason,
                    details=reason.details,
                )
                continue
            outputs_by_node[node.id] = output_items
            emitter.emit(node, "started", message=_native_node_started_message(node))
            if _binding_id(node) == EXTERNAL_TOOL_BINDING_ID:
                emitter.emit(
                    node,
                    "tool_call_started",
                    message="OpenCLI Tool Capability call started",
                    details=_tool_call_trace_details(details),
                )
            emitter.emit(
                node,
                "partial",
                message=_native_node_partial_message(node),
                batch=(
                    _node_batch_reference(
                        body.project.id,
                        run_id,
                        node,
                        item_count=int(details.get("inputItemCount", 0)),
                        record_count=len(output_items),
                    )
                    if _binding_id(node) == NORMALIZE_BINDING_ID
                    else None
                ),
                details=details,
            )
            if _binding_id(node) == EXTERNAL_TOOL_BINDING_ID:
                emitter.emit(
                    node,
                    "tool_call_completed",
                    message="OpenCLI Tool Capability call completed",
                    details=_tool_call_trace_details(details),
                )
            emitter.emit(node, "completed", message=_native_node_completed_message(node))
            continue

        dispatch = dispatches_by_node.get(node.id)
        if dispatch is None:
            outputs_by_node.setdefault(node.id, [])
            emitter.emit(node, "started", message="Node started")
            emitter.emit(node, "completed", message="Node completed")
            continue

        emitter.emit(node, "started", message="OpenCLI source dispatch started")
        fleet_match = await _match_dispatch_fleet_target(
            dispatch,
            node,
            session=session,
        )
        fleet_match_details = _fleet_match_trace_details(fleet_match)
        resource_requirement, resource_resolution = resolve_runtime_resources(
            dispatch,
            node,
            fleet_match,
        )
        resource_details = {
            "resourceRequirement": resource_requirement.model_dump(
                mode="json",
                exclude_none=True,
            ),
            "resourceResolution": resource_resolution.model_dump(
                mode="json",
                exclude_none=True,
            ),
        }
        if fleet_match_details:
            emitter.events[-1].details["fleetMatch"] = fleet_match_details
        emitter.events[-1].details.update(resource_details)

        if resource_resolution.status == "blocked":
            reason = resource_resolution.blockReason
            assert reason is not None
            emitter.emit(
                node,
                "blocked",
                message=reason.message,
                block_reason=reason,
                details=resource_details,
            )
            for ancestor_id in _package_ancestor_ids(node):
                blocked_by_package.setdefault(ancestor_id, []).append(reason)
            outputs_by_node[node.id] = []
            continue

        output_items, agent_dispatch_details = await _dispatch_opencli_source_to_fleet(
            dispatch,
            fleet_match,
        )
        batch = _batch_reference(body.project.id, run_id, dispatch)
        if output_items:
            batch = batch.model_copy(update={"itemCount": len(output_items)})
        dispatch_trace_details = {
            **({"fleetMatch": fleet_match_details} if fleet_match_details else {}),
            **resource_details,
            **({"agentDispatch": agent_dispatch_details} if agent_dispatch_details else {}),
        }
        emitter.emit(
            node,
            "batch_ready",
            message="OpenCLI batch reference ready",
            batch=batch,
            details={
                "functionId": OPENCLI_FUNCTION_ID,
                "worker": OPENCLI_WORKER,
                **dispatch_trace_details,
            },
        )
        if agent_dispatch_details and agent_dispatch_details.get("success") is False:
            reason = WorkflowRunBlockReason(
                code="fleet_agent_dispatch_failed",
                message=str(agent_dispatch_details.get("error") or "Fleet agent dispatch failed"),
                source="workflow_fleet",
                details={
                    "adapterTaskId": dispatch.taskId,
                    "sourceGroup": dispatch.sourceGroup,
                    "agentDispatch": agent_dispatch_details,
                    **({"fleetMatch": fleet_match_details} if fleet_match_details else {}),
                },
            )
            emitter.emit(
                node,
                "failed",
                message="OpenCLI source dispatch failed on selected fleet agent",
                block_reason=reason,
                details=reason.details,
            )
            for ancestor_id in _package_ancestor_ids(node):
                blocked_by_package.setdefault(ancestor_id, []).append(reason)
            outputs_by_node[node.id] = []
            continue

        emitter.emit(
            node,
            "partial",
            message=(
                "OpenCLI source items collected through selected fleet agent"
                if agent_dispatch_details
                else "OpenCLI dispatch envelope is ready for worker fanout"
            ),
            details={
                "adapterTaskId": dispatch.taskId,
                "sourceGroup": dispatch.sourceGroup,
                "itemCount": len(output_items),
                "outputPort": "items[]",
                **dispatch_trace_details,
            },
        )
        emitter.emit(
            node,
            "completed",
            message=(
                "OpenCLI source dispatch completed through selected fleet agent"
                if agent_dispatch_details
                else "OpenCLI source dispatch completed"
            ),
        )
        outputs_by_node[node.id] = output_items

    for package_node in reversed(package_nodes):
        trace_errors = [
            error
            for error in (trace.errors if trace else [])
            if error.node_id in {None, package_node.id}
        ]
        if trace_errors:
            emitter.emit(
                package_node,
                "blocked",
                message=trace_errors[0].message,
                block_reason=_reason_from_compile_error(trace_errors[0]),
            )
            continue

        internal_reasons = blocked_by_package.get(package_node.id, [])
        if internal_reasons:
            emitter.emit(
                package_node,
                "partial",
                message="Package produced partial source results before an internal block",
            )
            emitter.emit(
                package_node,
                "blocked",
                message="Package has blocked internal runtime nodes",
                block_reason=WorkflowRunBlockReason(
                    code="internal_node_blocked",
                    message="Package has blocked internal runtime nodes",
                    source="workflow_runtime",
                    details={
                        "blockedReasons": [
                            reason.model_dump(mode="json") for reason in internal_reasons
                        ],
                    },
                ),
            )
            continue

        emitter.emit(package_node, "completed", message="Package node completed")

    events = [*prior_events, *emitter.events]
    projection = _build_projection(
        workflow_id=body.project.id,
        run_id=run_id,
        trace_id=trace_id,
        package_node_id=(trace.packageNodeId if trace else None) or body.packageNodeId,
        started_at=started_at,
        valid=trace.valid if trace else True,
        errors=trace.errors if trace else [],
        runtime_nodes=runtime_nodes,
        events=events,
    )
    await _store_workflow_run(
        run_id,
        request=body,
        projection=projection,
        events=events,
        session=session,
    )
    return projection


async def get_workflow_run_projection(
    run_id: str,
    *,
    session: AsyncSession | None = None,
) -> WorkflowRunProjection | None:
    stored = _RUNS.get(run_id)
    if stored:
        return stored.projection
    stored = await _load_workflow_run(run_id, session=session)
    return stored.projection if stored else None


async def list_workflow_run_events(
    run_id: str,
    *,
    session: AsyncSession | None = None,
    after_sequence: int | None = None,
    node_id: str | None = None,
    event_type: WorkflowNodeRunEventType | None = None,
    limit: int | None = None,
) -> list[WorkflowNodeRunEvent] | None:
    stored = _RUNS.get(run_id)
    if not stored:
        stored = await _load_workflow_run(run_id, session=session)
    if not stored:
        return None
    events = _filter_workflow_run_events(
        stored.events,
        after_sequence=after_sequence,
        node_id=node_id,
        event_type=event_type,
        limit=limit,
    )
    return events


async def get_workflow_run_checkpoint(
    run_id: str,
    *,
    session: AsyncSession | None = None,
) -> WorkflowRunCheckpoint | None:
    stored = _RUNS.get(run_id) or await _load_workflow_run(run_id, session=session)
    if stored is None:
        return None
    return _build_checkpoint(stored.request, stored.projection, stored.events)


async def continue_workflow_run_with_source_outputs(
    run_id: str,
    body: WorkflowRunSourceOutputsRequest,
    *,
    session: AsyncSession | None = None,
) -> WorkflowRunProjection | None:
    stored = _RUNS.get(run_id) or await _load_workflow_run(run_id, session=session)
    if stored is None:
        return None

    merged_outputs = _merge_source_outputs(
        stored.request.sourceOutputs,
        body.sourceOutputs,
    )
    request = stored.request.model_copy(
        update={
            "runId": run_id,
            "traceId": stored.projection.traceId,
            "sourceOutputs": merged_outputs,
        },
        deep=True,
    )
    return await start_workflow_run(
        request,
        session=session,
        existing_events=stored.events,
    )


async def _store_workflow_run(
    run_id: str,
    *,
    request: WorkflowRunStartRequest,
    projection: WorkflowRunProjection,
    events: list[WorkflowNodeRunEvent],
    session: AsyncSession | None,
) -> None:
    stored = _StoredWorkflowRun(request, projection, list(events))
    _RUNS[run_id] = stored
    if session is not None:
        row = await session.get(WorkflowRunRow, run_id)
        if row is None:
            row = WorkflowRunRow(id=run_id)
            session.add(row)

        row.workflow_id = projection.workflowId
        row.trace_id = projection.traceId
        row.status = projection.status
        row.valid = projection.valid
        row.package_node_id = projection.packageNodeId
        row.request = request.model_dump(mode="json")
        row.projection = projection.model_dump(mode="json")

        existing_events = (
            await session.execute(
                select(WorkflowRunEventRow).where(WorkflowRunEventRow.run_id == run_id)
            )
        ).scalars()
        for event_row in existing_events:
            await session.delete(event_row)

        for event in events:
            session.add(
                WorkflowRunEventRow(
                    run_id=run_id,
                    workflow_id=event.workflowId,
                    trace_id=event.traceId,
                    event_id=event.id,
                    node_id=event.nodeId,
                    sequence=event.sequence,
                    event_type=event.eventType,
                    payload=event.model_dump(mode="json"),
                )
            )
        await session.flush()

    await publish_workflow_run_event_mirror(events)


async def _load_workflow_run(
    run_id: str,
    *,
    session: AsyncSession | None,
) -> _StoredWorkflowRun | None:
    if session is None:
        return None

    row = await session.get(WorkflowRunRow, run_id)
    if row is None:
        return None

    event_rows = (
        (
            await session.execute(
                select(WorkflowRunEventRow)
                .where(WorkflowRunEventRow.run_id == run_id)
                .order_by(WorkflowRunEventRow.sequence)
            )
        )
        .scalars()
        .all()
    )
    stored = _StoredWorkflowRun(
        request=WorkflowRunStartRequest.model_validate(row.request),
        projection=WorkflowRunProjection.model_validate(row.projection),
        events=[WorkflowNodeRunEvent.model_validate(event_row.payload) for event_row in event_rows],
    )
    _RUNS[run_id] = stored
    return stored


def _merge_source_outputs(
    existing: dict[str, list[dict[str, Any]]],
    incoming: dict[str, list[dict[str, Any]]],
) -> dict[str, list[dict[str, Any]]]:
    merged = {node_id: [dict(item) for item in items] for node_id, items in existing.items()}
    for node_id, items in incoming.items():
        merged.setdefault(node_id, []).extend(dict(item) for item in items)
    return merged


def _filter_workflow_run_events(
    events: list[WorkflowNodeRunEvent],
    *,
    after_sequence: int | None,
    node_id: str | None,
    event_type: WorkflowNodeRunEventType | None,
    limit: int | None,
) -> list[WorkflowNodeRunEvent]:
    filtered = [
        event
        for event in events
        if (after_sequence is None or event.sequence > after_sequence)
        and (node_id is None or event.nodeId == node_id)
        and (event_type is None or event.eventType == event_type)
    ]
    if limit is not None:
        filtered = filtered[:limit]
    return list(filtered)


def _build_checkpoint(
    request: WorkflowRunStartRequest,
    projection: WorkflowRunProjection,
    events: list[WorkflowNodeRunEvent],
) -> WorkflowRunCheckpoint:
    source_outputs = request.sourceOutputs
    source_output_node_ids = sorted(source_outputs)
    source_output_item_count = sum(len(items) for items in source_outputs.values())
    last_sequence = max((event.sequence for event in events), default=0)
    checkpoint_id = f"{projection.runId}:{last_sequence:04d}"
    return WorkflowRunCheckpoint(
        checkpointId=checkpoint_id,
        workflowId=projection.workflowId,
        runId=projection.runId,
        traceId=projection.traceId,
        status=projection.status,
        valid=projection.valid,
        eventCount=projection.eventCount,
        lastSequence=last_sequence,
        updatedAt=projection.updatedAt,
        nodeStates=projection.nodeStates,
        sourceOutputNodeIds=source_output_node_ids,
        sourceOutputItemCount=source_output_item_count,
        canContinueWithSourceOutputs=True,
        continuationPath=f"/api/v1/workflows/runs/{projection.runId}/source-outputs",
        tracePath=f"/api/v1/workflows/runs/{projection.runId}/trace",
    )


class _WorkflowRunEventEmitter:
    def __init__(
        self,
        *,
        workflow_id: str,
        run_id: str,
        trace_id: str,
        source_id: str | None = None,
        initial_sequence: int = 0,
    ) -> None:
        self._workflow_id = workflow_id
        self._run_id = run_id
        self._trace_id = trace_id
        self._source_id = source_id
        self._initial_sequence = initial_sequence
        self.events: list[WorkflowNodeRunEvent] = []

    def emit(
        self,
        node: CompiledWorkflowNode,
        event_type: WorkflowNodeRunEventType,
        *,
        message: str | None = None,
        block_reason: WorkflowRunBlockReason | None = None,
        batch: WorkflowRunBatchReference | None = None,
        details: dict[str, object] | None = None,
    ) -> None:
        sequence = self._initial_sequence + len(self.events) + 1
        node_path = _compiled_node_path(node)
        package_node_id, internal_node_id = _legacy_location_from_node_path(node_path)
        source_group = _read_string(node.params.get("sourceGroup")) or _read_string(
            node.params.get("source_group")
        )
        if batch and batch.sourceGroup:
            source_group = batch.sourceGroup

        self.events.append(
            WorkflowNodeRunEvent(
                id=f"{self._run_id}:{sequence:04d}:{event_type}:{node.id}",
                sequence=sequence,
                workflowId=self._workflow_id,
                workflowRunId=self._run_id,
                traceId=self._trace_id,
                nodeId=node.id,
                sourceId=self._source_id,
                eventType=event_type,
                createdAt=_utcnow(),
                nodePath=node_path,
                packageNodeId=package_node_id,
                internalNodeId=internal_node_id,
                sourceGroup=source_group,
                message=message,
                blockReason=block_reason,
                batch=batch,
                details=details or {},
            )
        )


def _build_projection(
    *,
    workflow_id: str,
    run_id: str,
    trace_id: str,
    package_node_id: str | None,
    started_at: str,
    valid: bool,
    errors: list[WorkflowCompileError],
    runtime_nodes: list[CompiledWorkflowNode],
    events: list[WorkflowNodeRunEvent],
) -> WorkflowRunProjection:
    states: dict[str, WorkflowRunNodeState] = {}
    ordered_ids: list[str] = []
    for node in runtime_nodes:
        node_path = _compiled_node_path(node)
        package_parent_id, internal_node_id = _legacy_location_from_node_path(node_path)
        states[node.id] = WorkflowRunNodeState(
            nodeId=node.id,
            status="queued",
            nodePath=node_path,
            packageNodeId=package_parent_id,
            internalNodeId=internal_node_id,
        )
        ordered_ids.append(node.id)

    for event in events:
        state = states.setdefault(
            event.nodeId,
            WorkflowRunNodeState(
                nodeId=event.nodeId,
                nodePath=event.nodePath,
                packageNodeId=event.packageNodeId,
                internalNodeId=event.internalNodeId,
            ),
        )
        if event.nodeId not in ordered_ids:
            ordered_ids.append(event.nodeId)
        state.latestEventId = event.id
        state.eventCount += 1
        state.status = _status_after_event(event.eventType)
        if event.sourceGroup and event.sourceGroup not in state.sourceGroups:
            state.sourceGroups.append(event.sourceGroup)
        if event.blockReason:
            state.blockReasons.append(event.blockReason)
        if event.batch:
            if all(batch.batchId != event.batch.batchId for batch in state.batches):
                state.batches.append(event.batch)

    node_states = [states[node_id] for node_id in ordered_ids]
    status = _run_status(node_states, valid, runtime_nodes)
    updated_at = events[-1].createdAt if events else started_at
    return WorkflowRunProjection(
        workflowId=workflow_id,
        runId=run_id,
        traceId=trace_id,
        valid=valid,
        status=status,
        packageNodeId=package_node_id,
        startedAt=started_at,
        updatedAt=updated_at,
        eventCount=len(events),
        nodeStates=node_states,
        errors=errors,
    )


def _compile_failure_events(
    *,
    workflow_id: str,
    run_id: str,
    trace_id: str,
    errors: list[WorkflowCompileError],
) -> list[WorkflowNodeRunEvent]:
    events: list[WorkflowNodeRunEvent] = []
    for error in errors:
        if not error.node_id:
            continue
        sequence = len(events) + 1
        events.append(
            WorkflowNodeRunEvent(
                id=f"{run_id}:{sequence:04d}:failed:{error.node_id}",
                sequence=sequence,
                workflowId=workflow_id,
                workflowRunId=run_id,
                traceId=trace_id,
                nodeId=error.node_id,
                eventType="failed",
                createdAt=_utcnow(),
                message=error.message,
                blockReason=_reason_from_compile_error(error),
                details={
                    "edgeId": error.edge_id,
                    "path": error.path,
                },
            )
        )
    return events


def _batch_reference(
    workflow_id: str,
    run_id: str,
    dispatch: WorkflowOpenCLIHDATraceDispatch,
) -> WorkflowRunBatchReference:
    batch_id = str(
        uuid.uuid5(
            uuid.NAMESPACE_URL,
            f"opencli-admin/workflow/{workflow_id}/run/{run_id}/batch/{dispatch.taskId}",
        )
    )
    return WorkflowRunBatchReference(
        batchId=batch_id,
        itemCount=0,
        recordCount=0,
        sourceGroup=dispatch.sourceGroup,
        adapterTaskId=dispatch.taskId,
        odpRef=(
            f"odp://workflow-runs/{run_id}/nodes/{dispatch.nodeId}"
            f"/sources/{dispatch.sourceGroup}/batches/{batch_id}"
        ),
        manifestUri=f"/api/v1/workflows/runs/{run_id}/evidence-batches/{batch_id}",
    )


def _node_batch_reference(
    workflow_id: str,
    run_id: str,
    node: CompiledWorkflowNode,
    *,
    item_count: int,
    record_count: int = 0,
    adapter_task_id: str | None = None,
) -> WorkflowRunBatchReference:
    source_group = _source_group(node, node.id)
    batch_id = str(
        uuid.uuid5(
            uuid.NAMESPACE_URL,
            f"opencli-admin/workflow/{workflow_id}/run/{run_id}/batch/{node.id}",
        )
    )
    return WorkflowRunBatchReference(
        batchId=batch_id,
        itemCount=item_count,
        recordCount=record_count,
        sourceGroup=source_group,
        adapterTaskId=adapter_task_id,
        odpRef=(
            f"odp://workflow-runs/{run_id}/nodes/{node.id}"
            f"/sources/{source_group}/batches/{batch_id}"
        ),
        manifestUri=f"/api/v1/workflows/runs/{run_id}/evidence-batches/{batch_id}",
    )


async def _match_dispatch_fleet_target(
    dispatch: WorkflowOpenCLIHDATraceDispatch,
    node: CompiledWorkflowNode,
    *,
    session: AsyncSession | None,
) -> WorkflowFleetCapabilityMatchResponse | None:
    if session is None:
        return None

    adapter_node_id = _read_string(node.params.get("opencliAdapterNodeId"))
    if adapter_node_id:
        from backend.workflow.opencli_adapter_nodes import resolve_opencli_adapter_node

        adapter_node = resolve_opencli_adapter_node(adapter_node_id)
        if adapter_node is not None and not adapter_node.browser:
            # Public/non-browser commands are safest and fastest on the local OpenCLI
            # runtime. Browser-backed commands continue through fleet/profile matching.
            return None
    request = WorkflowFleetCapabilityMatchRequest(
        adapterNodeId=adapter_node_id,
        site=None if adapter_node_id else dispatch.site,
        command=None if adapter_node_id else dispatch.command,
    )
    return await match_workflow_fleet_capability(session, request)


def _fleet_match_trace_details(
    match: WorkflowFleetCapabilityMatchResponse | None,
) -> dict[str, Any] | None:
    if match is None:
        return None
    return match.model_dump(mode="json", exclude_none=True)


async def _dispatch_opencli_source_to_fleet(
    dispatch: WorkflowOpenCLIHDATraceDispatch,
    match: WorkflowFleetCapabilityMatchResponse | None,
) -> tuple[list[dict[str, Any]], dict[str, object] | None]:
    target = _fleet_agent_dispatch_target(dispatch, match)
    if target is None:
        if dispatch.packageNodeId is not None:
            # Packaged HDA fanout retains its asynchronous worker-envelope
            # contract when no concrete fleet target was selected.
            return [], None
        from backend.channels.opencli_channel import OpenCLIChannel

        payload = _read_dict(dispatch.iii.get("payload"))
        config: dict[str, Any] = {
            "site": dispatch.site,
            "command": dispatch.command,
            "format": _read_string(payload.get("format")) or "json",
            "args": dispatch.args,
        }
        positional_args = payload.get("positional_args", payload.get("positionalArgs"))
        if isinstance(positional_args, list):
            config["positional_args"] = positional_args
        result = await OpenCLIChannel().collect(config, {})
        details: dict[str, object] = {
            "attempted": True,
            "protocol": "local",
            "mode": "direct",
            "site": dispatch.site,
            "command": dispatch.command,
            "format": config["format"],
            "success": result.success,
            "itemCount": len(result.items) if result.success else 0,
        }
        if result.error:
            details["error"] = result.error
        if result.error_type:
            details["errorType"] = result.error_type
        if result.metadata:
            details["metadata"] = result.metadata
        return (result.items if result.success else []), details

    from backend.channels.opencli_channel import _collect_via_agent, _collect_via_ws_agent

    agent_url = str(target["agentUrl"])
    protocol = str(target["protocol"])
    mode = str(target["mode"])
    output_format = str(target["format"])
    positional_args = target["positionalArgs"]
    if not isinstance(positional_args, list):
        positional_args = []
    positional_args = [str(item) for item in positional_args]

    details: dict[str, object] = {
        "attempted": True,
        "protocol": protocol,
        "agentUrl": agent_url,
        "endpoint": target["endpoint"],
        "mode": mode,
        "site": dispatch.site,
        "command": dispatch.command,
        "format": output_format,
    }
    try:
        if protocol == "ws":
            result = await _collect_via_ws_agent(
                agent_url,
                dispatch.site,
                dispatch.command,
                dispatch.args,
                positional_args,
                output_format,
                mode,
            )
        else:
            result = await _collect_via_agent(
                agent_url,
                dispatch.site,
                dispatch.command,
                dispatch.args,
                positional_args,
                output_format,
                mode,
            )
    except Exception as exc:
        details.update(
            {
                "success": False,
                "itemCount": 0,
                "error": str(exc),
                "errorType": type(exc).__name__,
            }
        )
        return [], details

    details.update(
        {
            "success": result.success,
            "itemCount": len(result.items) if result.success else 0,
        }
    )
    if result.error:
        details["error"] = result.error
    if result.error_type:
        details["errorType"] = result.error_type
    if result.metadata:
        details["metadata"] = result.metadata
    return (result.items if result.success else []), details


def _fleet_agent_dispatch_target(
    dispatch: WorkflowOpenCLIHDATraceDispatch,
    match: WorkflowFleetCapabilityMatchResponse | None,
) -> dict[str, object] | None:
    if match is None or not match.matched or match.selected is None:
        return None
    selected = match.selected
    protocol = (selected.agentProtocol or "").lower()
    if protocol not in {"http", "ws"}:
        return None
    agent_url = (selected.agentUrl or selected.endpoint or "").rstrip("/")
    if not agent_url:
        return None
    payload = _read_dict(dispatch.iii.get("payload"))
    positional_args = payload.get("positional_args", payload.get("positionalArgs"))
    if not isinstance(positional_args, list):
        positional_args = []
    return {
        "endpoint": selected.endpoint,
        "agentUrl": agent_url,
        "protocol": protocol,
        "mode": _read_string(payload.get("mode")) or selected.mode or "cdp",
        "format": _read_string(payload.get("format")) or "json",
        "positionalArgs": positional_args,
    }


def _reason_from_compile_error(error: WorkflowCompileError) -> WorkflowRunBlockReason:
    return WorkflowRunBlockReason(
        code=error.code,
        message=error.message,
        source="workflow_compile",
        details=error.model_dump(mode="json"),
    )


def _status_after_event(event_type: WorkflowNodeRunEventType) -> WorkflowRunStatus:
    if event_type == "started":
        return "running"
    if event_type in {"batch_ready", "tool_call_started", "tool_call_completed"}:
        return "partial"
    if event_type == "failed":
        return "failed"
    if event_type in {"blocked", "partial", "completed", "queued"}:
        return event_type
    return "partial"


def _run_status(
    node_states: list[WorkflowRunNodeState],
    valid: bool,
    runtime_nodes: list[CompiledWorkflowNode] | None = None,
) -> WorkflowRunStatus:
    if not valid:
        return "failed"
    statuses = {state.status for state in node_states}
    if runtime_nodes:
        terminal_ids = {node.id for node in runtime_nodes if _is_builder_output(node)}
        terminal_statuses = {
            state.status for state in node_states if state.nodeId in terminal_ids
        }
        if (
            len(terminal_ids) > 1
            and len(terminal_statuses) == len(terminal_ids)
            and terminal_statuses <= {"completed", "failed", "blocked"}
            and "completed" in terminal_statuses
            and terminal_statuses.intersection({"failed", "blocked"})
        ):
            return "partial_success"
    if "failed" in statuses:
        return "failed"
    if "blocked" in statuses:
        return "blocked"
    if "running" in statuses or "partial" in statuses:
        return "partial"
    if statuses and statuses <= {"completed"}:
        return "completed"
    return "queued"


def _is_builder_output(node: CompiledWorkflowNode) -> bool:
    builder = _read_dict(node.params.get("builder"))
    return _read_string(builder.get("nodeType")) in {
        "records-output",
        "email-output",
        "webhook-output",
    }


def _select_runtime_nodes_for_trigger(
    nodes: list[CompiledWorkflowNode],
    *,
    trigger_kind: str,
    trigger_node_id: str | None,
) -> tuple[list[CompiledWorkflowNode], WorkflowCompileError | None]:
    """Select one trigger entry and its reachable subgraph for an independent Run."""

    trigger_nodes = [node for node in nodes if _runtime_trigger_kind(node) is not None]
    if not trigger_nodes:
        return nodes, None

    selected: CompiledWorkflowNode | None = None
    if trigger_node_id:
        selected = next((node for node in nodes if node.id == trigger_node_id), None)
        if selected is None:
            return [], WorkflowCompileError(
                code="workflow_trigger_not_found",
                message=f'Workflow trigger node "{trigger_node_id}" was not found.',
                node_id=trigger_node_id,
                path=["trigger", "triggerNodeId"],
            )
        selected_kind = _runtime_trigger_kind(selected)
        if selected_kind is None:
            return [], WorkflowCompileError(
                code="unsupported_workflow_trigger",
                message=f'Node "{trigger_node_id}" is not a workflow trigger entry.',
                node_id=trigger_node_id,
                path=["trigger", "triggerNodeId"],
            )
        requested_kind = "manual" if trigger_kind == "ai" else trigger_kind
        if selected_kind != requested_kind:
            return [], WorkflowCompileError(
                code="workflow_trigger_kind_mismatch",
                message=(
                    f'Workflow trigger node "{trigger_node_id}" is "{selected_kind}", '
                    f'not "{trigger_kind}".'
                ),
                node_id=trigger_node_id,
                path=["trigger", "kind"],
            )
    else:
        requested_kind = "manual" if trigger_kind == "ai" else trigger_kind
        candidates = [
            node for node in trigger_nodes if _runtime_trigger_kind(node) == requested_kind
        ]
        if len(candidates) == 1:
            selected = candidates[0]
        elif len(candidates) > 1:
            return [], WorkflowCompileError(
                code="workflow_trigger_ambiguous",
                message=(
                    f'Workflow has multiple "{trigger_kind}" trigger entries; '
                    "triggerNodeId is required."
                ),
                path=["trigger", "triggerNodeId"],
            )
        else:
            return [], WorkflowCompileError(
                code="workflow_trigger_kind_mismatch",
                message=f'Workflow has no "{trigger_kind}" trigger entry.',
                path=["trigger", "kind"],
            )

    adjacency: dict[str, list[str]] = {node.id: [] for node in nodes}
    for node in nodes:
        for dependency_id in node.depends_on:
            adjacency.setdefault(dependency_id, []).append(node.id)

    active_ids = {selected.id}
    pending = [selected.id]
    while pending:
        current_id = pending.pop()
        for downstream_id in adjacency.get(current_id, []):
            if downstream_id not in active_ids:
                active_ids.add(downstream_id)
                pending.append(downstream_id)

    # External-runtime imports predate trigger-scoped execution and are
    # intentionally represented as governed OpenCLI nodes rather than opaque
    # executors. Their imported subgraph is not yet wired to the host trigger,
    # so keep explicitly marked externalWorkflow nodes runnable while ordinary
    # disconnected/orphan nodes remain excluded.
    active_ids.update(
        node.id
        for node in nodes
        if isinstance(node.params.get("externalWorkflow"), dict)
    )

    selected_nodes = [
        node.model_copy(
            update={
                "depends_on": [
                    dependency_id
                    for dependency_id in node.depends_on
                    if dependency_id in active_ids
                ]
            }
        )
        for node in nodes
        if node.id in active_ids
    ]
    return selected_nodes, None


def _runtime_trigger_kind(node: CompiledWorkflowNode) -> str | None:
    binding_id = _binding_id(node)
    if binding_id == WEBHOOK_TRIGGER_BINDING_ID:
        return "webhook"
    if binding_id != SCHEDULE_TRIGGER_BINDING_ID:
        return None

    builder = _read_dict(node.params.get("builder"))
    node_type = _read_string(builder.get("nodeType"))
    mode = _read_string(node.params.get("mode"))
    return "manual" if node_type == "manual-trigger" or mode == "manual" else "schedule"


def _select_package_id(
    nodes: list[CompiledWorkflowNode],
    package_node_id: str | None,
) -> str | None:
    if package_node_id:
        return (
            package_node_id
            if any(node.id == package_node_id and node.package is not None for node in nodes)
            else None
        )

    package_ids = {
        str(node.runtime.get("package_parent_id"))
        for node in nodes
        if _is_opencli_internal_source(node, str(node.runtime.get("package_parent_id")))
    }
    package_ids.discard("")
    package_ids.discard("None")
    return sorted(package_ids)[0] if len(package_ids) == 1 else None


def _is_opencli_internal_source(node: CompiledWorkflowNode, package_node_id: str | None) -> bool:
    if not package_node_id or node.runtime.get("package_parent_id") != package_node_id:
        return False
    binding = node.runtime.get("binding")
    return isinstance(binding, dict) and binding.get("function_id") == OPENCLI_FUNCTION_ID


def _is_turbopush_publish_node(node: CompiledWorkflowNode) -> bool:
    binding = node.runtime.get("binding")
    return isinstance(binding, dict) and binding.get("binding_id") == TURBOPUSH_BINDING_ID


def _is_workflow_source_fetch_node(node: CompiledWorkflowNode) -> bool:
    return _binding_id(node) == SOURCE_FETCH_BINDING_ID


def _is_workflow_notify_node(node: CompiledWorkflowNode) -> bool:
    return _binding_id(node) == NOTIFY_SEND_BINDING_ID


def _is_webhook_notify_node(node: CompiledWorkflowNode) -> bool:
    return _binding_id(node) == WEBHOOK_NOTIFY_BINDING_ID


def _is_first_loop_native_node(node: CompiledWorkflowNode) -> bool:
    binding = node.runtime.get("binding")
    if not isinstance(binding, dict):
        return False
    return binding.get("binding_id") in {
        NORMALIZE_BINDING_ID,
        MERGE_BINDING_ID,
        ROUTER_ROUTE_BINDING_ID,
        RECORD_ACCEPTANCE_BINDING_ID,
        RECORD_SINK_BINDING_ID,
        INBOX_STORE_BINDING_ID,
        NOTIFY_SEND_BINDING_ID,
        WEBHOOK_NOTIFY_BINDING_ID,
        EXTERNAL_TOOL_BINDING_ID,
    }


def _fixture_source_items(node: CompiledWorkflowNode) -> list[dict[str, Any]]:
    raw_items = _read_dict_list(
        node.params.get("fixtureItems", node.params.get("sampleItems", node.params.get("items")))
    )
    if not raw_items:
        return []
    source_group = _source_group(node, node.id)
    return [
        {
            "raw": item,
            "lineage": [
                {
                    "nodeId": node.id,
                    "sourceGroup": source_group,
                    "artifact": "fixtureItems",
                    "index": index,
                }
            ],
        }
        for index, item in enumerate(raw_items)
    ]


def _request_source_items(
    node: CompiledWorkflowNode,
    source_outputs: dict[str, list[dict[str, Any]]],
) -> list[dict[str, Any]]:
    raw_items = _read_dict_list(source_outputs.get(node.id))
    if not raw_items:
        return []
    source_group = _source_group(node, node.id)
    return [
        {
            "raw": item,
            "lineage": [
                {
                    "nodeId": node.id,
                    "sourceGroup": source_group,
                    "artifact": "sourceOutputs",
                    "index": index,
                }
            ],
        }
        for index, item in enumerate(raw_items)
    ]


def _live_source_items(
    node: CompiledWorkflowNode,
    raw_items: list[dict[str, Any]],
    *,
    artifact: str = "live_http_source",
) -> list[dict[str, Any]]:
    source_group = _source_group(node, node.id)
    return [
        {
            "raw": item,
            "lineage": [
                {
                    "nodeId": node.id,
                    "sourceGroup": source_group,
                    "artifact": artifact,
                    "index": index,
                }
            ],
        }
        for index, item in enumerate(raw_items)
    ]


async def _bound_source_record_items(
    node: CompiledWorkflowNode,
    *,
    session: AsyncSession | None,
) -> list[dict[str, Any]]:
    if session is None:
        return []
    task_id = _bound_task_id(node)
    if not task_id:
        return []
    result = await session.execute(
        select(CollectedRecord)
        .where(CollectedRecord.task_id == task_id)
        .order_by(CollectedRecord.created_at, CollectedRecord.id)
    )
    records = result.scalars().all()
    source_group = _source_group(node, node.id)
    return [
        {
            "raw": dict(record.raw_data or {}),
            "normalizedData": dict(record.normalized_data or {}),
            "contentHash": record.content_hash,
            "recordId": record.id,
            "lineage": [
                {
                    "nodeId": node.id,
                    "sourceGroup": source_group,
                    "artifact": "collected_records",
                    "recordId": record.id,
                    "taskId": record.task_id,
                    "sourceId": record.source_id,
                    "index": index,
                }
            ],
        }
        for index, record in enumerate(records)
    ]


def _bound_task_id(node: CompiledWorkflowNode) -> str | None:
    return (
        _read_string(node.params.get("taskId"))
        or _read_string(node.params.get("collectionTaskId"))
        or _read_string(node.params.get("boundTaskId"))
    )


def _bound_source_id_from_items(items: list[dict[str, Any]]) -> str | None:
    for item in items:
        for entry in _read_dict_list(item.get("lineage")):
            source_id = _read_string(entry.get("sourceId"))
            if source_id:
                return source_id
    return None


async def _execute_native_node(
    node: CompiledWorkflowNode,
    outputs_by_node: dict[str, list[dict[str, Any]]],
    run_id: str,
    *,
    workflow_id: str,
    session: AsyncSession | None = None,
    runtime_nodes_by_id: dict[str, CompiledWorkflowNode] | None = None,
    materialized_source_tasks: dict[str, tuple[str, str]] | None = None,
) -> tuple[dict[str, object], list[dict[str, Any]]]:
    binding_id = _binding_id(node)
    input_items = _upstream_outputs(node, outputs_by_node)
    if binding_id == NORMALIZE_BINDING_ID:
        candidates = _normalize_runtime_items(node, input_items, run_id)
        return (
            {
                "bindingId": binding_id,
                "inputPort": "items[]",
                "outputPort": "recordCandidate[]",
                "inputItemCount": len(input_items),
                "recordCandidateCount": len(candidates),
                "lineage": _lineage_pointer(node),
            },
            candidates,
        )
    if binding_id == MERGE_BINDING_ID:
        binding = _read_dict(node.runtime.get("binding"))
        binding_input = _read_dict(binding.get("input"))
        merged = [_append_lineage(item, node, step="merge", run_id=run_id) for item in input_items]
        return (
            {
                "bindingId": binding_id,
                "strategy": binding_input.get("strategy", "concat"),
                "inputType": binding_input.get("inputType", "recordCandidate[]"),
                "outputType": binding_input.get("outputType", "recordCandidate[]"),
                "preserveLineage": binding_input.get("preserveLineage", True),
                "inputCandidateCount": len(input_items),
                "mergedCandidateCount": len(merged),
                "lineage": _lineage_pointer(node),
            },
            merged,
        )
    if binding_id == ROUTER_ROUTE_BINDING_ID:
        binding = _read_dict(node.runtime.get("binding"))
        binding_input = _read_dict(binding.get("input"))
        expression = _read_string(binding_input.get("expression")) or "true"
        routed = _route_runtime_items(node, input_items, run_id, expression=expression)
        return (
            {
                "bindingId": binding_id,
                "expression": expression,
                "inputType": binding_input.get("inputPort", "recordCandidate[]"),
                "outputType": binding_input.get("outputPort", "recordCandidate[]"),
                "inputCandidateCount": len(input_items),
                "routedCandidateCount": len(routed),
                "lineage": _lineage_pointer(node),
            },
            routed,
        )
    if binding_id == RECORD_ACCEPTANCE_BINDING_ID:
        binding = _read_dict(node.runtime.get("binding"))
        binding_input = _read_dict(binding.get("input"))
        accepted = [
            _accept_candidate(item, node, run_id=run_id)
            for item in input_items
            if _candidate_has_lineage(item) or binding_input.get("lineageRequired") is False
        ]
        review_required = len(input_items) - len(accepted)
        return (
            {
                "bindingId": binding_id,
                "schema": binding_input.get("schema", "record.v1"),
                "dedupe": binding_input.get("dedupe", "required"),
                "lineageRequired": binding_input.get("lineageRequired", True),
                "inputCandidateCount": len(input_items),
                "acceptedRecordCount": len(accepted),
                "reviewRequiredCount": review_required,
                "lineage": _lineage_pointer(node),
            },
            accepted,
        )
    if binding_id in {RECORD_SINK_BINDING_ID, INBOX_STORE_BINDING_ID}:
        binding = _read_dict(node.runtime.get("binding"))
        binding_input = _read_dict(binding.get("input"))
        target = (
            _read_string(binding_input.get("target"))
            or _read_string(binding_input.get("queue"))
            or "records"
        )
        stored_refs, skipped_count = await _store_record_sink_outputs(
            node,
            input_items,
            run_id=run_id,
            workflow_id=workflow_id,
            target=target,
            session=session,
            runtime_nodes_by_id=runtime_nodes_by_id or {},
            materialized_source_tasks=materialized_source_tasks or {},
        )
        return (
            {
                "bindingId": binding_id,
                "target": target,
                "writeMode": binding_input.get("writeMode", "append"),
                "inputRecordCount": len(input_items),
                "storedRecordCount": len(stored_refs),
                "skippedRecordCount": skipped_count,
                "storedRefs": stored_refs,
                "lineage": _lineage_pointer(node),
            },
            input_items,
        )
    if binding_id == NOTIFY_SEND_BINDING_ID:
        binding = _read_dict(node.runtime.get("binding"))
        binding_input = _read_dict(binding.get("input"))
        return (
            {
                "bindingId": binding_id,
                "notifierType": binding_input.get("notifier_type", "workflow"),
                "target": binding_input.get("target", "workflow"),
                "template": binding_input.get("template", "brief"),
                "deliveryConfigured": binding_input.get("delivery_configured", False),
                "inputItemCount": len(input_items),
                "lineage": _lineage_pointer(node),
            },
            input_items,
        )
    if binding_id == WEBHOOK_NOTIFY_BINDING_ID:
        binding = _read_dict(node.runtime.get("binding"))
        binding_input = _read_dict(binding.get("input"))
        delivery = await execute_workflow_webhook_delivery(
            binding_input,
            input_items,
            workflow_id=workflow_id,
            run_id=run_id,
            node_id=node.id,
        )
        return (
            {
                "bindingId": binding_id,
                **delivery,
                "lineage": _lineage_pointer(node),
            },
            input_items,
        )
    if binding_id == EXTERNAL_TOOL_BINDING_ID:
        binding = _read_dict(node.runtime.get("binding"))
        binding_input = _read_dict(binding.get("input"))
        output_items = _execute_external_tool_capability(
            node,
            input_items,
            run_id=run_id,
            binding_input=binding_input,
        )
        return (
            {
                "bindingId": binding_id,
                "toolCapabilityId": binding_input.get("toolCapabilityId"),
                "executorMode": binding_input.get("executorMode"),
                "inputItemCount": len(input_items),
                "outputItemCount": len(output_items),
                "outputPort": binding_input.get("outputPort", "unknown"),
                "sampleOutputs": [_trace_sample_output(item) for item in output_items[:3]],
                "externalWorkflow": binding_input.get("externalWorkflow", {}),
                "lineage": _lineage_pointer(node),
            },
            output_items,
        )
    return ({"bindingId": binding_id or "", "lineage": _lineage_pointer(node)}, [])


def _execute_external_tool_capability(
    node: CompiledWorkflowNode,
    input_items: list[dict[str, Any]],
    *,
    run_id: str,
    binding_input: dict[str, Any],
) -> list[dict[str, Any]]:
    if (
        binding_input.get("executorMode") == OKX_MARKET_TICKER_SNAPSHOT_EXECUTOR
        and binding_input.get("toolCapabilityId") == "tool.realtime.stream.subscribe"
    ):
        output = _execute_okx_market_tool(binding_input)
        return [_external_tool_output(node, output, input_items, run_id, 0, binding_input)]

    if (
        binding_input.get("executorMode") == JOYAI_VL_INTERACTION_EXECUTOR
        and binding_input.get("toolCapabilityId") == JOYAI_VL_TOOL_CAPABILITY_ID
    ):
        output = _execute_joyai_vl_tool(binding_input)
        return [_external_tool_output(node, output, input_items, run_id, 0, binding_input)]

    fixture_outputs = _read_dict_list(binding_input.get("fixtureOutputs"))
    fixture_output = _read_dict(binding_input.get("fixtureOutput"))
    if not fixture_outputs and fixture_output:
        fixture_outputs = [fixture_output]
    if not fixture_outputs:
        fixture_outputs = [{"inputItemCount": len(input_items)}]

    return [
        _external_tool_output(node, output, input_items, run_id, index, binding_input)
        for index, output in enumerate(fixture_outputs)
    ]


def _execute_okx_market_tool(binding_input: dict[str, Any]) -> dict[str, Any]:
    params = {
        **_read_dict(binding_input.get("executorParams")),
        **_read_dict(binding_input.get("toolParams")),
    }
    try:
        return execute_okx_market_ticker_snapshot(params)
    except RealtimeMarketExecutionError as exc:
        return {
            "schema": "event.market.ticker.error.v1",
            "source": "okx",
            "eventType": "market.ticker.error",
            "status": "error",
            "message": str(exc),
        }


def _execute_joyai_vl_tool(binding_input: dict[str, Any]) -> dict[str, Any]:
    params = {
        **_read_dict(binding_input.get("executorParams")),
        **_read_dict(binding_input.get("toolParams")),
    }
    try:
        return execute_joyai_vl_interaction(params)
    except JoyAIVLExecutionError as exc:
        return {
            "schema": "event.vl.interaction.error.v1",
            "source": "joyai-vl",
            "eventType": "vl.interaction.error",
            "status": "error",
            "message": str(exc),
        }


def _external_tool_output(
    node: CompiledWorkflowNode,
    output: dict[str, Any],
    input_items: list[dict[str, Any]],
    run_id: str,
    index: int,
    binding_input: dict[str, Any],
) -> dict[str, Any]:
    return {
        "raw": output,
        "normalizedData": output,
        "lineage": [
            *[lineage for item in input_items for lineage in _read_dict_list(item.get("lineage"))],
            {
                "nodeId": node.id,
                "step": "external_tool_capability",
                "runId": run_id,
                "toolCapabilityId": binding_input.get("toolCapabilityId"),
                "index": index,
            },
        ],
    }


def _trace_sample_output(item: dict[str, Any]) -> dict[str, Any]:
    raw = _read_dict(item.get("raw"))
    if not raw:
        return {}
    return {
        key: raw[key]
        for key in (
            "schema",
            "source",
            "channel",
            "instId",
            "eventType",
            "eventTime",
            "latencyMs",
            "market",
            "status",
            "message",
        )
        if key in raw
    }


def _tool_call_trace_details(details: dict[str, object]) -> dict[str, object]:
    return {
        "bindingId": details.get("bindingId"),
        "toolCapabilityId": details.get("toolCapabilityId"),
        "executorMode": details.get("executorMode"),
        "inputItemCount": details.get("inputItemCount"),
        "outputItemCount": details.get("outputItemCount"),
        "externalWorkflow": details.get("externalWorkflow", {}),
        "lineage": details.get("lineage", {}),
    }


async def _store_record_sink_outputs(
    node: CompiledWorkflowNode,
    input_items: list[dict[str, Any]],
    *,
    run_id: str,
    workflow_id: str,
    target: str,
    session: AsyncSession | None,
    runtime_nodes_by_id: dict[str, CompiledWorkflowNode],
    materialized_source_tasks: dict[str, tuple[str, str]],
) -> tuple[list[dict[str, Any]], int]:
    if session is None:
        return (
            [
                {
                    "recordId": _read_string(item.get("recordId"))
                    or _stable_id("record", run_id, node.id, str(index)),
                    "target": target,
                    "lineage": item.get("lineage", []),
                }
                for index, item in enumerate(input_items)
            ],
            0,
        )

    triples_by_source_node: dict[str, list[tuple[dict, dict, str, list[dict[str, Any]]]]] = {}
    for item in input_items:
        source_node_id = _origin_source_node_id(item, runtime_nodes_by_id)
        if not source_node_id:
            continue
        source_id, _task_id = await _materialize_source_task(
            session,
            runtime_nodes_by_id[source_node_id],
            run_id=run_id,
            workflow_id=workflow_id,
            sink_node_id=node.id,
            cache=materialized_source_tasks,
        )
        raw = dict(_read_dict(item.get("raw")))
        lineage = _read_dict_list(item.get("lineage"))
        raw["_workflowLineage"] = lineage
        raw["_workflowRunId"] = run_id
        raw["_workflowSinkNodeId"] = node.id
        normalized, content_hash = normalize_item(raw, source_id)
        accepted_normalized = _read_dict(item.get("normalizedData"))
        normalized.update(
            {key: value for key, value in accepted_normalized.items() if key not in {"source_id"}}
        )
        normalized["source_id"] = source_id
        triples_by_source_node.setdefault(source_node_id, []).append(
            (raw, normalized, content_hash, lineage)
        )

    stored_refs: list[dict[str, Any]] = []
    skipped_total = 0
    for source_node_id, triples_with_lineage in triples_by_source_node.items():
        source_id, task_id = await _materialize_source_task(
            session,
            runtime_nodes_by_id[source_node_id],
            run_id=run_id,
            workflow_id=workflow_id,
            sink_node_id=node.id,
            cache=materialized_source_tasks,
        )
        records, skipped = await store_records(
            session,
            task_id,
            source_id,
            [
                (raw, normalized, content_hash)
                for raw, normalized, content_hash, _lineage in triples_with_lineage
            ],
            channel_type=_workflow_source_channel_type(runtime_nodes_by_id[source_node_id]),
            forward_to_odp=False,
            workflow_id=workflow_id,
            workflow_run_id=run_id,
        )
        skipped_total += skipped
        for record, (_raw, _normalized, _content_hash, lineage) in zip(
            records, triples_with_lineage, strict=False
        ):
            stored_refs.append(
                {
                    "recordId": record.id,
                    "target": target,
                    "sourceId": source_id,
                    "taskId": task_id,
                    "lineage": lineage,
                }
            )

    await session.flush()
    return stored_refs, skipped_total


async def _materialize_source_task(
    session: AsyncSession,
    source_node: CompiledWorkflowNode,
    *,
    run_id: str,
    workflow_id: str,
    sink_node_id: str,
    cache: dict[str, tuple[str, str]],
) -> tuple[str, str]:
    cached = cache.get(source_node.id)
    if cached:
        return cached

    task_id = _read_string(source_node.params.get("taskId")) or _read_string(
        source_node.params.get("collectionTaskId")
    )
    if task_id:
        task = await session.get(CollectionTask, task_id)
        if task is not None:
            cache[source_node.id] = (task.source_id, task.id)
            return task.source_id, task.id

    source_id = _read_string(source_node.params.get("sourceId")) or _read_string(
        source_node.params.get("dataSourceId")
    )
    source = await session.get(DataSource, source_id) if source_id else None
    if source is None:
        source = DataSource(
            name=f"Workflow Source: {source_node.id}",
            description=("Materialized source ownership for a WorkflowProject Record Sink run."),
            channel_type=_workflow_source_channel_type(source_node),
            channel_config={
                "workflowId": workflow_id,
                "workflowRunId": run_id,
                "sourceNodeId": source_node.id,
                "adapter": _adapter_reference(source_node),
                "params": _json_safe(source_node.params),
            },
            enabled=True,
            tags=["workflow", "record-sink"],
        )
        session.add(source)
        await session.flush()

    task = CollectionTask(
        source_id=source.id,
        trigger_type="workflow",
        parameters={
            "workflowId": workflow_id,
            "workflowRunId": run_id,
            "sourceNodeId": source_node.id,
            "sinkNodeId": sink_node_id,
        },
        status="completed",
    )
    session.add(task)
    await session.flush()
    cache[source_node.id] = (source.id, task.id)
    return source.id, task.id


def _origin_source_node_id(
    item: dict[str, Any],
    runtime_nodes_by_id: dict[str, CompiledWorkflowNode],
) -> str | None:
    for entry in _read_dict_list(item.get("lineage")):
        node_id = _read_string(entry.get("nodeId"))
        if not node_id:
            continue
        node = runtime_nodes_by_id.get(node_id)
        if node and node.kind == "source":
            return node.id
    return None


def _workflow_source_channel_type(node: CompiledWorkflowNode) -> str:
    adapter = _read_string(node.adapter)
    binding = _read_dict(node.runtime.get("binding"))
    binding_input = _read_dict(binding.get("input"))
    channel_type = _read_string(binding_input.get("channelType"))
    if channel_type:
        return channel_type
    channel = _read_string(binding.get("channel"))
    if channel and channel != "source":
        return channel
    if adapter and adapter.startswith("opencli"):
        return "opencli"
    site = _read_string(node.params.get("site"))
    return site or "workflow"


def _adapter_reference(node: CompiledWorkflowNode) -> str | None:
    adapter = _read_string(node.adapter)
    if adapter:
        return adapter
    if hasattr(node.adapter, "id"):
        return _read_string(getattr(node.adapter, "id"))
    if hasattr(node.adapter, "model_dump"):
        dumped = node.adapter.model_dump(mode="json")
        if isinstance(dumped, dict):
            return _read_string(dumped.get("id"))
    return None


def _json_safe(value: object) -> object:
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json")
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_json_safe(item) for item in value]
    if isinstance(value, tuple):
        return [_json_safe(item) for item in value]
    if isinstance(value, str | int | float | bool) or value is None:
        return value
    return str(value)


def _upstream_outputs(
    node: CompiledWorkflowNode,
    outputs_by_node: dict[str, list[dict[str, Any]]],
) -> list[dict[str, Any]]:
    return [
        item for upstream_id in node.depends_on for item in outputs_by_node.get(upstream_id, [])
    ]


def _normalize_runtime_items(
    node: CompiledWorkflowNode,
    input_items: list[dict[str, Any]],
    run_id: str,
) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    source_id = _read_string(node.params.get("sourceId")) or node.id
    for index, item in enumerate(input_items):
        raw = _read_dict(item.get("raw")) or _read_dict(item)
        normalized, content_hash = normalize_item(raw, source_id)
        lineage = list(_read_dict_list(item.get("lineage")))
        lineage.append(
            {
                "nodeId": node.id,
                "step": "normalize",
                "runId": run_id,
                "index": index,
            }
        )
        candidates.append(
            {
                "candidateId": _stable_id("candidate", run_id, node.id, content_hash),
                "raw": raw,
                "normalizedData": normalized,
                "contentHash": content_hash,
                "lineage": lineage,
            }
        )
    return candidates


def _append_lineage(
    item: dict[str, Any],
    node: CompiledWorkflowNode,
    *,
    step: str,
    run_id: str,
) -> dict[str, Any]:
    updated = dict(item)
    lineage = list(_read_dict_list(updated.get("lineage")))
    lineage.append({"nodeId": node.id, "step": step, "runId": run_id})
    updated["lineage"] = lineage
    return updated


def _accept_candidate(
    item: dict[str, Any],
    node: CompiledWorkflowNode,
    *,
    run_id: str,
) -> dict[str, Any]:
    accepted = _append_lineage(item, node, step="record_acceptance", run_id=run_id)
    content_hash = _read_string(accepted.get("contentHash")) or _stable_id(
        "content", run_id, node.id, str(len(accepted))
    )
    return {
        "recordId": _stable_id("record", run_id, node.id, content_hash),
        "candidateId": accepted.get("candidateId"),
        "raw": accepted.get("raw", {}),
        "normalizedData": accepted.get("normalizedData", {}),
        "contentHash": content_hash,
        "status": "accepted",
        "lineage": accepted.get("lineage", []),
    }


def _candidate_has_lineage(item: dict[str, Any]) -> bool:
    return bool(_read_dict_list(item.get("lineage")))


def _route_runtime_items(
    node: CompiledWorkflowNode,
    input_items: list[dict[str, Any]],
    run_id: str,
    *,
    expression: str,
) -> list[dict[str, Any]]:
    return [
        _append_lineage(item, node, step="route", run_id=run_id)
        for item in input_items
        if _matches_route_expression(item, expression)
    ]


def _matches_route_expression(item: dict[str, Any], expression: str) -> bool:
    normalized_expression = expression.strip()
    if not normalized_expression or normalized_expression.lower() == "true":
        return True
    if normalized_expression.lower() == "false":
        return False

    or_terms = [term.strip() for term in normalized_expression.split("||")]
    if len(or_terms) > 1:
        return any(_matches_route_expression(item, term) for term in or_terms)

    and_terms = [term.strip() for term in normalized_expression.split("&&")]
    if len(and_terms) > 1:
        return all(_matches_route_expression(item, term) for term in and_terms)

    for operator in (">=", "<=", "===", "==", ">", "<"):
        if operator not in normalized_expression:
            continue
        left, right = [part.strip() for part in normalized_expression.split(operator, 1)]
        if not left.startswith("item."):
            return True
        value = _item_value(item, left.removeprefix("item."))
        expected = _parse_expression_literal(right)
        if operator in {"===", "=="}:
            return value == expected
        if not isinstance(value, int | float) or not isinstance(expected, int | float):
            return False
        if operator == ">=":
            return value >= expected
        if operator == "<=":
            return value <= expected
        if operator == ">":
            return value > expected
        if operator == "<":
            return value < expected

    if normalized_expression.startswith("item."):
        return bool(_item_value(item, normalized_expression.removeprefix("item.")))
    return True


def _parse_expression_literal(raw: str) -> object:
    value = raw.strip().strip('"').strip("'")
    if value == "true":
        return True
    if value == "false":
        return False
    try:
        return float(value) if "." in value else int(value)
    except ValueError:
        return value


def _item_value(item: dict[str, Any], path: str) -> object:
    raw = _read_dict(item.get("raw"))
    normalized = _read_dict(item.get("normalizedData"))
    for source in (raw, normalized, item):
        value: object = source
        for part in path.split("."):
            if not isinstance(value, dict) or part not in value:
                value = None
                break
            value = value[part]
        if value is not None:
            return value
    return None


def _required_source_credential_key(binding_input: dict[str, Any]) -> str | None:
    config = _read_dict(binding_input.get("adapterConfig"))
    params = _read_dict(binding_input.get("params"))
    for source in (params, config, binding_input):
        for field in (
            "requiredCredentialKey",
            "requiredCredential",
            "credentialKey",
            "credentialName",
        ):
            value = _read_string(source.get(field))
            if value:
                return value

        required = source.get("requiresCredential")
        if isinstance(required, str) and required.strip():
            return required.strip()
        if required is True:
            return "default"
    return None


def _source_credential_configured(binding_input: dict[str, Any]) -> bool:
    config = _read_dict(binding_input.get("adapterConfig"))
    params = _read_dict(binding_input.get("params"))
    for source in (params, config, binding_input):
        if source.get("credentialConfigured") is True:
            return True
        for field in ("credentialRef", "credentialId", "authRef", "secretRef"):
            if _read_string(source.get(field)):
                return True
        auth = source.get("auth")
        if isinstance(auth, dict) and auth:
            return True
    return False


def _source_fetch_block_reason(
    node: CompiledWorkflowNode,
    permissions: object,
) -> WorkflowRunBlockReason:
    binding = _read_dict(node.runtime.get("binding"))
    binding_input = _read_dict(binding.get("input"))
    if not bool(getattr(permissions, "canFetchNetwork", False)):
        return WorkflowRunBlockReason(
            code=FETCH_PERMISSION_REQUIRED,
            message=(
                "Workflow source fetch is bound, but agentPermissions.canFetchNetwork is false."
            ),
            source="workflow_permissions",
            details={
                "nodeId": node.id,
                "bindingId": SOURCE_FETCH_BINDING_ID,
                "requiredPermission": "canFetchNetwork",
            },
        )

    credential_key = _required_source_credential_key(binding_input)
    if credential_key and not _source_credential_configured(binding_input):
        return WorkflowRunBlockReason(
            code=MISSING_SOURCE_CREDENTIAL,
            message=(
                "Workflow source fetch is bound, but the required source "
                "credential is not configured."
            ),
            source="workflow_source_credentials",
            details={
                "nodeId": node.id,
                "bindingId": SOURCE_FETCH_BINDING_ID,
                "provider": binding_input.get("provider"),
                "channelType": binding_input.get("channelType"),
                "requiredCredentialKey": credential_key,
            },
        )

    live_mode = _read_string(binding_input.get("liveMode")) or "live"
    if live_mode in {"fixture", "mock"}:
        return WorkflowRunBlockReason(
            code=SOURCE_OUTPUT_REQUIRED,
            message=(
                "Fixture/mock source fetch requires sourceOutputs, fixtureItems, "
                "or bound source records before downstream nodes can run."
            ),
            source="workflow_source",
            details={
                "nodeId": node.id,
                "bindingId": SOURCE_FETCH_BINDING_ID,
                "liveMode": live_mode,
            },
        )

    return WorkflowRunBlockReason(
        code="live_source_executor_pending",
        message=(
            "Workflow source fetch is bound, but this source provider does not "
            "yet have a live executor in the workflow run service."
        ),
        source="workflow_source",
        details={
            "nodeId": node.id,
            "bindingId": SOURCE_FETCH_BINDING_ID,
            "provider": binding_input.get("provider"),
            "channelType": binding_input.get("channelType"),
        },
    )


def _notify_send_block_reason(
    node: CompiledWorkflowNode,
    permissions: object,
    *,
    outputs_by_node: dict[str, list[dict[str, Any]]] | None = None,
) -> WorkflowRunBlockReason | None:
    binding = _read_dict(node.runtime.get("binding"))
    binding_input = _read_dict(binding.get("input"))
    binding_id = _binding_id(node) or NOTIFY_SEND_BINDING_ID
    if not bool(getattr(permissions, "canSendNotifications", False)):
        return WorkflowRunBlockReason(
            code=SEND_PERMISSION_REQUIRED,
            message=(
                "Workflow notification is bound, but "
                "agentPermissions.canSendNotifications is false."
            ),
            source="workflow_permissions",
            details={
                "nodeId": node.id,
                "bindingId": binding_id,
                "requiredPermission": "canSendNotifications",
            },
        )
    if not bool(binding_input.get("delivery_configured")):
        return WorkflowRunBlockReason(
            code=MISSING_DELIVERY_PROJECTION,
            message=(
                "Workflow notification is bound, but delivery requires a "
                "configured notifier target."
            ),
            source="workflow_notifier",
            details={
                "nodeId": node.id,
                "bindingId": binding_id,
                "required_params": ["webhook_url"],
            },
        )
    if binding_id == WEBHOOK_NOTIFY_BINDING_ID and not _upstream_outputs(
        node,
        outputs_by_node or {},
    ):
        return WorkflowRunBlockReason(
            code=MISSING_DELIVERY_PROJECTION,
            message=(
                "Webhook delivery is bound, but EvidenceBatch/resource "
                "projection is not available."
            ),
            source="workflow_webhook_delivery",
            details={
                "nodeId": node.id,
                "bindingId": WEBHOOK_NOTIFY_BINDING_ID,
                "required_params": [
                    "evidencebatch_projection_api",
                    "delivery_projection",
                ],
            },
        )
    return None


def _native_node_started_message(node: CompiledWorkflowNode) -> str:
    binding_id = _binding_id(node)
    if binding_id == NORMALIZE_BINDING_ID:
        return "Normalize transform started"
    if binding_id == MERGE_BINDING_ID:
        return "Merge node started"
    if binding_id == ROUTER_ROUTE_BINDING_ID:
        return "Router node started"
    if binding_id == RECORD_ACCEPTANCE_BINDING_ID:
        return "Record acceptance gate started"
    if binding_id == RECORD_SINK_BINDING_ID:
        return "Record sink started"
    if binding_id == INBOX_STORE_BINDING_ID:
        return "Inbox store started"
    if binding_id == NOTIFY_SEND_BINDING_ID:
        return "Notification send started"
    if binding_id == WEBHOOK_NOTIFY_BINDING_ID:
        return "Webhook delivery started"
    if binding_id == EXTERNAL_TOOL_BINDING_ID:
        return "OpenCLI Tool Capability started"
    return "Native workflow node started"


def _native_node_partial_message(node: CompiledWorkflowNode) -> str:
    binding_id = _binding_id(node)
    if binding_id == NORMALIZE_BINDING_ID:
        return "Record Candidates projected"
    if binding_id == MERGE_BINDING_ID:
        return "Candidate streams merged with lineage"
    if binding_id == ROUTER_ROUTE_BINDING_ID:
        return "Candidates routed with lineage"
    if binding_id == RECORD_ACCEPTANCE_BINDING_ID:
        return "Record Candidates accepted as Records"
    if binding_id == RECORD_SINK_BINDING_ID:
        return "Accepted Records stored through Record Sink boundary"
    if binding_id == INBOX_STORE_BINDING_ID:
        return "Items stored through Inbox boundary"
    if binding_id == NOTIFY_SEND_BINDING_ID:
        return "Notification payload projected"
    if binding_id == WEBHOOK_NOTIFY_BINDING_ID:
        return "Webhook delivery evidence emitted"
    if binding_id == EXTERNAL_TOOL_BINDING_ID:
        return "OpenCLI Tool Capability emitted output"
    return "Native workflow node emitted trace evidence"


def _native_node_completed_message(node: CompiledWorkflowNode) -> str:
    binding_id = _binding_id(node)
    if binding_id == NORMALIZE_BINDING_ID:
        return "Normalize transform completed"
    if binding_id == MERGE_BINDING_ID:
        return "Merge node completed"
    if binding_id == ROUTER_ROUTE_BINDING_ID:
        return "Router node completed"
    if binding_id == RECORD_ACCEPTANCE_BINDING_ID:
        return "Record acceptance gate completed"
    if binding_id == RECORD_SINK_BINDING_ID:
        return "Record sink completed"
    if binding_id == INBOX_STORE_BINDING_ID:
        return "Inbox store completed"
    if binding_id == NOTIFY_SEND_BINDING_ID:
        return "Notification send completed"
    if binding_id == WEBHOOK_NOTIFY_BINDING_ID:
        return "Webhook delivery completed"
    if binding_id == EXTERNAL_TOOL_BINDING_ID:
        return "OpenCLI Tool Capability completed"
    return "Native workflow node completed"


def _lineage_pointer(node: CompiledWorkflowNode) -> dict[str, object]:
    return {
        "nodeId": node.id,
        "nodePath": _compiled_node_path(node),
        "dependsOn": node.depends_on,
        "packageParentId": node.runtime.get("package_parent_id"),
        "packageInternalId": node.runtime.get("package_internal_id"),
    }


def _compiled_node_path(node: CompiledWorkflowNode) -> list[str]:
    value = node.runtime.get("node_path")
    if isinstance(value, list) and value and all(isinstance(part, str) and part for part in value):
        return list(value)
    return node.id.split(INTERNAL_ID_SEPARATOR)


def _legacy_location_from_node_path(node_path: list[str]) -> tuple[str | None, str | None]:
    if len(node_path) <= 1:
        return None, None
    return INTERNAL_ID_SEPARATOR.join(node_path[:-1]), node_path[-1]


def _package_ancestor_ids(node: CompiledWorkflowNode) -> list[str]:
    node_path = _compiled_node_path(node)
    return [
        INTERNAL_ID_SEPARATOR.join(node_path[:depth])
        for depth in range(1, len(node_path))
    ]


def _webhook_runtime_input_envelope(
    body: WorkflowRunStartRequest,
    node: CompiledWorkflowNode,
) -> dict[str, Any]:
    binding = _read_dict(node.runtime.get("binding"))
    binding_input = _read_dict(binding.get("input"))
    return {
        "workflowId": body.project.id,
        "trigger": {
            "kind": "webhook",
            "triggerNodeId": node.id,
            "requestId": body.trigger.requestId,
            "idempotencyKey": body.trigger.idempotencyKey,
        },
        "request": {
            "method": _read_string(binding_input.get("method")) or "POST",
            "path": _read_string(binding_input.get("path")) or "/hook",
            "payload": body.input.payload,
            "headers": body.input.headers,
            "query": body.input.query,
            "source": body.input.source,
            "sourceId": body.input.sourceId or body.input.source,
        },
        "responseMode": body.responseMode,
    }


def _binding_id(node: CompiledWorkflowNode) -> str | None:
    binding = node.runtime.get("binding")
    if not isinstance(binding, dict):
        return None
    return _read_string(binding.get("binding_id"))


def _to_dispatch(
    project: WorkflowProject,
    node: CompiledWorkflowNode,
    *,
    package_node_id: str | None,
    run_id: str,
    trace_id: str,
) -> WorkflowOpenCLIHDATraceDispatch:
    binding = node.runtime.get("binding")
    binding_input = binding.get("input") if isinstance(binding, dict) else {}
    site = _read_string(binding_input.get("site")) if isinstance(binding_input, dict) else None
    command = (
        _read_string(binding_input.get("command")) if isinstance(binding_input, dict) else None
    )
    if site is None or command is None:
        site = _read_string(node.params.get("site")) or ""
        command = _read_string(node.params.get("command")) or ""

    internal_node_id = (
        _internal_node_id(node.id, package_node_id) if package_node_id else None
    )
    source_group = _source_group(node, internal_node_id or node.id)
    args = _read_dict(node.params.get("args"))
    task_id = _task_id(project.id, run_id, node.id, source_group)
    payload: dict[str, object] = {
        "workflow_id": project.id,
        "workflow_run_id": run_id,
        "node_id": node.id,
        "node_path": _compiled_node_path(node),
        "source_group": source_group,
        "site": site,
        "command": command,
        "args": args,
        "format": _read_string(node.params.get("format")) or "json",
        "task_id": task_id,
        "trace_id": trace_id,
    }
    if package_node_id:
        payload["package_node_id"] = package_node_id
    if internal_node_id:
        payload["internal_node_id"] = internal_node_id
    positional_args = node.params.get("positional_args", node.params.get("positionalArgs"))
    if isinstance(positional_args, list) and positional_args:
        payload["positional_args"] = positional_args
    mode = _read_string(node.params.get("mode"))
    if mode:
        payload["mode"] = mode

    return WorkflowOpenCLIHDATraceDispatch(
        taskId=task_id,
        nodeId=node.id,
        nodePath=_compiled_node_path(node),
        packageNodeId=package_node_id,
        internalNodeId=internal_node_id,
        sourceGroup=source_group,
        site=site,
        command=command,
        args=args,
        iii={"function_id": OPENCLI_FUNCTION_ID, "payload": payload},
    )


def _dispatch_metadata() -> dict[str, str]:
    return {
        "runtime": "iii",
        "worker": OPENCLI_WORKER,
        "functionId": OPENCLI_FUNCTION_ID,
        "mode": "trigger_envelope",
    }


def _internal_node_id(node_id: str, package_node_id: str) -> str:
    prefix = f"{package_node_id}{INTERNAL_ID_SEPARATOR}"
    return node_id.removeprefix(prefix)


def _optional_internal_node_id(node_id: str, package_node_id: str | None) -> str | None:
    if not package_node_id:
        return None
    prefix = f"{package_node_id}{INTERNAL_ID_SEPARATOR}"
    return node_id.removeprefix(prefix) if node_id.startswith(prefix) else None


def _source_group(node: CompiledWorkflowNode, internal_node_id: str) -> str:
    return (
        _read_string(node.params.get("sourceGroup"))
        or _read_string(node.params.get("source_group"))
        or (node.adapter.id if node.adapter else None)
        or internal_node_id
    )


def _task_id(workflow_id: str, run_id: str, node_id: str, source_group: str) -> str:
    return str(
        uuid.uuid5(
            uuid.NAMESPACE_URL,
            f"opencli-admin/workflow/{workflow_id}/run/{run_id}/node/{node_id}/source/{source_group}",
        )
    )


def _read_string(value: object) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _read_dict(value: object) -> dict[str, object]:
    return dict(value) if isinstance(value, dict) else {}


def _read_dict_list(value: object) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    return [dict(item) for item in value if isinstance(item, dict)]


def _stable_id(prefix: str, *parts: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"opencli-admin/{prefix}/{'/'.join(parts)}"))


def _utcnow() -> str:
    return datetime.now(UTC).isoformat()
