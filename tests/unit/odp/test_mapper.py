"""RecordEventMapper — normalized record -> RecordEvent field mapping is pinned.

The mapper is the single source of truth for the ODP payload shape; the legacy
forwarder (``odp_client.triple_to_event``) and the future ``OdpSink`` both route
through it.
"""

from datetime import datetime

from backend.odp.mapper import RecordEventMapper, provider_for_channel


def _normalized(**over):
    base = {
        "title": "Hello",
        "url": "https://x/a",
        "content": "body",
        "author": "",
        "published_at": "2026-06-30T12:00:00Z",
        "source_id": "src-1",
    }
    base.update(over)
    return base


def test_provider_for_channel():
    assert provider_for_channel("rss") == "opencli-admin/rss"


def test_from_triple_maps_fields():
    raw = {"title": "Hello"}
    normalized = _normalized()
    ev = RecordEventMapper.from_triple(
        channel_type="rss",
        source_id="src-1",
        task_id="task-9",
        raw=raw,
        normalized=normalized,
        content_hash="hash-1",
    )
    assert ev.provider == "opencli-admin/rss"
    assert ev.source_id == "src-1"
    assert ev.event_id == "hash-1"
    assert ev.task_id == "task-9"
    # payload/raw_data carried by reference — same dicts the normalizer produced.
    assert ev.payload is normalized
    assert ev.raw_data is raw
    assert ev.ingest_mode == "snapshot"
    assert ev.cursor is None
    assert ev.trace_id is None
    assert ev.source_ts == "2026-06-30T12:00:00Z"


def test_from_triple_coerces_ids_to_str():
    ev = RecordEventMapper.from_triple(
        channel_type="api",
        source_id=42,
        task_id=7,
        raw={},
        normalized=_normalized(),
        content_hash="h",
    )
    assert ev.source_id == "42"
    assert ev.task_id == "7"


def test_source_ts_falls_back_to_now_when_missing():
    ev = RecordEventMapper.from_triple(
        channel_type="rss",
        source_id="s",
        task_id="t",
        raw={},
        normalized=_normalized(published_at=""),
        content_hash="h",
    )
    # Value is non-deterministic (now), but must be valid RFC3339 ending in Z.
    assert ev.source_ts.endswith("Z")
    datetime.fromisoformat(ev.source_ts.replace("Z", "+00:00"))


def test_source_ts_falls_back_to_now_when_unparseable():
    ev = RecordEventMapper.from_triple(
        channel_type="rss",
        source_id="s",
        task_id="t",
        raw={},
        normalized=_normalized(published_at="not-a-date"),
        content_hash="h",
    )
    assert ev.source_ts.endswith("Z")
    datetime.fromisoformat(ev.source_ts.replace("Z", "+00:00"))


def test_naive_published_at_assumed_utc():
    ev = RecordEventMapper.from_triple(
        channel_type="rss",
        source_id="s",
        task_id="t",
        raw={},
        normalized=_normalized(published_at="2026-06-30T12:00:00"),
        content_hash="h",
    )
    assert ev.source_ts == "2026-06-30T12:00:00Z"


def test_ingest_mode_and_cursor_passthrough():
    ev = RecordEventMapper.from_triple(
        channel_type="rss",
        source_id="s",
        task_id="t",
        raw={},
        normalized=_normalized(),
        content_hash="h",
        ingest_mode="stream",
        cursor="etag-123",
    )
    assert ev.ingest_mode == "stream"
    assert ev.cursor == "etag-123"
    wire = ev.to_wire()
    assert wire["ingest_mode"] == "stream"
    assert wire["cursor"] == "etag-123"
