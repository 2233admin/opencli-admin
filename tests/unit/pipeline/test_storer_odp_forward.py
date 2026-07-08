"""Characterization: the ODP shadow-forward inside ``store_records``.

``storer.store_records`` forwards to ODP *before* the sqlite write when
``ODP_INGEST_URL`` is set — an existing shadow, not added by the refactor. These
lock the gate and the fail-open / fail-closed behavior so a later step can move
the forward into an ``OdpSink`` and prove equivalence.
"""

from unittest.mock import AsyncMock, patch

import pytest

from backend.pipeline import storer


def _triple(source_id, n):
    raw = {"title": f"A{n}"}
    normalized = {
        "title": f"A{n}",
        "url": f"https://x/{n}",
        "content": "",
        "author": "",
        "published_at": "2026-06-30T12:00:00Z",
        "source_id": source_id,
    }
    return (raw, normalized, f"hash-{n}")


async def _seed(db_session):
    from backend.models.source import DataSource
    from backend.models.task import CollectionTask

    source = DataSource(
        name="ODP Source",
        channel_type="rss",
        channel_config={"feed_url": "https://x/f"},
    )
    db_session.add(source)
    await db_session.flush()
    task = CollectionTask(source_id=source.id, trigger_type="manual", parameters={})
    db_session.add(task)
    await db_session.flush()
    return source, task


@pytest.mark.asyncio
async def test_forward_called_when_url_set_and_flag_explicit_true(db_session, monkeypatch):
    # P1-1: forward_to_odp now defaults to False, so an explicit opt-in is
    # required — this is the shape OdpSink/DualSink use for an ODP-aware
    # write_strategy. ODP_INGEST_URL being set is necessary but no longer
    # sufficient on its own (see test_forward_skipped_when_flag_defaults_false).
    monkeypatch.setenv("ODP_INGEST_URL", "http://odp:8040")
    source, task = await _seed(db_session)
    triples = [_triple(source.id, 1), _triple(source.id, 2)]

    post_mock = AsyncMock(return_value=(2, 0, 0))
    with patch("backend.pipeline.odp_client.post_batch", new=post_mock):
        new_records, skipped = await storer.store_records(
            db_session, task.id, source.id, triples, channel_type="rss",
            forward_to_odp=True,
        )

    assert len(new_records) == 2
    assert skipped == 0
    post_mock.assert_awaited_once()
    sent = post_mock.call_args.args[0]
    assert [e["event_id"] for e in sent] == ["hash-1", "hash-2"]
    assert sent[0]["provider"] == "opencli-admin/rss"
    assert sent[0]["task_id"] == str(task.id)


@pytest.mark.asyncio
async def test_forward_skipped_when_flag_defaults_false(db_session, monkeypatch):
    # P1-1 strangler collapse: the bare-env-var backdoor is closed. Even with
    # ODP_INGEST_URL set, a caller that does not explicitly opt in (the new
    # default) must NOT forward — closing the "legacy source silently leaks
    # into ODP" bug. Only an explicit write_strategy (OdpSink/DualSink) opts in.
    monkeypatch.setenv("ODP_INGEST_URL", "http://odp:8040")
    source, task = await _seed(db_session)

    post_mock = AsyncMock(return_value=(1, 0, 0))
    with patch("backend.pipeline.odp_client.post_batch", new=post_mock):
        new_records, _ = await storer.store_records(
            db_session, task.id, source.id, [_triple(source.id, 1)], channel_type="rss",
        )

    assert len(new_records) == 1
    post_mock.assert_not_awaited()


@pytest.mark.asyncio
async def test_forward_suppressed_when_flag_false(db_session, monkeypatch):
    # The forward_to_odp gate (PR3) lets DualSink's legacy leg suppress the
    # storer forward even when ODP_INGEST_URL is set — no double-send.
    monkeypatch.setenv("ODP_INGEST_URL", "http://odp:8040")
    source, task = await _seed(db_session)

    post_mock = AsyncMock(return_value=(1, 0, 0))
    with patch("backend.pipeline.odp_client.post_batch", new=post_mock):
        new_records, _ = await storer.store_records(
            db_session, task.id, source.id, [_triple(source.id, 1)],
            channel_type="rss", forward_to_odp=False,
        )

    assert len(new_records) == 1
    post_mock.assert_not_awaited()


@pytest.mark.asyncio
async def test_forward_skipped_when_url_unset(db_session, monkeypatch):
    monkeypatch.delenv("ODP_INGEST_URL", raising=False)
    source, task = await _seed(db_session)

    post_mock = AsyncMock(return_value=(1, 0, 0))
    with patch("backend.pipeline.odp_client.post_batch", new=post_mock):
        new_records, _ = await storer.store_records(
            db_session, task.id, source.id, [_triple(source.id, 1)], channel_type="rss"
        )

    assert len(new_records) == 1
    post_mock.assert_not_awaited()


@pytest.mark.asyncio
async def test_forward_failure_swallowed_by_default(db_session, monkeypatch):
    monkeypatch.setenv("ODP_INGEST_URL", "http://odp:8040")
    monkeypatch.delenv("ODP_INGEST_REQUIRED", raising=False)
    source, task = await _seed(db_session)

    boom = AsyncMock(side_effect=RuntimeError("odp down"))
    with patch("backend.pipeline.odp_client.post_batch", new=boom):
        new_records, _ = await storer.store_records(
            db_session, task.id, source.id, [_triple(source.id, 1)], channel_type="rss",
            forward_to_odp=True,
        )

    # Fail-open: ODP being down must not block the sqlite write.
    assert len(new_records) == 1


@pytest.mark.asyncio
async def test_forward_failure_raises_when_required(db_session, monkeypatch):
    monkeypatch.setenv("ODP_INGEST_URL", "http://odp:8040")
    monkeypatch.setenv("ODP_INGEST_REQUIRED", "1")
    source, task = await _seed(db_session)

    boom = AsyncMock(side_effect=RuntimeError("odp down"))
    with patch("backend.pipeline.odp_client.post_batch", new=boom):
        with pytest.raises(RuntimeError, match="odp down"):
            await storer.store_records(
                db_session, task.id, source.id, [_triple(source.id, 1)], channel_type="rss",
                forward_to_odp=True,
            )
