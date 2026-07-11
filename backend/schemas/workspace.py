from datetime import datetime

from pydantic import BaseModel, Field

from backend.models.identity import WorkspaceRole
from backend.schemas.common import UTCModel


class WorkspaceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    slug: str = Field(min_length=1, max_length=100, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
    first_admin_subject: str = Field(min_length=1, max_length=255)
    first_admin_email: str | None = Field(default=None, max_length=320)
    first_admin_display_name: str | None = Field(default=None, max_length=255)


class WorkspaceStatusUpdate(BaseModel):
    active: bool


class WorkspaceRead(UTCModel):
    id: str
    name: str
    slug: str
    active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class WorkspaceMemberCreate(BaseModel):
    subject: str = Field(min_length=1, max_length=255)
    email: str | None = Field(default=None, max_length=320)
    display_name: str | None = Field(default=None, max_length=255)
    role: WorkspaceRole


class WorkspaceMemberRoleUpdate(BaseModel):
    role: WorkspaceRole


class WorkspaceMemberRead(UTCModel):
    user_id: str
    subject: str
    email: str | None
    display_name: str | None
    disabled: bool
    role: WorkspaceRole
    created_at: datetime


class WorkspaceCreatedRead(UTCModel):
    id: str
    name: str
    slug: str
    active: bool
    first_admin: WorkspaceMemberRead
    created_at: datetime
