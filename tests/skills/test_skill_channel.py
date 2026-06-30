"""Integration test for the skill channel wired into the run/pipeline spine (issue 05).

Browser-free + provider-free + end-to-end through the real spine:

  * a **fake page** (patches issue 01's ``open_skill_page`` so no Chrome/CDP is
    needed) that serves a scripted snapshot and records page ops,
  * a **stubbed model_call** (patches ``_build_model_call`` so no real LLM /
    network is hit) that replays a scripted action sequence,
  * a **shared in-memory SQLite** bound into ``AsyncSessionLocal`` (and the
    runner's copy) so ``events.emit`` / ``store_records`` / runner Phase-4 all
    write to the one DB the test then queries.

The loop (issue 03) + risk gate (issue 04) run *for real* against the fake page;
only the two true I/O boundaries (browser, model) are stubbed. Covers acceptance
criteria 2–5: per-step ``TaskRunEvent``s with the keyed ``step`` values, extracts
flowing through the normal normalize/store path into ``CollectedRecord``s, and the
``awaiting_confirm`` script driving ``run.status == "awaiting_confirm"``.

Runs under the default ``pytest -m "not live"``; ``asyncio_mode = "auto"``.
"""

import json
from types import SimpleNamespace

import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from backend.database import Base
from backend.models.record import CollectedRecord
from backend.models.source import DataSource
from backend.models.task import CollectionTask, TaskRun, TaskRunEvent

# Skill spec (Skill.elements shape) with a false_terminal_states trap + a red line.
ELEMENTS = {
    "procedure": ["open list", "read rows"],
    "milestones": ["rows visible"],
    "terminal_conditions": ["list page shown"],
    "false_terminal_states": ["still loading"],
    "red_lines": ["never delete account"],
}

SKILL_MD = (
    "# demo skill\nprocedure: open the list and read the rows\n"
    "red line: never delete account"
)


# ── fakes ──────────────────────────────────────────────────────────────────────
class FakePage:
    """Fake SkillPage (issue 01 boundary): scripted snapshot + recorded ops.

    Mirrors the real ``SkillPage`` surface the executor (#02) drives. The channel
    wraps the *real* ``SkillPage`` in ``_PerceivingPage`` (whose ``snapshot()``
    delegates to ``perception.snapshot(self.page)``); here we patch
    ``open_skill_page`` to return this fake directly and make its own
    ``snapshot()`` / ``page.evaluate`` both work, so either path perceives.
    """

    def __init__(self, snap=None):
        self._snap = snap if snap is not None else [
            {"ref": 0, "role": "link", "name": "Row 1", "value": ""},
            {"ref": 1, "role": "button", "name": "Open", "value": ""},
        ]
        self.calls = 0
        self.ops: list[tuple] = []
        # `_PerceivingPage` reads `.page` and calls perception.snapshot(self.page),
        # which does `await self.page.evaluate(JS)`. Make .page.evaluate return the
        # raw rows so the real perception path also works if exercised.
        self.page = SimpleNamespace(evaluate=self._evaluate)

    async def _evaluate(self, _js, *a, **k):
        return [dict(r) for r in self._snap]

    async def snapshot(self, *a, **k):
        self.calls += 1
        return [dict(r) for r in self._snap]

    async def aclose(self):
        pass

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
    """An OpenAI-chat-shaped reply carrying exactly one tool_call."""
    tc = SimpleNamespace(
        id="call_1",
        function=SimpleNamespace(name=verb, arguments=json.dumps(args)),
    )
    msg = SimpleNamespace(content="", tool_calls=[tc])
    return SimpleNamespace(choices=[SimpleNamespace(message=msg)])


def _scripted_model_call(script):
    """Return an async model_call replaying ``script`` (list of (verb, args)).

    Matches the loop's ``async (messages, *, tools, model, xml) -> reply``
    contract. Falls back to a clean ``done`` when the script is exhausted so a
    runaway loop can't hang the test.
    """
    seq = list(script)

    async def model_call(messages, *, tools, model, xml):
        if seq:
            verb, args = seq.pop(0)
            return _openai_reply(verb, args)
        return _openai_reply("done", {"status": "success", "note": "list page shown"})

    return model_call


