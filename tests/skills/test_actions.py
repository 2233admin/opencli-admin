"""Unit tests for the skill action executor (issue 02).

Drives ``execute_action`` against a fake/mock ``SkillPage`` for every verb
(happy path + bad-ref + unknown-verb). No real browser, no network, no DB — runs
in the default ``-m "not live"`` collection. ``asyncio_mode = "auto"`` is set in
pyproject.toml, so ``async def test_*`` needs no decorator.
"""

from unittest.mock import AsyncMock, MagicMock

from backend.skills.actions import (
    VERBS,
    ActionResult,
    execute_action,
    resolve_ref,
    validate_action,
)

# Small fixed snapshot (the perception [{ref, role, name, value}] shape).
SNAP = [
    {"ref": "1", "role": "button", "name": "Search", "value": ""},
    {"ref": "3", "role": "textbox", "name": "q", "value": ""},
]


def _fake_page() -> MagicMock:
    """A fake SkillPage: every page op is an AsyncMock so we can assert awaits."""
    page = MagicMock()
    page.goto = AsyncMock()
    page.click = AsyncMock()
    page.type = AsyncMock()
    page.select = AsyncMock()
    page.scroll = AsyncMock()
    return page


def _assert_no_write(page: MagicMock) -> None:
    """No page-mutating/op method was awaited."""
    page.goto.assert_not_awaited()
    page.click.assert_not_awaited()
    page.type.assert_not_awaited()
    page.select.assert_not_awaited()
    page.scroll.assert_not_awaited()


# ── Fixed verb set (acceptance #1) ─────────────────────────────────────────────

def test_verb_set_is_exactly_the_fixed_seven():
    assert set(VERBS) == {
        "navigate", "click", "type", "select", "scroll", "extract", "done"
    }


def test_validate_rejects_evaluate_and_js():
    # The ADR red line: evaluate / js are not in the fixed set → rejected.
    assert validate_action({"verb": "evaluate", "js": "x"})
    assert validate_action({"verb": "js", "code": "x"})


def test_validate_rejects_unknown_verb():
    assert validate_action({"verb": "frobnicate"})


def test_validate_rejects_missing_verb():
    assert validate_action({})
    assert validate_action({"url": "http://x"})


def test_validate_rejects_missing_required_field():
    err = validate_action({"verb": "navigate"})
    assert err and "url" in err


def test_validate_accepts_well_formed():
    assert validate_action({"verb": "navigate", "url": "http://x"}) is None
    assert validate_action({"verb": "click", "ref": "1"}) is None
    assert validate_action({"verb": "done", "status": "ok"}) is None


# ── resolve_ref (pure helper) ──────────────────────────────────────────────────

def test_resolve_ref_string_and_int_tolerant():
    assert resolve_ref(SNAP, "1")["role"] == "button"
    assert resolve_ref(SNAP, 1)["role"] == "button"  # int tolerated
    assert resolve_ref(SNAP, "3")["name"] == "q"


def test_resolve_ref_missing_returns_none():
    assert resolve_ref(SNAP, "99") is None
    assert resolve_ref([], "1") is None


# ── Happy path per verb (acceptance #5) ────────────────────────────────────────

async def test_navigate_happy():
    page = _fake_page()
    result = await execute_action(page, SNAP, {"verb": "navigate", "url": "http://x"})
    assert result.ok is True
    assert result.verb == "navigate"
    page.goto.assert_awaited_once_with("http://x")


async def test_click_happy():
    page = _fake_page()
    result = await execute_action(page, SNAP, {"verb": "click", "ref": "1"})
    assert result.ok is True
    assert result.verb == "click"
    page.click.assert_awaited_once_with("1")


async def test_type_with_submit_passes_submit_true():
    page = _fake_page()
    result = await execute_action(
        page, SNAP, {"verb": "type", "ref": "3", "text": "hello", "submit": True}
    )
    assert result.ok is True
    page.type.assert_awaited_once_with("3", "hello", submit=True)


async def test_type_without_submit_passes_submit_false():
    page = _fake_page()
    result = await execute_action(
        page, SNAP, {"verb": "type", "ref": "3", "text": "hello"}
    )
    assert result.ok is True
    page.type.assert_awaited_once_with("3", "hello", submit=False)


