"""HTTP schemas for persistent Studio authoring APIs."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from backend.schemas import workflow as workflow_schemas
from backend.schemas.common import UTCModel

ProjectAppType = Literal["chatbot", "agent", "chatflow", "workflow", "text-generator"]


class WorkspaceRead(UTCModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str
    slug: str
    active: bool
    created_at: datetime
    updated_at: datetime


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    slug: str = Field(min_length=1, max_length=100)
    description: str | None = None
    app_type: ProjectAppType = "workflow"


class ProjectRead(UTCModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    workspace_id: str
    name: str
    slug: str
    description: str | None
    app_type: ProjectAppType
    primary_workflow_id: str | None
    created_by_user_id: str
    archived: bool
    created_at: datetime
    updated_at: datetime


class WorkflowCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    graph: dict


class BootstrapWorkflowCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    graph: workflow_schemas.WorkflowProject


class ProjectBootstrapCreate(BaseModel):
    project: ProjectCreate
    workflow: BootstrapWorkflowCreate


class WorkflowRead(UTCModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    project_id: str
    name: str
    description: str | None
    current_published_version: int | None
    archived: bool
    created_at: datetime
    updated_at: datetime


class DraftUpdate(BaseModel):
    graph: dict
    revision: int = Field(ge=1)


class DraftRead(UTCModel):
    revision: int
    graph: dict
    updated_by_user_id: str
    updated_at: datetime


class VersionCreate(BaseModel):
    reason: str = Field(min_length=1)
    expected_revision: int = Field(ge=1, alias="expectedRevision")
    validation_run_id: str = Field(min_length=1, alias="validationRunId")


class VersionRead(UTCModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    workflow_id: str
    version: int
    draft_revision: int
    graph: dict
    compile_version: str
    published_by_user_id: str
    reason: str
    created_at: datetime


class ProjectBootstrapRead(BaseModel):
    project: ProjectRead
    primary_workflow: WorkflowRead
    draft: DraftRead


class ValidationRunRead(workflow_schemas.WorkflowRunProjection):
    model_config = ConfigDict(populate_by_name=True)
    draft_revision: int = Field(alias="draftRevision")
    compile_version: str = Field(alias="compileVersion")
    warnings: list[workflow_schemas.WorkflowCompileError] = Field(default_factory=list)
