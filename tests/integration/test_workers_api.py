"""Integration tests for /api/v1/workers endpoints."""

import asyncio
import threading
from types import SimpleNamespace

import pytest


@pytest.mark.asyncio
async def test_list_workers_reports_local_executor_without_inspecting_celery(client, monkeypatch):
    from backend.api.v1 import workers

    monkeypatch.setattr(
        workers,
        "get_settings",
        lambda: SimpleNamespace(
            task_executor="local",
            local_max_concurrent_pipelines=8,
        ),
    )

    def fail_if_celery_is_inspected():
        raise AssertionError("local executor must not inspect Celery")

    monkeypatch.setattr(workers, "_inspect_workers", fail_if_celery_is_inspected)
    monkeypatch.setattr(workers, "_local_active_pipeline_tasks", lambda: 3)

    response = await client.get("/api/v1/workers")

    assert response.status_code == 200
    assert response.json()["data"] == [
        {
            "id": "local",
            "worker_id": "local",
            "hostname": "local",
            "status": "online",
            "active_tasks": 3,
            "last_heartbeat": None,
            "concurrency": 8,
            "celery_version": None,
        }
    ]


@pytest.mark.asyncio
async def test_list_workers_celery_inspect_does_not_block_event_loop(client, monkeypatch):
    from backend.api.v1 import workers

    monkeypatch.setattr(
        workers,
        "get_settings",
        lambda: SimpleNamespace(task_executor="celery"),
    )
    inspect_started = threading.Event()
    release_inspect = threading.Event()

    def blocking_inspect():
        inspect_started.set()
        release_inspect.wait(timeout=0.5)
        return (
            {
                "celery@node-1": {
                    "hostname": "node-1",
                    "pool": {"max-concurrency": 4},
                    "versions": {"celery": "5.5.3"},
                }
            },
            {"celery@node-1": [{"id": "task-1"}]},
        )

    monkeypatch.setattr(workers, "_inspect_workers", blocking_inspect)

    loop = asyncio.get_running_loop()
    started_at = loop.time()
    request = asyncio.create_task(client.get("/api/v1/workers"))
    await asyncio.sleep(0.02)
    event_loop_delay = loop.time() - started_at

    try:
        assert inspect_started.is_set()
        assert event_loop_delay < 0.15
        assert not request.done()
    finally:
        release_inspect.set()

    response = await request
    assert response.status_code == 200
    assert response.json()["data"] == [
        {
            "id": "celery@node-1",
            "worker_id": "celery@node-1",
            "hostname": "node-1",
            "status": "online",
            "active_tasks": 1,
            "last_heartbeat": None,
            "concurrency": 4,
            "celery_version": "5.5.3",
        }
    ]


@pytest.mark.asyncio
async def test_celery_stats(client):
    response = await client.get("/api/v1/workers/celery-stats")
    assert response.status_code == 200
    data = response.json()["data"]
    # Returns error dict if Celery not running
    assert "stats" in data or "error" in data
