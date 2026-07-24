import io
import json

import pytest

from backend.workflow.swarm_simulation import (
    MIROFISH_ALLOW_ENDPOINT_OVERRIDE_ENV,
    MIROFISH_ENDPOINT_ENV,
    MIROFISH_UPSTREAM_COMMIT,
    SwarmSimulationExecutionError,
    execute_swarm_simulation,
)


def _situation_report():
    return {
        "schema": "situation.report.v1",
        "query": "国产 AI",
        "topics": [
            {"label": "开源模型", "mentionCount": 8},
            {"label": "算力成本", "mentionCount": 5},
        ],
        "platforms": [
            {"platform": "douyin", "itemCount": 8},
            {"platform": "bilibili", "itemCount": 5},
        ],
        "signals": [{"type": "velocity_spike"}],
        "generatedAt": "2026-07-21T00:00:00+00:00",
    }


def test_local_simulation_is_deterministic_and_marks_all_outputs_simulated():
    params = {
        "provider": "local",
        "requirement": "推演国产 AI 讨论如何演变",
        "agentCount": 6,
        "maxRounds": 3,
        "platform": "parallel",
        "now": "2026-07-21T00:00:00+00:00",
    }
    wrapped = [{"raw": _situation_report(), "normalizedData": _situation_report()}]

    first = execute_swarm_simulation(wrapped, params)
    second = execute_swarm_simulation(wrapped, params)

    assert first == second
    assert first["schema"] == "swarm.forecast.v1"
    assert first["provider"]["equivalenceLevel"] == "contract"
    assert first["run"]["roundsCompleted"] == 3
    assert first["config"]["platforms"] == ["twitter", "reddit"]
    assert len(first["profiles"]) == 6
    assert all(profile["simulated"] for profile in first["profiles"])
    assert all(action["simulated"] for action in first["timeline"])
    assert first["simulated"] is True
    assert "不是对真实世界未来的事实预测" in first["disclaimer"]


def test_mirofish_requires_private_provider_endpoint(monkeypatch):
    monkeypatch.delenv(MIROFISH_ENDPOINT_ENV, raising=False)
    with pytest.raises(SwarmSimulationExecutionError, match=MIROFISH_ENDPOINT_ENV):
        execute_swarm_simulation([], {"provider": "mirofish"})


def test_local_simulation_accepts_last30days_provider_report_as_seed():
    output = execute_swarm_simulation(
        [
            {
                "raw": {
                    "schema": "recent-research.provider.v1",
                    "provider": {"id": "last30days"},
                    "report": {
                        "schema_version": "1.2",
                        "query": "AI 芯片",
                        "generated_at": "2026-07-21T00:00:00Z",
                        "clusters": [],
                        "results": [],
                    },
                }
            }
        ],
        {"provider": "local", "agentCount": 3, "maxRounds": 1},
    )

    assert output["seed"]["schema"] == "simulation.seed.last30days.v1"
    assert output["seed"]["query"] == "AI 芯片"
    assert output["seed"]["provider"]["id"] == "last30days"


def test_mirofish_health_operation_returns_pinned_provider_provenance(monkeypatch):
    class _FakeResponse(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    def fake_urlopen(request, timeout):
        assert request.full_url == "http://mirofish:5000/health"
        assert request.method == "GET"
        assert timeout == 5
        return _FakeResponse(
            json.dumps({"success": True, "data": {"status": "healthy"}}).encode()
        )

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    monkeypatch.setenv(MIROFISH_ENDPOINT_ENV, "http://mirofish:5000/")
    output = execute_swarm_simulation(
        [],
        {
            "provider": "mirofish",
            "operation": "health",
            "timeoutSeconds": 5,
        },
    )

    assert output["schema"] == "swarm.provider-operation.v1"
    assert output["canonicalState"] == "provider_ready"
    assert output["provider"]["expectedUpstreamCommit"] == MIROFISH_UPSTREAM_COMMIT
    assert output["provider"]["versionVerified"] is False
    assert output["data"] == {"status": "healthy"}


def test_mirofish_ontology_uses_situation_report_as_seed(monkeypatch):
    captured = {}

    class _FakeResponse(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    def fake_urlopen(request, timeout):
        captured["body"] = request.data.decode("utf-8")
        return _FakeResponse(
            json.dumps(
                {
                    "success": True,
                    "data": {
                        "project_id": "proj_1",
                        "ontology": {"entity_types": [], "edge_types": []},
                    },
                }
            ).encode()
        )

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    monkeypatch.setenv(MIROFISH_ENDPOINT_ENV, "http://mirofish:5000")
    output = execute_swarm_simulation(
        [{"raw": _situation_report()}],
        {"provider": "mirofish", "operation": "ontology"},
    )

    assert "国产 AI" in captured["body"]
    assert "simulation_requirement" in captured["body"]
    assert output["handles"]["project_id"] == "proj_1"


def test_mirofish_failed_provider_state_is_not_reported_completed(monkeypatch):
    class _FakeResponse(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    monkeypatch.setattr(
        "urllib.request.urlopen",
        lambda request, timeout: _FakeResponse(
            json.dumps({"success": True, "data": {"status": "failed"}}).encode()
        ),
    )
    monkeypatch.setenv(MIROFISH_ENDPOINT_ENV, "http://mirofish:5000")

    output = execute_swarm_simulation(
        [],
        {"provider": "mirofish", "operation": "report_status"},
    )

    assert output["canonicalState"] == "failed"
    assert output["status"] == "failed"


def test_workflow_endpoint_override_is_disabled_by_default(monkeypatch):
    monkeypatch.delenv(MIROFISH_ENDPOINT_ENV, raising=False)
    monkeypatch.delenv(MIROFISH_ALLOW_ENDPOINT_OVERRIDE_ENV, raising=False)

    with pytest.raises(SwarmSimulationExecutionError, match="endpoints are disabled"):
        execute_swarm_simulation(
            [],
            {"provider": "mirofish", "endpoint": "http://127.0.0.1:5000"},
        )
