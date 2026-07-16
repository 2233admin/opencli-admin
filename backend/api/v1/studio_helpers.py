"""Shared lookup and projection helpers for Studio authoring routes."""

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.api.v1.studio_schemas import ValidationRunRead
from backend.models.studio import (
    StudioProject,
    StudioWorkflow,
    StudioWorkflowValidationRun,
    StudioWorkspace,
)
from backend.schemas import workflow as workflow_schemas

LOCAL_USER_ID = "local-development-user"


def validation_projection(row: StudioWorkflowValidationRun) -> ValidationRunRead:
    return ValidationRunRead(
        workflowId=row.workflow_id,
        runId=row.id,
        traceId=f"validation:{row.id}",
        valid=row.valid,
        status=row.status,
        draft_revision=row.draft_revision,
        compile_version=row.compile_version,
        startedAt=row.created_at.isoformat(),
        updatedAt=row.updated_at.isoformat(),
        eventCount=0,
        nodeStates=[],
        errors=[
            workflow_schemas.WorkflowCompileError.model_validate(error)
            for error in row.errors
        ],
        warnings=[
            workflow_schemas.WorkflowCompileError.model_validate(warning)
            for warning in row.warnings
        ],
    )


async def get_workspace(db: AsyncSession, workspace_id: str) -> StudioWorkspace:
    row = await db.get(StudioWorkspace, workspace_id)
    if row is None or not row.active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Workspace not found")
    return row


async def get_project(
    db: AsyncSession, workspace_id: str, project_id: str
) -> StudioProject:
    row = await db.scalar(
        select(StudioProject).where(
            StudioProject.id == project_id,
            StudioProject.workspace_id == workspace_id,
        )
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    return row


async def get_workflow(
    db: AsyncSession, workspace_id: str, project_id: str, workflow_id: str
) -> StudioWorkflow:
    await get_project(db, workspace_id, project_id)
    row = await db.scalar(
        select(StudioWorkflow).where(
            StudioWorkflow.id == workflow_id,
            StudioWorkflow.project_id == project_id,
        )
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Workflow not found")
    return row
