"""Unit tests for the skill perception snapshot + CDP page wrapper.

Browser-free: the JS-eval boundary is mocked (``AsyncMock``) and the pure
projection (``project_snapshot``) is exercised directly. Runs under the default
``pytest -m "not live"`` with no Playwright / Chrome.

Covers issue 01 acceptance criteria #3 (snapshot shape + ref tagging) and #4
(token-bounded, no raw DOM / screenshots), plus the page wrapper's pure ref
resolution and dumb one-action ops (via a fake page) so the new modules don't
drag total coverage under 80%.
"""

from unittest.mock import AsyncMock, MagicMock

from backend.skills.page import SkillPage, _ref_selector, open_skill_page
from backend.skills.perception import (
    DEFAULT_MAX_ELEMENTS,
    SNAPSHOT_KEYS,
    project_snapshot,
    snapshot,
)


# ── project_snapshot: shape + refs ────────────────────────────────────────
def _raw(n: int) -> list[dict]:
    return [
        {"ref": i, "role": "button", "name": f"btn{i}", "value": ""} for i in range(n)
    ]


def test_project_snapshot_keys_are_exactly_the_contract():
    out = project_snapshot(_raw(3))
    assert len(out) == 3
    for row in out:
        assert set(row.keys()) == set(SNAPSHOT_KEYS)
        assert set(row.keys()) == {"ref", "role", "name", "value"}


def test_project_snapshot_refs_sequential_and_preserved():
    out = project_snapshot(_raw(5))
    assert [row["ref"] for row in out] == [0, 1, 2, 3, 4]


def test_project_snapshot_caps_at_max_elements():
    out = project_snapshot(_raw(120), max_elements=50)
    assert len(out) == 50
    # deterministic: first N in DOM order
    assert [row["ref"] for row in out] == list(range(50))


def test_project_snapshot_default_cap_is_documented_constant():
    out = project_snapshot(_raw(DEFAULT_MAX_ELEMENTS + 25))
    assert len(out) == DEFAULT_MAX_ELEMENTS


def test_project_snapshot_drops_extra_keys_and_fills_missing():
    raw = [{"ref": 0, "role": "input", "name": "q", "value": "x", "html": "<b>", "extra": 1}]
    out = project_snapshot(raw)
    assert out[0] == {"ref": 0, "role": "input", "name": "q", "value": "x"}
    # missing keys filled with empty strings; ref falls back to index
    out2 = project_snapshot([{}])
    assert out2[0] == {"ref": 0, "role": "", "name": "", "value": ""}


def test_project_snapshot_no_raw_dom_or_screenshot_keys():
    raw = [
        {"ref": 0, "role": "a", "name": "link", "value": "",
         "outerHTML": "<a>", "screenshot": "b64"}
    ]
    out = project_snapshot(raw)
    for row in out:
        assert "outerHTML" not in row
        assert "html" not in row
        assert "screenshot" not in row


def test_project_snapshot_empty_and_zero_cap():
    assert project_snapshot([]) == []
    assert project_snapshot(_raw(10), max_elements=0) == []
    assert project_snapshot(_raw(10), max_elements=-5) == []


def test_project_snapshot_coerces_string_ref_to_int():
    out = project_snapshot([{"ref": "7", "role": "button", "name": "go", "value": ""}])
    assert out[0]["ref"] == 7


# ── snapshot(): I/O wrapper over a mocked page ─────────────────────────────
async def test_snapshot_with_mocked_page_returns_projection():
    page = MagicMock()
    page.evaluate = AsyncMock(return_value=_raw(3))
    out = await snapshot(page)
    page.evaluate.assert_awaited_once()
    assert len(out) == 3
    assert all(set(r.keys()) == {"ref", "role", "name", "value"} for r in out)


async def test_snapshot_applies_cap_and_handles_none():
    page = MagicMock()
    page.evaluate = AsyncMock(return_value=_raw(80))
    out = await snapshot(page, max_elements=10)
    assert len(out) == 10

    page.evaluate = AsyncMock(return_value=None)
    assert await snapshot(page) == []


# ── page wrapper: pure ref resolution + dumb ops over a fake page ──────────
def test_ref_selector_uses_data_skill_ref():
    assert _ref_selector(3) == '[data-skill-ref="3"]'
    assert _ref_selector("12") == '[data-skill-ref="12"]'


