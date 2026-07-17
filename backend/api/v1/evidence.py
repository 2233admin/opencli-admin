# ruff: noqa: N815, UP045
"""EvidenceBatch projection endpoints.

Read-only projection routes for evidence batches, batch detail, and full run
projection. These routes do not dispatch workers and never stream raw
records. They are meant to back Canvas run-trace workbenches and AI clients
that need to cite evidence batch references.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import get_db
from backend.schemas.common import ApiResponse
from backend.schemas.evidence import (
    EvidenceBatchDetailResponse,
    EvidenceBatchListResponse,
    EvidenceProjectionResponse,
)
from backend.services import evidence_service

router = APIRouter(prefix="/workflows/runs", tags=["evidence"])


def _split_include(value: Optional[str]) -> list[str]:
    if value is None:
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


@router.get(
    "/{run_id}/evidence-batches",
    response_model=ApiResponse[EvidenceBatchListResponse],
)
async def list_run_evidence_batches(
    run_id: str,
    node_id: Optional[str] = Query(default=None, alias="nodeId"),
    source_group: Optional[str] = Query(default=None, alias="sourceGroup"),
    cursor: Optional[str] = Query(default=None),
    limit: Optional[int] = Query(default=None, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[EvidenceBatchListResponse]:
    """List evidence batch summaries for a workflow run with cursor pagination."""

    try:
        result = await evidence_service.list_evidence_batches(
            run_id,
            node_id=node_id,
            source_group=source_group,
            cursor=cursor,
            limit=limit,
            session=db,
        )
    except evidence_service.EvidenceRunNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return ApiResponse.ok(result)


@router.get(
    "/{run_id}/evidence-batches/{batch_id}",
    response_model=ApiResponse[EvidenceBatchDetailResponse],
)
async def get_run_evidence_batch(
    run_id: str,
    batch_id: str,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[EvidenceBatchDetailResponse]:
    """Return the detail projection for a single evidence batch."""

    try:
        result = await evidence_service.get_evidence_batch(run_id, batch_id, session=db)
    except evidence_service.EvidenceRunNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except evidence_service.EvidenceBatchNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return ApiResponse.ok(result)


@router.get(
    "/{run_id}/projection",
    response_model=ApiResponse[EvidenceProjectionResponse],
)
async def get_run_projection(
    run_id: str,
    include: Optional[str] = Query(
        default=None,
        description=(
            "Comma-separated optional sections: clusters, missingSources, "
            "summaries, conflicts."
        ),
    ),
    node_id: Optional[str] = Query(default=None, alias="nodeId"),
    source_group: Optional[str] = Query(default=None, alias="sourceGroup"),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[EvidenceProjectionResponse]:
    """Return the evidence projection for a workflow run.

    Optional sections are opt-in via ``include``. Unsupported include values
    return ``400`` to keep the projection surface explicit.
    """

    includes = _split_include(include)
    try:
        result = await evidence_service.build_run_projection(
            run_id,
            include=includes,
            node_id=node_id,
            source_group=source_group,
            session=db,
        )
    except evidence_service.EvidenceRunNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except evidence_service.EvidenceUnsupportedIncludeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ApiResponse.ok(result)
