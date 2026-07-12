from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from backend.schemas.common import UTCModel
from backend.schemas.workflow import WorkflowProject


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    slug: str = Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", max_length=100)
    description: str | None = Field(default=None, max_length=4000)


class ProjectRead(UTCModel):
    id: str
    workspace_id: str
    name: str
    slug: str
    description: str | None
    archived: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class WorkflowCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=4000)
    graph: WorkflowProject


class WorkflowRead(UTCModel):
    id: str
    project_id: str
    name: str
    description: str | None
    current_published_version: int | None
    archived: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class WorkflowDraftUpdate(BaseModel):
    graph: WorkflowProject


class WorkflowDraftRead(UTCModel):
    revision: int
    graph: WorkflowProject
    updated_by_user_id: str
    updated_at: datetime

    model_config = {"from_attributes": True}


class WorkflowPublish(BaseModel):
    reason: str = Field(min_length=1, max_length=2000)


class WorkflowVersionRead(UTCModel):
    id: str
    workflow_id: str
    version: int
    draft_revision: int
    graph: WorkflowProject
    compile_version: str
    published_by_user_id: str
    reason: str
    created_at: datetime

    model_config = {"from_attributes": True}


class WorkflowVersionRunCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    package_node_id: str | None = Field(default=None, alias="packageNodeId")
    trace_id: str | None = Field(default=None, alias="traceId")
    source_outputs: dict[str, list[dict]] = Field(default_factory=dict, alias="sourceOutputs")
