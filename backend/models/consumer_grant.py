from datetime import datetime

from sqlalchemy import JSON, Boolean, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from backend.models.base import TimestampMixin


class ConsumerGrant(TimestampMixin):
    __tablename__ = "consumer_grants"
    __table_args__ = (UniqueConstraint("service_identity_id", "name"),)

    service_identity_id: Mapped[str] = mapped_column(
        ForeignKey("service_identities.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    resource_scope: Mapped[dict] = mapped_column(JSON, nullable=False)
    data_scope: Mapped[dict] = mapped_column(JSON, nullable=False)
    quota: Mapped[dict] = mapped_column(JSON, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_by_user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    revoked_at: Mapped[datetime | None] = mapped_column(nullable=True)
    revoked_by_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=True
    )
    revocation_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
