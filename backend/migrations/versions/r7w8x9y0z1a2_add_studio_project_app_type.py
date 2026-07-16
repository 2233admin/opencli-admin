"""add persisted Dify application type to Studio projects

Revision ID: r7w8x9y0z1a2
Revises: q6v7w8x9y0z1
"""

import re

import sqlalchemy as sa
from alembic import op

revision = "r7w8x9y0z1a2"
down_revision = "q6v7w8x9y0z1"
branch_labels = None
depends_on = None


def _legacy_app_type(name: str | None, description: str | None, slug: str | None) -> str:
    """Preserve the removed Studio classifier exactly during the one-time backfill."""
    normalized = f"{name or ''} {description or ''} {slug or ''}".lower()
    if re.search(r"chatflow|对话流|会话流", normalized):
        return "chatflow"
    if re.search(r"\bagent\b|智能体|专题研究|research", normalized, flags=re.ASCII):
        return "agent"
    if re.search(r"chatbot|聊天|客服|问答", normalized):
        return "chatbot"
    if re.search(r"text.generator|文本生成|文案|摘要|翻译|写作", normalized):
        return "text-generator"
    return "workflow"


def upgrade() -> None:
    with op.batch_alter_table("studio_projects") as batch:
        batch.add_column(
            sa.Column(
                "app_type",
                sa.String(length=32),
                nullable=False,
                server_default="workflow",
            )
        )

    bind = op.get_bind()
    projects = bind.execute(
        sa.text("SELECT id, name, description, slug FROM studio_projects")
    ).mappings()
    updates = [
        {
            "project_id": project["id"],
            "app_type": _legacy_app_type(
                project["name"], project["description"], project["slug"]
            ),
        }
        for project in projects
    ]
    if updates:
        bind.execute(
            sa.text(
                "UPDATE studio_projects SET app_type = :app_type WHERE id = :project_id"
            ),
            updates,
        )

    with op.batch_alter_table("studio_projects") as batch:
        batch.create_check_constraint(
            "ck_studio_projects_app_type",
            "app_type IN ('chatbot', 'agent', 'chatflow', 'workflow', 'text-generator')",
        )


def downgrade() -> None:
    with op.batch_alter_table("studio_projects") as batch:
        batch.drop_constraint("ck_studio_projects_app_type", type_="check")
        batch.drop_column("app_type")
