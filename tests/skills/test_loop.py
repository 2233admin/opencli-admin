"""End-to-end test for the cheap-model step loop (issue 03).

Browser-free + provider-free: a **fake** ``SkillPage`` (returns scripted
snapshots, no Playwright/Chrome) and a **stubbed** ``model_call`` (replays a
scripted list of tool calls). Runs under the default ``pytest -m "not live"``;
``asyncio_mode = "auto"`` means ``async def test_*`` needs no decorator.

Covers the issue-03 acceptance criteria:
  #1 build_system_prompt foregrounds the 5 loop-control elements + every ref.
  #2 SKILL_TOOLS / SKILL_TOOLS_TEXT: 7 verbs, two shapes, distinct from chat.TOOLS.
  #3 one action/step; OpenAI tool_calls AND XML <tool_use> normalize to the SAME
     executed action sequence on the same fake page.
  #4 termination: validated done (accept) ; done that trips a false_terminal_state
     is rejected and the loop continues ; max_steps cap → outcome == "capped".
     extract actions accumulate into LoopResult.extracts in order.
"""

import json
from types import SimpleNamespace

from backend.api.v1.chat import TOOLS as CHAT_TOOLS
from backend.skills.loop import (
    MAX_STEPS,
    LoopResult,
    StepRecord,
    run_skill_loop,
)
from backend.skills.prompt import (
    SKILL_TOOLS,
    SKILL_TOOLS_TEXT,
    SKILL_WRITE_VERBS,
    build_system_prompt,
)

# A small skill spec (Skill.elements shape) with a false_terminal_states trap.
ELEMENTS = {
    "procedure": ["open search", "type query", "read results"],
    "milestones": ["results visible"],
    "terminal_conditions": ["results page shown"],
    "false_terminal_states": ["still loading"],
    "red_lines": ["never pay"],
}


# ── fakes ──────────────────────────────────────────────────────────────────────
class FakePage:
    """Fake SkillPage: yields the same small snapshot every step (refs 0 & 1)."""

    def __init__(self, snap=None):
        self._snap = snap if snap is not None else [
            {"ref": 0, "role": "textbox", "name": "q", "value": ""},
            {"ref": 1, "role": "button", "name": "Search", "value": ""},
        ]
        self.calls = 0
        # page ops the executor may drive (issue 02 calls these on ref verbs)
        self.ops: list[tuple] = []

    async def snapshot(self, *a, **k):
        self.calls += 1
        return [dict(r) for r in self._snap]

    async def goto(self, url):
        self.ops.append(("goto", url))

    async def click(self, ref):
        self.ops.append(("click", ref))

    async def type(self, ref, text, submit=False):
        self.ops.append(("type", ref, text, submit))

    async def select(self, ref, value):
        self.ops.append(("select", ref, value))

    async def scroll(self, direction):
        self.ops.append(("scroll", direction))


def _openai_reply(verb, args):
    """An OpenAI-chat-shaped reply carrying one tool_call."""
    tc = SimpleNamespace(
        id="call_1",
        function=SimpleNamespace(name=verb, arguments=json.dumps(args)),
    )
    msg = SimpleNamespace(content="", tool_calls=[tc])
    return SimpleNamespace(choices=[SimpleNamespace(message=msg)])


def _xml_reply(verb, args):
    """A reply whose content carries one <tool_use> XML block (Qwen path)."""
    content = f'<tool_use name="{verb}" id="toolu_1">{json.dumps(args)}</tool_use>'
    msg = SimpleNamespace(content=content, tool_calls=None)
    return SimpleNamespace(choices=[SimpleNamespace(message=msg)])


def _scripted_model(script, builder):
    """Return an async model_call that replays ``script`` (list of (verb,args)).

    ``builder`` shapes each reply (_openai_reply or _xml_reply). When the script
    runs out it returns a clean ``done`` so a runaway loop can't hang the test.
    """
    seq = list(script)
    captured = {"tools_seen": [], "xml_seen": [], "n": 0}

    async def model_call(messages, *, tools, model, xml):
        captured["n"] += 1
        captured["tools_seen"].append(tools)
        captured["xml_seen"].append(xml)
        if seq:
            verb, args = seq.pop(0)
            return builder(verb, args)
        return builder("done", {"status": "success", "note": "fallback"})

    model_call.captured = captured
    return model_call


