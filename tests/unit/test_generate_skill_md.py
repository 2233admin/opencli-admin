"""Tests for backend/scripts/generate_skill_md.py — PR-H (GOAL-5.md).

Covers the generator's own logic (not the drift check itself — see
tests/skills/test_skill_md_drift.py for that): it must produce valid,
deterministic content that reflects backend/taxonomy.py's category set and
all three public endpoint groups (PR-E items, PR-F rss, PR-G daily/dailies).
"""

from backend.scripts.generate_skill_md import (
    OUTPUT_PATH,
    collect_endpoints,
    load_categories,
    render_skill_md,
)
from backend.taxonomy import TOP_LEVEL_CATEGORIES


def test_load_categories_is_the_taxonomy_source_of_truth():
    # Not a copy/paste of the literal tuple — asserts identity of values,
    # so a change to taxonomy.py is picked up automatically.
    assert load_categories() == TOP_LEVEL_CATEGORIES


def test_collect_endpoints_covers_all_three_pr_groups():
    endpoints = collect_endpoints()
    full_paths = {e.full_path for e in endpoints}
    assert "/api/public/items" in full_paths  # PR-E
    assert "/api/public/rss" in full_paths  # PR-F
    assert "/api/public/daily" in full_paths  # PR-G
    assert "/api/public/daily/{digest_date}" in full_paths  # PR-G
    assert "/api/public/dailies" in full_paths  # PR-G


def test_collect_endpoints_items_has_expected_query_params():
    endpoints = collect_endpoints()
    items = next(e for e in endpoints if e.full_path == "/api/public/items")
    param_names = {p.name for p in items.params}
    assert param_names == {"mode", "category", "since", "q", "take"}


def test_render_skill_md_has_valid_frontmatter():
    content = render_skill_md(load_categories(), collect_endpoints())
    lines = content.splitlines()
    assert lines[0] == "---"
    closing_indices = [i for i, line in enumerate(lines) if line == "---"]
    assert len(closing_indices) >= 2, "frontmatter must open and close with ---"
    frontmatter = "\n".join(lines[1 : closing_indices[1]])
    assert "name:" in frontmatter
    assert "description:" in frontmatter


def test_render_skill_md_includes_every_category():
    content = render_skill_md(load_categories(), collect_endpoints())
    for category in TOP_LEVEL_CATEGORIES:
        assert category in content


def test_render_skill_md_includes_all_endpoint_groups():
    content = render_skill_md(load_categories(), collect_endpoints())
    assert "/api/public/items" in content
    assert "/api/public/rss" in content
    assert "/api/public/daily" in content
    assert "/api/public/dailies" in content


def test_render_skill_md_never_mentions_internal_fields():
    # This is an agent-facing doc — it must not advertise raw_data/
    # normalized_data as something callers can request or expect back.
    content = render_skill_md(load_categories(), collect_endpoints())
    assert "raw_data" not in content or "never exposed" in content
    assert "normalized_data" not in content or "never exposed" in content


def test_render_skill_md_is_deterministic():
    first = render_skill_md(load_categories(), collect_endpoints())
    second = render_skill_md(load_categories(), collect_endpoints())
    assert first == second


def test_output_path_points_at_the_required_location():
    assert OUTPUT_PATH.as_posix().endswith("backend/skills/agent_access/SKILL.md")
