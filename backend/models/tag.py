from sqlalchemy import Index, String
from sqlalchemy.orm import Mapped, mapped_column

from backend.models.base import TimestampMixin


class Tag(TimestampMixin):
    """A taxonomy tag: either a top-level category or a free-form subtag.

    Mirrors the Dify Tag/TagBinding pattern (tenant_id dropped — opencli-admin
    has no multi-tenancy concept). No DB-level enum for `type`; validity of
    "category" values against the closed set lives in backend/taxonomy.py and
    is enforced at the service layer (see TagService, a later PR).
    """

    __tablename__ = "tags"
    __table_args__ = (Index("ix_tags_type_name", "type", "name"),)

    # category | subtag
    type: Mapped[str] = mapped_column(String(20), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)


class TagBinding(TimestampMixin):
    """Binds a Tag to a target record.

    No DB-level foreign keys on tag_id/target_id — intentional, copies the
    Dify pattern where referential integrity is enforced at the service layer
    rather than via DB constraints. target_id points at collected_records.id.
    """

    __tablename__ = "tag_bindings"

    tag_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    target_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
