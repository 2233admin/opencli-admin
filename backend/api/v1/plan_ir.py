"""Plan IR endpoints (issue 01): the documented IR schema (story 27 — agents
author Plans through this contract), a stateless structural-validation
endpoint, and the read-only degenerate-projection endpoint for an existing
Data Source (story 18 — zero-migration bridge).

Every endpoint here is read-only / stateless. Nothing persists a Plan
(issue 02) or executes one (issues 03/04) — /validate checks a caller-
supplied graph in memory and returns, it never stores it; /projection is a
pure function of the source's already-stored ``channel_config``.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import get_db
from backend.plan_ir.projection import project_source_to_plan
from backend.plan_ir.validation import validate_plan_graph
from backend.schemas.common import ApiResponse
from backend.schemas.plan_ir import PlanGraph, plan_ir_json_schema
from backend.services import source_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/plan-ir", tags=["plan-ir"])


@router.get("/schema", response_model=ApiResponse[dict])
async def get_plan_ir_schema() -> ApiResponse:
    """The versioned, documented Plan IR JSON schema (story 27). Pure
    function of the Pydantic models in ``backend.schemas.plan_ir`` — no DB
    access, safe to poll."""
    return ApiResponse.ok(plan_ir_json_schema())


@router.post("/validate", response_model=ApiResponse[dict])
async def validate_plan_ir(body: PlanGraph) -> ApiResponse:
    """Run structural validation (cycles, orphan merges, missing required
    params, port type mismatches, source-node entity-reference rules)
    against a caller-supplied ``PlanGraph`` and return the node-anchored
    result. Stateless: the graph is validated in memory and discarded —
    this is not a save/create endpoint (issue 02 owns persistence)."""
    result = validate_plan_graph(body)
    return ApiResponse.ok(result.to_dict())


@router.get(
    "/projection/{source_id}",
    response_model=ApiResponse[PlanGraph],
)
async def get_source_plan_projection(
    source_id: str, db: AsyncSession = Depends(get_db)
) -> ApiResponse:
    """Render an existing Data Source as its degenerate single-node Plan
    (ADR-0009 "zero-migration bridge", story 18). Pure function of the
    source's stored ``channel_config`` — no Plan is created or persisted by
    calling this endpoint, and calling it twice for the same source returns
    the same graph shape every time (only ``channel_config``-derived params
    can differ between calls, if the source's config changed in between).

    404 if the source itself doesn't exist, matching every other
    ``/sources/{id}/*``-shaped lookup in this API.
    """
    source = await source_service.get_source(db, source_id)
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")

    plan = project_source_to_plan(source)
    return ApiResponse.ok(plan)
