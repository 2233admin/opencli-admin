"""Unit tests for backend/worker/tasks.py — celery task retry wiring."""

from backend.worker.tasks import run_collection


def test_run_collection_autoretries_on_any_exception():
    """PR-B's whole retry story depends on this: run_pipeline() only ever
    re-raises exceptions its error taxonomy already classified as retryable
    (everything else is swallowed into a returned PipelineResult before it
    gets here), so it's correct — not overly broad — for the celery task
    boundary to autoretry on any Exception that reaches it."""
    assert run_collection.autoretry_for == (Exception,)
    assert run_collection.max_retries == 3
    assert run_collection.default_retry_delay == 60
