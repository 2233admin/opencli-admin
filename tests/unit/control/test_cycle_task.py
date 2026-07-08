"""Start/stop smoke test for backend.control.cycle_task (issue 03 / PR-Control-4).

The asyncio wrapper is intentionally thin — all decision logic is tested
directly against run_control_cycle_once (see test_cycle.py). This just
proves the background task starts, ticks at least once, and stops cleanly
without leaking a running task.
"""

import asyncio

import pytest

from backend.control import cycle_task


@pytest.fixture(autouse=True)
async def _ensure_stopped():
    yield
    await cycle_task.stop()


@pytest.mark.asyncio
async def test_start_then_stop_is_clean(monkeypatch):
    ticks = []

    async def _fake_tick():
        ticks.append(1)

    monkeypatch.setattr(cycle_task, "_tick", _fake_tick)
    monkeypatch.setattr(
        cycle_task,
        "get_settings",
        lambda: type("S", (), {"control_cycle_period_seconds": 0.01})(),
    )

    assert cycle_task.is_running() is False
    cycle_task.start()
    assert cycle_task.is_running() is True

    # Let it tick at least once.
    await asyncio.sleep(0.05)
    assert len(ticks) >= 1

    await cycle_task.stop()
    assert cycle_task.is_running() is False


@pytest.mark.asyncio
async def test_start_is_idempotent(monkeypatch):
    async def _fake_tick():
        pass

    monkeypatch.setattr(cycle_task, "_tick", _fake_tick)
    monkeypatch.setattr(
        cycle_task,
        "get_settings",
        lambda: type("S", (), {"control_cycle_period_seconds": 10})(),
    )

    cycle_task.start()
    first_task = cycle_task._task
    cycle_task.start()
    assert cycle_task._task is first_task  # no-op second start

    await cycle_task.stop()


@pytest.mark.asyncio
async def test_stop_without_start_is_a_noop():
    assert cycle_task.is_running() is False
    await cycle_task.stop()  # must not raise
    assert cycle_task.is_running() is False
