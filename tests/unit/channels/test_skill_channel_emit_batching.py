"""Unit tests for skill_channel's AUDIT C24 event-batching refactor:
_emit_loop_events must build plain dict payloads (not pre-built
events.emit(...) coroutines) so the caller can hand the whole per-run step
trace to events.emit_many in one session/commit instead of awaiting one
events.emit(...) per step.

End-to-end coverage of the real spine (events actually landing in the DB
under the right run_id/step names) already lives in
tests/skills/test_skill_channel.py — this file is the focused unit-level
check on the refactored builder function itself.
"""


def test_emit_loop_events_returns_plain_dicts_not_coroutines():
    from backend.channels.skill_channel import (
        STEP_DONE,
        STEP_EXTRACT,
        STEP_PERCEIVE,
        STEP_STEP,
        _emit_loop_events,
    )
    from backend.skills.loop import LoopResult, StepRecord

    result = LoopResult(
        steps=[
            StepRecord(index=0, verb="navigate", args={}, result={"ok": True}),
            StepRecord(index=1, verb="extract", args={}, result={"data": {"title": "x"}}),
        ],
        extracts=[{"title": "x"}],
        outcome="done_success",
        summary={"note": "ok"},
    )

    payloads = _emit_loop_events(result)

    # plain dicts — nothing here is an unawaited coroutine (which would leak
    # a "coroutine was never awaited" warning and never reach the DB).
    assert all(isinstance(p, dict) for p in payloads)

    # bracketed by a leading skill_perceive and trailing skill_done.
    assert payloads[0]["step"] == STEP_PERCEIVE
    assert payloads[-1]["step"] == STEP_DONE
    # one payload per StepRecord in order, extract verb keyed distinctly.
    assert payloads[1]["step"] == STEP_STEP
    assert payloads[2]["step"] == STEP_EXTRACT

    # every payload carries at least the keys events.emit_many/TaskRunEvent need.
    for p in payloads:
        assert "message" in p


def test_emit_loop_events_step_error_is_warning_level():
    from backend.channels.skill_channel import STEP_STEP, _emit_loop_events
    from backend.skills.loop import LoopResult, StepRecord

    result = LoopResult(
        steps=[StepRecord(index=0, verb="click", args={}, error="blocked")],
        outcome="error",
    )

    payloads = _emit_loop_events(result)
    step_payload = next(p for p in payloads if p["step"] == STEP_STEP)

    assert step_payload["level"] == "warning"
    assert "blocked" in step_payload["message"]


def test_emit_loop_events_done_outcome_reflects_error_level():
    from backend.channels.skill_channel import STEP_DONE, _emit_loop_events
    from backend.skills.loop import LoopResult

    ok_payloads = _emit_loop_events(LoopResult(outcome="done_success"))
    done_ok = next(p for p in ok_payloads if p["step"] == STEP_DONE)
    assert done_ok["level"] == "info"

    failed_payloads = _emit_loop_events(LoopResult(outcome="done_failed"))
    done_failed = next(p for p in failed_payloads if p["step"] == STEP_DONE)
    assert done_failed["level"] == "warning"
