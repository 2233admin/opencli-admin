"""Dify workflow import endpoints."""

from fastapi import APIRouter, Depends, HTTPException

from backend.config import get_settings
from backend.schemas.common import ApiResponse
from backend.schemas.dify_compat import DifyImportRequest, DifyImportResponse
from backend.workflow.dify_graphon_client import (
    DifyGraphonClient,
    DifyGraphonUnavailableError,
)
from backend.workflow.dify_importer import DifyImportError, import_dify_workflow

router = APIRouter(prefix="/workflows", tags=["workflows"])


def get_dify_graphon_client() -> DifyGraphonClient:
    settings = get_settings()
    return DifyGraphonClient(
        base_url=settings.dify_graphon_runtime_url,
        timeout_seconds=settings.dify_graphon_timeout_seconds,
    )


@router.post(
    "/import/dify",
    response_model=ApiResponse[DifyImportResponse],
)
async def import_dify(
    body: DifyImportRequest,
    graphon_client: DifyGraphonClient = Depends(get_dify_graphon_client),
) -> ApiResponse[DifyImportResponse]:
    try:
        result = await import_dify_workflow(body, graphon_client=graphon_client)
    except DifyImportError as error:
        raise HTTPException(
            status_code=error.status_code,
            detail={"code": error.code, "message": error.message},
        ) from error
    except DifyGraphonUnavailableError as error:
        raise HTTPException(
            status_code=503,
            detail={"code": "dify_graphon_unavailable", "message": str(error)},
        ) from error
    return ApiResponse.ok(result)
