"""Unit tests for the risk-tiered confirm gate (issue 04).

Pure / browser-free: the classifier takes plain dicts, the gate helper takes a
decision + ``auto_confirm`` flag, and the loop assertion uses a **fake**
``SkillPage`` + **stubbed** ``model_call`` (no Playwright/Chrome, same pattern as
``test_loop.py``). Runs under the default ``pytest -m "not live"``;
``asyncio_mode = "auto"`` means ``async def test_*`` needs no decorator.

Covers the issue-04 acceptance criteria:
  #1 auto-run tiers + reads → needs_confirm=False (AUTO).
  #2 generic high-risk verbs (submit|pay|post|delete + type submit flag) → confirm.
  #3 red_line precedence — beats the generic pattern, even over auto-run verbs.
  #4 ambiguous (unknown verb / write verb with element=None) → confirm.
  #5 auto_confirm bypass — gate-decision level, no browser.
  #6 headless abort surfaces ChannelResult-shaped metadata at the boundary.
  #7 status string is a centralized constant.
"""

import json
from types import SimpleNamespace

from backend.skills.risk import (
    AWAITING_CONFIRM,
    HIGH_RISK_VERBS,
    PROPOSED_ACTION,
    RiskTier,
    awaiting_confirm_metadata,
    classify_action,
    should_run,
)

# A skill spec (Skill.elements shape) with a red line that names an OTHERWISE
# auto-run target ("export records" — an extract) to prove red_line precedence.
SKILL = {
    "red_lines": ["never pay", "export records"],
    "procedure": ["search", "read"],
}


# ── acceptance #1: auto-run tiers + reads ──────────────────────────────────────
def test_navigate_scroll_extract_done_are_auto():
    for action in (
        {"verb": "navigate", "url": "https://example.com/results"},
        {"verb": "scroll", "dir": "down"},
        {"verb": "extract", "data": {"title": "T1"}},
        {"verb": "done", "status": "success", "note": "results page shown"},
    ):
        d = classify_action(action, None, None)
        assert d.needs_confirm is False, action
        assert d.tier is RiskTier.AUTO, action


def test_read_style_click_and_select_are_auto():
    # A plain "Next" link / a benign country dropdown — no high-risk token.
    click = {"verb": "click", "ref": "3"}
    el_click = {"ref": "3", "role": "link", "name": "Next page", "value": ""}
    d = classify_action(click, el_click, SKILL)
    assert d.needs_confirm is False
    assert d.tier is RiskTier.AUTO

    select = {"verb": "select", "ref": "4", "value": "CN"}
    el_sel = {"ref": "4", "role": "combobox", "name": "Country", "value": ""}
    d2 = classify_action(select, el_sel, SKILL)
    assert d2.needs_confirm is False
    assert d2.tier is RiskTier.AUTO


# ── acceptance #2: generic high-risk verbs ⇒ confirm ──────────────────────────
def test_click_submit_button_needs_confirm():
    action = {"verb": "click", "ref": "9"}
    el = {"ref": "9", "role": "button", "name": "Submit order", "value": ""}
    d = classify_action(action, el, SKILL)
    assert d.needs_confirm is True
    assert d.tier is RiskTier.CONFIRM
    assert "submit" in d.reason


def test_click_delete_control_needs_confirm():
    action = {"verb": "click", "ref": "2"}
    el = {"ref": "2", "role": "button", "name": "Delete account", "value": ""}
    d = classify_action(action, el, SKILL)
    assert d.needs_confirm is True


def test_each_high_risk_verb_token_trips_confirm():
    for token in HIGH_RISK_VERBS:
        action = {"verb": "click", "ref": "1"}
        el = {"ref": "1", "role": "button", "name": f"{token.title()} now", "value": ""}
        d = classify_action(action, el, SKILL)
        assert d.needs_confirm is True, token


def test_type_with_submit_flag_needs_confirm_regardless_of_name():
    # No high-risk token in the element name — the submit flag alone is the signal.
    action = {"verb": "type", "ref": "0", "text": "q", "submit": True}
    el = {"ref": "0", "role": "textbox", "name": "search", "value": ""}
    d = classify_action(action, el, SKILL)
    assert d.needs_confirm is True
    assert d.reason == "submit-flag"


def test_type_without_submit_into_plain_field_is_auto():
    action = {"verb": "type", "ref": "0", "text": "hello"}
    el = {"ref": "0", "role": "textbox", "name": "search", "value": ""}
    d = classify_action(action, el, SKILL)
    assert d.needs_confirm is False
    assert d.tier is RiskTier.AUTO


