"""End-to-end ``live`` test: the skill execute loop against a **real** Chrome (issue 07).

This is the one e2e proof that the whole v1 execute leg works against a genuine
browser — not a fake page. It is gated behind the existing ``live`` pytest marker
(``pyproject.toml`` ``[tool.pytest.ini_options].markers``), so the default
``pytest -m "not live"`` coverage suite never needs a browser (acceptance #1).

What is **real** here (ADR-0003 D1/D2/D3/D5):

  * a real local Chrome reached **over CDP** — ``backend.skills.page.open_skill_page``
    does ``chromium.connect_over_cdp(endpoint)`` against the endpoint from
    ``backend.browser_pool`` (seeded via ``init_pool([ep])`` + ``set_mode(ep,"cdp")``),
  * a **deterministic local page** served by an in-test ``ThreadingHTTPServer`` on
    ``127.0.0.1:0`` (no external site — acceptance / non-goals),
  * the **real spine**: ``run_collection_pipeline`` → ``run_pipeline`` →
    ``collector.collect`` → ``SkillChannel.collect`` → the real loop + risk gate,
    emitting ``TaskRunEvent``s via ``events.emit`` and storing extracts through the
    normal normalize/store path,
  * a **real configured DB** — a throwaway file-backed SQLite bound into both
    ``backend.database.AsyncSessionLocal`` (what ``events.emit`` / ``run_pipeline``
    use) and the runner's top-level copy, so the loop's event rows are visible to
    the test's own queries (the in-memory ``db_session`` fixture in ``conftest.py``
    is a *different* DB the loop never writes to — see issue 07 step 1/4).

What stays **scripted** (deliberate — non-goal "No live LLM requirement"): only the
cheap model's *action choice*. We patch the documented model seam
``backend.channels.skill_channel._build_model_call`` to replay a fixed
``navigate → extract → done`` (happy) / ``navigate → click`` (abort) sequence, so
the browser interaction is real but the test is deterministic (no model flakiness).
Real model tool-calling is issue 03's unit tests, not here.

How to run (Windows): see ``TESTING.md`` → "技能执行环路 e2e（live marker，Windows）".
With no endpoint configured the module-level fixture ``pytest.skip``s with an
actionable message rather than failing.
"""

import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from backend.database import Base
from backend.models.record import CollectedRecord
from backend.models.source import DataSource
from backend.models.task import CollectionTask, TaskRun, TaskRunEvent

pytestmark = pytest.mark.live


# ── deterministic local page ────────────────────────────────────────────────────
# Two routes off one tiny static site (served on 127.0.0.1:<ephemeral>):
#   /list  — extractable items with a stable selector (the happy path extracts them)
#   /risk  — exactly one high-risk control: a "Delete account" button whose click
#            handler sets window.__deleted = true. The risk classifier (issue 04)
#            matches verb+name against submit|pay|post|delete, so a click on it with
#            auto_confirm off MUST be blocked → no write → window.__deleted stays false.
_LIST_HTML = """<!doctype html><html><head><meta charset="utf-8">
<title>Skill Demo List</title></head><body>
<h1>Items</h1>
<ul id="items">
  <li class="item" data-title="Alpha"><a href="/a">Alpha</a></li>
  <li class="item" data-title="Beta"><a href="/b">Beta</a></li>
  <li class="item" data-title="Gamma"><a href="/c">Gamma</a></li>
</ul>
</body></html>"""

_RISK_HTML = """<!doctype html><html><head><meta charset="utf-8">
<title>Skill Demo Risk</title></head><body>
<h1>Danger zone</h1>
<p class="item" data-title="Account">your account</p>
<script>window.__deleted = false;</script>
<button id="delete-btn" onclick="window.__deleted = true;">Delete account</button>
</body></html>"""


class _Handler(BaseHTTPRequestHandler):
    def _send(self, body: str) -> None:
        payload = body.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):  # noqa: N802 — http.server API name
        if self.path.startswith("/risk"):
            self._send(_RISK_HTML)
        else:
            self._send(_LIST_HTML)

    def log_message(self, *_args):  # silence the per-request stderr noise
        return


@pytest.fixture(scope="module")
def local_site():
    """Serve the deterministic page on 127.0.0.1:<ephemeral>; yield its base URL."""
    server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    host, port = server.server_address
    try:
        yield f"http://{host}:{port}"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


