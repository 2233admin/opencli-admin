"""Build III dispatch envelopes for Multi Source OpenCLI HDA nodes."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from backend.schemas.workflow import (
    CompiledWorkflowNode,
    WorkflowCompileError,
    WorkflowNodeRunEvent,
    WorkflowNodeRunEventType,
    WorkflowOpenCLIHDATraceDispatch,
    WorkflowOpenCLIHDATraceResponse,
    WorkflowProject,
    WorkflowRunBatchReference,
    WorkflowRunBlockReason,
    WorkflowRunNodeState,
    WorkflowRunProjection,
    WorkflowRunStartRequest,
    WorkflowRunStatus,
)
from backend.workflow.compiler import INTERNAL_ID_SEPARATOR, compile_workflow_project
from backend.workflow.runtime_registry import OPENCLI_FUNCTION_ID, OPENCLI_WORKER

_RUNS: dict[str, tuple[WorkflowRunProjection, list[WorkflowNodeRunEvent]]] = {}


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


def start_workflow_run(body: WorkflowRunStartRequest) -> WorkflowRunProjection:
    """Create a replayable workflow run projection from a compiled WorkflowProject."""

    run_id = body.runId or str(uuid.uuid4())
    trace_id = body.traceId or str(uuid.uuid4())
    started_at = _utcnow()
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
        _RUNS[run_id] = (projection, events)
        return projection

    trace = build_opencli_hda_trace(
        body.project,
        package_node_id=body.packageNodeId,
        run_id=run_id,
        trace_id=trace_id,
    )
    emitter = _WorkflowRunEventEmitter(
        workflow_id=body.project.id,
        run_id=run_id,
        trace_id=trace_id,
    )
    runtime_nodes = compile_result.plan.runtime.nodes
    package_nodes = [node for node in runtime_nodes if node.package is not None]
    package_ids = {node.id for node in package_nodes}
    dispatches_by_node = {dispatch.nodeId: dispatch for dispatch in trace.dispatches}
    blocked_by_package: dict[str, list[WorkflowRunBlockReason]] = {}

    for node in runtime_nodes:
        emitter.emit(node, "queued", message="Node queued for workflow run")

    for node in runtime_nodes:
        if node.id in package_ids:
            emitter.emit(node, "started", message="Package node started")
            continue

        missing_runtime = _read_dict(node.runtime.get("missing_runtime"))
        package_parent_id = _read_string(node.runtime.get("package_parent_id"))
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
            if package_parent_id:
                blocked_by_package.setdefault(package_parent_id, []).append(reason)
            continue

        dispatch = dispatches_by_node.get(node.id)
        if dispatch is None:
            emitter.emit(node, "started", message="Node started")
            emitter.emit(node, "completed", message="Node completed")
            continue

        emitter.emit(node, "started", message="OpenCLI source dispatch started")
        batch = _batch_reference(body.project.id, run_id, dispatch)
        emitter.emit(
            node,
            "batch_ready",
            message="OpenCLI batch reference ready",
            batch=batch,
            details={
                "functionId": OPENCLI_FUNCTION_ID,
                "worker": OPENCLI_WORKER,
            },
        )
        emitter.emit(
            node,
            "partial",
            message="OpenCLI dispatch envelope is ready for worker fanout",
            details={
                "adapterTaskId": dispatch.taskId,
                "sourceGroup": dispatch.sourceGroup,
            },
        )
        emitter.emit(node, "completed", message="OpenCLI source dispatch completed")

    for package_node in package_nodes:
        trace_errors = [
            error for error in trace.errors if error.node_id in {None, package_node.id}
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

    events = emitter.events
    projection = _build_projection(
        workflow_id=body.project.id,
        run_id=run_id,
        trace_id=trace_id,
        package_node_id=trace.packageNodeId or body.packageNodeId,
        started_at=started_at,
        valid=trace.valid,
        errors=trace.errors,
        runtime_nodes=runtime_nodes,
        events=events,
    )
    _RUNS[run_id] = (projection, events)
    return projection


def get_workflow_run_projection(run_id: str) -> WorkflowRunProjection | None:
    stored = _RUNS.get(run_id)
    return stored[0] if stored else None


def list_workflow_run_events(run_id: str) -> list[WorkflowNodeRunEvent] | None:
    stored = _RUNS.get(run_id)
    return list(stored[1]) if stored else None


class _WorkflowRunEventEmitter:
    def __init__(self, *, workflow_id: str, run_id: str, trace_id: str) -> None:
        self._workflow_id = workflow_id
        self._run_id = run_id
        self._trace_id = trace_id
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
        sequence = len(self.events) + 1
        package_node_id = _read_string(node.runtime.get("package_parent_id"))
        internal_node_id = _optional_internal_node_id(node.id, package_node_id)
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
                eventType=event_type,
                createdAt=_utcnow(),
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
        package_parent_id = _read_string(node.runtime.get("package_parent_id"))
        states[node.id] = WorkflowRunNodeState(
            nodeId=node.id,
            status="queued",
            packageNodeId=package_parent_id,
            internalNodeId=_optional_internal_node_id(node.id, package_parent_id),
        )
        ordered_ids.append(node.id)

    for event in events:
        state = states.setdefault(
            event.nodeId,
            WorkflowRunNodeState(
                nodeId=event.nodeId,
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
            state.batches.append(event.batch)

    node_states = [states[node_id] for node_id in ordered_ids]
    status = _run_status(node_states, valid)
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
        manifestUri=f"/api/v1/workflows/runs/{run_id}/batches/{batch_id}",
    )


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
    if event_type == "batch_ready":
        return "partial"
    if event_type == "failed":
        return "failed"
    if event_type in {"blocked", "partial", "completed", "queued"}:
        return event_type
    return "partial"


def _run_status(node_states: list[WorkflowRunNodeState], valid: bool) -> WorkflowRunStatus:
    if not valid:
        return "failed"
    statuses = {state.status for state in node_states}
    if "failed" in statuses:
        return "failed"
    if "blocked" in statuses:
        return "blocked"
    if "running" in statuses or "partial" in statuses:
        return "partial"
    if statuses and statuses <= {"completed"}:
        return "completed"
    return "queued"


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


def _to_dispatch(
    project: WorkflowProject,
    node: CompiledWorkflowNode,
    *,
    package_node_id: str,
    run_id: str,
    trace_id: str,
) -> WorkflowOpenCLIHDATraceDispatch:
    binding = node.runtime.get("binding")
    binding_input = binding.get("input") if isinstance(binding, dict) else {}
    site = _read_string(binding_input.get("site")) if isinstance(binding_input, dict) else None
    command = (
        _read_string(binding_input.get("command"))
        if isinstance(binding_input, dict)
        else None
    )
    if site is None or command is None:
        site = _read_string(node.params.get("site")) or ""
        command = _read_string(node.params.get("command")) or ""

    internal_node_id = _internal_node_id(node.id, package_node_id)
    source_group = _source_group(node, internal_node_id)
    args = _read_dict(node.params.get("args"))
    task_id = _task_id(project.id, run_id, node.id, source_group)
    payload: dict[str, object] = {
        "workflow_id": project.id,
        "workflow_run_id": run_id,
        "package_node_id": package_node_id,
        "node_id": node.id,
        "internal_node_id": internal_node_id,
        "source_group": source_group,
        "site": site,
        "command": command,
        "args": args,
        "format": _read_string(node.params.get("format")) or "json",
        "task_id": task_id,
        "trace_id": trace_id,
    }
    positional_args = node.params.get("positional_args", node.params.get("positionalArgs"))
    if isinstance(positional_args, list) and positional_args:
        payload["positional_args"] = positional_args
    mode = _read_string(node.params.get("mode"))
    if mode:
        payload["mode"] = mode

    return WorkflowOpenCLIHDATraceDispatch(
        taskId=task_id,
        nodeId=node.id,
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


def _utcnow() -> str:
    return datetime.now(UTC).isoformat()
