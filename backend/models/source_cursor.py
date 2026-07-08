from sqlalchemy import JSON, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from backend.models.base import TimestampMixin


class SourceCursor(TimestampMixin):
    """Per-source incremental cursor — the channel's "where we left off".

    One row per source: an etag/last_modified for RSS, a since_id/page_token for
    others. ``DBCursorStore`` reads/writes this. The cursor only advances once
    collected data has reached a reliable write layer, so a crash or a failed
    write re-fetches instead of silently skipping.
    """

    __tablename__ = "source_cursors"
    __table_args__ = (
        UniqueConstraint("source_id", name="uq_source_cursors_source_id"),
    )

    source_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    cursor: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
