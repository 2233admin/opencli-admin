from sqlalchemy import JSON, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from backend.models.base import TimestampMixin


class WorkspaceSettings(TimestampMixin):
    __tablename__ = "workspace_settings"

    scope: Mapped[str] = mapped_column(String(50), nullable=False, unique=True, default="global")
    overrides: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
