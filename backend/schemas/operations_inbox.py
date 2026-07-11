from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from backend.schemas.common import UTCModel


class OperationsWorkItemRead(UTCModel):
    id: str
    workspace_id: str
    type: str
    status: str
    severity: str
    priority: str
    owning_team_id: str | None = None
    assignee_id: str | None = None
    author_actor_type: str | None = None
    author_actor_id: str | None = None
    evidence: dict[str, Any] = Field(default_factory=dict)
    reason: str | None = None
    parent_id: str | None = None
    proposal_id: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ApprovalDecision(BaseModel):
    decision: Literal["approve", "reject", "request_changes"]
    reason: str = Field(min_length=1, max_length=2000)


class ApprovalDecisionRead(BaseModel):
    approval: OperationsWorkItemRead
    proposal: OperationsWorkItemRead
    execution_state: Literal[
        "awaiting_additional_approval",
        "awaiting_actuator",
        "changes_requested",
        "denied",
    ]
