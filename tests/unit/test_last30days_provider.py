import json
from subprocess import CompletedProcess

import pytest

from backend.workflow.last30days_provider import (
    LAST30DAYS_ENGINE_COMMIT,
    LAST30DAYS_ENGINE_ENV,
    LAST30DAYS_PYTHON_ENV,
    Last30DaysProviderError,
)
from backend.workflow.situation_awareness import execute_situation_awareness


def test_provider_requires_installed_engine(monkeypatch):
    monkeypatch.delenv(LAST30DAYS_ENGINE_ENV, raising=False)
    with pytest.raises(Last30DaysProviderError, match=LAST30DAYS_ENGINE_ENV):
        execute_situation_awareness([], {"provider": "last30days", "query": "AI"})


def test_provider_builds_upstream_json_command(monkeypatch, tmp_path):
    engine = tmp_path / "last30days.py"
    engine.write_text("# fixture", encoding="utf-8")
    monkeypatch.setenv(LAST30DAYS_ENGINE_ENV, str(engine))
    monkeypatch.setenv(LAST30DAYS_PYTHON_ENV, "python3.12")
    captured = {}

    def fake_run(command, **kwargs):
        if command[0] == "git":
            return CompletedProcess(command, 1, stdout="", stderr="not a checkout")
        captured["command"] = command
        captured["kwargs"] = kwargs
        return CompletedProcess(
            command,
            0,
            stdout=json.dumps(
                {
                    "schema_version": "1.2",
                    "query": "AI",
                    "window_days": 30,
                    "source_status": {},
                    "clusters": [],
                    "results": [],
                }
            ),
            stderr="",
        )

    monkeypatch.setattr("subprocess.run", fake_run)
    output = execute_situation_awareness(
        [],
        {
            "provider": "last30days",
            "query": "AI",
            "windowDays": 30,
            "sources": ["xiaohongshu", "web"],
            "depth": "deep",
            "verifyFreshness": True,
        },
    )

    command = captured["command"]
    assert command[:3] == ["python3.12", str(engine.resolve()), "AI"]
    assert command[command.index("--search") + 1] == "xiaohongshu,web"
    assert "--deep" in command
    assert "--verify-freshness" in command
    assert captured["kwargs"]["timeout"] == 300
    assert output["provider"]["expectedUpstreamCommit"] == LAST30DAYS_ENGINE_COMMIT
    assert output["provider"]["versionVerified"] is False
    assert output["report"]["schema_version"] == "1.2"
