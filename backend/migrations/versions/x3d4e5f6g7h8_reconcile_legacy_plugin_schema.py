"""reconcile databases created by the legacy plugin-hub migration chain

Revision ID: x3d4e5f6g7h8
Revises: u0z1a2b3c4d5
"""

import sqlalchemy as sa
from alembic import op

revision = "x3d4e5f6g7h8"
down_revision = "u0z1a2b3c4d5"
branch_labels = None
depends_on = None


def _columns(table_name: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    return {column["name"] for column in inspector.get_columns(table_name)}


def _indexes(table_name: str) -> dict[str, tuple[str, ...]]:
    inspector = sa.inspect(op.get_bind())
    return {
        index["name"]: tuple(index["column_names"]) for index in inspector.get_indexes(table_name)
    }


def upgrade() -> None:
    if "version" not in _columns("source_cursors"):
        with op.batch_alter_table("source_cursors") as batch:
            batch.add_column(sa.Column("version", sa.Integer(), nullable=False, server_default="0"))

    if "identity_key" not in _columns("collected_records"):
        with op.batch_alter_table("collected_records") as batch:
            batch.add_column(sa.Column("identity_key", sa.String(length=512), nullable=True))

    index_name = "ix_collected_records_source_identity"
    indexes = _indexes("collected_records")
    expected_columns = ("source_id", "identity_key")
    if index_name in indexes and indexes[index_name] != expected_columns:
        raise RuntimeError(
            f"{index_name} has columns {indexes[index_name]}, expected {expected_columns}"
        )
    if index_name not in indexes:
        op.create_index(
            index_name,
            "collected_records",
            ["source_id", "identity_key"],
            unique=False,
        )


def downgrade() -> None:
    # These columns also belong to the canonical migration path. Removing them
    # would damage databases that reached this revision from current main.
    pass