# ── acceptance #1: 9-element prompt ────────────────────────────────────────────
def test_build_system_prompt_contains_elements_and_refs():
    snap = [{"ref": "0", "role": "button", "name": "Search", "value": ""}]
    s = build_system_prompt(
        skill_md=None,
        elements={
            "procedure": ["p1"],
            "milestones": ["m1"],
            "terminal_conditions": ["tc1"],
            "false_terminal_states": ["fts1"],
            "red_lines": ["rl1"],
        },
        snapshot=snap,
        task="t",
        step_index=0,
        max_steps=20,
    )
    for token in ("p1", "m1", "tc1", "fts1", "rl1", "0", "Search", "t"):
        assert token in s
    # loop contract is stated
    assert "EXACTLY ONE" in s


def test_build_system_prompt_falls_back_to_skill_md():
    s = build_system_prompt(
        skill_md="# Card\nprocedure: do the thing\nred line: never delete",
        elements=None,
        snapshot=[],
        task=None,
        step_index=2,
        max_steps=5,
    )
    assert "do the thing" in s
    assert "step 3 of at most 5" in s
    assert "no interactive elements" in s


# ── acceptance #2: separate verb schema, 7 verbs, two shapes ───────────────────
def test_skill_tools_seven_verbs_two_shapes_distinct_from_chat():
    names = {t["function"]["name"] for t in SKILL_TOOLS}
    assert names == {"navigate", "click", "type", "select", "scroll", "extract", "done"}
    assert SKILL_TOOLS is not CHAT_TOOLS
    assert names != {t["function"]["name"] for t in CHAT_TOOLS}
    assert isinstance(SKILL_TOOLS_TEXT, str) and "tool_use" in SKILL_TOOLS_TEXT
    # write-verb set exposed for issue 04 (defined here, used later)
    assert SKILL_WRITE_VERBS == {"click", "type", "select"}


# ── acceptance #3: one action/step, both shapes normalize to same sequence ─────
async def _run(builder):
    """Drive a fixed script through one reply shape; return (result, page)."""
    script = [
        ("type", {"ref": "0", "text": "hello", "submit": True}),
        ("click", {"ref": "1"}),
        ("extract", {"data": {"title": "T1"}}),
        ("extract", {"data": {"title": "T2"}}),
        ("done", {"status": "success", "note": "results page shown"}),
    ]
    page = FakePage()
    model_call = _scripted_model(script, builder)
    result = await run_skill_loop(
        page=page,
        model_call=model_call,
        model="qwable-v1" if builder is _xml_reply else "gpt-4o-mini",
        elements=ELEMENTS,
        task="search hello",
        max_steps=20,
        # This test asserts OpenAI/XML tool shapes normalize to the SAME executed
        # sequence (issue 03 #3). The script's type{...,submit:true} is a write
        # the issue-04 risk gate would otherwise block; auto_confirm=True bypasses
        # the gate so the parser-parity assertion is exercised, not the gate.
        auto_confirm=True,
    )
    return result, page, model_call


async def test_openai_and_xml_produce_identical_action_sequence():
    res_oa, page_oa, mc_oa = await _run(_openai_reply)
    res_xml, page_xml, mc_xml = await _run(_xml_reply)

    # Same executed page ops in the same order (type → click).
    assert page_oa.ops == page_xml.ops
    assert page_oa.ops == [("type", "0", "hello", True), ("click", "1")]

    # Same verb sequence across recorded steps.
    verbs_oa = [s.verb for s in res_oa.steps]
    verbs_xml = [s.verb for s in res_xml.steps]
    assert verbs_oa == verbs_xml == ["type", "click", "extract", "extract", "done"]

    # The harness picked the right tool path for each model.
    assert mc_oa.captured["xml_seen"] == [False] * mc_oa.captured["n"]
    assert mc_xml.captured["xml_seen"] == [True] * mc_xml.captured["n"]
    # OpenAI path passes SKILL_TOOLS; XML path passes no tools (described in prompt).
    assert all(t is SKILL_TOOLS for t in mc_oa.captured["tools_seen"])
    assert all(t is None for t in mc_xml.captured["tools_seen"])

    # extracts accumulate in order (acceptance #4 tail).
    assert res_oa.extracts == [{"title": "T1"}, {"title": "T2"}]
    assert res_xml.extracts == [{"title": "T1"}, {"title": "T2"}]


