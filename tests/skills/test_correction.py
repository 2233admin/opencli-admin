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

from types import SimpleNamespace
from typing import Any

import pytest

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
    # rollback safety net (2026-07-01): v(n)'s actual body stashed on the
    # 'corrected' entry, not just its version number.
    assert last["prev_skill_md"] == "OLD MD"
    assert last["prev_elements"] == PRIOR_ELEMENTS

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

    with pytest.raises(ValueError):
        await correction.re_distill(db_session, skill, [], provider={"model": "m"})
    # nothing mutated on the failed precondition
    assert skill.version == 1


# ── rollback_correction (2026-07-01 addendum): undo a bad re-distill ───────────
async def test_rollback_correction_restores_prev_body_and_decrements_version(
    db_session, monkeypatch
):
    skill = await _seed_skill(db_session)

    async def fake_distill(trace, provider=None):
        return dict(FIXED_SPEC)

    monkeypatch.setattr(correction, "distill_trace", fake_distill)
    trace = assemble_trace([], {"status": "failed"}, domain="d", label="c", trace_id="t1")
    await correction.re_distill(db_session, skill, trace, provider={"model": "m"})
    assert skill.version == 2
    assert skill.skill_md == "NEW MD"

    rolled_back = await correction.rollback_correction(db_session, skill)

    assert rolled_back.version == 1
    assert rolled_back.skill_md == "OLD MD"
    assert rolled_back.elements == PRIOR_ELEMENTS
    last = rolled_back.evidence[-1]
    assert last["event"] == "rolled_back"
    assert last["from_version"] == 2
    assert last["to_version"] == 1

    reloaded = await db_session.get(Skill, skill.id)
    assert reloaded.version == 1
    assert reloaded.skill_md == "OLD MD"


async def test_rollback_correction_no_prior_correction_raises(db_session):
    skill = await _seed_skill(db_session)  # only a 'distilled' evidence entry
    with pytest.raises(ValueError):
        await correction.rollback_correction(db_session, skill)


async def test_rollback_correction_twice_raises(db_session, monkeypatch):
    skill = await _seed_skill(db_session)

    async def fake_distill(trace, provider=None):
        return dict(FIXED_SPEC)

    monkeypatch.setattr(correction, "distill_trace", fake_distill)
    trace = assemble_trace([], {"status": "failed"}, domain="d", label="c", trace_id="t1")
    await correction.re_distill(db_session, skill, trace, provider={"model": "m"})

    await correction.rollback_correction(db_session, skill)

    with pytest.raises(ValueError):
        await correction.rollback_correction(db_session, skill)


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


def test_self_eval_carries_loop_outcome_through():
    """`outcome` collapses done_failed/capped/error to "failed"; `loop_outcome`
    keeps the un-collapsed vocabulary so a consumer (maybe_propose_correction)
    can still tell them apart."""
    ev = self_eval(outcome_from_loop("error"), {})
    assert ev["outcome"] == "failed"
    assert ev["loop_outcome"] == "error"

    ev2 = self_eval(outcome_from_loop("done_failed"), {})
    assert ev2["outcome"] == "failed"
    assert ev2["loop_outcome"] == "done_failed"


# ── self_eval terminal_conditions grounding (2026-07-01 fix) ────────────────────
# Before this fix, `terminal_met` was `succeeded` in BOTH the declared and
# undeclared `terminal_conditions` branches — a declared terminal_conditions
# element was never actually checked against anything (dead branch).
def test_self_eval_distrusts_success_when_terminal_condition_never_observed():
    elements = {"terminal_conditions": ["list page shown"]}
    outcome = outcome_from_loop(
        "done_success", terminal_check="accepted",
        extra={"terminal_conditions_hit": []},  # declared phrase never seen
    )
    ev = self_eval(outcome, elements)
    assert ev["terminal_met"] is False
    assert ev["passed"] is False


def test_self_eval_trusts_success_when_terminal_condition_observed():
    elements = {"terminal_conditions": ["list page shown"]}
    outcome = outcome_from_loop(
        "done_success", terminal_check="accepted",
        extra={"terminal_conditions_hit": ["list page shown"]},
    )
    ev = self_eval(outcome, elements)
    assert ev["terminal_met"] is True
    assert ev["passed"] is True


