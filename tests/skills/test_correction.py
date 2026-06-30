"""Issue 06: journey_trace_v1 shape + re-distill correction path.

Browser-free, provider-free, network-free — green under ``pytest -m "not live"``
(``asyncio_mode = "auto"``). Covers:

  * acceptance #1 — ``assemble_trace`` builds the shared shape and a trace from it
    survives a round trip through the distiller (``distill_trace`` reads only
    ``summary.domain`` / ``label`` / ``trace_id``), with ``call_llm`` stubbed;
  * acceptance #3 / #5 — ``re_distill`` bumps ``version`` by exactly 1, appends
    exactly one ``evidence`` entry, and **replaces** ``skill_md`` / ``elements``
    from ``to_skill_fields(spec)`` with no field hand-patched (``distill_trace``
    stubbed to a fixed spec);
  * the ``self_eval`` signal reflects the run outcome vs the skill's
    terminal/milestone conditions.

Uses the in-memory SQLite ``db_session`` fixture from ``tests/conftest.py``.
"""

from typing import Any

from backend.models.skill import Skill
from backend.skills import correction, distill
from backend.skills.trace import assemble_trace, outcome_from_loop, self_eval

# A fixed distilled spec the stubbed distiller returns (acceptance #5 shape).
FIXED_SPEC: dict[str, Any] = {
    "skill_name": "x",
    "scope": "s",
    "skill_md": "NEW MD",
    "preconditions": ["pre"],
    "procedure": ["p"],
    "milestones": ["m"],
    "terminal_conditions": ["t"],
    "false_terminal_states": ["f"],
    "recovery_policies": ["r"],
    "anti_drift_boundaries": ["a"],
    "red_lines": ["rl"],
    "domain": "d",
    "capability": "c",
    "source_trace": "t1",
    "distill_model": "m",
}

PRIOR_ELEMENTS = {
    "preconditions": ["old-pre"],
    "procedure": ["old step"],
    "milestones": ["old milestone"],
    "terminal_conditions": ["old terminal"],
    "false_terminal_states": ["old false"],
    "recovery_policies": [],
    "anti_drift_boundaries": [],
    "red_lines": ["old red line"],
}


async def _seed_skill(session) -> Skill:
    skill = Skill(
        domain="d",
        capability="c",
        name="seed-skill",
        scope="seed scope",
        skill_md="OLD MD",
        elements=dict(PRIOR_ELEMENTS),
        evidence=[{"event": "distilled", "at": "2026-01-01T00:00:00+00:00"}],
        version=1,
        status="active",
    )
    session.add(skill)
    await session.flush()
    await session.commit()
    return skill


# ── acceptance #3 / #5: re_distill bumps version, appends evidence, replaces body ─
async def test_re_distill_bumps_version_and_replaces_from_spec(db_session, monkeypatch):
    skill = await _seed_skill(db_session)
    prior_evidence = len(skill.evidence)

    async def fake_distill(trace, provider=None):
        # Mirror distill_trace's contract: return a fully-formed spec.
        return dict(FIXED_SPEC)

    # Stub the symbol correction.py imported (no network, no provider needed).
    monkeypatch.setattr(correction, "distill_trace", fake_distill)

    trace = assemble_trace(
        [{"action": "navigate", "target": "x", "result": "err", "ms": 5}],
        {"status": "failed", "milestones_hit": [], "terminal_check": False},
        domain="d",
        label="c",
        trace_id="t1",
    )

    updated = await correction.re_distill(db_session, skill, trace, provider={"model": "m"})

    # version bumped by EXACTLY 1
    assert updated.version == 2
    # exactly one new evidence entry, and it's a "corrected" record
    assert len(updated.evidence) == prior_evidence + 1
    last = updated.evidence[-1]
    assert last["event"] == "corrected"
    assert last["from_version"] == 1
    assert last["to_version"] == 2
    assert last["trace_id"] == "t1"
    # skill_md / elements REPLACED from to_skill_fields(spec) — not hand-patched
    expected = distill.to_skill_fields(FIXED_SPEC)
    assert updated.skill_md == "NEW MD"
    assert updated.elements == expected["elements"]
    assert updated.distill_model == "m"
    assert updated.source_trace == "t1"

    # persisted: reload from the DB and re-check the durable mutations.
    reloaded = await db_session.get(Skill, skill.id)
    assert reloaded.version == 2
    assert reloaded.skill_md == "NEW MD"
    assert len(reloaded.evidence) == prior_evidence + 1