def test_high_risk_token_in_verb_args_text_trips_confirm():
    # The token lives in the model's typed text, not the element name.
    action = {"verb": "type", "ref": "0", "text": "delete everything"}
    el = {"ref": "0", "role": "textbox", "name": "command", "value": ""}
    d = classify_action(action, el, SKILL)
    assert d.needs_confirm is True


# ── acceptance #3: red_line precedence ─────────────────────────────────────────
def test_red_line_beats_auto_run_extract():
    # "export records" is a red line; extract would normally be AUTO.
    action = {"verb": "extract", "data": {"note": "export records to csv"}}
    d = classify_action(action, None, SKILL)
    assert d.needs_confirm is True
    assert d.tier is RiskTier.CONFIRM
    assert d.matched_red_line == "export records"
    assert d.reason == "red-line"


def test_red_line_matches_via_element_name():
    action = {"verb": "click", "ref": "7"}
    el = {"ref": "7", "role": "button", "name": "Pay now", "value": ""}
    # "never pay" red line contains "pay"? No — substring is line-in-haystack.
    # Use a red line phrase that appears in the element name.
    skill = {"red_lines": ["pay now"]}
    d = classify_action(action, el, skill)
    assert d.needs_confirm is True
    assert d.matched_red_line == "pay now"


def test_red_line_accepts_skill_like_object_with_elements():
    skill_obj = SimpleNamespace(elements={"red_lines": ["wire transfer"]})
    action = {"verb": "click", "ref": "1"}
    el = {"ref": "1", "role": "button", "name": "Wire transfer", "value": ""}
    d = classify_action(action, el, skill_obj)
    assert d.needs_confirm is True
    assert d.matched_red_line == "wire transfer"


def test_no_red_lines_means_generic_pattern_governs():
    action = {"verb": "click", "ref": "1"}
    el = {"ref": "1", "role": "link", "name": "Home", "value": ""}
    d = classify_action(action, el, {"red_lines": []})
    assert d.needs_confirm is False


# ── acceptance #4: ambiguous ⇒ confirm ─────────────────────────────────────────
def test_unknown_verb_is_ambiguous_confirm():
    d = classify_action({"verb": "frobnicate", "x": 1}, None, SKILL)
    assert d.needs_confirm is True
    assert d.reason == "ambiguous-default-confirm"


def test_write_verb_with_no_resolved_element_is_ambiguous_confirm():
    for verb, extra in (
        ("click", {"ref": "99"}),
        ("type", {"ref": "99", "text": "x"}),
        ("select", {"ref": "99", "value": "v"}),
    ):
        action = {"verb": verb, **extra}
        d = classify_action(action, None, SKILL)  # element unresolved
        assert d.needs_confirm is True, verb
        assert d.reason == "ambiguous-default-confirm", verb


def test_non_dict_action_is_ambiguous_confirm():
    d = classify_action(None, None, SKILL)  # type: ignore[arg-type]
    assert d.needs_confirm is True
    assert d.reason == "ambiguous-default-confirm"


# ── acceptance #5: auto_confirm bypass (gate-decision level) ───────────────────
def test_should_run_true_for_auto_tier():
    d = classify_action({"verb": "scroll", "dir": "down"}, None, SKILL)
    assert should_run(d, auto_confirm=False) is True
    assert should_run(d, auto_confirm=True) is True


def test_should_run_confirm_action_blocked_without_auto_confirm():
    action = {"verb": "click", "ref": "9"}
    el = {"ref": "9", "role": "button", "name": "Submit", "value": ""}
    d = classify_action(action, el, SKILL)
    assert d.needs_confirm is True
    assert should_run(d, auto_confirm=False) is False  # blocked
    assert should_run(d, auto_confirm=True) is True     # bypassed


# ── acceptance #6 (helper): awaiting_confirm metadata contract ─────────────────
def test_awaiting_confirm_metadata_shape():
    action = {"verb": "click", "ref": "9"}
    md = awaiting_confirm_metadata(action)
    assert md[AWAITING_CONFIRM] is True
    assert md[PROPOSED_ACTION] == action
    # a copy, not the same object (caller can't mutate it through the action)
    assert md[PROPOSED_ACTION] is not action


# ── acceptance #7: status string is a centralized constant ─────────────────────
def test_awaiting_confirm_constant_value():
    assert AWAITING_CONFIRM == "awaiting_confirm"


# ─────────────────────────────────────────────────────────────────────────────
# acceptance #6 (loop): headless abort surfaces the contract at the boundary.
#
# issue 03's loop is landed, so we assert against the real loop with a fake page +
# scripted model + monkeypatched-free executor. The loop returns a LoopResult;
# issue 05 lifts (awaiting_confirm, proposed_action) onto ChannelResult.metadata.
# We assert both the LoopResult signal AND the exact metadata dict the channel
# will publish, via the shared helper, so the boundary contract is pinned here.
# ─────────────────────────────────────────────────────────────────────────────
from backend.skills.loop import run_skill_loop  # noqa: E402

