from sqlalchemy import JSON, Boolean, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from backend.models.base import TimestampMixin


class Automation(TimestampMixin):
    """Provider-neutral scheduled agent task, configurable by UI or API."""

    __tablename__ = "automations"

    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    precheck: Mapped[str | None] = mapped_column(Text, nullable=True)
    executor: Mapped[str] = mapped_column(String(64), nullable=False)
    schedule: Mapped[str] = mapped_column(String(255), nullable=False)
    timezone: Mapped[str] = mapped_column(String(64), nullable=False, default="UTC")
    session_mode: Mapped[str] = mapped_column(String(32), nullable=False, default="fresh")
    approval_mode: Mapped[str] = mapped_column(String(32), nullable=False, default="suggest_changes")
    project: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_by_user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