@pytest.fixture(scope="module")
def cdp_endpoint():
    """Real local Chrome CDP endpoint, or skip with an actionable reason.

    Reads ``SKILL_LIVE_CDP_ENDPOINT`` (falls back to ``OPENCLI_CDP_ENDPOINT``, the
    var ``TESTING.md`` already uses for Chrome). Initializes the module-level
    ``browser_pool`` so ``get_pool()`` resolves and ``acquire(endpoint=ep)`` yields
    this exact endpoint; sets its mode to ``cdp`` (the loop attaches via
    ``connect_over_cdp``). Local/LAN only (ADR-0003 D1).
    """
    ep = os.environ.get("SKILL_LIVE_CDP_ENDPOINT") or os.environ.get("OPENCLI_CDP_ENDPOINT")
    if not ep:
        pytest.skip(
            "set SKILL_LIVE_CDP_ENDPOINT to a running Chrome --remote-debugging-port "
            "endpoint (e.g. http://127.0.0.1:9222) to run the live skill e2e"
        )

    from backend import browser_pool

    pool = browser_pool.init_pool([ep])
    pool.set_mode(ep, "cdp")
    return ep


@pytest_asyncio.fixture
async def spine_db(monkeypatch):
    """A shared SQLite bound into every ``AsyncSessionLocal`` the spine uses.

    One ``StaticPool`` connection is shared across all sessions so rows written by
    ``events.emit`` / ``store_records`` / runner Phase-4 are visible to the test's
    own queries — the real configured DB the live loop writes to (issue 07 step 4),
    *not* conftest's per-test in-memory ``db_session``. A throwaway in-memory DB is
    enough (set ``DATABASE_URL`` for a file DB if you want to inspect it after).
    """
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    sessionmaker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    monkeypatch.setattr("backend.database.AsyncSessionLocal", sessionmaker)
    monkeypatch.setattr("backend.pipeline.runner.AsyncSessionLocal", sessionmaker)

    yield sessionmaker

    await engine.dispose()


# ── scripted model (browser is real; only the action choice is fixed) ───────────
def _openai_reply(verb, args):
    """An OpenAI-chat-shaped reply carrying exactly one tool_call (loop normalizes it)."""
    tc = SimpleNamespace(
        id="call_1",
        function=SimpleNamespace(name=verb, arguments=json.dumps(args)),
    )
    msg = SimpleNamespace(content="", tool_calls=[tc])
    return SimpleNamespace(choices=[SimpleNamespace(message=msg)])


def _scripted_model_call(script):
    """Async ``model_call`` replaying ``script`` (list of (verb, args)).

    Matches the loop's ``async (messages, *, tools, model, xml) -> reply`` contract;
    falls back to a clean ``done`` when exhausted so a runaway loop cannot hang.
    """
    seq = list(script)

    async def model_call(messages, *, tools, model, xml):
        if seq:
            verb, args = seq.pop(0)
            return _openai_reply(verb, args)
        return _openai_reply("done", {"status": "success", "note": "done"})

    return model_call


def _patch_model(monkeypatch, script):
    """Stub ONLY the LLM seam — the browser/CDP path stays real."""
    monkeypatch.setattr(
        "backend.channels.skill_channel._build_model_call",
        lambda provider: _scripted_model_call(script),
    )


async def _seed_skill_source_task(sessionmaker, channel_config):
    """Create a ``skill`` DataSource + CollectionTask; return (source_id, task_id)."""
    async with sessionmaker() as session:
        source = DataSource(
            name="Live Skill Source",
            channel_type="skill",
            channel_config=channel_config,
        )
        session.add(source)
        await session.flush()
        task = CollectionTask(source_id=source.id, trigger_type="manual", parameters={})
        session.add(task)
        await session.flush()
        await session.commit()
        return source.id, task.id


async def _read_dom_flag(cdp_endpoint: str, url_contains: str, expr: str):
    """Re-attach over CDP and evaluate ``expr`` on the tab whose URL contains a marker.

    Used only for the test's *own* assertions (reading ``window.__deleted``) — this
    is Playwright's ``page.evaluate``, which ADR-0003 D3 forbids only inside the
    *skill's* action space, not in test harness code. The skill's ``SkillPage``
    closed its CDP connection (detaching the client, **not** killing the pool's
    Chrome), so the tab still exists; we reconnect and find it by URL.
    """
    from playwright.async_api import async_playwright

    pw = await async_playwright().start()
    browser = await pw.chromium.connect_over_cdp(cdp_endpoint)
    try:
        for context in browser.contexts:
            for page in context.pages:
                if url_contains in (page.url or ""):
                    return await page.evaluate(expr)
        return None
    finally:
        await browser.close()
        await pw.stop()


# Skill spec (Skill.elements shape). The high-risk skill adds a red line so the
# gate is authoritative (ADR-0003 D4: red_lines win over the generic pattern).
_READONLY_ELEMENTS = {
    "procedure": ["open the list page", "extract the items", "then done"],
    "milestones": ["items visible"],
    "terminal_conditions": ["items extracted"],
    "false_terminal_states": [],
    "red_lines": [],
}
_RISK_ELEMENTS = {
    "procedure": ["open the page", "delete the account"],
    "milestones": [],
    "terminal_conditions": ["account deleted"],
    "false_terminal_states": [],
    "red_lines": ["delete account"],
}
_SKILL_MD = "# live demo skill\nprocedure: drive the deterministic local page."


