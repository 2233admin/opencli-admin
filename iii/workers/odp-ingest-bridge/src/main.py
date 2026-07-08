"""M0: III worker that posts Record v2 events to Rust odp-ingest."""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any

from iii import InitOptions, register_worker
from iii_observability import Logger

III_ROOT = Path(__file__).resolve().parents[2]
if str(III_ROOT) not in sys.path:
    sys.path.insert(0, str(III_ROOT))

from lib.env_bootstrap import bootstrap_worker_env  # noqa: E402
from lib.odp_record import post_batch_sync  # noqa: E402

bootstrap_worker_env()

worker = register_worker(
    os.environ.get("III_URL", "ws://localhost:49134"),
    InitOptions(
        worker_name="odp-ingest-bridge",
        worker_description="Forwards Record v2 batches to Rust odp-ingest (ODP data plane)",
    ),
)
logger = Logger()


def batch_handler(payload: dict[str, Any]) -> dict[str, Any]:
    events = payload.get("events") or []
    if not isinstance(events, list):
        raise ValueError("events must be a list")
    trace_id = payload.get("trace_id")
    task_id = payload.get("task_id")
    if trace_id or task_id:
        patched: list[dict[str, Any]] = []
        for ev in events:
            if not isinstance(ev, dict):
                continue
            row = dict(ev)
            if trace_id and not row.get("trace_id"):
                row["trace_id"] = trace_id
            if task_id and not row.get("task_id"):
                row["task_id"] = task_id
            patched.append(row)
        events = patched

    logger.info("odp.ingest::batch", {"count": len(events)})
    result = post_batch_sync(events)
    return {"ok": True, **result}


def single_handler(payload: dict[str, Any]) -> dict[str, Any]:
    event = payload.get("event")
    if not isinstance(event, dict):
        raise ValueError("event must be an object")
    return batch_handler({"events": [event], "trace_id": payload.get("trace_id"), "task_id": payload.get("task_id")})


def health_handler(_payload: dict[str, Any]) -> dict[str, Any]:
    from lib.odp_record import ingest_base_url

    return {"ok": True, "ingest_url": ingest_base_url()}


worker.register_function(
    "odp.ingest::batch",
    batch_handler,
    description="POST a Record v2 batch to Rust odp-ingest",
)
worker.register_function(
    "odp.ingest::single",
    single_handler,
    description="POST one Record v2 event to Rust odp-ingest",
)
worker.register_function(
    "odp.ingest::health",
    health_handler,
    description="Return configured ODP_INGEST_URL (connectivity probe)",
)

print("odp-ingest-bridge started — odp.ingest::{batch,single,health}")