import pytest

from backend.migrations.versions.r7w8x9y0z1a2_add_studio_project_app_type import (
    _legacy_app_type,
)


@pytest.mark.parametrize(
    ("name", "description", "slug", "expected"),
    [
        ("Chatflow Support", None, "support", "chatflow"),
        ("专题研究 Agent", None, "research", "agent"),
        ("聊天客服", None, "support", "chatbot"),
        ("每日摘要", None, "brief", "text-generator"),
        ("普通项目", None, "project", "workflow"),
        ("Reagent analysis", None, "chemistry", "workflow"),
        ("Text", None, "text_generator", "text-generator"),
        ("智能Agent助手", None, "assistant", "agent"),
        ("Under score", None, "under_agent_score", "workflow"),
    ],
)
def test_legacy_app_type_backfill_matches_removed_studio_classifier(
    name: str,
    description: str | None,
    slug: str,
    expected: str,
) -> None:
    assert _legacy_app_type(name, description, slug) == expected
