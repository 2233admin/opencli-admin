"""Integration test for the static SKILL.md route — PR-H (GOAL-5.md).

`GET /skills/agent_access/SKILL.md` must serve the exact, generated,
committed file (see backend/scripts/generate_skill_md.py and
tests/skills/test_skill_md_drift.py) with no auth and no transformation —
this is the URL an agent platform would fetch to "install" the skill.
"""

from backend.scripts.generate_skill_md import OUTPUT_PATH


async def test_skill_md_is_served_statically_and_matches_committed_file(client):
    response = await client.get("/skills/agent_access/SKILL.md")

    assert response.status_code == 200
    assert response.text == OUTPUT_PATH.read_text(encoding="utf-8")


async def test_skill_md_static_route_requires_no_auth(client):
    # No Authorization header, no API key — matches GOAL-5.md 架构决策 #1
    # (anonymous public access) for the whole /api/public + /skills surface.
    response = await client.get("/skills/agent_access/SKILL.md")
    assert response.status_code == 200
