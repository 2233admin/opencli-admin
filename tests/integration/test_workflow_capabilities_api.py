import pytest

from backend.workflow.opencli_adapter_nodes import list_opencli_adapter_nodes


def _fixture_opencli_catalog() -> tuple[dict, ...]:
    return (
        {
            "site": "bbc",
            "name": "news",
            "description": "BBC news",
            "access": "read",
            "browser": False,
            "strategy": "public",
            "args": [{"name": "limit", "type": "int", "required": False}],
            "columns": ["title", "url"],
        },
        {
            "site": "twitter",
            "name": "search",
            "description": "X search",
            "access": "read",
            "browser": True,
            "strategy": "cookie",
            "args": [
                {
                    "name": "query",
                    "type": "str",
                    "required": True,
                    "positional": True,
                },
                {"name": "limit", "type": "int", "required": False},
            ],
            "columns": ["id", "text"],
        },
        {
            "site": "twitter",
            "name": "post",
            "description": "Post to X",
            "access": "write",
            "browser": True,
            "strategy": "cookie",
            "args": [{"name": "text", "type": "str", "required": True}],
            "columns": ["id", "url"],
        },
    )


def _webhook_notify_project() -> dict:
    return {
        "id": "wf-webhook-contract",
        "name": "Webhook contract",
        "profile": "intelligence",
        "version": 1,
        "nodes": [
            {
                "id": "source-bilibili",
                "kind": "source",
                "capability": "fetch",
                "adapter": "opencli-bilibili",
                "params": {"site": "bilibili", "command": "search"},
            },
            {
                "id": "notify-webhook",
                "kind": "notify",
                "capability": "send",
                "adapter": "webhook-notifier",
                "params": {"template": "brief", "target": "webhook"},
                "ui": {"catalogId": "intelligence.output.webhook"},
            },
        ],
        "edges": [
            {
                "id": "e-source-notify",
                "source": "source-bilibili",
                "target": "notify-webhook",
            }
        ],
        "adapters": [
            {
                "id": "opencli-bilibili",
                "type": "source",
                "provider": "opencli",
                "mode": "live",
                "config": {"channel": "opencli"},
            },
            {
                "id": "webhook-notifier",
                "type": "notification",
                "provider": "webhook",
                "mode": "webhook",
                "config": {"notifierType": "webhook", "target": "webhook"},
            },
        ],
        "agentPermissions": {
            "canFetchNetwork": True,
            "canSendNotifications": False,
            "canWriteInbox": True,
        },
    }


