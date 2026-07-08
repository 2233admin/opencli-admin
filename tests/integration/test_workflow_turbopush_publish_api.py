import pytest

from backend.workflow.turbopush_executor import execute_turbopush_publish


def _turbopush_project(*, can_send: bool = False) -> dict:
    return {
        "id": "wf-turbopush-publish",
        "name": "TurboPush publish",
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
                    "targetPlatforms": ["xiaohongshu", "douyin"],
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
            "canFetchNetwork": False,
            "canSendNotifications": can_send,
            "canWriteInbox": True,
        },
    }


def _force_missing_turbopush(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    monkeypatch.delenv("TURBO_PUSH_PORT", raising=False)
    monkeypatch.delenv("TURBO_PUSH_AUTH", raising=False)
    monkeypatch.setenv("TURBO_PUSH_MCP_CONFIG", str(tmp_path / "missing-mcp.json"))


def _force_present_turbopush(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TURBO_PUSH_PORT", "12345")
    monkeypatch.setenv("TURBO_PUSH_AUTH", "secret-token")
    monkeypatch.delenv("TURBO_PUSH_MCP_CONFIG", raising=False)


@pytest.mark.asyncio
async def test_compile_blocks_turbopush_publish_when_local_service_missing(
    client,
    monkeypatch,
    tmp_path,
):
    _force_missing_turbopush(monkeypatch, tmp_path)

    response = await client.post(
        "/api/v1/workflows/compile",
        json={"project": _turbopush_project()},
    )

    assert response.status_code == 200
    node = response.json()["data"]["plan"]["runtime"]["nodes"][0]
    assert node["runtime"]["origin"]["catalog_id"] == (
        "intelligence.output.turbopush-publish"
    )
    assert node["runtime"]["turbopush"]["binding_id"] == "turbopush.local.publish"
    assert node["runtime"]["turbopush"]["dispatch"] == "blocked_until_resource"
    assert "binding" not in node["runtime"]
    assert node["runtime"]["missing_runtime"]["code"] == "missing_turbopush_service"
    assert "cookie" not in " ".join(node["runtime"]["missing_runtime"]["required_params"]).lower()
    assert "profile" not in " ".join(node["runtime"]["missing_runtime"]["required_params"]).lower()
    assert "worker" not in " ".join(node["runtime"]["missing_runtime"]["required_params"]).lower()


@pytest.mark.asyncio
async def test_compile_binds_turbopush_publish_to_local_mcp_http_flow(
    client,
    monkeypatch,
):
    _force_present_turbopush(monkeypatch)

    response = await client.post(
        "/api/v1/workflows/compile",
        json={"project": _turbopush_project(can_send=True)},
    )

    assert response.status_code == 200
    node = response.json()["data"]["plan"]["runtime"]["nodes"][0]
    assert "missing_runtime" not in node["runtime"]
    binding = node["runtime"]["binding"]
    assert binding["binding_id"] == "turbopush.local.publish"
    assert binding["runtime"] == "workflow"
    assert binding["channel"] == "turbopush"
    assert binding["input"]["service"] == {
        "base_url": "http://127.0.0.1:12345",
        "auth": "runtime-secret",
        "source": "env",
    }
    assert binding["input"]["contentType"] == "graph_text"
    assert binding["input"]["targetPlatforms"] == ["xiaohongshu", "douyin"]
    assert binding["input"]["publish"]["createTool"] == "create_graph_text"
    assert binding["input"]["publish"]["publishTool"] == "publish_graph_text"
    assert "secret-token" not in str(binding)


@pytest.mark.asyncio
async def test_workflow_capabilities_include_turbopush_publish(client):
    response = await client.get("/api/v1/workflows/capabilities")

    assert response.status_code == 200
    catalog = {item["id"]: item for item in response.json()["data"]["catalog"]}
    turbopush = catalog["intelligence.output.turbopush-publish"]
    assert turbopush["status"] == "runnable"
    assert turbopush["backendAvailable"] is True
    assert turbopush["runtimeBinding"] == "turbopush.local.publish"
    assert turbopush["provider"] == "turbopush"


@pytest.mark.asyncio
async def test_turbopush_run_blocks_without_send_permission(
    client,
    monkeypatch,
):
    _force_present_turbopush(monkeypatch)

    response = await client.post(
        "/api/v1/workflows/runs",
        json={
            "project": _turbopush_project(can_send=False),
            "runId": "run-turbopush-permission",
            "traceId": "trace-turbopush-permission",
        },
    )

    assert response.status_code == 202
    data = response.json()["data"]
    assert data["valid"] is True
    assert data["status"] == "blocked"
    state = data["nodeStates"][0]
    assert state["nodeId"] == "publish-turbopush"
    assert state["status"] == "blocked"
    assert state["blockReasons"][0]["code"] == "send_permission_required"

    events = (
        await client.get("/api/v1/workflows/runs/run-turbopush-permission/events")
    ).json()["data"]
    assert [event["eventType"] for event in events] == ["queued", "blocked"]


@pytest.mark.asyncio
async def test_turbopush_run_emits_publish_flow_events_when_permitted(
    client,
    monkeypatch,
):
    _force_present_turbopush(monkeypatch)
    monkeypatch.setattr(
        "backend.workflow.opencli_hda_tracer.execute_turbopush_publish",
        lambda binding_input: {
            "bindingId": "turbopush.local.publish",
            "contentType": binding_input["contentType"],
            "articleId": 123,
            "targetPlatforms": binding_input["targetPlatforms"],
            "postAccountCount": 2,
            "publishTool": "publish_graph_text",
            "events": [{"event": "finish", "data": '{"msg":"ok","res":[true,true]}'}],
            "summary": {
                "successCount": 0,
                "errorCount": 0,
                "finish": {"msg": "ok", "res": [True, True]},
                "messages": [],
            },
        },
    )

    response = await client.post(
        "/api/v1/workflows/runs",
        json={
            "project": _turbopush_project(can_send=True),
            "runId": "run-turbopush-ready",
            "traceId": "trace-turbopush-ready",
        },
    )

    assert response.status_code == 202
    data = response.json()["data"]
    assert data["valid"] is True
    assert data["status"] == "completed"

    events = (await client.get("/api/v1/workflows/runs/run-turbopush-ready/events")).json()[
        "data"
    ]
    assert [event["eventType"] for event in events] == [
        "queued",
        "started",
        "partial",
        "completed",
    ]
    partial = events[2]
    assert partial["details"]["bindingId"] == "turbopush.local.publish"
    assert partial["details"]["contentType"] == "graph_text"
    assert partial["details"]["publishTool"] == "publish_graph_text"
    assert partial["details"]["targetPlatforms"] == ["xiaohongshu", "douyin"]
    assert partial["details"]["postAccountCount"] == 2


def test_execute_turbopush_publish_posts_real_http_sse_flow(monkeypatch):
    _force_present_turbopush(monkeypatch)
    calls: list[tuple[str, str, object]] = []

    class FakeResponse:
        def __init__(self, payload=None, *, lines=None):
            self.status_code = 200
            self._payload = payload
            self._lines = lines or []

        def json(self):
            return self._payload

        def raise_for_status(self):
            return None

        def iter_lines(self):
            return iter(self._lines)

    class FakeStream:
        def __init__(self, response):
            self._response = response

        def __enter__(self):
            return self._response

        def __exit__(self, *_args):
            return False

    class FakeClient:
        def __init__(self, *_, **__):
            pass

        def request(self, method, path, **kwargs):
            calls.append((method, path, kwargs.get("json")))
            if path == "/account/logged?simple=true":
                return FakeResponse(
                    {
                        "code": 200,
                        "msg": "ok",
                        "data": [
                            {
                                "id": 7,
                                "platType": "xiaohongshu",
                                "platName": "XHS",
                            }
                        ],
                    }
                )
            if path == "/article/graphText":
                return FakeResponse({"code": 200, "msg": "ok", "data": {"id": 321}})
            raise AssertionError(f"unexpected request {method} {path}")

        def stream(self, method, path, **kwargs):
            calls.append((method, path, kwargs.get("json")))
            assert path == "/sse/graphText/321"
            return FakeStream(
                FakeResponse(
                    lines=[
                        "event: success",
                        "data: XHS ok",
                        "",
                        "event: finish",
                        'data: {"msg":"done","res":[true]}',
                        "",
                    ]
                )
            )

        def close(self):
            pass

    monkeypatch.setattr("backend.workflow.turbopush_executor.httpx.Client", FakeClient)

    result = execute_turbopush_publish(
        {
            "contentType": "graph_text",
            "title": "发布测试",
            "desc": "真实 TurboPush 图文",
            "files": ["C:/tmp/a.png"],
            "targetPlatforms": ["xiaohongshu"],
            "syncDraft": False,
        }
    )

    assert [call[1] for call in calls] == [
        "/account/logged?simple=true",
        "/article/graphText",
        "/sse/graphText/321",
    ]
    publish_body = calls[-1][2]
    assert publish_body["postAccounts"] == [
        {
            "id": 7,
            "platName": "XHS",
            "settings": {
                "platType": "xiaohongshu",
                "origin": False,
                "source": 0,
                "lookScope": 0,
            },
        }
    ]
    assert result["articleId"] == 321
    assert result["postAccountCount"] == 1
    assert result["summary"]["finish"] == {"msg": "done", "res": [True]}
