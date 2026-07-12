from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

from backend.schemas.common import UTCModel
from backend.schemas.workflow import WorkflowProject
from backend.workflow.conformance.contracts import (
    ConformanceCaseResult,
    ExpectedWorkflowRunEvent,
    RuntimePassport,
)


class WorkspaceCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    slug: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None


class WorkspaceUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


class WorkspaceRead(UTCModel):
    id: str
    name: str
    slug: str
    description: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class WorkspaceSettingsUpdate(BaseModel):
    timezone: Optional[str] = None
    deterministic_simulation: Optional[bool] = None
    max_items_per_run: Optional[int] = Field(None, gt=0)


class WorkspaceSettingsRead(UTCModel):
    id: str
    workspace_id: str
    timezone: str
    deterministic_simulation: bool
    max_items_per_run: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ProjectCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    slug: str = Field(..., min_length=1, max_length=255)


class ProjectRead(UTCModel):
    id: str
    workspace_id: str
    name: str
    slug: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class WorkflowDraftCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    snapshot: WorkflowProject


class WorkflowDraftUpdate(BaseModel):
    snapshot: WorkflowProject
    expected_revision: int = Field(..., ge=1)


class WorkflowDraftRead(UTCModel):
    id: str
    project_id: str
    name: str
    revision: int
    snapshot: WorkflowProject
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ValidationRunCreate(BaseModel):
    mode: Literal["fixture", "passthrough"] = "passthrough"
    expected_events: Optional[list[ExpectedWorkflowRunEvent]] = None


class ValidationRunRead(UTCModel):
    id: str
    draft_id: str
    draft_revision: int
    status: str
    compile_valid: bool
    compile_errors: Optional[list[dict[str, Any]]] = None
    conformance_mode: str
    expected_events: Optional[list[dict[str, Any]]] = None
    conformance_result: Optional[dict[str, Any]] = None
    runtime_passport: Optional[dict[str, Any]] = None
    run_id: Optional[str] = None
    failure_reason: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class WorkflowDraftPublishRequest(BaseModel):
    validation_run_id: str = Field(..., min_length=1)
    expected_revision: int = Field(..., ge=1)


class WorkflowVersionRead(UTCModel):
    id: str
    project_id: str
    draft_id: Optional[str] = None
    version_number: int
    source_revision: int
    validation_run_id: str
    snapshot: WorkflowProject
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


__all__ = [
    "WorkspaceCreate",
    "WorkspaceUpdate",
    "WorkspaceRead",
    "WorkspaceSettingsUpdate",
    "WorkspaceSettingsRead",
    "ProjectCreate",
    "ProjectRead",
    "WorkflowDraftCreate",
    "WorkflowDraftUpdate",
    "WorkflowDraftRead",
    "ValidationRunCreate",
    "ValidationRunRead",
    "WorkflowDraftPublishRequest",
    "WorkflowVersionRead",
    "ConformanceCaseResult",
    "RuntimePassport",
]