@pytest.mark.asyncio
async def test_compile_reports_webhook_notify_contract_without_live_delivery(client):
    response = await client.post(
        "/api/v1/workflows/compile",
        json={"project": _webhook_notify_project()},
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["valid"] is True
    node = next(
        node
        for node in data["plan"]["runtime"]["nodes"]
        if node["id"] == "notify-webhook"
    )
    assert node["runtime"]["origin"]["catalog_id"] == "intelligence.output.webhook"
    assert "binding" not in node["runtime"]
    assert node["runtime"]["notifier"]["binding_id"] == "workflow.notifier.webhook.send"
    assert node["runtime"]["notifier"]["dispatch"] == "blocked_until_projection"
    assert node["runtime"]["notifier"]["input"]["delivery_configured"] is False
    notifier_contract = node["runtime"]["notifier"]["contract"]
    assert notifier_contract["bindingId"] == "workflow.notifier.webhook.send"
    assert notifier_contract["certification"]["realNodeIoContract"] is True
    assert notifier_contract["certification"]["realWebhookDelivery"] is True
    assert node["runtime"]["missing_runtime"] == {
        "status": "missing",
        "code": "missing_delivery_projection",
        "node_id": "notify-webhook",
        "kind": "notify",
        "capability": "send",
        "adapter_id": "webhook-notifier",
        "provider": "webhook",
        "required_params": [
            "evidencebatch_projection_api",
            "delivery_projection",
            "webhook_url",
        ],
        "message": (
            "Webhook Notify has a backend notifier contract, but live delivery "
            "waits for EvidenceBatch projection and a configured webhook URL."
        ),
    }


@pytest.mark.asyncio
async def test_workflow_capabilities_project_real_backend_surfaces(client, monkeypatch):
    monkeypatch.setattr(
        "backend.workflow.capability_projection.get_opencli_adapter_node_summary",
        lambda: {
            "total": 3,
            "sites": 2,
            "access": {"read": 2, "write": 1},
            "browser": {"browser": 2, "non_browser": 1},
            "sourceSlotReady": 1,
            "sourceSlotRequiresParams": 1,
            "toolCapabilityReviewRequired": 1,
        },
    )

    response = await client.get("/api/v1/workflows/capabilities")

    assert response.status_code == 200
    data = response.json()["data"]

    catalog = {item["id"]: item for item in data["catalog"]}
    for item in catalog.values():
        if item["status"] == "runnable" and item.get("runtimeBinding"):
            contract = item["manifest"]["contract"]
            assert contract["bindingId"] == item["runtimeBinding"]
            assert contract["inputShape"]["ports"] is not None
            assert contract["outputShape"]["ports"] is not None
            assert contract["eventShape"]["events"]
            assert contract["fixtureCoverage"]["cases"]
            assert contract["canvas"]["exposeResourceInternals"] is False

    assert catalog["intelligence.input.collection-need"]["status"] == "runnable"
    assert catalog["intelligence.input.collection-need"]["backendAvailable"] is True
    assert catalog["intelligence.input.collection-need"]["runtimeBinding"] == (
        "workflow.demand-draft.patch"
    )
    assert catalog["intelligence.schedule.cron"]["status"] == "runnable"
    assert catalog["intelligence.schedule.cron"]["backendAvailable"] is True
    assert catalog["intelligence.schedule.cron"]["runtimeBinding"] == (
        "workflow.trigger.schedule_tick"
    )
    assert "workflow_trigger_binding" not in catalog["intelligence.schedule.cron"]["missing"]
    assert catalog["intelligence.source.opencli-slot"]["status"] == "runnable"
    assert catalog["intelligence.source.opencli-slot"]["backendAvailable"] is True
    assert catalog["intelligence.source.opencli-slot"]["runtimeBinding"]
    opencli_manifest = catalog["intelligence.source.opencli-slot"]["manifest"]
    assert opencli_manifest["schema"] == "capability.source.opencli-slot.v1"
    assert opencli_manifest["ports"]["outputs"] == [{"name": "out", "type": "items[]"}]
    assert opencli_manifest["runtime"]["binding"] == "iii.collector-opencli.snapshot"
    assert "canFetchNetwork" in opencli_manifest["permissions"]
    assert "source_output_ingest_available" in opencli_manifest["probes"]
    assert (
        "frontend_run_event_binding"
        not in catalog["intelligence.source.opencli-slot"]["missing"]
    )
    assert catalog["intelligence.source.pool"]["status"] == "runnable"
    assert catalog["intelligence.source.pool"]["backendAvailable"] is True
    assert catalog["intelligence.source.pool"]["runtimeBinding"] == (
        "workflow.source-pool.parallel-fanout"
    )
    assert catalog["intelligence.output.collection-result"]["status"] == "runnable"
    assert catalog["intelligence.output.collection-result"]["backendAvailable"] is True
    assert catalog["intelligence.output.collection-result"]["runtimeBinding"] == (
        "workflow.collection-output.items"
    )
    assert catalog["intelligence.flow.merge"]["status"] == "runnable"
    assert catalog["intelligence.flow.merge"]["runtimeBinding"] == "workflow.flow.merge"
    merge_manifest = catalog["intelligence.flow.merge"]["manifest"]
    assert merge_manifest["ports"]["inputs"] == [
        {"name": "in1", "type": "recordCandidate[]"},
        {"name": "in2", "type": "recordCandidate[]"},
    ]
    assert merge_manifest["trace"]["events"] == [
        "partial:mergedCandidateCount",
        "completed",
    ]
    assert catalog["intelligence.control.record-acceptance"]["status"] == "runnable"
    assert catalog["intelligence.control.record-acceptance"]["runtimeBinding"] == (
        "workflow.gate.record-acceptance"
    )
    gate_manifest = catalog["intelligence.control.record-acceptance"]["manifest"]
    assert gate_manifest["schema"] == "capability.control.record-acceptance.v1"
    assert "record_schema_available" in gate_manifest["probes"]
    assert catalog["intelligence.sink.records"]["status"] == "runnable"
    assert catalog["intelligence.sink.records"]["runtimeBinding"] == (
        "workflow.record-sink.records"
    )
    sink_manifest = catalog["intelligence.sink.records"]["manifest"]
    assert sink_manifest["resources"] == [
        "data_sources",
        "collection_tasks",
        "collected_records",
    ]
    assert sink_manifest["runtime"]["binding"] == "workflow.record-sink.records"
    assert catalog["external.tool.capability"]["status"] == "runnable"
    assert catalog["external.tool.capability"]["backendAvailable"] is True
    assert catalog["external.tool.capability"]["runtimeBinding"] == (
        "workflow.external-tool.capability"
    )
    external_tool_manifest = catalog["external.tool.capability"]["manifest"]
    assert external_tool_manifest["schema"] == "capability.external.tool.v1"
    assert external_tool_manifest["ports"] == {
        "inputs": [{"name": "in", "type": "unknown"}],
        "outputs": [{"name": "out", "type": "unknown"}],
    }
    assert (
        "node_level_tool_capability_binding_when_unconfigured"
        in catalog["external.tool.capability"]["missing"]
    )
    assert "tool_capability_registry" in external_tool_manifest["resources"]
    assert "partial:outputItemCount" in external_tool_manifest["trace"]["events"]
    assert catalog["package.opencli.multi-source-hda"]["status"] == "runnable"
    assert (
        "frontend_run_event_binding"
        not in catalog["package.opencli.multi-source-hda"]["missing"]
    )
    assert (
        "typed_demand_input_envelope"
        not in catalog["package.opencli.multi-source-hda"]["missing"]
    )
    assert catalog["intelligence.output.webhook"]["status"] == "blocked"
    assert catalog["intelligence.output.webhook"]["backendAvailable"] is True
    assert catalog["intelligence.output.webhook"]["runtimeBinding"] == (
        "workflow.notifier.webhook.send"
    )
    assert "workflow_notifier_sink_binding" not in catalog["intelligence.output.webhook"]["missing"]
    assert "evidencebatch_projection_input" in catalog["intelligence.output.webhook"]["missing"]
    webhook_contract = catalog["intelligence.output.webhook"]["manifest"]["contract"]
    assert webhook_contract["status"] == "blocked_until_preconditions"
    assert webhook_contract["certification"]["realWebhookDelivery"] is True
    assert webhook_contract["configGate"]["required"] == [
        "evidencebatch_projection_api",
        "delivery_projection",
        "webhook_url",
    ]

    channels = {item["channelType"]: item for item in data["channels"]}
    assert set(channels) == {
        "api",
        "browser_act",
        "cli",
        "crawl4ai",
        "opencli",
        "rss",
        "skill",
        "web_scraper",
    }
    assert channels["opencli"]["status"] == "runnable"
    assert channels["opencli"]["backendAvailable"] is True
    assert channels["rss"]["status"] == "blocked"
    assert channels["rss"]["backendAvailable"] is True
    assert "canvas_source_projection" in channels["rss"]["missing"]

    notifiers = {item["notifierType"]: item for item in data["notifiers"]}
    assert "webhook" in notifiers
    assert notifiers["webhook"]["status"] == "blocked"
    assert notifiers["webhook"]["backendAvailable"] is True
    assert notifiers["webhook"]["runtimeBinding"] == "workflow.notifier.webhook.send"
    assert "evidencebatch_projection_input" in notifiers["webhook"]["missing"]

    primitives = {item["id"]: item for item in data["primitives"]}
    assert primitives["primitive.ops.trigger-webhook"]["status"] == "blocked"
    assert primitives["primitive.ops.trigger-webhook"]["backendAvailable"] is True

    triggers = {item["id"]: item for item in data["triggers"]}
    assert triggers["trigger.manual"]["status"] == "runnable"
    assert triggers["trigger.manual"]["missing"] == []
    assert triggers["trigger.webhook"]["status"] == "blocked"

    resources = {item["id"]: item for item in data["resources"]}
    fleet_resource = resources["resource.workflow-fleet-runtime"]
    assert fleet_resource["status"] == "runnable"
    assert fleet_resource["backendAvailable"] is True
    assert fleet_resource["runtimeBinding"] == "workflow.fleet.inventory"
    assert fleet_resource["manifest"]["canvas"]["node"] is False
    assert fleet_resource["manifest"]["endpoints"] == {
        "inventory": "/api/v1/workflows/fleet/inventory",
        "match": "/api/v1/workflows/fleet/match",
    }
    adapter_registry = resources["resource.opencli-adapter-nodes"]
    assert adapter_registry["status"] == "runnable"
    assert adapter_registry["backendAvailable"] is True
    assert adapter_registry["runtimeBinding"] == "iii.collector-opencli.snapshot"
    assert adapter_registry["manifest"]["canvas"]["node"] is False
    assert adapter_registry["manifest"]["endpoint"] == (
        "/api/v1/workflows/opencli-adapter-nodes"
    )
    assert adapter_registry["manifest"]["summary"]["total"] == 3
    assert adapter_registry["manifest"]["materialization"]["write"] == (
        "external.tool.capability with review"
    )
    tool_resource = resources["resource.tool-capability.tool.search.fixture"]
    assert tool_resource["status"] == "runnable"
    assert tool_resource["backendAvailable"] is True
    assert tool_resource["runtimeBinding"] == "workflow.external-tool.capability"
    assert tool_resource["manifest"]["toolCapability"]["id"] == "tool.search.fixture"
    assert tool_resource["manifest"]["toolCapability"]["executor"]["mode"] == "fixture"
    realtime_resource = resources[
        "resource.tool-capability.tool.realtime.stream.subscribe"
    ]
    assert realtime_resource["status"] == "runnable"
    assert realtime_resource["runtimeBinding"] == "workflow.external-tool.capability"
    assert realtime_resource["manifest"]["toolCapability"]["id"] == (
        "tool.realtime.stream.subscribe"
    )
    assert realtime_resource["manifest"]["toolCapability"]["executor"]["mode"] == (
        "okx_market_ticker_snapshot"
    )
    assert "realtime.source.stream" not in catalog


def test_opencli_adapter_nodes_classify_manifest_entries(monkeypatch):
    monkeypatch.setattr(
        "backend.workflow.opencli_adapter_nodes._load_opencli_catalog",
        _fixture_opencli_catalog,
    )

    response = list_opencli_adapter_nodes()
    nodes = {node.id: node for node in response.nodes}

    bbc = nodes["opencli.adapter.bbc.news"]
    assert bbc.status == "runnable"
    assert bbc.catalogId == "intelligence.source.opencli-slot"
    assert bbc.manifest["canvas"]["materialization"] == "source_slot_ready"
    assert bbc.params == {"site": "bbc", "command": "news", "format": "json", "args": {}}

    twitter_search = nodes["opencli.adapter.twitter.search"]
    assert twitter_search.status == "blocked"
    assert twitter_search.catalogId == "intelligence.source.opencli-slot"
    assert twitter_search.requiredArgs == ["query"]
    assert twitter_search.manifest["canvas"]["materialization"] == (
        "source_slot_requires_params"
    )
    assert twitter_search.manifest["canvas"]["positionalRequiredArgs"] == ["query"]

    twitter_post = nodes["opencli.adapter.twitter.post"]
    assert twitter_post.status == "blocked"
    assert twitter_post.catalogId == "external.tool.capability"
    assert twitter_post.manifest["canvas"]["node"] is False
    assert twitter_post.manifest["canvas"]["materialization"] == (
        "tool_capability_review_required"
    )
    assert response.summary == {
        "total": 3,
        "sites": 2,
        "access": {"read": 2, "write": 1},
        "browser": {"non_browser": 1, "browser": 2},
        "sourceSlotReady": 1,
        "sourceSlotRequiresParams": 1,
        "toolCapabilityReviewRequired": 1,
    }


@pytest.mark.asyncio
async def test_opencli_adapter_nodes_endpoint_filters_and_limits(client, monkeypatch):
    monkeypatch.setattr(
        "backend.workflow.opencli_adapter_nodes._load_opencli_catalog",
        _fixture_opencli_catalog,
    )

    response = await client.get(
        "/api/v1/workflows/opencli-adapter-nodes",
        params={"site": "twitter", "includeWrite": False, "limit": 10},
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["total"] == 1
    assert data["summary"]["access"] == {"read": 1}
    assert [node["id"] for node in data["nodes"]] == ["opencli.adapter.twitter.search"]


@pytest.mark.asyncio
async def test_workflow_tool_capabilities_register_opencli_tool_bindings(client):
    response = await client.get("/api/v1/workflows/tool-capabilities")

    assert response.status_code == 200
    data = response.json()["data"]
    tools = {tool["id"]: tool for tool in data["tools"]}
    assert "tool.search.fixture" in tools
    fixture_tool = tools["tool.search.fixture"]
    assert fixture_tool["status"] == "runnable"
    assert fixture_tool["provider"] == "opencli-admin"
    assert fixture_tool["executor"]["mode"] == "fixture"
    assert fixture_tool["inputPorts"] == [{"name": "in", "type": "unknown"}]
    assert fixture_tool["outputPorts"] == [{"name": "out", "type": "unknown"}]
    assert fixture_tool["manifest"]["runtime"]["binding"] == (
        "workflow.external-tool.capability"
    )
    realtime_ids = {
        "tool.realtime.stream.subscribe",
        "tool.realtime.event.normalize",
        "tool.realtime.window.rolling",
        "tool.realtime.state.cache",
        "tool.realtime.feature.compute",
        "tool.realtime.signal.emit",
    }
    assert realtime_ids.issubset(tools)
    stream_tool = tools["tool.realtime.stream.subscribe"]
    assert stream_tool["inputPorts"] == [{"name": "in", "type": "trigger"}]
    assert stream_tool["outputPorts"] == [{"name": "out", "type": "event[]"}]
    assert stream_tool["executor"]["mode"] == "okx_market_ticker_snapshot"
    assert stream_tool["executor"]["params"]["instId"] == "ETH-USDT-SWAP"
    assert stream_tool["manifest"]["canvas"]["node"] is False
    signal_tool = tools["tool.realtime.signal.emit"]
    assert signal_tool["inputPorts"] == [{"name": "in", "type": "feature[]"}]
    assert signal_tool["outputPorts"] == [{"name": "out", "type": "signal[]"}]
