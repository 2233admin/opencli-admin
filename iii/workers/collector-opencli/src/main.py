"""M3: OpenCLI snapshot collector — opencli → Record v2 → odp.ingest::batch."""

from __future__ import annotations

import os
import sys
import uuid
from pathlib import Path
from typing import Any

from iii import InitOptions, register_worker
from iii_observability import Logger

# /app/worker/src/main.py → parents[2] == /app (schedule-bootstrap uses parents[3])
III_ROOT = Path(__file__).resolve().parents[2]
if str(III_ROOT) not in sys.path:
    sys.path.insert(0, str(III_ROOT))

from lib import opencli_cli  # noqa: E402
from lib.env_bootstrap import bootstrap_worker_env  # noqa: E402
from lib.odp_record import opencli_items_to_events, source_id_for_opencli  # noqa: E402

bootstrap_worker_env()

worker = register_worker(
    os.environ.get("III_URL", "ws://localhost:49134"),
    InitOptions(
        worker_name="collector-opencli",
        worker_description="OpenCLI site snapshots (B站/小红书/Twitter等) into ODP ingest",
    ),
)
logger = Logger()


def opencli_snapshot_handler(payload: dict[str, Any]) -> dict[str, Any]:
    site = str(payload.get("site") or "").strip()
    command = str(payload.get("command") or "").strip()
    if not site or not command:
        raise ValueError("site and command are required")

    source_id = source_id_for_opencli(site, command, payload.get("source_id"))
    task_id = payload.get("task_id") or str(uuid.uuid4())
    trace_id = payload.get("trace_id") or str(uuid.uuid4())

    logger.info(
        "odp.collect::opencli_snapshot",
        {
            "site": site,
            "command": command,
            "schedule_id": payload.get("schedule_id"),
            "cron_job_id": (payload.get("cron") or {}).get("job_id"),
        },
    )

    collect_result = opencli_cli.run_collect(
        site=site,
        command=command,
        args=payload.get("args"),
        positional_args=payload.get("positional_args"),
        output_format=str(payload.get("format") or "json"),
        mode=payload.get("mode"),
        chrome_endpoint=payload.get("chrome_endpoint"),
    )
    items = collect_result.get("items") or []
    events = opencli_items_to_events(
        items,
        site=site,
        command=command,
        source_id=source_id,
        task_id=task_id,
        trace_id=trace_id,
    )

    ingest_result: dict[str, Any] = {"sent": 0, "accepted": 0, "duplicates": 0, "rejected": 0}
    if events:
        ingest_result = worker.trigger(
            {
                "function_id": "odp.ingest::batch",
                "payload": {
                    "events": events,
                    "trace_id": trace_id,
                    "task_id": task_id,
                },
            }
        )

    return {
        "ok": True,
        "site": site,
        "command": command,
        "source_id": source_id,
        "task_id": task_id,
        "trace_id": trace_id,
        "schedule_id": payload.get("schedule_id"),
        "collect": collect_result,
        "items_fetched": len(items),
        "ingest": ingest_result,
    }


def status_handler(_payload: dict[str, Any]) -> dict[str, Any]:
    import shutil

    bin_path = os.environ.get("OPENCLI_BIN", "opencli")
    return {
        "opencli_bin": bin_path,
        "opencli_found": bool(shutil.which(bin_path) or os.path.isfile(bin_path)),
        "mode": os.environ.get("OPENCLI_MODE", "bridge"),
        "daemon_host": os.environ.get("OPENCLI_DAEMON_HOST", "agent-1"),
        "daemon_port": os.environ.get("OPENCLI_DAEMON_PORT", "19825"),
    }


worker.register_function(
    "odp.collect::opencli_snapshot",
    opencli_snapshot_handler,
    description="Run opencli site/command and ingest items as Record v2",
)
worker.register_function(
    "opencli::status",
    status_handler,
    description="opencli binary and bridge/cdp connection settings",
)

print("collector-opencli started — odp.collect::opencli_snapshot, opencli::status")