@pytest_asyncio.fixture
async def spine_db(monkeypatch):
    """A shared in-memory SQLite bound into every AsyncSessionLocal the spine uses.

    One ``StaticPool`` connection is shared across all sessions so rows written by
    ``events.emit`` / ``store_records`` / runner Phase-4 are visible to the test's
    own queries. Patches both ``backend.database.AsyncSessionLocal`` (what
    ``events.emit`` / ``run_pipeline`` import lazily) and the runner's top-level
    copy.
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


async def _seed_skill_source_task(sessionmaker, channel_config):
    """Create a skill DataSource + CollectionTask; return (source_id, task_id)."""
    async with sessionmaker() as session:
        source = DataSource(
            name="Skill Source",
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


def _patch_browser_and_model(monkeypatch, fake_page, script):
    """Stub the two true I/O boundaries: the CDP page + the LLM model_call."""
    # No real Chrome: open_skill_page returns the fake page (also covers aclose()).
    async def fake_open(cdp_endpoint):
        return fake_page

    monkeypatch.setattr("backend.skills.page.open_skill_page", fake_open)
    # No real LLM: the channel's model_call binder returns the scripted caller.
    monkeypatch.setattr(
        "backend.channels.skill_channel._build_model_call",
        lambda provider: _scripted_model_call(script),
    )

    # browser_pool.acquire must yield a CDP endpoint without a real browser.
    class _FakePool:
        def acquire(self, endpoint=None):
            class _CM:
                async def __aenter__(self):
                    return endpoint or "http://fake-cdp:9222"

                async def __aexit__(self, *exc):
                    return False

            return _CM()

        def get_mode(self, _ep):
            return "fake"

    monkeypatch.setattr("backend.browser_pool.get_pool", lambda: _FakePool())


# ── acceptance #2,#3,#5(i,ii): clean run — events + extracts stored ────────────
async def test_skill_run_emits_events_and_stores_extracts(spine_db, monkeypatch):
    from backend.pipeline.runner import run_collection_pipeline

    fake_page = FakePage()
    # extract two records, then done.
    script = [
        ("navigate", {"url": "https://example.com/list"}),
        ("extract", {"data": {"title": "Row A", "url": "https://example.com/a"}}),
        ("extract", {"data": {"title": "Row B", "url": "https://example.com/b"}}),
        ("done", {"status": "success", "note": "list page shown"}),
    ]
    _patch_browser_and_model(monkeypatch, fake_page, script)

    source_id, task_id = await _seed_skill_source_task(
        spine_db, {"skill_md": SKILL_MD, "elements": ELEMENTS, "auto_confirm": False}
    )

    outcome = await run_collection_pipeline(task_id, {})

    assert outcome["success"] is True
    assert outcome["stored"] == 2

    async with spine_db() as session:
        # (i) per-step events emitted for this run, keyed by the spec's step names.
        run = (await session.execute(
            select(TaskRun).where(TaskRun.task_id == task_id)
        )).scalar_one()
        events = (await session.execute(
            select(TaskRunEvent).where(TaskRunEvent.run_id == run.id)
        )).scalars().all()
        steps = {e.step for e in events}
        assert {"skill_perceive", "skill_step", "skill_extract", "skill_done"} <= steps

        # (ii) extracts reached the store as CollectedRecords via the normal path.
        records = (await session.execute(
            select(CollectedRecord).where(CollectedRecord.source_id == source_id)
        )).scalars().all()
        assert len(records) == 2
        titles = {r.normalized_data.get("title") for r in records}
        assert titles == {"Row A", "Row B"}

        # clean run → completed (not awaiting_confirm).
        assert run.status == "completed"

    # the loop really drove the page op through the executor.
    assert ("goto", "https://example.com/list") in fake_page.ops


# ── acceptance #4 / #5(iii): paused run → awaiting_confirm status ──────────────
async def test_skill_run_paused_sets_awaiting_confirm(spine_db, monkeypatch):
    from backend.pipeline.runner import run_collection_pipeline

    fake_page = FakePage()
    # A high-risk click (ref 1 named "Delete") with auto_confirm off → the gate
    # blocks it in headless v1 → loop returns awaiting_confirm.
    fake_page._snap = [
        {"ref": 0, "role": "link", "name": "Row 1", "value": ""},
        {"ref": 1, "role": "button", "name": "Delete account", "value": ""},
    ]
    script = [
        ("extract", {"data": {"title": "Row A", "url": "https://example.com/a"}}),
        ("click", {"ref": "1"}),  # blocked by red line / high-risk → pause
        ("done", {"status": "success", "note": "should not reach"}),
    ]
    _patch_browser_and_model(monkeypatch, fake_page, script)

    source_id, task_id = await _seed_skill_source_task(
        spine_db, {"skill_md": SKILL_MD, "elements": ELEMENTS, "auto_confirm": False}
    )

    outcome = await run_collection_pipeline(task_id, {})

    # A paused run is still a successful pipeline execution (collect/store ran).
    assert outcome["success"] is True

    async with spine_db() as session:
        task = await session.get(CollectionTask, task_id)
        run = (await session.execute(
            select(TaskRun).where(TaskRun.task_id == task_id)
        )).scalar_one()

        # (iii) paused → awaiting_confirm on BOTH task and run, not completed/failed.
        assert run.status == "awaiting_confirm"
        assert task.status == "awaiting_confirm"

        # the awaiting_confirm event (emitted by the loop) appears for the run.
        events = (await session.execute(
            select(TaskRunEvent).where(TaskRunEvent.run_id == run.id)
        )).scalars().all()
        assert any(e.step == "awaiting_confirm" for e in events)

        # the one pre-pause extract still stored (paused after collecting it).
        records = (await session.execute(
            select(CollectedRecord).where(CollectedRecord.source_id == source_id)
        )).scalars().all()
        assert len(records) == 1

    # the blocked click never executed on the page.
    assert ("click", "1") not in fake_page.ops


# ── auto_confirm bypass: a high-risk action runs unattended → completed ────────
async def test_skill_run_auto_confirm_bypasses_gate(spine_db, monkeypatch):
    from backend.pipeline.runner import run_collection_pipeline

    fake_page = FakePage()
    fake_page._snap = [
        {"ref": 0, "role": "button", "name": "Submit", "value": ""},
    ]
    script = [
        ("click", {"ref": "0"}),  # high-risk, but auto_confirm bypasses
        ("done", {"status": "success", "note": "list page shown"}),
    ]
    _patch_browser_and_model(monkeypatch, fake_page, script)

    _source_id, task_id = await _seed_skill_source_task(
        spine_db, {"skill_md": SKILL_MD, "elements": ELEMENTS, "auto_confirm": True}
    )

    outcome = await run_collection_pipeline(task_id, {})
    assert outcome["success"] is True

    async with spine_db() as session:
        run = (await session.execute(
            select(TaskRun).where(TaskRun.task_id == task_id)
        )).scalar_one()
        assert run.status == "completed"

    # auto_confirm let the click through to the executor.
    assert ("click", "0") in fake_page.ops


# ── unit: collect() with no run_id no-ops events and still returns items ───────
async def test_collect_without_run_id_is_self_contained(monkeypatch):
    """A direct collect() (no pipeline / no run_id) drives the loop, returns
    extracts as items, and emits no events (run_id is None)."""
    from backend.channels.skill_channel import SkillChannel

    fake_page = FakePage()
    script = [
        ("extract", {"data": {"title": "Solo"}}),
        ("done", {"status": "success", "note": "list page shown"}),
    ]
    _patch_browser_and_model(monkeypatch, fake_page, script)

    result = await SkillChannel().collect(
        {"skill_md": SKILL_MD, "elements": ELEMENTS},
        {},  # no run_id
    )
    assert result.success is True
    assert result.metadata["executed"] is True
    assert result.metadata["awaiting_confirm"] is False
    assert result.items == [{"title": "Solo"}]


# ── SkillService leg: load SKILL.md from the DB, no inline body ─────────────────
async def test_collect_resolves_skill_from_db(spine_db, monkeypatch):
    """With no inline ``skill_md``, the channel resolves the persisted Skill by
    ``skill_id`` (and by ``(domain, capability)``), executes it, and appends the
    self-eval back to that row's ``evidence``."""
    from backend.channels.skill_channel import SkillChannel
    from backend.models.skill import Skill

    fake_page = FakePage()
    script = [
        ("extract", {"data": {"title": "FromDB"}}),
        ("done", {"status": "success", "note": "list page shown"}),
    ]
    _patch_browser_and_model(monkeypatch, fake_page, script)

    # Seed a persisted skill — its body lives only in the DB, never in config.
    async with spine_db() as session:
        skill = Skill(
            domain="demo",
            capability="list-rows",
            name="demo skill",
            skill_md=SKILL_MD,
            elements=ELEMENTS,
            enabled=True,
        )
        session.add(skill)
        await session.flush()
        skill_id = skill.id
        await session.commit()

    # (a) resolve by skill_id — no skill_md inline.
    result = await SkillChannel().collect({"skill_id": skill_id}, {})
    assert result.success is True
    assert result.items == [{"title": "FromDB"}]

    # self-eval written back to the resolved row (proves identity flowed through).
    async with spine_db() as session:
        row = await session.get(Skill, skill_id)
        assert len(row.evidence) == 1

    # (b) resolve by the unique (domain, capability).
    result2 = await SkillChannel().collect(
        {"domain": "demo", "capability": "list-rows"}, {}
    )
    assert result2.success is True
    assert result2.items == [{"title": "FromDB"}]

    # (c) a disabled skill refuses to execute with a clear error.
    async with spine_db() as session:
        row = await session.get(Skill, skill_id)
        row.enabled = False
        await session.commit()
    blocked = await SkillChannel().collect({"skill_id": skill_id}, {})
    assert blocked.success is False
    assert "disabled" in (blocked.error or "")