# ── acceptance #2,#3: real CDP + deterministic page → items + done + step events ─
async def test_live_happy_path_extracts_and_ends_on_done(
    spine_db, cdp_endpoint, local_site, monkeypatch
):
    """Read-only skill over a real Chrome: navigate → extract → done.

    Asserts (against the real spine + real browser): an extract record reaches the
    store (``pipeline_result.stored >= 1``), the loop ended on ``done`` (a
    ``skill_done`` event present; ``awaiting_confirm`` falsy), and per-step
    ``TaskRunEvent``s were written (≥1 perceive, ≥1 step/extract, 1 done).
    """
    from backend.pipeline.runner import run_collection_pipeline

    list_url = f"{local_site}/list"
    script = [
        ("navigate", {"url": list_url}),
        ("extract", {"data": {"title": "Alpha", "url": f"{local_site}/a"}}),
        ("done", {"status": "success", "note": "items extracted"}),
    ]
    _patch_model(monkeypatch, script)

    source_id, task_id = await _seed_skill_source_task(
        spine_db,
        {
            "skill_md": _SKILL_MD,
            "elements": _READONLY_ELEMENTS,
            "auto_confirm": False,
        },
    )

    # Option A: drive the whole spine; pass the real CDP endpoint via parameters
    # exactly as the pipeline does (parameters["chrome_endpoint"]).
    outcome = await run_collection_pipeline(task_id, {"chrome_endpoint": cdp_endpoint})

    # ≥1 extract reached the store (records flowed through normalize/store — D2/D5).
    assert outcome["success"] is True
    assert outcome["stored"] >= 1

    async with spine_db() as session:
        run = (
            await session.execute(select(TaskRun).where(TaskRun.task_id == task_id))
        ).scalar_one()

        # ended on done, not paused.
        assert run.status == "completed"

        events = (
            await session.execute(
                select(TaskRunEvent).where(TaskRunEvent.run_id == run.id)
            )
        ).scalars().all()
        steps = [e.step for e in events]
        # at least one perceive, one step/extract, and one done (acceptance #3).
        assert "skill_perceive" in steps
        assert ("skill_extract" in steps) or ("skill_step" in steps)
        assert "skill_done" in steps
        assert "awaiting_confirm" not in steps

        # the extract really stored as a CollectedRecord via the normal path.
        records = (
            await session.execute(
                select(CollectedRecord).where(CollectedRecord.source_id == source_id)
            )
        ).scalars().all()
        assert len(records) >= 1
        assert any(r.normalized_data.get("title") == "Alpha" for r in records)


# ── acceptance #4: headless gate — high-risk click blocked, no silent write ─────
async def test_live_headless_gate_blocks_high_risk_no_write(
    spine_db, cdp_endpoint, local_site, monkeypatch
):
    """High-risk skill over a real Chrome with auto_confirm off.

    The model proposes ``click`` on the real "Delete account" button. The risk gate
    (issue 04) must block it in headless v1 → ``awaiting_confirm`` (no write). Asserts
    the paused outcome on the real spine (``TaskRun.status == "awaiting_confirm"`` +
    an ``awaiting_confirm`` event) AND — the load-bearing "no silent write" check —
    that the page's ``window.__deleted`` DOM flag is still ``false`` afterwards.
    """
    from backend.pipeline.runner import run_collection_pipeline

    risk_url = f"{local_site}/risk"
    # navigate to the page, perceive (the Delete button gets data-skill-ref="0"),
    # then click it. The done after must never be reached.
    script = [
        ("navigate", {"url": risk_url}),
        ("click", {"ref": "0"}),
        ("done", {"status": "success", "note": "should not reach"}),
    ]
    _patch_model(monkeypatch, script)

    _source_id, task_id = await _seed_skill_source_task(
        spine_db,
        {
            "skill_md": _SKILL_MD,
            "elements": _RISK_ELEMENTS,
            "auto_confirm": False,
        },
    )

    outcome = await run_collection_pipeline(task_id, {"chrome_endpoint": cdp_endpoint})

    # A paused run is still a successful pipeline execution (collect/normalize/store ran).
    assert outcome["success"] is True

    async with spine_db() as session:
        task = await session.get(CollectionTask, task_id)
        run = (
            await session.execute(select(TaskRun).where(TaskRun.task_id == task_id))
        ).scalar_one()

        # paused → awaiting_confirm on BOTH run and task, not completed/failed.
        assert run.status == "awaiting_confirm"
        assert task.status == "awaiting_confirm"

        events = (
            await session.execute(
                select(TaskRunEvent).where(TaskRunEvent.run_id == run.id)
            )
        ).scalars().all()
        assert any(e.step == "awaiting_confirm" for e in events)

    # The load-bearing no-silent-write check: the delete handler never ran, so the
    # DOM flag the high-risk control sets is still false (PRD §7 false-negative danger).
    deleted = await _read_dom_flag(cdp_endpoint, "/risk", "window.__deleted")
    assert deleted is False
