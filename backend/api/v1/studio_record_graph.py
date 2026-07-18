"""Project-scoped record graph preview route."""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import get_db
from backend.schemas.common import ApiResponse
from backend.schemas.record_graph import ProjectRecordGraphPreview
from backend.services.record_graph_service import build_project_record_graph_preview

router = APIRouter()


@router.get(
    "/workspaces/{workspace_id}/projects/{project_id}/record-graph",
    response_model=ApiResponse[ProjectRecordGraphPreview],
)
async def get_project_record_graph(
    workspace_id: str,
    project_id: str,
    max_nodes: int = Query(700, ge=100, le=2000),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse:
    preview = await build_project_record_graph_preview(
        db,
        workspace_id=workspace_id,
        project_id=project_id,
        max_nodes=max_nodes,
    )
    if preview is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    return ApiResponse.ok(preview)