# ── SkillService leg: unresolvable skill → clean failure, not a crash ──────────
async def test_collect_unknown_skill_fails_cleanly(spine_db, monkeypatch):
    """A skill_id / (domain, capability) with no matching row returns a failed
    ChannelResult (not an exception)."""
    from backend.channels.skill_channel import SkillChannel

    fake_page = FakePage()
    _patch_browser_and_model(monkeypatch, fake_page, [])

    missing = await SkillChannel().collect({"skill_id": "nope-404"}, {})
    assert missing.success is False
    assert "not found" in (missing.error or "")


# ── Universal Studio bridge: /skill/invoke maps collect() into the wire envelope ─
async def test_skill_bridge_invoke_maps_envelope(monkeypatch):
    """The kernel's PythonBridge POSTs ``{capability, params, inputs}``; the
    endpoint maps a ``collect()`` run into ``{ok, outputs, events}``. Mirrors the
    self-contained collect path (inline skill_md, no run_id) — no DB/browser
    needed. Proves the Python half of the brick-2 wire contract (universal-studio
    ``platform/docs/PHASE-1-horizontal-slice.md``)."""
    from backend.api.v1.skill_bridge import skill_invoke

    fake_page = FakePage()
    script = [
        ("extract", {"data": {"title": "Solo"}}),
        ("done", {"status": "success", "note": "list page shown"}),
    ]
    _patch_browser_and_model(monkeypatch, fake_page, script)

    body = {
        "capability": "browser.skill.execute",
        "params": {"skill_md": SKILL_MD, "elements": ELEMENTS},
        "inputs": {"task": {"type": {"kind": "Value", "of": "string"}, "value": "list the rows"}},
    }
    env = await skill_invoke(body)

    # ok + three typed output ports mapped from ChannelResult.items + metadata.
    assert env["ok"] is True
    outputs = env["outputs"]
    assert outputs["records"]["type"] == {"kind": "DataRef", "of": "Record"}
    assert outputs["records"]["value"] == [{"title": "Solo"}]
    assert outputs["trace"]["type"]["of"] == "JourneyTrace"
    assert isinstance(outputs["trace"]["value"], dict)
    assert outputs["self_eval"]["type"] == {"kind": "Value", "of": "SelfEval"}
    assert outputs["self_eval"]["value"] is not None

    # events = faithful projection of the trace steps (post-hoc node.progress).
    steps = outputs["trace"]["value"].get("steps") or []
    assert steps  # the run produced at least one step
    assert isinstance(env["events"], list)
    assert len(env["events"]) == len(steps)

    # unknown capability → clean failure envelope (HTTP 200, ok:false), not a 500.
    bad = await skill_invoke({"capability": "nope", "params": {}, "inputs": {}})
    assert bad["ok"] is False
    assert "unknown capability" in (bad["error"] or "")
