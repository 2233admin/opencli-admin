from typing import TYPE_CHECKING, Optional

from sqlalchemy import JSON, Boolean, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.models.base import TimestampMixin

if TYPE_CHECKING:
    from backend.models.task import CollectionTask
    from backend.models.schedule import CronSchedule


class DataSource(TimestampMixin):
    """Represents a data source with channel configuration."""

    __tablename__ = "data_sources"

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Channel type: opencli | web_scraper | api | rss | cli
    channel_type: Mapped[str] = mapped_column(String(50), nullable=False)
    channel_config: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    # Write destination strategy (strangler-fig): which sink persists collected
    # items. legacy | odp_shadow | odp_dual_required | odp_primary | odp_only.
    # Default 'legacy' preserves the original DB write (with its env-gated ODP
    # shadow-forward). See backend.pipeline.sinks.strategy.select_sink.
    write_strategy: Mapped[str] = mapped_column(
        String(32), nullable=False, default="legacy", server_default="legacy"
    )

    # Optional AI processing config
    ai_config: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)

    # Per-source SourceObjective override (issue 02: per-source objective
    # override). Null means "no override, use the global default
    # SourceObjective()". A partial dict is merged over defaults through
    # backend.control.objectives.resolve_objective — never read directly by
    # evaluator/policy code, which always take a resolved SourceObjective.
    objective_override: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)

    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    tags: Mapped[list] = mapped_column(JSON, nullable=False, default=list)

    # Relationships
    tasks: Mapped[list["CollectionTask"]] = relationship(
        "CollectionTask", back_populates="source", cascade="all, delete-orphan"
    )
    schedules: Mapped[list["CronSchedule"]] = relationship(
        "CronSchedule", back_populates="source", cascade="all, delete-orphan"
    )
