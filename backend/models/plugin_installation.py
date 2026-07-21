"""Persisted metadata for installed plugin packages."""

from __future__ import annotations

from typing import Any

from sqlalchemy import JSON, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from backend.models.base import TimestampMixin


class PluginInstallation(TimestampMixin):
    __tablename__ = "plugin_installations"
    __table_args__ = (
        UniqueConstraint(
            "provider_key",
            "version",
            "source_digest",
            name="uq_plugin_installations_provider_version_digest",
        ),
    )

    provider_key: Mapped[str] = mapped_column(String(257), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    author: Mapped[str] = mapped_column(String(128), nullable=False)
    version: Mapped[str] = mapped_column(String(64), nullable=False)
    source_kind: Mapped[str] = mapped_column(String(32), nullable=False)
    source_digest: Mapped[str] = mapped_column(String(64), nullable=False)
    manifest_spec_version: Mapped[str] = mapped_column(String(32), nullable=False)
    signature_state: Mapped[str] = mapped_column(String(32), nullable=False)
    manifest_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    capabilities_json: Mapped[list[dict[str, Any]]] = mapped_column(
        JSON, nullable=False, default=list
    )
    permissions_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    runtime_status: Mapped[str] = mapped_column(String(32), nullable=False)
    blockers_json: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False, default=list)
