"""Drift check for backend/skills/agent_access/SKILL.md — PR-H (GOAL-5.md).

架构决策 #9: SKILL.md is generated, not hand-written, and CI must fail if the
committed file no longer matches what `backend/scripts/generate_skill_md.py`
would produce right now (e.g. someone added a category to
`backend/taxonomy.py` or changed a query-param description in
`backend/api/public/*.py` and forgot to re-run the generator).

How to run just this check:
    uv run pytest tests/skills/test_skill_md_drift.py -q
    # or, without pytest at all:
    uv run python backend/scripts/generate_skill_md.py --check

When this goes red: any edit to `backend/taxonomy.py`'s
`TOP_LEVEL_CATEGORIES`, or to a query/path parameter's name, default, or
`description=...` on any route in `backend/api/public/{items,rss,daily}.py`,
that isn't followed by re-running the generator and committing the result.
Fix: `uv run python backend/scripts/generate_skill_md.py`, then `git add
backend/skills/agent_access/SKILL.md`.
"""

from backend.scripts.generate_skill_md import (
    OUTPUT_PATH,
    collect_endpoints,
    load_categories,
    render_skill_md,
)


def test_committed_skill_md_matches_generator_output():
    assert OUTPUT_PATH.exists(), (
        f"{OUTPUT_PATH} is missing — run "
        "`uv run python backend/scripts/generate_skill_md.py` and commit it."
    )
    generated = render_skill_md(load_categories(), collect_endpoints())
    committed = OUTPUT_PATH.read_text(encoding="utf-8")
    assert committed == generated, (
        "backend/skills/agent_access/SKILL.md is stale relative to "
        "backend/taxonomy.py + backend/api/public/*.py route definitions. "
        "Re-run `uv run python backend/scripts/generate_skill_md.py` and "
        "commit the regenerated file."
    )