def test_self_eval_falls_back_to_succeeded_when_caller_omits_grounding_signal():
    """A caller that never computes terminal_conditions_hit (e.g. code outside
    skill_channel calling self_eval directly) keeps the old succeeded-only
    trust — not a silent False."""
    elements = {"terminal_conditions": ["list page shown"]}
    ev = self_eval(outcome_from_loop("done_success", terminal_check="accepted"), elements)
    assert ev["terminal_met"] is True
    assert ev["passed"] is True


# ── v2 auto-trigger: maybe_propose_correction (grilled 2026-07-01) ──────────────
_SKILL = SimpleNamespace(id="s1", domain="d", capability="c")


def _executed(
    passed: bool, loop_outcome: str = "done_failed", trace_id: str = "t"
) -> dict[str, Any]:
    return {
        "event": "executed", "passed": passed,
        "loop_outcome": loop_outcome, "trace_id": trace_id,
    }


def test_maybe_propose_correction_triggers_after_n_straight_fails():
    evidence = [_executed(False, trace_id=f"t{i}") for i in range(3)]
    proposed = correction.maybe_propose_correction(_SKILL, evidence, n=3)
    assert proposed is True
    assert evidence[-1]["event"] == "correction_proposed"
    assert evidence[-1]["trace_ids"] == ["t0", "t1", "t2"]
    assert evidence[-1]["prior_redistill_count"] == 0  # never redistilled before


def test_maybe_propose_correction_counts_prior_redistills():
    evidence = [
        {"event": "corrected", "from_version": 1, "to_version": 2},
        {"event": "corrected", "from_version": 2, "to_version": 3},
        *[_executed(False, trace_id=f"t{i}") for i in range(3)],
    ]
    proposed = correction.maybe_propose_correction(_SKILL, evidence, n=3)
    assert proposed is True
    assert evidence[-1]["prior_redistill_count"] == 2


def test_maybe_propose_correction_not_yet_at_threshold():
    evidence = [_executed(False), _executed(False)]  # only 2 of 3
    assert correction.maybe_propose_correction(_SKILL, evidence, n=3) is False
    assert len(evidence) == 2  # untouched


def test_maybe_propose_correction_one_success_breaks_the_streak():
    evidence = [_executed(False), _executed(True), _executed(False), _executed(False)]
    assert correction.maybe_propose_correction(_SKILL, evidence, n=3) is False


def test_maybe_propose_correction_ignores_error_outcome_runs():
    """A `loop_outcome == "error"` run (CDP drop / network blip) is environment
    noise, not a skill defect — it must not count toward, or break, the streak."""
    evidence = [
        _executed(False, loop_outcome="done_failed"),
        _executed(False, loop_outcome="error"),  # noise — skipped entirely
        _executed(False, loop_outcome="capped"),
        _executed(False, loop_outcome="done_failed"),
    ]
    proposed = correction.maybe_propose_correction(_SKILL, evidence, n=3)
    assert proposed is True
    # the 3 non-error fails are the ones cited, in order, error excluded.
    assert len(evidence[-1]["trace_ids"]) == 3


def test_maybe_propose_correction_resets_after_corrected():
    evidence = [
        _executed(False), _executed(False),  # old streak, pre re-distill
        {"event": "corrected", "from_version": 1, "to_version": 2},
        _executed(False), _executed(False),  # v2's own streak so far: only 2
    ]
    assert correction.maybe_propose_correction(_SKILL, evidence, n=3) is False


def test_maybe_propose_correction_resets_after_dismissed():
    evidence = [
        _executed(False), _executed(False), _executed(False),
        {"event": "correction_dismissed", "at": "x"},
        _executed(False), _executed(False),  # fresh streak: only 2 since dismiss
    ]
    assert correction.maybe_propose_correction(_SKILL, evidence, n=3) is False


def test_maybe_propose_correction_no_duplicate_proposal():
    evidence = [_executed(False) for _ in range(3)]
    assert correction.maybe_propose_correction(_SKILL, evidence, n=3) is True
    before = len(evidence)
    # a 4th fail piles on, but a proposal is already open past the boundary.
    evidence.append(_executed(False))
    assert correction.maybe_propose_correction(_SKILL, evidence, n=3) is False
    assert len(evidence) == before + 1  # only the manual append above, no 2nd proposal
