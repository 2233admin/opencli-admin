"""Run official RSS, RSSHub, and RSS-Bridge through the live workflow pipeline."""

from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from typing import Any

import httpx

EXPECTED_GROUPS = {
    "official-rss",
    "rsshub-ecosystem",
    "rss-bridge-ecosystem",
}


def _data(response: httpx.Response) -> Any:
    response.raise_for_status()
    return response.json()["data"]


def _ensure_provider(
    client: httpx.Client,
    *,
    provider_type: str,
    name: str,
    base_url: str,
) -> dict[str, Any]:
    providers = _data(client.get("/api/v1/providers/feed-generators"))
    provider = next(
        (
            item
            for item in providers
            if item["provider_type"] == provider_type
            and item["base_url"].rstrip("/") == base_url.rstrip("/")
        ),
        None,
    )
    if provider is not None:
        return provider

    return _data(
        client.post(
            "/api/v1/providers/feed-generators",
            json={
                "name": name,
                "provider_type": provider_type,
                "base_url": base_url,
                "config": {
                    "timeout_seconds": 30,
                    "allowed_domains": ["127.0.0.1"],
                    "allow_private_network": True,
                    "browser_routes": False,
                    "authenticated_routes": False,
                },
                "enabled": True,
            },
        )
    )


def _provider_node(
    client: httpx.Client,
    provider_id: str,
    payload: dict[str, Any],
    node_id: str,
) -> dict[str, Any]:
    generated = _data(
        client.post(
            f"/api/v1/providers/feed-generators/{provider_id}/workflow-node",
            json=payload,
        )
    )
    return {
        "id": node_id,
        "kind": "source",
        "capability": "fetch",
        "adapter": "rss-feed",
        "params": generated["params"],
        "ui": {"catalogId": generated["nodeType"], "label": generated["label"]},
    }


