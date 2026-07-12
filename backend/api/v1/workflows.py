"""WorkflowProject compile and runtime endpoints."""

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import get_db
from backend.models.workflow_run import WorkflowRun as WorkflowRunRow
from backend.schemas import workflow as workflow_schemas
from backend.schemas.common import ApiResponse
from backend.workflow.capability_projection import build_workflow_capabilities
from backend.workflow.compiler import compile_workflow_project
from backend.workflow.demand_assembler import draft_workflow_demand
from backend.workflow.external_importer import import_external_workflow
from backend.workflow.fleet_inventory import (
    build_workflow_fleet_inventory,
    match_workflow_fleet_capability,
)
from backend.workflow.opencli_adapter_nodes import list_opencli_adapter_nodes
from backend.workflow.opencli_hda_tracer import (
    build_opencli_hda_trace,
    continue_workflow_run_with_source_outputs,
    get_workflow_run_checkpoint,
    get_workflow_run_projection,
    list_workflow_run_events,
    start_workflow_run,
)
from backend.workflow.patcher import preview_workflow_patch
from backend.workflow.tool_capabilities import list_workflow_tool_capabilities

router = APIRouter(prefix="/workflows", tags=["workflows"])


async def _reject_workspace_scoped_run(db: AsyncSession, run_id: str) -> None:
    run = await db.get(WorkflowRunRow, run_id)
    if run is not None and run.workflow_version_id is not None:
        raise HTTPException(status_code=404, detail="Workflow run not found")


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
async def get_workflow_capabilities() -> ApiResponse[workflow_schemas.WorkflowCapabilitiesResponse]:
    """Return Canvas-visible workflow capabilities and their runtime status."""

    return ApiResponse.ok(build_workflow_capabilities())


@router.get(
    "/tool-capabilities",
    response_model=ApiResponse[workflow_schemas.WorkflowToolCapabilitiesResponse],
)
async def get_workflow_tool_capabilities() -> ApiResponse[
    workflow_schemas.WorkflowToolCapabilitiesResponse
]:
    """Return registered OpenCLI Admin Tool Capabilities."""

    return ApiResponse.ok(list_workflow_tool_capabilities())


