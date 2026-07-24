"""Safety and model-boundary coverage for Canvas node AI edit drafts."""

import pytest

from backend.schemas.workflow import WorkflowNodeEditDraftRequest, WorkflowProject
from backend.workflow import node_edit_draft


def test_decode_model_reply_accepts_fenced_json() -> None:
    decoded = node_edit_draft._decode_model_reply(
        '```json\n{"reply":"已调整", "params":{"limit":50}}\n```'
    )

    assert decoded == {"reply": "已调整", "params": {"limit": 50}}


def test_decode_model_reply_uses_last_complete_json_after_think_prelude() -> None:
    decoded = node_edit_draft._decode_model_reply(
        '<think>Current params: {"limit":20}</think>\n'
        '{"reply":"已调整", "params":{"limit":50}}'
    )

    assert decoded == {"reply": "已调整", "params": {"limit": 50}}


def test_safe_param_patch_rejects_new_parameter_names() -> None:
    assert node_edit_draft._safe_param_patch(
        {"limit": 50, "api_key": "never", "newParam": True}, ["limit"]
    ) == {"limit": 50}


def test_sensitive_parameter_names_are_not_offered_to_the_model() -> None:
    assert node_edit_draft._is_sensitive_parameter_name("api_key") is True
    assert node_edit_draft._is_sensitive_parameter_name("accessToken") is True
    assert node_edit_draft._is_sensitive_parameter_name("limit") is False


def test_node_lookup_supports_package_internal_paths() -> None:
    project = WorkflowProject.model_validate(
        {
            "id": "wf-package",
            "name": "Package",
            "profile": "intelligence",
            "nodes": [{
                "id": "package",
                "kind": "agent",
                "capability": "normalize",
                "params": {},
                "internals": {"nodes": [{
                    "id": "source",
                    "kind": "source",
                    "capability": "fetch",
                    "params": {"limit": 20},
                }], "edges": []},
            }],
            "edges": [],
        }
    )

    assert node_edit_draft._find_workflow_node(project, "package::source").id == "source"


@pytest.mark.asyncio
async def test_node_edit_draft_preserves_package_internal_path(monkeypatch) -> None:
    project = WorkflowProject.model_validate(
        {
            "id": "wf-package-edit",
            "name": "Package edit",
            "profile": "intelligence",
            "nodes": [{
                "id": "package",
                "kind": "agent",
                "capability": "normalize",
                "params": {},
                "internals": {"nodes": [{
                    "id": "source",
                    "kind": "source",
                    "capability": "fetch",
                    "params": {"limit": 20},
                }], "edges": []},
            }],
            "edges": [],
        }
    )

    class FakeAdapter:
        async def chat(self, *args, **kwargs):
            return '{"reply":"已调整", "params":{"limit":50}}'

        async def aclose(self):
            pass

    async def resolve_with_fallback(session, role, operation):
        return await operation(FakeAdapter(), "configured-model")

    monkeypatch.setattr(node_edit_draft.resolver, "resolve_with_fallback", resolve_with_fallback)
    result = await node_edit_draft.draft_workflow_node_edit(
        WorkflowNodeEditDraftRequest(project=project, nodeId="package::source", message="把 limit 改为 50"),
        session=object(),
    )

    assert result.patch is not None
    assert result.patch.patch.operations[0]["nodeId"] == "package::source"


@pytest.mark.asyncio
async def test_node_edit_draft_uses_chat_role_and_returns_reviewable_patch(monkeypatch) -> None:
    project = WorkflowProject.model_validate(
        {
            "id": "wf-node-edit",
            "name": "Node edit",
            "profile": "intelligence",
            "nodes": [
                {
                    "id": "source",
                    "kind": "source",
                    "capability": "fetch",
                    "params": {"limit": 20},
                }
            ],
            "edges": [],
        }
    )
    called = {}

    class FakeAdapter:
        async def chat(self, messages, *, model, **kwargs):
            called["messages"] = messages
            called["model"] = model
            return '{"reply":"已把数量改为 50", "params":{"limit":50,"ignored":"no"}}'

        async def aclose(self):
            called["closed"] = True

    async def resolve_with_fallback(session, role, operation):
        called["role"] = role
        return await operation(FakeAdapter(), "configured-model")

    monkeypatch.setattr(node_edit_draft.resolver, "resolve_with_fallback", resolve_with_fallback)
    result = await node_edit_draft.draft_workflow_node_edit(
        WorkflowNodeEditDraftRequest(project=project, nodeId="source", message="把最大条数改为 50"),
        session=object(),
    )

    assert called["role"] == "chat"
    assert called["model"] == "configured-model"
    assert called["closed"] is True
    assert result.reply == "已把数量改为 50"
    assert result.patch is not None
    assert result.patch.patch.operations[0]["op"] == "update_parameters"
    assert result.patch.patch.operations[0]["nodeId"] == "source"
    assert result.patch.patch.operations[0]["params"] == {"limit": 50}