async def test_one_action_per_step_truncates_extra_tool_calls():
    """If the model emits >1 tool call, only the FIRST runs; rest are ignored."""
    page = FakePage()

    async def model_call(messages, *, tools, model, xml):
        f1 = SimpleNamespace(name="click", arguments='{"ref":"1"}')
        f2 = SimpleNamespace(name="click", arguments='{"ref":"0"}')
        tc1 = SimpleNamespace(id="a", function=f1)
        tc2 = SimpleNamespace(id="b", function=f2)
        msg = SimpleNamespace(content="", tool_calls=[tc1, tc2])
        return SimpleNamespace(choices=[SimpleNamespace(message=msg)])

    result = await run_skill_loop(
        page=page, model_call=model_call, model="gpt-4o-mini",
        elements=ELEMENTS, max_steps=1,
    )
    # Only the first click executed.
    assert page.ops == [("click", "1")]
    assert result.steps[0].result.get("truncated_extra_calls") is True


# ── acceptance #4: termination — done accept / done reject / cap ───────────────
async def test_clean_done_terminates_success():
    page = FakePage()
    model_call = _scripted_model(
        [("done", {"status": "success", "note": "results page shown"})], _openai_reply
    )
    result = await run_skill_loop(
        page=page, model_call=model_call, model="gpt-4o-mini", elements=ELEMENTS,
    )
    assert result.outcome == "done_success"
    assert result.steps[-1].verb == "done"
    assert result.steps[-1].terminal_check == "accepted"
    # steps are ordered 0..n
    assert [s.index for s in result.steps] == list(range(len(result.steps)))


async def test_done_failed_status_maps_to_done_failed_outcome():
    page = FakePage()
    model_call = _scripted_model(
        [("done", {"status": "failed", "note": "gave up"})], _openai_reply
    )
    result = await run_skill_loop(
        page=page, model_call=model_call, model="gpt-4o-mini", elements=ELEMENTS,
    )
    assert result.outcome == "done_failed"


async def test_done_tripping_false_terminal_state_is_rejected_and_loop_continues():
    """A done whose note matches a false_terminal_states phrase must NOT stop."""
    page = FakePage()
    # First done trips "still loading" → rejected; then a clean done accepts.
    script = [
        ("done", {"status": "success", "note": "still loading the results"}),
        ("done", {"status": "success", "note": "results page shown"}),
    ]
    model_call = _scripted_model(script, _openai_reply)
    result = await run_skill_loop(
        page=page, model_call=model_call, model="gpt-4o-mini", elements=ELEMENTS,
    )
    done_steps = [s for s in result.steps if s.verb == "done"]
    assert len(done_steps) == 2
    assert done_steps[0].terminal_check == "rejected"
    assert done_steps[1].terminal_check == "accepted"
    # loop did not stop on the rejected done
    assert result.outcome == "done_success"


async def test_max_steps_cap_stops_after_exactly_n_steps():
    """A script that never emits done halts at the cap with outcome 'capped'."""
    page = FakePage()
    # Always scroll, never done.
    seq_call_count = {"n": 0}

    async def model_call(messages, *, tools, model, xml):
        seq_call_count["n"] += 1
        return _openai_reply("scroll", {"dir": "down"})

    result = await run_skill_loop(
        page=page, model_call=model_call, model="gpt-4o-mini",
        elements=ELEMENTS, max_steps=3,
    )
    assert result.outcome == "capped"
    assert len(result.steps) == 3
    assert seq_call_count["n"] == 3
    assert page.calls == 3  # perceived once per step
    assert result.summary["step_count"] == 3


