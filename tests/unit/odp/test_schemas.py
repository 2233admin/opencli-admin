"""Typed ODP contract mirror — wire shape and response parsing are pinned here.

These lock the bytes opencli-admin exchanges with the Rust ingest service
(``odp-rs/crates/odp-contracts``). If the Rust contract changes, these should
fail and force a deliberate update on both sides.
"""

from backend.odp.schemas import (
    SCHEMA_VERSION,
    IngestReject,
    OdpIngestResponse,
    RecordEvent,
)


def test_schema_version_is_one():
    # Mirrors odp_contracts::SCHEMA_VERSION; the schema file is named "v2" but the
    # integer on the wire is 1.
    assert SCHEMA_VERSION == 1


def test_record_event_to_wire_pins_shape():
    ev = RecordEvent(
        provider="opencli-admin/rss",
        source_id="src-1",
        event_id="hash-1",
        source_ts="2026-06-30T12:00:00Z",
        payload={"title": "t", "url": "u"},
        raw_data={"title": "t"},
        task_id="task-1",
    )
    assert ev.to_wire() == {
        "schema_version": 1,
        "provider": "opencli-admin/rss",
        "source_id": "src-1",
        "event_id": "hash-1",
        "ingest_mode": "snapshot",
        "source_ts": "2026-06-30T12:00:00Z",
        "cursor": None,
        "payload": {"title": "t", "url": "u"},
        "raw_data": {"title": "t"},
        "trace_id": None,
        "task_id": "task-1",
    }


def test_record_event_wire_keeps_explicit_nulls():
    # The legacy forwarder emits explicit null cursor/trace_id/task_id/raw_data
    # (not skip-when-null); Rust accepts both via #[serde(default)]. Lock the
    # explicit form so a later forward-path swap stays byte-equivalent.
    wire = RecordEvent(
        provider="p",
        source_id="s",
        event_id="e",
        source_ts="2026-01-01T00:00:00Z",
        payload={},
    ).to_wire()
    assert wire["cursor"] is None
    assert wire["trace_id"] is None
    assert wire["task_id"] is None
    assert wire["raw_data"] is None


def test_response_from_wire_full():
    resp = OdpIngestResponse.from_wire(
        {
            "accepted": 3,
            "duplicates": 1,
            "rejected": 2,
            "errors": [
                {"index": 4, "event_id": "e4", "reason": "bad payload"},
                {"index": 5, "reason": "dup"},
            ],
        }
    )
    assert (resp.accepted, resp.duplicates, resp.rejected) == (3, 1, 2)
    assert resp.errors == [
        IngestReject(index=4, reason="bad payload", event_id="e4"),
        IngestReject(index=5, reason="dup", event_id=None),
    ]


def test_response_from_wire_tolerates_missing_fields():
    resp = OdpIngestResponse.from_wire({})
    assert (resp.accepted, resp.duplicates, resp.rejected) == (0, 0, 0)
    assert resp.errors == []


def test_response_from_wire_tolerates_null_errors():
    resp = OdpIngestResponse.from_wire({"accepted": 1, "errors": None})
    assert resp.accepted == 1
    assert resp.errors == []