async def test_re_distill_accepts_trace_list_uses_most_recent(db_session, monkeypatch):
    skill = await _seed_skill(db_session)
    seen: dict[str, Any] = {}

    async def fake_distill(trace, provider=None):
        seen["trace_id"] = trace.get("trace_id")
        return dict(FIXED_SPEC)

    monkeypatch.setattr(correction, "distill_trace", fake_distill)

    t_old = assemble_trace([], {"status": "failed"}, domain="d", label="c", trace_id="old")
    t_new = assemble_trace([], {"status": "failed"}, domain="d", label="c", trace_id="new")

    await correction.re_distill(db_session, skill, [t_old, t_new], provider={"model": "m"})

    # v1 keeps it simple: distill the most recent (last) trace.
    assert seen["trace_id"] == "new"
    assert skill.version == 2


async def test_re_distill_empty_traces_raises(db_session, monkeypatch):
    skill = await _seed_skill(db_session)
    monkeypatch.setattr(correction, "distill_trace", lambda *a, **k: None)
    import pytest

    with pytest.raises(ValueError):
        await correction.re_distill(db_session, skill, [], provider={"model": "m"})
    # nothing mutated on the failed precondition
    assert skill.version == 1


# ── acceptance #1: trace shape + distiller round trip ───────────────────────────
def test_assemble_trace_shape():
    t = assemble_trace(
        [{"action": "navigate", "target": "x", "result": "ok", "ms": 5}],
        {"status": "success", "milestones_hit": [], "terminal_check": True},
        domain="binance",
        label="funding rates",
        trace_id="t1",
    )
    assert t["schema"] == "journey_trace_v1"
    assert "steps" in t and len(t["steps"]) == 1
    assert t["summary"]["domain"] == "binance"
    assert t["label"] == "funding rates"
    assert t["trace_id"] == "t1"
    assert "outcome" in t and t["outcome"]["status"] == "success"


async def test_trace_round_trips_through_distiller(monkeypatch):
    """A trace from assemble_trace survives distill_trace unchanged (it reads only
    summary.domain / label / trace_id). call_llm stubbed to a fixed JSON."""
    import json

    async def fake_call_llm(system, user, provider):
        return json.dumps(
            {
                "skill_name": "funding rates",
                "scope": "read funding",
                "procedure": ["open"],
                "skill_md": "# md",
            }
        )

    monkeypatch.setattr(distill, "call_llm", fake_call_llm)

    t = assemble_trace(
        [{"action": "navigate", "target": "x", "result": "ok", "ms": 5}],
        {"status": "success", "milestones_hit": [], "terminal_check": True},
        domain="binance",
        label="funding rates",
        trace_id="t1",
    )
    spec = await distill.distill_trace(t)
    assert spec["domain"] == "binance"
    assert spec["source_trace"] == "t1"
    assert spec["capability"] == "funding-rates"


# ── self_eval signal ────────────────────────────────────────────────────────────
def test_self_eval_pass_on_success():
    elements = {"terminal_conditions": ["list shown"], "milestones": ["rows visible"]}
    outcome = outcome_from_loop(
        "done_success", milestones_hit=["rows visible"], terminal_check="accepted"
    )
    outcome["trace_id"] = "t1"
    ev = self_eval(outcome, elements)
    assert ev["event"] == "executed"
    assert ev["passed"] is True
    assert ev["terminal_met"] is True
    assert ev["milestones_hit"] == ["rows visible"]
    assert ev["outcome"] == "success"
    assert ev["trace_id"] == "t1"


def test_self_eval_fail_on_capped():
    elements = {"terminal_conditions": ["list shown"], "milestones": ["rows visible"]}
    outcome = outcome_from_loop("capped")
    ev = self_eval(outcome, elements)
    assert ev["passed"] is False
    assert ev["terminal_met"] is False
    assert ev["outcome"] == "failed"


def test_self_eval_paused_is_not_passed():
    ev = self_eval(outcome_from_loop("awaiting_confirm"), {"terminal_conditions": ["x"]})
    assert ev["outcome"] == "paused"
    assert ev["passed"] is False
