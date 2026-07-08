"""The **record** leg (2026-07-01 addendum): capture → journey_trace_v1.

Browser-free unit tests — a fake Playwright ``Page`` (mirrors
``test_skill_channel.py``'s ``FakePage`` convention) stands in for
``expose_binding`` / ``add_init_script`` / ``evaluate`` / ``on`` /
``main_frame``, so ``RecordSession``'s capture→trace-assembly logic is
exercised with **no real browser**. The one thing a fake *can't* prove — that
Playwright's real ``expose_binding`` actually delivers real DOM events — is
covered separately by the ``live`` marker test (``test_record_live.py``).
"""

from typing import Any

from backend.skills.page import SkillPage
from backend.skills.record import RecordSession


class _FakeFrame:
    def __init__(self, url: str) -> None:
        self.url = url


class _FakePWPage:
    """Fake Playwright ``Page``: records what got bound/injected, and lets the
    test manually invoke the same callbacks Playwright itself would fire."""

    def __init__(self) -> None:
        self.bindings: dict[str, Any] = {}
        self.init_scripts: list[str] = []
        self.evaluated: list[str] = []
        self.handlers: dict[str, Any] = {}
        self.main_frame = _FakeFrame("about:blank")

    async def expose_binding(self, name: str, fn: Any) -> None:
        self.bindings[name] = fn

    async def add_init_script(self, script: str) -> None:
        self.init_scripts.append(script)

    async def evaluate(self, script: str, arg: Any = None) -> None:
        self.evaluated.append(script)

    def on(self, event: str, handler: Any) -> None:
        self.handlers[event] = handler


def _make_session(domain="d", capability="c") -> tuple[RecordSession, _FakePWPage]:
    fake_pw_page = _FakePWPage()
    skill_page = SkillPage(pw=None, browser=None, page=fake_pw_page)
    session = RecordSession(session_id="s1", domain=domain, capability=capability, page=skill_page)
    return session, fake_pw_page


async def test_start_wires_binding_init_script_and_navigate_handler():
    session, fake_page = _make_session()
    await session.start()

    assert "__record_event" in fake_page.bindings
    assert len(fake_page.init_scripts) == 1
    assert len(fake_page.evaluated) == 1  # the current already-loaded doc gets one manual inject
    assert "framenavigated" in fake_page.handlers


async def test_captured_click_becomes_a_click_step():
    session, fake_page = _make_session()
    await session.start()

    binding = fake_page.bindings["__record_event"]
    await binding({}, {"verb": "click", "name": "Submit order", "role": "button"})

    assert len(session.steps) == 1
    step = session.steps[0]
    assert step.verb == "click"
    assert step.args == {"name": "Submit order", "role": "button"}
    assert step.target == "Submit order"


async def test_captured_type_and_select_map_to_action_verb_shapes():
    """`type`/`select` args must match backend.skills.actions.VERBS' shape
    (`text` for type, `value` for select) — same vocabulary the execute leg
    already uses, so a recorded trace never needs verb translation."""
    session, fake_page = _make_session()
    await session.start()
    binding = fake_page.bindings["__record_event"]

    await binding({}, {"verb": "type", "name": "email", "role": "textbox", "value": "a@b.com"})
    await binding({}, {"verb": "select", "name": "country", "role": "combobox", "value": "US"})
    await binding({}, {"verb": "submit", "name": "login-form"})

    assert session.steps[0].args == {"name": "email", "role": "textbox", "text": "a@b.com"}
    assert session.steps[1].args == {"name": "country", "role": "combobox", "value": "US"}
    assert session.steps[2].args == {"name": "login-form"}


async def test_navigate_handler_appends_step_for_main_frame_only():
    session, fake_page = _make_session()
    await session.start()
    navigate_handler = fake_page.handlers["framenavigated"]

    navigate_handler(fake_page.main_frame)  # main frame → recorded
    other_frame = _FakeFrame("https://example.com/iframe")
    navigate_handler(other_frame)  # not main frame → ignored

    assert len(session.steps) == 1
    assert session.steps[0].verb == "navigate"
    assert session.steps[0].args == {"url": "about:blank"}


async def test_stop_appends_done_and_assembles_journey_trace_v1():
    session, fake_page = _make_session(domain="example.com", capability="open-list")
    await session.start()
    binding = fake_page.bindings["__record_event"]
    await binding({}, {"verb": "click", "name": "Open", "role": "button"})

    trace = await session.stop(status="success", note="looks done")

    assert session.stopped is True
    assert trace["schema"] == "journey_trace_v1"
    assert trace["summary"]["domain"] == "example.com"
    assert trace["label"] == "open-list"
    assert trace["outcome"]["status"] == "success"
    assert trace["outcome"]["loop_outcome"] == "done_success"
    verbs = [s["verb"] for s in trace["steps"]]
    assert verbs == ["click", "done"]
    assert trace["steps"][-1]["args"] == {"status": "success", "note": "looks done"}


async def test_stop_with_failed_status_maps_to_done_failed_outcome():
    session, _fake_page = _make_session()
    await session.start()

    trace = await session.stop(status="failed", note="couldn't finish")

    assert trace["outcome"]["status"] == "failed"
    assert trace["outcome"]["loop_outcome"] == "done_failed"


async def test_unknown_captured_verb_is_ignored():
    """CAPTURE_JS never emits anything but click/type/select/submit — but the
    handler stays defensive (no crash) if it ever did."""
    session, fake_page = _make_session()
    await session.start()
    binding = fake_page.bindings["__record_event"]
    await binding({}, {"verb": "mousemove", "name": "x"})
    assert session.steps == []
