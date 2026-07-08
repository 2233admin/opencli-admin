"""Canonical workflow runtime conformance fixtures."""

from __future__ import annotations

from copy import deepcopy
from typing import Any

EXPECTED_FIRST_SLICE_BINDINGS = [
    "workflow.source.fetch",
    "workflow.transform.normalize",
    "workflow.router.route",
    "workflow.inbox.store",
    "workflow.notify.send",
]


def workflow_conformance_project(
    *,
    can_fetch_network: bool = True,
    can_send_notifications: bool = True,
    delivery_configured: bool = True,
    include_unsupported_node: bool = False,
) -> dict[str, Any]:
    notify_config: dict[str, Any] = {
        "notifierType": "operator-preview",
        "target": "simulated-webhook",
    }
    if delivery_configured:
        notify_config["url"] = "mock://opencli-conformance/notify"

    project: dict[str, Any] = {
        "id": "workflow-runtime-conformance",
        "name": "Runtime Conformance",
        "profile": "intelligence",
        "version": 1,
        "settings": {
            "timezone": "Asia/Shanghai",
            "deterministicSimulation": True,
            "maxItemsPerRun": 20,
        },
        "adapters": [
            {
                "id": "jin10-kuaixun",
                "type": "source",
                "provider": "jin10",
                "mode": "fixture",
                "config": {"feed": "kuaixun"},
            },
            {
                "id": "simulated-webhook",
                "type": "notification",
                "provider": "operator-preview",
                "mode": "mock",
                "config": notify_config,
            },
        ],
        "agentPermissions": {
            "canFetchNetwork": can_fetch_network,
            "canSendNotifications": can_send_notifications,
            "canWriteInbox": True,
            "allowedDomains": ["jin10.com"],
        },
        "nodes": [
            {
                "id": "source-jin10",
                "kind": "source",
                "capability": "fetch",
                "adapter": "jin10-kuaixun",
                "params": {"limit": 20, "importantOnly": False},
            },
            {
                "id": "agent-normalize",
                "kind": "agent",
                "capability": "normalize",
                "params": {"language": "zh-CN"},
            },
            {
                "id": "router-importance",
                "kind": "router",
                "capability": "route",
                "params": {"expression": "item.important === true || item.score >= 0.7"},
            },
            {
                "id": "inbox-review",
                "kind": "inbox",
                "capability": "store",
                "params": {"queue": "macro-watch"},
            },
            {
                "id": "notify-preview",
                "kind": "notify",
                "capability": "send",
                "adapter": "simulated-webhook",
                "params": {"template": "brief", "target": "simulated-webhook"},
            },
        ],
        "edges": [
            {
                "id": "e-source-normalize",
                "source": "source-jin10",
                "target": "agent-normalize",
            },
            {
                "id": "e-normalize-router",
                "source": "agent-normalize",
                "target": "router-importance",
            },
            {
                "id": "e-router-inbox",
                "source": "router-importance",
                "target": "inbox-review",
            },
            {
                "id": "e-router-notify",
                "source": "router-importance",
                "target": "notify-preview",
            },
        ],
    }

    if include_unsupported_node:
        project["nodes"].append(
            {
                "id": "unsupported-export",
                "kind": "action",
                "capability": "summarize",
                "params": {"format": "pdf"},
            }
        )
        project["edges"].append(
            {
                "id": "e-router-unsupported",
                "source": "router-importance",
                "target": "unsupported-export",
            }
        )

    return project


def workflow_conformance_source_outputs() -> dict[str, list[dict[str, Any]]]:
    return {
        "source-jin10": [
            {
                "id": "macro-1",
                "title": "Fed signal: watch rates",
                "url": "https://www.jin10.com/flash/macro-1",
                "important": True,
                "score": 0.91,
            },
            {
                "id": "macro-2",
                "title": "Low-signal item",
                "url": "https://www.jin10.com/flash/macro-2",
                "important": False,
                "score": 0.22,
            },
        ]
    }


def workflow_conformance_missing_webhook_url_project() -> dict[str, Any]:
    project = workflow_conformance_project()
    project["adapters"] = [
        adapter for adapter in project["adapters"] if adapter["id"] != "simulated-webhook"
    ]
    project["adapters"].append(
        {
            "id": "webhook-notifier",
            "type": "notification",
            "provider": "webhook",
            "mode": "live",
            "config": {
                "notifierType": "webhook",
                "target": "webhook",
            },
        }
    )
    for node in project["nodes"]:
        if node["id"] == "notify-preview":
            node.update(
                {
                    "id": "notify-webhook",
                    "adapter": "webhook-notifier",
                    "params": {"template": "brief", "target": "webhook"},
                    "ui": {"catalogId": "intelligence.output.webhook"},
                }
            )
    for edge in project["edges"]:
        if edge["target"] == "notify-preview":
            edge["target"] = "notify-webhook"
    return project


def workflow_conformance_webhook_delivery_project(
    *,
    can_send_notifications: bool = True,
    include_projection_edge: bool = True,
) -> dict[str, Any]:
    project = workflow_conformance_missing_webhook_url_project()
    project["agentPermissions"]["canSendNotifications"] = can_send_notifications
    for adapter in project["adapters"]:
        if adapter["id"] == "webhook-notifier":
            adapter["config"] = {
                **adapter["config"],
                "url": "https://hooks.example.com/opencli-conformance",
            }
    if not include_projection_edge:
        project["edges"] = [
            edge for edge in project["edges"] if edge["target"] != "notify-webhook"
        ]
    return project


def workflow_conformance_missing_source_credential_project() -> dict[str, Any]:
    project = workflow_conformance_project()
    for adapter in project["adapters"]:
        if adapter["id"] == "jin10-kuaixun":
            adapter["mode"] = "live"
            adapter["config"] = {
                **adapter["config"],
                "requiresCredential": True,
                "requiredCredentialKey": "jin10_api_token",
            }
    return project


def workflow_conformance_missing_runtime_resource_project() -> dict[str, Any]:
    return {
        "id": "workflow-runtime-conformance-resource",
        "name": "Runtime Conformance Resource",
        "profile": "intelligence",
        "version": 1,
        "nodes": [
            {
                "id": "publish-turbopush",
                "kind": "notify",
                "capability": "send",
                "adapter": "turbopush-local",
                "params": {
                    "contentType": "graph_text",
                    "contentSource": "upstream",
                    "title": "{{item.title}}",
                    "desc": "{{item.summary}}",
                    "targetPlatforms": ["xiaohongshu"],
                    "accountSelector": "logged_accounts_by_platform",
                    "syncDraft": False,
                },
                "ui": {"catalogId": "intelligence.output.turbopush-publish"},
            }
        ],
        "edges": [],
        "adapters": [
            {
                "id": "turbopush-local",
                "type": "notification",
                "provider": "turbopush",
                "mode": "live",
                "config": {
                    "channel": "turbopush",
                    "mcpServer": "turbo-push",
                    "resourceMode": "auto",
                },
            }
        ],
        "agentPermissions": {
            "canFetchNetwork": True,
            "canSendNotifications": True,
            "canWriteInbox": True,
        },
    }


def copy_workflow_fixture(project: dict[str, Any]) -> dict[str, Any]:
    return deepcopy(project)