async def test_select_happy():
    page = _fake_page()
    result = await execute_action(
        page, SNAP, {"verb": "select", "ref": "3", "value": "v"}
    )
    assert result.ok is True
    page.select.assert_awaited_once_with("3", "v")


async def test_scroll_happy():
    page = _fake_page()
    result = await execute_action(page, SNAP, {"verb": "scroll", "dir": "down"})
    assert result.ok is True
    page.scroll.assert_awaited_once_with("down")


async def test_extract_returns_record_and_writes_nothing():
    page = _fake_page()
    data = {"title": "T", "price": 9}
    result = await execute_action(page, SNAP, {"verb": "extract", "data": data})
    assert result.ok is True
    assert result.verb == "extract"
    assert result.record == {"title": "T", "price": 9}
    # Copied, not the same object — caller can't mutate the action.
    assert result.record is not data
    _assert_no_write(page)


async def test_done_is_terminal_and_calls_no_page_op():
    page = _fake_page()
    result = await execute_action(
        page, SNAP, {"verb": "done", "status": "complete", "note": "all set"}
    )
    assert result.ok is True
    assert result.terminal is True
    assert result.detail["status"] == "complete"
    assert result.detail["note"] == "all set"
    _assert_no_write(page)


async def test_only_done_sets_terminal():
    page = _fake_page()
    for action in (
        {"verb": "navigate", "url": "http://x"},
        {"verb": "click", "ref": "1"},
        {"verb": "extract", "data": {"a": 1}},
    ):
        result = await execute_action(page, SNAP, action)
        assert result.terminal is False


# ── bad-ref (acceptance #2) ────────────────────────────────────────────────────

async def test_click_bad_ref_fails_without_page_call():
    page = _fake_page()
    result = await execute_action(page, SNAP, {"verb": "click", "ref": "99"})
    assert result.ok is False
    assert "99" in result.error
    page.click.assert_not_awaited()


async def test_type_bad_ref_fails_without_page_call():
    page = _fake_page()
    result = await execute_action(
        page, SNAP, {"verb": "type", "ref": "99", "text": "x"}
    )
    assert result.ok is False
    assert "99" in result.error
    page.type.assert_not_awaited()


async def test_select_bad_ref_fails_without_page_call():
    page = _fake_page()
    result = await execute_action(
        page, SNAP, {"verb": "select", "ref": "99", "value": "v"}
    )
    assert result.ok is False
    assert "99" in result.error
    page.select.assert_not_awaited()


# ── unknown-verb (acceptance #1, red line) ─────────────────────────────────────

async def test_evaluate_verb_rejected_no_page_call():
    page = _fake_page()
    result = await execute_action(
        page, SNAP, {"verb": "evaluate", "js": "window.x=1"}
    )
    assert result.ok is False
    assert "evaluate" in result.error
    _assert_no_write(page)


async def test_unknown_verb_rejected_no_page_call():
    page = _fake_page()
    result = await execute_action(page, SNAP, {"verb": "frobnicate"})
    assert result.ok is False
    assert "frobnicate" in result.error
    _assert_no_write(page)


async def test_missing_required_field_fails():
    page = _fake_page()
    result = await execute_action(page, SNAP, {"verb": "navigate"})
    assert result.ok is False
    assert "url" in result.error
    _assert_no_write(page)


# ── page-op error → structured failure, never raises ───────────────────────────

async def test_page_op_exception_becomes_structured_failure():
    page = _fake_page()
    page.click = AsyncMock(side_effect=RuntimeError("boom"))
    result = await execute_action(page, SNAP, {"verb": "click", "ref": "1"})
    assert result.ok is False
    assert result.verb == "click"
    assert "boom" in result.error


def test_action_result_factories():
    ok = ActionResult.success("click", detail={"ref": "1"})
    assert ok.ok is True and ok.verb == "click" and ok.detail == {"ref": "1"}
    bad = ActionResult.failure("click", "nope")
    assert bad.ok is False and bad.error == "nope"
