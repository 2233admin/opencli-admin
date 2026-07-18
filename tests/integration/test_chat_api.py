"""Chat dock AI-provider tool coverage: read (list_providers), write/propose
(update_provider), and confirm (POST /chat/confirm) — the LLM round trip
itself is out of scope (no prior art for mocking it in this repo); these
exercise the exact tool-dispatch logic the LLM would trigger.
"""

import pytest
from fastapi import HTTPException

from backend.api.v1.chat import _build_proposal, _run_read_tool
from backend.models.provider import ModelProvider


async def _make_provider(db_session, **overrides) -> ModelProvider:
    provider = ModelProvider(
        name=overrides.get("name", "Test Provider"),
        provider_type=overrides.get("provider_type", "openai"),
        base_url=overrides.get("base_url", "https://api.openai.com/v1"),
        api_key=overrides.get("api_key", "sk-test-key"),
        default_model=overrides.get("default_model", "gpt-4o-mini"),
        enabled=overrides.get("enabled", True),
    )
    db_session.add(provider)
    await db_session.commit()
    await db_session.refresh(provider)
    return provider


# ── read: list_providers ─────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_list_providers_read_tool_empty(db_session):
    result = await _run_read_tool(db_session, "list_providers", {})
    assert result == []


@pytest.mark.asyncio
async def test_list_providers_read_tool_returns_enabled_and_disabled(db_session):
    enabled = await _make_provider(db_session, name="Enabled One", enabled=True)
    disabled = await _make_provider(db_session, name="Disabled One", enabled=False)

    result = await _run_read_tool(db_session, "list_providers", {})

    assert {p["id"] for p in result} == {enabled.id, disabled.id}
    by_id = {p["id"]: p for p in result}
    assert by_id[enabled.id]["enabled"] is True
    assert by_id[disabled.id]["enabled"] is False
    assert set(by_id[enabled.id]) == {"id", "name", "provider_type", "default_model", "base_url", "enabled"}


# ── write: update_provider proposal ──────────────────────────────────────────
@pytest.mark.asyncio
async def test_update_provider_proposal_default_model(db_session):
    provider = await _make_provider(db_session, default_model="gpt-4o-mini")

    proposal = await _build_proposal(
        db_session, "update_provider", {"provider_id": provider.id, "default_model": "qwen3:4b"}
    )

    assert proposal.tool == "update_provider"
    assert proposal.args == {"provider_id": provider.id, "default_model": "qwen3:4b"}
    assert "gpt-4o-mini" in proposal.diff and "qwen3:4b" in proposal.diff
    # proposing never mutates the row
    await db_session.refresh(provider)
    assert provider.default_model == "gpt-4o-mini"


@pytest.mark.asyncio
async def test_update_provider_proposal_enabled_toggle(db_session):
    provider = await _make_provider(db_session, enabled=True)

    proposal = await _build_proposal(db_session, "update_provider", {"provider_id": provider.id, "enabled": False})

    assert proposal.args == {"provider_id": provider.id, "enabled": False}
    assert "启用" in proposal.diff or "停用" in proposal.diff


@pytest.mark.asyncio
async def test_update_provider_proposal_not_found(db_session):
    with pytest.raises(HTTPException) as exc_info:
        await _build_proposal(db_session, "update_provider", {"provider_id": "nonexistent-id", "enabled": True})
    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_update_provider_proposal_no_fields(db_session):
    provider = await _make_provider(db_session)
    with pytest.raises(HTTPException) as exc_info:
        await _build_proposal(db_session, "update_provider", {"provider_id": provider.id})
    assert exc_info.value.status_code == 400


# ── confirm: POST /api/v1/chat/confirm ───────────────────────────────────────
@pytest.mark.asyncio
async def test_confirm_update_provider(client, db_session):
    provider = await _make_provider(db_session, default_model="gpt-4o-mini", enabled=True)

    response = await client.post(
        "/api/v1/chat/confirm",
        json={
            "proposal": {
                "tool": "update_provider",
                "args": {"provider_id": provider.id, "default_model": "qwen3:4b", "enabled": False},
                "summary": "配置 AI 模型提供商",
                "diff": "default_model gpt-4o-mini -> qwen3:4b",
            }
        },
    )

    assert response.status_code == 200
    body = response.json()["data"]
    assert body["applied"] is True
    assert body["tool"] == "update_provider"

    await db_session.refresh(provider)
    assert provider.default_model == "qwen3:4b"
    assert provider.enabled is False


@pytest.mark.asyncio
async def test_confirm_update_provider_not_found(client):
    response = await client.post(
        "/api/v1/chat/confirm",
        json={
            "proposal": {
                "tool": "update_provider",
                "args": {"provider_id": "nonexistent-id", "enabled": True},
                "summary": "配置 AI 模型提供商",
                "diff": "enabled -> true",
            }
        },
    )
    assert response.status_code == 404


# ── confirm: trigger_task dispatch failure ───────────────────────────────────
@pytest.mark.asyncio
async def test_confirm_trigger_task_reports_dispatch_failure(client, db_session, monkeypatch):
    """Dispatch blowing up after the task row is committed must surface as 502,
    not applied=True with a silently dead task."""
    from backend.models.source import DataSource

    source = DataSource(
        name="Chat Trigger Source",
        channel_type="rss",
        channel_config={"feed_url": "https://example.com/feed.xml"},
        enabled=True,
    )
    db_session.add(source)
    await db_session.commit()
    await db_session.refresh(source)

    class _BoomExecutor:
        async def dispatch_collection(self, task_id: str, parameters: dict) -> dict:
            raise RuntimeError("broker down")

    monkeypatch.setattr("backend.executor.get_executor", lambda: _BoomExecutor())

    response = await client.post(
        "/api/v1/chat/confirm",
        json={
            "proposal": {
                "tool": "trigger_task",
                "args": {"source_id": source.id},
                "summary": "触发采集",
                "diff": "",
            }
        },
    )

    assert response.status_code == 502
    assert "派发失败" in response.json()["detail"]