@router.get(
    "/fleet/inventory",
    response_model=ApiResponse[workflow_schemas.WorkflowFleetInventoryResponse],
)
async def get_workflow_fleet_inventory(
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[workflow_schemas.WorkflowFleetInventoryResponse]:
    """Project existing browser pool, agents, WS links, and site bindings."""

    return ApiResponse.ok(await build_workflow_fleet_inventory(db))


@router.post(
    "/fleet/match",
    response_model=ApiResponse[workflow_schemas.WorkflowFleetCapabilityMatchResponse],
)
async def match_workflow_fleet_target(
    body: workflow_schemas.WorkflowFleetCapabilityMatchRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[workflow_schemas.WorkflowFleetCapabilityMatchResponse]:
    """Match an OpenCLI adapter capability to an existing fleet endpoint."""

    return ApiResponse.ok(await match_workflow_fleet_capability(db, body))


@router.get(
    "/opencli-adapter-nodes",
    response_model=ApiResponse[workflow_schemas.WorkflowOpenCLIAdapterNodesResponse],
)
async def get_opencli_adapter_nodes(
    site: str | None = None,
    q: str | None = None,
    include_write: bool = Query(True, alias="includeWrite"),
    limit: int = Query(2000, ge=1, le=5000),
) -> ApiResponse[workflow_schemas.WorkflowOpenCLIAdapterNodesResponse]:
    """Return OpenCLI adapter commands projected as node-capability manifests."""

    return ApiResponse.ok(
        list_opencli_adapter_nodes(
            site=site,
            q=q,
            include_write=include_write,
            limit=limit,
        )
    )


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
    "/demand-draft",
    response_model=ApiResponse[workflow_schemas.WorkflowPatchResponse],
)
async def draft_demand_workflow(
    body: workflow_schemas.WorkflowDemandDraftRequest,
) -> ApiResponse[workflow_schemas.WorkflowPatchResponse]:
    """Assemble a user collection need into reviewable WorkflowProject patches."""

    return ApiResponse.ok(draft_workflow_demand(body))


@router.post(
    "/import/external-runtime",
    response_model=ApiResponse[workflow_schemas.WorkflowPatchResponse],
)
async def import_external_runtime_workflow(
    body: workflow_schemas.WorkflowExternalImportRequest,
) -> ApiResponse[workflow_schemas.WorkflowPatchResponse]:
    """Import LangGraph/LangChain graphs as OpenCLI Admin native nodes."""

    return ApiResponse.ok(import_external_workflow(body))


@router.post(
    "/runs",
    response_model=ApiResponse[workflow_schemas.WorkflowRunProjection],
    status_code=202,
)
async def start_run(
    body: workflow_schemas.WorkflowRunStartRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[workflow_schemas.WorkflowRunProjection]:
    """Start a WorkflowProject run and emit replayable node-level events."""

    return ApiResponse.ok(await start_workflow_run(body, session=db))


@router.get(
    "/runs/{run_id}",
    response_model=ApiResponse[workflow_schemas.WorkflowRunProjection],
)
async def get_run_projection(
    run_id: str,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[workflow_schemas.WorkflowRunProjection]:
    """Return the latest node-state projection for a workflow run."""

    await _reject_workspace_scoped_run(db, run_id)
    projection = await get_workflow_run_projection(run_id, session=db)
    if projection is None:
        raise HTTPException(status_code=404, detail="Workflow run not found")
    return ApiResponse.ok(projection)


@router.post(
    "/runs/{run_id}/source-outputs",
    response_model=ApiResponse[workflow_schemas.WorkflowRunProjection],
    status_code=202,
)
async def continue_run_with_source_outputs(
    run_id: str,
    body: workflow_schemas.WorkflowRunSourceOutputsRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[workflow_schemas.WorkflowRunProjection]:
    """Continue a workflow run after external source batches arrive."""

    await _reject_workspace_scoped_run(db, run_id)
    projection = await continue_workflow_run_with_source_outputs(run_id, body, session=db)
    if projection is None:
        raise HTTPException(status_code=404, detail="Workflow run not found")
    return ApiResponse.ok(projection)


@router.get(
    "/runs/{run_id}/checkpoint",
    response_model=ApiResponse[workflow_schemas.WorkflowRunCheckpoint],
)
async def get_run_checkpoint(
    run_id: str,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[workflow_schemas.WorkflowRunCheckpoint]:
    """Return the latest durable checkpoint descriptor for a workflow run."""

    await _reject_workspace_scoped_run(db, run_id)
    checkpoint = await get_workflow_run_checkpoint(run_id, session=db)
    if checkpoint is None:
        raise HTTPException(status_code=404, detail="Workflow run not found")
    return ApiResponse.ok(checkpoint)


@router.get(
    "/runs/{run_id}/trace",
    response_model=ApiResponse[workflow_schemas.WorkflowRunTraceResponse],
)
async def query_run_trace(
    run_id: str,
    after_sequence: int | None = Query(default=None, ge=0, alias="afterSequence"),
    node_id: str | None = Query(default=None, alias="nodeId"),
    event_type: workflow_schemas.WorkflowNodeRunEventType | None = Query(
        default=None,
        alias="eventType",
    ),
    limit: int | None = Query(default=None, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[workflow_schemas.WorkflowRunTraceResponse]:
    """Query persisted run trace events with a checkpoint for resume/replay."""

    await _reject_workspace_scoped_run(db, run_id)
    projection = await get_workflow_run_projection(run_id, session=db)
    checkpoint = await get_workflow_run_checkpoint(run_id, session=db)
    events = await list_workflow_run_events(
        run_id,
        session=db,
        after_sequence=after_sequence,
        node_id=node_id,
        event_type=event_type,
        limit=limit,
    )
    if projection is None or checkpoint is None or events is None:
        raise HTTPException(status_code=404, detail="Workflow run not found")

    next_after_sequence = max((event.sequence for event in events), default=after_sequence or 0)
    return ApiResponse.ok(
        workflow_schemas.WorkflowRunTraceResponse(
            projection=projection,
            checkpoint=checkpoint,
            events=events,
            filters={
                "afterSequence": after_sequence,
                "nodeId": node_id,
                "eventType": event_type,
                "limit": limit,
            },
            nextAfterSequence=next_after_sequence,
        )
    )


@router.get(
    "/runs/{run_id}/events",
    response_model=ApiResponse[list[workflow_schemas.WorkflowNodeRunEvent]],
)
async def get_run_events(
    run_id: str,
    after_sequence: int | None = Query(default=None, ge=0, alias="afterSequence"),
    node_id: str | None = Query(default=None, alias="nodeId"),
    event_type: workflow_schemas.WorkflowNodeRunEventType | None = Query(
        default=None,
        alias="eventType",
    ),
    limit: int | None = Query(default=None, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[list[workflow_schemas.WorkflowNodeRunEvent]]:
    """Replay node-level events already emitted for a workflow run."""

    await _reject_workspace_scoped_run(db, run_id)
    events = await list_workflow_run_events(
        run_id,
        session=db,
        after_sequence=after_sequence,
        node_id=node_id,
        event_type=event_type,
        limit=limit,
    )
    if events is None:
        raise HTTPException(status_code=404, detail="Workflow run not found")
    return ApiResponse.ok(events)


@router.get("/runs/{run_id}/events/stream")
async def stream_run_events(
    run_id: str,
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Replay node events as a server-sent event response."""

    await _reject_workspace_scoped_run(db, run_id)
    projection = await get_workflow_run_projection(run_id, session=db)
    events = await list_workflow_run_events(run_id, session=db)
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
