from types import SimpleNamespace

from backend.executor.local import LocalExecutor


def test_active_pipeline_tasks_counts_running_and_queued_collections() -> None:
    executor = LocalExecutor()
    executor._collection_tasks = {
        "running": SimpleNamespace(done=lambda: False),
        "finished": SimpleNamespace(done=lambda: True),
    }
    executor._scheduled_collection_tasks = {
        "queued": SimpleNamespace(done=lambda: False),
    }

    assert executor.active_pipeline_tasks == 2
