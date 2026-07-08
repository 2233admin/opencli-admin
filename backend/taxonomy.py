"""Closed top-level content category set (仿 Dify Tag 机制, 分类名自定义).

Seed values are a placeholder proposal (架构决策 #4 in GOAL-5.md) accepted
as-is. This is the single source of truth for valid `category`-type Tag
names; do not hardcode the category list anywhere else.
"""

TOP_LEVEL_CATEGORIES: tuple[str, ...] = (
    "模型能力",
    "产品动态",
    "行业资讯",
    "研究论文",
    "工程实践",
    "其它",
)


def is_valid_category(name: str) -> bool:
    """Return True if `name` is one of the closed top-level categories."""
    return name in TOP_LEVEL_CATEGORIES
