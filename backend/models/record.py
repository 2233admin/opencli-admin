from typing import TYPE_CHECKING, Optional

from sqlalchemy import JSON, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.models.base import TimestampMixin

if TYPE_CHECKING:
    from backend.models.task import CollectionTask


class CollectedRecord(TimestampMixin):
    """A single data record collected from a source."""

    __tablename__ = "collected_records"
    __table_args__ = (
        UniqueConstraint("source_id", "content_hash", name="uq_source_content"),
        # Non-unique: identity_key is a supplementary dedup key (C7), not a
        # replacement for content_hash. Several rows sharing NULL is normal
        # for channels that don't implement identity().
        Index("ix_collected_records_source_identity", "source_id", "identity_key"),
    )

    task_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("collection_tasks.id", ondelete="CASCADE"), nullable=False
    )
    source_id: Mapped[str] = mapped_column(String(36), nullable=False)

    # Raw data as returned by the channel
    raw_data: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    # Normalized standard fields: title, url, content, author, published_at, ...
    normalized_data: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    # AI-enriched fields: summary, tags, sentiment, ...
    ai_enrichment: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)

    # SHA-256 hash of normalized content for deduplication
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)

    # Stable source-native id (RSS entry id, tweet id, ...) from the channel's
    # identity() (C7). NULL for channels that don't implement it — those keep
    # deduplicating on content_hash alone, unchanged. When present, it's a
    # supplementary key: an item whose identity matches an existing row gets
    # updated in place instead of inserted as a new row when its content
    # changes (e.g. a feed fixing a typo in a title no longer duplicates).
    identity_key: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)

    # Processing status
    # raw | normalized | ai_processed | notified | error
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="raw")
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Relationship
    task: Mapped["CollectionTask"] = relationship("CollectionTask", back_populates="records")
