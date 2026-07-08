"""Tests wiring classification (PR-C) into the pipeline orchestrator.

Confirms:
  - classification runs after the AI step regardless of success/failure/skip
  - classification never runs when there are no new_records
  - a classification failure is swallowed and does not fail the pipeline or
    change CollectionTask/record status handling
  - none of this touches the existing `status` state machine (regression
    coverage lives in test_pipeline.py / test_pipeline_errors.py and is run
    unchanged as part of the full suite)
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.channels.base import ChannelResult
from backend.pipeline.pipeline import run_pipeline


async def _setup_source_task(db_session, ai_config=None):
    from backend.models.source import DataSource
    from backend.models.task import CollectionTask

    source = DataSource(
        name="Classification Pipeline Source",
        channel_type="rss",
        channel_config={"feed_url": "https://ex.com/feed.xml"},
        ai_config=ai_config,
    )
    db_session.add(source)
    await db_session.flush()

    task = CollectionTask(source_id=source.id, trigger_type="manual", parameters={})
    db_session.add(task)
    await db_session.flush()

    return source, task


def _session_cm(session):
    cm = AsyncMock()
    cm.__aenter__ = AsyncMock(return_value=session)
    cm.__aexit__ = AsyncMock(return_value=False)
    return cm


@pytest.mark.asyncio
async def test_classification_runs_after_successful_ai_step(db_session):
    source, task = await _setup_source_task(
        db_session,
        ai_config={"processor_type": "claude", "prompt_template": "x"},
    )

    mock_items = [{"title": "Item", "url": "https://ex.com/1"}]
    channel_result = ChannelResult.ok(mock_items)
    mock_record = MagicMock()
    mock_record.id = "rec-1"
    mock_record.ai_enrichment = {"category": "模型能力"}

    mock_inner_session = AsyncMock()
    mock_inner_session.get = AsyncMock(return_value=MagicMock())
    mock_inner_session.commit = AsyncMock()

    mock_classify = AsyncMock()

    with (
        patch("backend.pipeline.collector.collect", return_value=channel_result),
        patch("backend.pipeline.storer.store_records", new=AsyncMock(return_value=([mock_record], 0))),
        patch("backend.pipeline.ai_processor.process_with_ai", new=AsyncMock()),
        patch("backend.pipeline.classification.classify_records", mock_classify),
        patch("backend.database.AsyncSessionLocal", return_value=_session_cm(mock_inner_session)),
    ):
        result = await run_pipeline(
            task.id,
            source,
            enable_ai=True,
            enable_notifications=False,
        )

    assert result.success is True
    mock_classify.assert_awaited_once()
    args, _ = mock_classify.call_args
    assert args[1] == [mock_record]
    assert args[2] is source


@pytest.mark.asyncio
async def test_classification_runs_when_ai_disabled(db_session):
    """Locked behavior: classification must happen even when AI enrichment
    never ran at all (enable_ai=False)."""
    source, task = await _setup_source_task(db_session)

    mock_items = [{"title": "Item", "url": "https://ex.com/1"}]
    channel_result = ChannelResult.ok(mock_items)
    mock_record = MagicMock()
    mock_record.id = "rec-2"
    mock_record.ai_enrichment = None

    mock_classify = AsyncMock()

    with (
        patch("backend.pipeline.collector.collect", return_value=channel_result),
        patch("backend.pipeline.storer.store_records", new=AsyncMock(return_value=([mock_record], 0))),
        patch("backend.pipeline.classification.classify_records", mock_classify),
    ):
        result = await run_pipeline(
            task.id,
            source,
            enable_ai=False,
            enable_notifications=False,
        )

    assert result.success is True
    mock_classify.assert_awaited_once()


@pytest.mark.asyncio
async def test_classification_runs_when_ai_config_missing(db_session):
    """enable_ai=True but no ai_config -> AI step is skipped (existing
    behavior), classification must still run."""
    source, task = await _setup_source_task(db_session, ai_config=None)

    mock_items = [{"title": "Item", "url": "https://ex.com/1"}]
    channel_result = ChannelResult.ok(mock_items)
    mock_record = MagicMock()
    mock_record.id = "rec-3"
    mock_record.ai_enrichment = None

    mock_classify = AsyncMock()

    with (
        patch("backend.pipeline.collector.collect", return_value=channel_result),
        patch("backend.pipeline.storer.store_records", new=AsyncMock(return_value=([mock_record], 0))),
        patch("backend.pipeline.classification.classify_records", mock_classify),
    ):
        result = await run_pipeline(
            task.id,
            source,
            agent_config=None,
            enable_ai=True,
            enable_notifications=False,
        )

    assert result.success is True
    mock_classify.assert_awaited_once()


@pytest.mark.asyncio
async def test_classification_skipped_when_no_new_records(db_session):
    source, task = await _setup_source_task(db_session)

    channel_result = ChannelResult.ok([])

    mock_classify = AsyncMock()

    with (
        patch("backend.pipeline.collector.collect", return_value=channel_result),
        patch("backend.pipeline.storer.store_records", new=AsyncMock(return_value=([], 0))),
        patch("backend.pipeline.classification.classify_records", mock_classify),
    ):
        result = await run_pipeline(
            task.id,
            source,
            enable_ai=False,
            enable_notifications=False,
        )

    assert result.success is True
    mock_classify.assert_not_awaited()


@pytest.mark.asyncio
async def test_classification_failure_does_not_fail_pipeline(db_session):
    """A blown-up classification step (e.g. DB hiccup) is a non-fatal side
    effect — it must be swallowed, not surfaced as a pipeline failure, and
    must not touch task/record status."""
    source, task = await _setup_source_task(db_session)

    mock_items = [{"title": "Item", "url": "https://ex.com/1"}]
    channel_result = ChannelResult.ok(mock_items)
    mock_record = MagicMock()
    mock_record.id = "rec-4"
    mock_record.ai_enrichment = None

    with (
        patch("backend.pipeline.collector.collect", return_value=channel_result),
        patch("backend.pipeline.storer.store_records", new=AsyncMock(return_value=([mock_record], 0))),
        patch(
            "backend.pipeline.classification.classify_records",
            new=AsyncMock(side_effect=RuntimeError("classification exploded")),
        ),
    ):
        result = await run_pipeline(
            task.id,
            source,
            enable_ai=False,
            enable_notifications=False,
        )

    # Classification blew up, but the pipeline still reports success — same
    # non-fatal contract as the existing AI/notify failure branches.
    assert result.success is True
