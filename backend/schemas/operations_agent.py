from datetime import datetime

from pydantic import BaseModel, Field, model_validator

from backend.models.operations_agent import AgentProfileMode
from backend.schemas.common import UTCModel


class OperationsAgentCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=4000)
    owning_team_id: str


class OperationsAgentPatch(BaseModel):
    disabled: bool


class OperationsAgentDraftUpdate(BaseModel):
    instructions: str = Field(min_length=1, max_length=20000)
    model_configuration: dict = Field(default_factory=dict)
    tool_configuration: dict = Field(default_factory=dict)


class OperationsAgentDraftRead(UTCModel):
    revision: int
    instructions: str
    model_configuration: dict
    tool_configuration: dict
    updated_by_user_id: str
    updated_at: datetime

    model_config = {"from_attributes": True}


class OperationsAgentPublish(BaseModel):
    reason: str = Field(min_length=1, max_length=2000)


class PublishedOperationsAgentVersionRead(UTCModel):
    version: int
    draft_revision: int
    instructions: str
    model_configuration: dict
    tool_configuration: dict
    published_by_user_id: str
    reason: str
    created_at: datetime

    model_config = {"from_attributes": True}


class OperationsAgentRunCreate(BaseModel):
    target_resource_type: str = Field(min_length=1, max_length=100)
    target_resource_id: str = Field(min_length=1, max_length=255)


class OperationsAgentRunRead(UTCModel):
    id: str
    workspace_id: str
    operations_agent_id: str
    published_version: int
    profile_version: int
    trigger_type: str
    trigger_reference: str | None
    target_resource_type: str
    target_resource_id: str
    status: str
    started_by_user_id: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class AgentProfileCreate(BaseModel):
    mode: AgentProfileMode
    tool_scope: list[str] = Field(default_factory=list)
    resource_scope: list[str] = Field(default_factory=list)
    action_scope: list[str] = Field(default_factory=list)
    reason: str = Field(min_length=1, max_length=2000)

    @model_validator(mode="after")
    def automatic_profile_is_explicitly_scoped(self):
        scopes = (self.tool_scope, self.resource_scope, self.action_scope)
        if self.mode == AgentProfileMode.LOW_RISK_AUTOMATIC and (
            not all(scopes) or any("*" in value for scope in scopes for value in scope)
        ):
            raise ValueError(
                "Low-Risk Automatic requires explicit tool, resource, and action scopes"
            )
        return self


class AgentProfileRead(UTCModel):
    version: int
    mode: str
    tool_scope: list[str]
    resource_scope: list[str]
    action_scope: list[str]
    assigned_by_user_id: str
    reason: str
    created_at: datetime

    model_config = {"from_attributes": True}


class OperationsAgentRead(UTCModel):
    id: str
    workspace_id: str
    owning_team_id: str
    name: str
    description: str | None
    disabled: bool
    current_profile: AgentProfileRead
    effective_profile: AgentProfileRead | None
    created_at: datetime
    updated_at: datetime