# ── recoverability: invalid action / no tool call don't crash the loop ─────────
async def test_invalid_action_is_recorded_and_loop_continues():
    page = FakePage()
    # First an unknown verb (rejected by validator), then a clean done.
    script = [
        ("frobnicate", {"x": 1}),
        ("done", {"status": "success", "note": "results page shown"}),
    ]
    model_call = _scripted_model(script, _openai_reply)
    result = await run_skill_loop(
        page=page, model_call=model_call, model="gpt-4o-mini", elements=ELEMENTS,
    )
    assert result.steps[0].verb == "frobnicate"
    assert result.steps[0].error and "frobnicate" in result.steps[0].error
    assert result.outcome == "done_success"  # recovered and finished


async def test_no_tool_call_is_recorded_and_loop_continues():
    page = FakePage()
    state = {"n": 0}

    async def model_call(messages, *, tools, model, xml):
        state["n"] += 1
        if state["n"] == 1:
            msg = SimpleNamespace(content="I am thinking...", tool_calls=[])
            return SimpleNamespace(choices=[SimpleNamespace(message=msg)])
        return _openai_reply("done", {"status": "success", "note": "results page shown"})

    result = await run_skill_loop(
        page=page, model_call=model_call, model="gpt-4o-mini", elements=ELEMENTS,
    )
    assert result.steps[0].error == "no tool call emitted"
    assert result.outcome == "done_success"


async def test_xml_path_invalid_json_args_does_not_crash():
    """XML <tool_use> with malformed JSON args → _safe_json → {} → validator catches."""
    page = FakePage()
    state = {"n": 0}

    async def model_call(messages, *, tools, model, xml):
        state["n"] += 1
        if state["n"] == 1:
            # malformed json inside tool_use → parses to {} → 'navigate' missing url
            content = '<tool_use name="navigate" id="t">{not json}</tool_use>'
            msg = SimpleNamespace(content=content, tool_calls=None)
            return SimpleNamespace(choices=[SimpleNamespace(message=msg)])
        return _xml_reply("done", {"status": "success", "note": "results page shown"})

    result = await run_skill_loop(
        page=page, model_call=model_call, model="qwable-v1", elements=ELEMENTS,
    )
    assert result.steps[0].verb == "navigate"
    assert result.steps[0].error and "url" in result.steps[0].error
    assert result.outcome == "done_success"


# ── provider error path ────────────────────────────────────────────────────────
async def test_model_call_exception_terminates_with_error_outcome():
    page = FakePage()

    async def model_call(messages, *, tools, model, xml):
        raise RuntimeError("provider down")

    result = await run_skill_loop(
        page=page, model_call=model_call, model="gpt-4o-mini", elements=ELEMENTS,
    )
    assert result.outcome == "error"
    assert result.steps[-1].error and "provider down" in result.steps[-1].error


# ── done validation with no false_terminal_states is permissive ───────────────
async def test_done_accepted_when_no_false_terminal_states_defined():
    page = FakePage()
    model_call = _scripted_model([("done", {"status": "success"})], _openai_reply)
    result = await run_skill_loop(
        page=page, model_call=model_call, model="gpt-4o-mini",
        elements={"procedure": ["x"]},  # no false_terminal_states
    )
    assert result.outcome == "done_success"
    assert result.steps[-1].terminal_check == "accepted"


# ── navigate happy path drives the page op ─────────────────────────────────────
async def test_navigate_executes_goto():
    page = FakePage()
    script = [
        ("navigate", {"url": "https://example.com"}),
        ("done", {"status": "success", "note": "results page shown"}),
    ]
    model_call = _scripted_model(script, _openai_reply)
    result = await run_skill_loop(
        page=page, model_call=model_call, model="gpt-4o-mini", elements=ELEMENTS,
    )
    assert ("goto", "https://example.com") in page.ops
    assert result.steps[0].target == "https://example.com"


# ── LoopResult / StepRecord are plain dict-able (forward-compat for #05/#06) ───
def test_result_and_step_are_dictable():
    r = LoopResult(
        steps=[StepRecord(index=0, verb="click", args={"ref": "1"})],
        extracts=[{"a": 1}],
        outcome="capped",
        summary={"step_count": 1},
    )
    d = r.to_dict()
    assert d["outcome"] == "capped"
    assert d["steps"][0]["verb"] == "click"
    assert d["extracts"] == [{"a": 1}]
    assert isinstance(MAX_STEPS, int) and MAX_STEPS == 20