def _fake_page():
    page = MagicMock()
    locator = MagicMock()
    locator.click = AsyncMock()
    locator.fill = AsyncMock()
    locator.press = AsyncMock()
    locator.select_option = AsyncMock()
    page.locator = MagicMock(return_value=locator)
    page.goto = AsyncMock()
    page.evaluate = AsyncMock()
    page.inner_text = AsyncMock(return_value="hello body")
    return page, locator


async def test_skillpage_ops_each_one_action():
    page, locator = _fake_page()
    sp = SkillPage(pw=None, browser=None, page=page)

    await sp.goto("https://example.com")
    page.goto.assert_awaited_once_with("https://example.com")

    await sp.click(2)
    page.locator.assert_called_with('[data-skill-ref="2"]')
    locator.click.assert_awaited_once()

    await sp.type(1, "hi", submit=True)
    locator.fill.assert_awaited_once_with("hi")
    locator.press.assert_awaited_once_with("Enter")

    await sp.select(4, "opt")
    locator.select_option.assert_awaited_once_with("opt")

    text = await sp.extract()
    assert text == "hello body"
    assert await sp.inner_text() == "hello body"


async def test_skillpage_type_without_submit_does_not_press():
    page, locator = _fake_page()
    sp = SkillPage(pw=None, browser=None, page=page)
    await sp.type(0, "x")
    locator.fill.assert_awaited_once_with("x")
    locator.press.assert_not_awaited()


async def test_skillpage_scroll_direction():
    page, _ = _fake_page()
    sp = SkillPage(pw=None, browser=None, page=page)
    await sp.scroll("down")
    await sp.scroll("up")
    assert page.evaluate.await_count == 2
    # down → +1, up → -1
    assert page.evaluate.await_args_list[0].args[1] == 1
    assert page.evaluate.await_args_list[1].args[1] == -1


async def test_skillpage_aclose_is_best_effort():
    browser = MagicMock()
    browser.close = AsyncMock()
    pw = MagicMock()
    pw.stop = AsyncMock()
    sp = SkillPage(pw=pw, browser=browser, page=MagicMock())
    await sp.aclose()
    browser.close.assert_awaited_once()
    pw.stop.assert_awaited_once()
    # idempotent / swallows after handles dropped
    await sp.aclose()


async def test_skillpage_async_context_manager():
    browser = MagicMock()
    browser.close = AsyncMock()
    pw = MagicMock()
    pw.stop = AsyncMock()
    async with SkillPage(pw=pw, browser=browser, page=MagicMock()) as sp:
        assert isinstance(sp, SkillPage)
    browser.close.assert_awaited_once()


async def test_open_skill_page_uses_connect_over_cdp(monkeypatch):
    """open_skill_page attaches over CDP and reuses the existing context/page."""
    existing_page = MagicMock()
    context = MagicMock()
    context.pages = [existing_page]
    browser = MagicMock()
    browser.contexts = [context]
    browser.connect = AsyncMock()

    chromium = MagicMock()
    chromium.connect_over_cdp = AsyncMock(return_value=browser)
    pw_obj = MagicMock()
    pw_obj.chromium = chromium
    pw_obj.stop = AsyncMock()

    pw_ctx = MagicMock()
    pw_ctx.start = AsyncMock(return_value=pw_obj)

    import backend.skills.page as page_mod

    monkeypatch.setattr(page_mod, "async_playwright", lambda: pw_ctx, raising=False)
    # async_playwright is imported lazily inside open_skill_page; patch the source.
    monkeypatch.setattr(
        "playwright.async_api.async_playwright", lambda: pw_ctx, raising=False
    )

    sp = await open_skill_page("http://127.0.0.1:9222")
    chromium.connect_over_cdp.assert_awaited_once_with("http://127.0.0.1:9222")
    assert sp.page is existing_page


async def test_open_skill_page_creates_page_when_none(monkeypatch):
    new_page = MagicMock()
    context = MagicMock()
    context.pages = []
    context.new_page = AsyncMock(return_value=new_page)
    browser = MagicMock()
    browser.contexts = [context]

    chromium = MagicMock()
    chromium.connect_over_cdp = AsyncMock(return_value=browser)
    pw_obj = MagicMock()
    pw_obj.chromium = chromium
    pw_ctx = MagicMock()
    pw_ctx.start = AsyncMock(return_value=pw_obj)

    monkeypatch.setattr(
        "playwright.async_api.async_playwright", lambda: pw_ctx, raising=False
    )
    sp = await open_skill_page("http://127.0.0.1:9222")
    context.new_page.assert_awaited_once()
    assert sp.page is new_page
