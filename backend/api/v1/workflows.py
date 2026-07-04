"""WorkflowProject compile and runtime endpoints."""

from fastapi import APIRouter, HTTPException, Response

from backend.schemas import workflow as workflow_schemas
from backend.schemas.common import ApiResponse
from backend.workflow.capability_projection import build_workflow_capabilities
from backend.workflow.compiler import compile_workflow_project
from backend.workflow.opencli_hda_tracer import (
    build_opencli_hda_trace,
    get_workflow_run_projection,
    list_workflow_run_events,
    start_workflow_run,
)
from backend.workflow.patcher import preview_workflow_patch

router = APIRouter(prefix="/workflows", tags=["workflows"])


@router.post("/compile", response_model=ApiResponse[workflow_schemas.WorkflowCompileResponse])
async def compile_workflow(
    body: workflow_schemas.WorkflowCompileRequest,
) -> ApiResponse[workflow_schemas.WorkflowCompileResponse]:
    """Compile a Canvas-authored WorkflowProject into an executable preview.

    This endpoint is stateless: it validates and compiles in memory, but it
    does not create tasks, persist a plan, or dispatch workers.
    """

    return ApiResponse.ok(compile_workflow_project(body.project))


@router.get(
    "/capabilities",
    response_model=ApiResponse[workflow_schemas.WorkflowCapabilitiesResponse],
)
async def get_workflow_capabilities() -> ApiResponse[
    workflow_schemas.WorkflowCapabilitiesResponse
]:
    """Return Canvas-visible workflow capabilities and their runtime status."""

    return ApiResponse.ok(build_workflow_capabilities())


@router.post(
    "/opencli-hda/trace",
    response_model=ApiResponse[workflow_schemas.WorkflowOpenCLIHDATraceResponse],
)
async def trace_opencli_hda(
    body: workflow_schemas.WorkflowOpenCLIHDATraceRequest,
) -> ApiResponse[workflow_schemas.WorkflowOpenCLIHDATraceResponse]:
    """Build III trigger envelopes for a Multi Source OpenCLI HDA workflow run."""

    return ApiResponse.ok(
        build_opencli_hda_trace(
            body.project,
            package_node_id=body.packageNodeId,
            run_id=body.runId,
            trace_id=body.traceId,
        )
    )


@router.post("/patch", response_model=ApiResponse[workflow_schemas.WorkflowPatchResponse])
async def patch_workflow(
    body: workflow_schemas.WorkflowPatchRequest,
) -> ApiResponse[workflow_schemas.WorkflowPatchResponse]:
    """Preview structured AI-authored WorkflowProject patch operations."""

    return ApiResponse.ok(preview_workflow_patch(body.project, body.operations))


@router.post(
    "/runs",
    response_model=ApiResponse[workflow_schemas.WorkflowRunProjection],
    status_code=202,
)
async def start_run(
    body: workflow_schemas.WorkflowRunStartRequest,
) -> ApiResponse[workflow_schemas.WorkflowRunProjection]:
    """Start a WorkflowProject run and emit replayable node-level events."""

    return ApiResponse.ok(start_workflow_run(body))


@router.get(
    "/runs/{run_id}",
    response_model=ApiResponse[workflow_schemas.WorkflowRunProjection],
)
async def get_run_projection(run_id: str) -> ApiResponse[workflow_schemas.WorkflowRunProjection]:
    """Return the latest node-state projection for a workflow run."""

    projection = get_workflow_run_projection(run_id)
    if projection is None:
        raise HTTPException(status_code=404, detail="Workflow run not found")
    return ApiResponse.ok(projection)


@router.get(
    "/runs/{run_id}/events",
    response_model=ApiResponse[list[workflow_schemas.WorkflowNodeRunEvent]],
)
async def get_run_events(
    run_id: str,
) -> ApiResponse[list[workflow_schemas.WorkflowNodeRunEvent]]:
    """Replay node-level events already emitted for a workflow run."""

    events = list_workflow_run_events(run_id)
    if events is None:
        raise HTTPException(status_code=404, detail="Workflow run not found")
    return ApiResponse.ok(events)


@router.get("/runs/{run_id}/events/stream")
async def stream_run_events(run_id: str) -> Response:
    """Replay node events as a server-sent event response."""

    projection = get_workflow_run_projection(run_id)
    events = list_workflow_run_events(run_id)
    if projection is None or events is None:
        raise HTTPException(status_code=404, detail="Workflow run not found")

    body = "".join(
        [_sse("node_event", event.model_dump_json()) for event in events]
        + [_sse("run_state", projection.model_dump_json())]
    )
    return Response(
        content=body,
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


def _sse(event: str, data: str) -> str:
    return f"event: {event}\ndata: {data}\n\n"