# elements with NO false_terminal_states so a clean done accepts immediately.
LOOP_ELEMENTS = {"procedure": ["search"], "red_lines": ["never pay"]}


class FakePage:
    """Fake SkillPage: a snapshot with a benign field (0) and a Submit button (9)."""

    def __init__(self, snap=None):
        self._snap = snap if snap is not None else [
            {"ref": "0", "role": "textbox", "name": "q", "value": ""},
            {"ref": "9", "role": "button", "name": "Submit order", "value": ""},
        ]
        self.ops: list[tuple] = []

    async def snapshot(self, *a, **k):
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
    tc = SimpleNamespace(
        id="c1", function=SimpleNamespace(name=verb, arguments=json.dumps(args))
    )
    msg = SimpleNamespace(content="", tool_calls=[tc])
    return SimpleNamespace(choices=[SimpleNamespace(message=msg)])


def _scripted_model(script):
    seq = list(script)

    async def model_call(messages, *, tools, model, xml):
        if seq:
            verb, args = seq.pop(0)
            return _openai_reply(verb, args)
        return _openai_reply("done", {"status": "success", "note": "fallback"})

    return model_call


async def test_loop_headless_aborts_on_high_risk_and_surfaces_metadata():
    """A headless loop (auto_confirm off) that reaches a Submit click stops at
    awaiting_confirm; the page write is NOT performed."""
    page = FakePage()
    # The model proposes clicking the Submit button at ref 9.
    model_call = _scripted_model([("click", {"ref": "9"})])
    result = await run_skill_loop(
        page=page,
        model_call=model_call,
        model="gpt-4o-mini",
        elements=LOOP_ELEMENTS,
        skill=LOOP_ELEMENTS,
        auto_confirm=False,
        run_id=None,  # no DB; gate still aborts, just skips the event
        max_steps=5,
    )
    assert result.outcome == AWAITING_CONFIRM
    assert result.awaiting_confirm is True
    assert result.proposed_action == {"verb": "click", "ref": "9"}
    # The high-risk click was BLOCKED — no page op performed.
    assert page.ops == []

    # The exact metadata dict the channel (issue 05) will publish.
    md = awaiting_confirm_metadata(result.proposed_action)
    assert md[AWAITING_CONFIRM] is True
    assert md[PROPOSED_ACTION] == {"verb": "click", "ref": "9"}


async def test_loop_auto_confirm_runs_high_risk_action():
    """With auto_confirm=True the same Submit click RUNS (no abort)."""
    page = FakePage()
    script = [
        ("click", {"ref": "9"}),
        ("done", {"status": "success", "note": "submitted"}),
    ]
    model_call = _scripted_model(script)
    result = await run_skill_loop(
        page=page,
        model_call=model_call,
        model="gpt-4o-mini",
        elements=LOOP_ELEMENTS,
        skill=LOOP_ELEMENTS,
        auto_confirm=True,
        max_steps=5,
    )
    assert result.outcome == "done_success"
    assert result.awaiting_confirm is False
    assert ("click", "9") in page.ops


async def test_loop_no_high_risk_action_runs_fully_through():
    """A skill whose actions are all auto-run completes; metadata has no
    awaiting_confirm flag."""
    page = FakePage()
    script = [
        ("type", {"ref": "0", "text": "hello"}),  # plain type, no submit
        ("scroll", {"dir": "down"}),
        ("done", {"status": "success", "note": "done"}),
    ]
    model_call = _scripted_model(script)
    result = await run_skill_loop(
        page=page,
        model_call=model_call,
        model="gpt-4o-mini",
        elements=LOOP_ELEMENTS,
        skill=LOOP_ELEMENTS,
        auto_confirm=False,
        max_steps=5,
    )
    assert result.outcome == "done_success"
    assert result.awaiting_confirm is False
    assert result.proposed_action is None
    assert ("type", "0", "hello", False) in page.ops


async def test_loop_red_line_aborts_even_for_extract():
    """A red_line ('never pay') matched by an extract aborts the headless loop
    even though extract is normally auto-run (red_line precedence at the gate)."""
    page = FakePage()
    model_call = _scripted_model(
        [("extract", {"data": {"note": "user clicked never pay button"}})]
    )
    result = await run_skill_loop(
        page=page,
        model_call=model_call,
        model="gpt-4o-mini",
        elements=LOOP_ELEMENTS,
        skill=LOOP_ELEMENTS,
        auto_confirm=False,
        max_steps=5,
    )
    assert result.outcome == AWAITING_CONFIRM
    assert result.awaiting_confirm is True
    assert result.proposed_action["verb"] == "extract"
