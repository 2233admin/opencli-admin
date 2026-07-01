"""add cookie_jar table

Revision ID: t0o1p2q3r4s5
Revises: s9n0o1p2q3r4
Create Date: 2026-07-02

Domain-keyed encrypted cookie store fed by a CookieCloud sync (backend/auth/
cookiecloud_sync.py). Deliberately not source_credentials — a sync yields a
whole browser's cookie jar (many domains at once), not one secret scoped to
one DataSource.
"""
import sqlalchemy as sa
from alembic import op

revision = "t0o1p2q3r4s5"
down_revision = "s9n0o1p2q3r4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "cookie_jar",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("domain", sa.String(length=255), nullable=False),
        sa.Column("cookie_name", sa.String(length=255), nullable=False),
        sa.Column("ciphertext", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("domain", "cookie_name", name="uq_cookie_jar_domain_name"),
    )
    op.create_index("ix_cookie_jar_domain", "cookie_jar", ["domain"])


def downgrade() -> None:
    op.drop_index("ix_cookie_jar_domain", table_name="cookie_jar")
    op.drop_table("cookie_jar")