def build_project(
    client: httpx.Client,
    *,
    rsshub: dict[str, Any],
    rss_bridge: dict[str, Any],
    webhook_url: str,
) -> dict[str, Any]:
    official_node = {
        "id": "rss-official",
        "kind": "source",
        "capability": "fetch",
        "adapter": "rss-feed",
        "params": {
            "feedUrl": "https://www.federalreserve.gov/feeds/press_all.xml",
            "maxEntries": 5,
            "sourceGroup": "official-rss",
            "site": "federal-reserve",
        },
        "ui": {"catalogId": "intelligence.source.rss", "label": "Official RSS"},
    }
    rsshub_node = _provider_node(
        client,
        rsshub["id"],
        {
            "route": "/rsshub/routes/en",
            "source_group": "rsshub-ecosystem",
            "site": "rsshub-routes",
            "max_entries": 5,
        },
        "rss-rsshub",
    )
    bridge_node = _provider_node(
        client,
        rss_bridge["id"],
        {
            "bridge": "FeedMergeBridge",
            "parameters": {
                "feed_name": "OpenCLI Provider E2E",
                "feed_1": "https://www.federalreserve.gov/feeds/press_all.xml",
                "limit": "5",
            },
            "source_group": "rss-bridge-ecosystem",
            "site": "rss-bridge-feed-merge",
            "max_entries": 5,
        },
        "rss-rss-bridge",
    )
    source_nodes = [official_node, rsshub_node, bridge_node]
    nodes = [
        {
            "id": "schedule-rss-providers",
            "kind": "schedule",
            "capability": "trigger",
            "params": {"interval": "15m", "timezone": "Asia/Shanghai"},
            "ui": {"catalogId": "intelligence.schedule.cron"},
        },
        *source_nodes,
        {
            "id": "normalize-rss-providers",
            "kind": "agent",
            "capability": "normalize",
            "params": {"language": "zh-CN", "preserveSourceRefs": True},
            "ui": {"catalogId": "intelligence.processing.normalize"},
        },
        {
            "id": "accept-rss-providers",
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
            "id": "records-rss-providers",
            "kind": "sink",
            "capability": "store",
            "params": {
                "target": "records",
                "writeMode": "append",
                "preserveLineage": True,
            },
            "ui": {"catalogId": "intelligence.sink.records"},
        },
        {
            "id": "webhook-rss-providers",
            "kind": "notify",
            "capability": "send",
            "adapter": "webhook-notifier",
            "params": {"template": "brief", "target": "rss-provider-e2e"},
            "ui": {"catalogId": "intelligence.output.webhook"},
        },
    ]
    edges = [
        *[
            {
                "id": f"schedule-{node['id']}",
                "source": "schedule-rss-providers",
                "target": node["id"],
                "sourcePort": "tick",
                "targetPort": "in",
            }
            for node in source_nodes
        ],
        *[
            {
                "id": f"{node['id']}-normalize",
                "source": node["id"],
                "target": "normalize-rss-providers",
                "sourcePort": "out",
                "targetPort": "in",
            }
            for node in source_nodes
        ],
        {
            "id": "normalize-accept",
            "source": "normalize-rss-providers",
            "target": "accept-rss-providers",
            "sourcePort": "out",
            "targetPort": "candidates",
        },
        {
            "id": "accept-records",
            "source": "accept-rss-providers",
            "target": "records-rss-providers",
            "sourcePort": "records",
            "targetPort": "records",
        },
        {
            "id": "accept-webhook",
            "source": "accept-rss-providers",
            "target": "webhook-rss-providers",
            "sourcePort": "records",
            "targetPort": "in",
        },
    ]
    return {
        "id": "wf-rss-provider-e2e",
        "name": "Official RSS + RSSHub + RSS-Bridge E2E",
        "profile": "intelligence",
        "version": 1,
        "settings": {"maxItemsPerRun": 15},
        "nodes": nodes,
        "edges": edges,
        "adapters": [
            {
                "id": "rss-feed",
                "type": "source",
                "provider": "rss",
                "mode": "live",
                "config": {"channel": "rss"},
            },
            {
                "id": "webhook-notifier",
                "type": "notification",
                "provider": "webhook",
                "mode": "webhook",
                "config": {
                    "notifierType": "webhook",
                    "target": "rss-provider-e2e",
                    "url": webhook_url,
                    "timeout": 30,
                },
            },
        ],
        "agentPermissions": {
            "canFetchNetwork": True,
            "canSendNotifications": True,
            "canWriteInbox": True,
            "allowedDomains": ["127.0.0.1", "federalreserve.gov", "httpbin.org"],
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8031")
    parser.add_argument("--rsshub-url", default="http://127.0.0.1:1200")
    parser.add_argument("--rss-bridge-url", default="http://127.0.0.1:3001")
    parser.add_argument("--webhook-url", default="https://httpbin.org/post")
    args = parser.parse_args()
    run_id = f"run-rss-provider-{datetime.now(UTC).strftime('%Y%m%d%H%M%S')}"

    with httpx.Client(base_url=args.base_url, timeout=180) as client:
        rsshub = _ensure_provider(
            client,
            provider_type="rsshub",
            name="Local RSSHub",
            base_url=args.rsshub_url,
        )
        rss_bridge = _ensure_provider(
            client,
            provider_type="rss_bridge",
            name="Local RSS-Bridge",
            base_url=args.rss_bridge_url,
        )
        health = {
            provider["provider_type"]: _data(
                client.post(
                    f"/api/v1/providers/feed-generators/{provider['id']}/test"
                )
            )
            for provider in (rsshub, rss_bridge)
        }
        project = build_project(
            client,
            rsshub=rsshub,
            rss_bridge=rss_bridge,
            webhook_url=args.webhook_url,
        )
        request = {
            "project": project,
            "runId": run_id,
            "traceId": f"trace-{run_id}",
            "trigger": {
                "kind": "schedule",
                "triggerNodeId": "schedule-rss-providers",
            },
        }
        run = _data(client.post("/api/v1/workflows/runs", json=request))
        events = _data(client.get(f"/api/v1/workflows/runs/{run_id}/events"))

    source_events = [
        event for event in events if event["message"] == "Live RSS source loaded as workflow items"
    ]
    groups = {
        event["batch"]["sourceGroup"]
        for event in source_events
        if event.get("batch", {}).get("sourceGroup")
    }
    sink_events = [
        event
        for event in events
        if event["nodeId"] == "records-rss-providers" and event["eventType"] == "partial"
    ]
    delivery_events = [
        event
        for event in events
        if event["nodeId"] == "webhook-rss-providers" and event["eventType"] == "partial"
    ]
    sink_details = sink_events[-1]["details"] if sink_events else {}
    delivery_details = delivery_events[-1]["details"] if delivery_events else {}
    summary = {
        "runId": run_id,
        "status": run["status"],
        "eventCount": run["eventCount"],
        "providers": {
            "rsshub": {"id": rsshub["id"], "health": health["rsshub"]},
            "rss_bridge": {"id": rss_bridge["id"], "health": health["rss_bridge"]},
        },
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
        "delivery": delivery_details,
        "errors": run.get("errors", []),
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))

    passed = (
        run["status"] == "completed"
        and groups == EXPECTED_GROUPS
        and all(event["details"]["itemCount"] > 0 for event in source_events)
        and sink_details.get("storedRecordCount", 0) > 0
        and delivery_details.get("delivered") is True
        and all(result.get("ok") is True for result in health.values())
    )
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
