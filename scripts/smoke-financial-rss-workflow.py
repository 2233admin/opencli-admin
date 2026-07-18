"""Run the real multi-source financial RSS workflow against a local backend."""

from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime

import httpx

EXPECTED_GROUPS = {
    "macro-policy",
    "market-regulation",
    "central-bank-research",
}


def build_project() -> dict:
    source_definitions = [
        {
            "id": "rss-federal-reserve",
            "feedUrl": "https://www.federalreserve.gov/feeds/press_all.xml",
            "sourceGroup": "macro-policy",
            "site": "federal-reserve",
        },
        {
            "id": "rss-sec-regulation",
            "feedUrl": "https://www.sec.gov/news/pressreleases.rss",
            "sourceGroup": "market-regulation",
            "site": "sec",
        },
        {
            "id": "rss-ecb-research",
            "feedUrl": "https://www.ecb.europa.eu/rss/press.html",
            "sourceGroup": "central-bank-research",
            "site": "ecb",
        },
    ]
    nodes = [
        {
            "id": "schedule-finance-rss",
            "kind": "schedule",
            "capability": "trigger",
            "params": {"interval": "15m", "timezone": "Asia/Shanghai"},
            "ui": {"catalogId": "intelligence.schedule.cron"},
        },
        *[
            {
                "id": source["id"],
                "kind": "source",
                "capability": "fetch",
                "adapter": "rss-feed",
                "params": {
                    "feedUrl": source["feedUrl"],
                    "maxEntries": 5,
                    "sourceGroup": source["sourceGroup"],
                    "site": source["site"],
                },
                "ui": {"catalogId": "intelligence.source.rss"},
            }
            for source in source_definitions
        ],
        {
            "id": "normalize-finance-rss",
            "kind": "agent",
            "capability": "normalize",
            "params": {"language": "zh-CN", "preserveSourceRefs": True},
            "ui": {"catalogId": "intelligence.processing.normalize"},
        },
        {
            "id": "accept-finance-rss",
            "kind": "control",
            "capability": "accept",
            "params": {
                "mode": "automatic_with_review",
                "schema": "record.v1",
                "dedupe": "required",
                "lineageRequired": True,
                "minQuality": 0,
            },
            "ui": {"catalogId": "intelligence.control.record-acceptance"},
        },
        {
            "id": "records-finance-rss",
            "kind": "sink",
            "capability": "store",
            "params": {
                "target": "records",
                "writeMode": "append",
                "preserveLineage": True,
            },
            "ui": {"catalogId": "intelligence.sink.records"},
        },
    ]
    edges = [
        *[
            {
                "id": f"schedule-{source['id']}",
                "source": "schedule-finance-rss",
                "target": source["id"],
                "sourcePort": "tick",
                "targetPort": "in",
            }
            for source in source_definitions
        ],
        *[
            {
                "id": f"{source['id']}-normalize",
                "source": source["id"],
                "target": "normalize-finance-rss",
                "sourcePort": "out",
                "targetPort": "in",
            }
            for source in source_definitions
        ],
        {
            "id": "normalize-accept",
            "source": "normalize-finance-rss",
            "target": "accept-finance-rss",
            "sourcePort": "out",
            "targetPort": "candidates",
        },
        {
            "id": "accept-records",
            "source": "accept-finance-rss",
            "target": "records-finance-rss",
            "sourcePort": "records",
            "targetPort": "records",
        },
    ]
    return {
        "id": "wf-financial-rss-mvp",
        "name": "财经多源 RSS 情报 MVP",
        "profile": "intelligence",
        "version": 1,
        "settings": {"maxItemsPerRun": 30},
        "nodes": nodes,
        "edges": edges,
        "adapters": [
            {
                "id": "rss-feed",
                "type": "source",
                "provider": "rss",
                "mode": "live",
                "config": {"channel": "rss"},
            }
        ],
        "agentPermissions": {
            "canFetchNetwork": True,
            "canSendNotifications": False,
            "canWriteInbox": True,
            "allowedDomains": [
                "federalreserve.gov",
                "sec.gov",
                "ecb.europa.eu",
            ],
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8031")
    args = parser.parse_args()
    run_id = f"run-financial-rss-{datetime.now(UTC).strftime('%Y%m%d%H%M%S')}"
    request = {
        "project": build_project(),
        "runId": run_id,
        "traceId": f"trace-{run_id}",
        "trigger": {
            "kind": "schedule",
            "triggerNodeId": "schedule-finance-rss",
        },
    }

    with httpx.Client(base_url=args.base_url, timeout=120) as client:
        response = client.post("/api/v1/workflows/runs", json=request)
        response.raise_for_status()
        run = response.json()["data"]
        events_response = client.get(f"/api/v1/workflows/runs/{run_id}/events")
        events_response.raise_for_status()
        events = events_response.json()["data"]

    source_events = [
        event
        for event in events
        if event["message"] == "Live RSS source loaded as workflow items"
    ]
    sink_events = [
        event
        for event in events
        if event["nodeId"] == "records-finance-rss" and event["eventType"] == "partial"
    ]
    groups = {
        event["batch"]["sourceGroup"]
        for event in source_events
        if event.get("batch", {}).get("sourceGroup")
    }
    sink_details = sink_events[-1]["details"] if sink_events else {}
    summary = {
        "runId": run_id,
        "status": run["status"],
        "eventCount": run["eventCount"],
        "rssSources": len(source_events),
        "groups": sorted(groups),
        "itemCounts": {
            event["batch"]["sourceGroup"]: event["details"]["itemCount"]
            for event in source_events
        },
        "feedTitles": {
            event["batch"]["sourceGroup"]: event["details"]["feedTitle"]
            for event in source_events
        },
        "storedRecords": sink_details.get("storedRecordCount", 0),
        "skippedRecords": sink_details.get("skippedRecordCount", 0),
        "errors": run.get("errors", []),
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))

    passed = (
        run["status"] == "completed"
        and groups == EXPECTED_GROUPS
        and all(event["details"]["itemCount"] > 0 for event in source_events)
        and sink_details.get("storedRecordCount", 0) > 0
    )
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
