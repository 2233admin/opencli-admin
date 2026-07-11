from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from backend.api.v1.operations_inbox import router
from backend.database import get_db
from backend.models.identity import User, Workspace, WorkspaceMembership, WorkspaceRole
from backend.models.operations_work_item import (
    OperationsWorkItem,
    WorkItemStatus,
    WorkItemType,
)
from backend.security.identity import RequestIdentity, get_request_identity


async def _client(db_session, identity: RequestIdentity) -> AsyncClient:
    app = FastAPI()
    app.include_router(router)

    async def override_db():
        yield db_session

    async def override_identity():
        return identity

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_request_identity] = override_identity
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _seed(db_session, role: WorkspaceRole):
    user = User(subject=f"{role.value}-subject")
    workspace = Workspace(name="Operations", slug=f"operations-{role.value}")
    db_session.add_all([user, workspace])
    await db_session.flush()
    db_session.add(WorkspaceMembership(workspace_id=workspace.id, user_id=user.id, role=role))
    proposal = OperationsWorkItem(
        workspace_id=workspace.id,
        type=WorkItemType.CHANGE_PROPOSAL,
        severity="high",
        author_actor_type="operations_agent",
        author_actor_id="operations-agent-1",
        evidence={
            "proposal_version": "plan-v2",
            "target_resource_version": "source-v7",
            "policy_state_version": "risk-policy-v3",
            "permission_state_version": "permissions-v5",
            "diff": {"schedule": {"from": "*/5", "to": "*/15"}},
            "observations": ["rate limited in 4/5 runs"],
        },
        reason="Operations Agent suggests reducing collection frequency",
    )
    db_session.add(proposal)
    await db_session.flush()
    approval = OperationsWorkItem(
        workspace_id=workspace.id,
        type=WorkItemType.APPROVAL,
        proposal_id=proposal.id,
        parent_id=proposal.id,
        evidence={"gate": "human", "proposal_version": "plan-v2"},
    )
    db_session.add(approval)
    await db_session.commit()
    return user, workspace, proposal, approval


async def _add_member(db_session, workspace: Workspace, role: WorkspaceRole, subject: str):
    user = User(subject=subject)
    db_session.add(user)
    await db_session.flush()
    db_session.add(WorkspaceMembership(workspace_id=workspace.id, user_id=user.id, role=role))
    await db_session.commit()
    return user


async def test_workspace_member_can_view_agent_proposal_evidence(db_session):
    _, workspace, proposal, _ = await _seed(db_session, WorkspaceRole.VIEWER)
    client = await _client(db_session, RequestIdentity(subject="viewer-subject"))
    async with client:
        response = await client.get(
            f"/workspaces/{workspace.id}/operations-inbox",
            params={"type": "change_proposal"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["total"] == 1
    assert payload["data"][0]["id"] == proposal.id
    assert payload["data"][0]["evidence"]["proposal_version"] == "plan-v2"
    assert payload["data"][0]["evidence"]["observations"]


async def test_viewer_cannot_approve(db_session):
    _, workspace, _, approval = await _seed(db_session, WorkspaceRole.VIEWER)
    client = await _client(db_session, RequestIdentity(subject="viewer-subject"))
    async with client:
        response = await client.post(
            f"/workspaces/{workspace.id}/operations-inbox/{approval.id}/decision",
            json={"decision": "approve", "reason": "looks safe"},
        )

    assert response.status_code == 403


async def test_approval_requires_versioned_evidence(db_session):
    _, workspace, proposal, approval = await _seed(db_session, WorkspaceRole.ADMIN)
    proposal.evidence = {"diff": {"schedule": {"from": "*/5", "to": "*/15"}}}
    await db_session.flush()
    client = await _client(db_session, RequestIdentity(subject="admin-subject"))
    async with client:
        response = await client.post(
            f"/workspaces/{workspace.id}/operations-inbox/{approval.id}/decision",
            json={"decision": "approve", "reason": "looks safe"},
        )

    assert response.status_code == 409
    assert proposal.status == WorkItemStatus.OPEN


async def test_authorized_approval_is_audited_and_waits_for_actuator(db_session):
    user, workspace, proposal, approval = await _seed(db_session, WorkspaceRole.OPERATOR)
    user_id = user.id
    approval_id = approval.id
    proposal_id = proposal.id
    client = await _client(db_session, RequestIdentity(subject="operator-subject"))
    async with client:
        response = await client.post(
            f"/workspaces/{workspace.id}/operations-inbox/{approval.id}/decision",
            json={"decision": "approve", "reason": "Evidence supports the bounded change"},
        )
        duplicate = await client.post(
            f"/workspaces/{workspace.id}/operations-inbox/{approval.id}/decision",
            json={"decision": "reject", "reason": "changed my mind"},
        )

    assert response.status_code == 200
    assert response.json()["data"]["execution_state"] == "awaiting_actuator"
    assert duplicate.status_code == 409

    db_session.expire_all()
    stored_approval = await db_session.scalar(
        select(OperationsWorkItem).where(OperationsWorkItem.id == approval_id)
    )
    stored_proposal = await db_session.scalar(
        select(OperationsWorkItem).where(OperationsWorkItem.id == proposal_id)
    )
    audit = stored_approval.evidence["decisions"][0]
    grant = stored_approval.evidence["approval_grant"]
    assert stored_approval.status == WorkItemStatus.RESOLVED
    assert stored_proposal.status == WorkItemStatus.IN_PROGRESS
    assert audit["actor_user_id"] == user_id
    assert audit["actor_subject"] == "operator-subject"
    assert audit["reason"] == "Evidence supports the bounded change"
    assert audit["requires_actuator"] is True
    assert grant["proposal_version"] == "plan-v2"
    assert grant["target_resource_version"] == "source-v7"
    assert grant["policy_state_version"] == "risk-policy-v3"
    assert grant["permission_state_version"] == "permissions-v5"
    assert grant["risk_level"] == "high"
    assert grant["approver_user_ids"] == [user_id]
    assert grant["expires_at"]


async def test_admin_can_reject_without_dispatching_execution(db_session):
    _, workspace, proposal, approval = await _seed(db_session, WorkspaceRole.ADMIN)
    client = await _client(db_session, RequestIdentity(subject="admin-subject"))
    async with client:
        response = await client.post(
            f"/workspaces/{workspace.id}/operations-inbox/{approval.id}/decision",
            json={"decision": "reject", "reason": "Target version is stale"},
        )

    assert response.status_code == 200
    assert response.json()["data"]["execution_state"] == "denied"
    assert proposal.status == WorkItemStatus.RESOLVED
    assert approval.evidence["decisions"][0]["requires_actuator"] is False
    assert "approval_grant" not in approval.evidence


async def test_request_changes_returns_proposal_for_revision_without_grant(db_session):
    _, workspace, proposal, approval = await _seed(db_session, WorkspaceRole.OPERATOR)
    client = await _client(db_session, RequestIdentity(subject="operator-subject"))
    async with client:
        response = await client.post(
            f"/workspaces/{workspace.id}/operations-inbox/{approval.id}/decision",
            json={"decision": "request_changes", "reason": "Add rollback evidence"},
        )

    assert response.status_code == 200
    assert response.json()["data"]["execution_state"] == "changes_requested"
    assert approval.status == WorkItemStatus.RESOLVED
    assert proposal.status == WorkItemStatus.OPEN
    assert approval.evidence["decisions"][0]["decision"] == "request_changes"
    assert "approval_grant" not in approval.evidence


async def test_admin_cannot_self_approve_own_proposal(db_session):
    admin, workspace, proposal, approval = await _seed(db_session, WorkspaceRole.ADMIN)
    proposal.author_actor_type = "user"
    proposal.author_actor_id = admin.id
    await db_session.flush()
    client = await _client(db_session, RequestIdentity(subject="admin-subject"))
    async with client:
        response = await client.post(
            f"/workspaces/{workspace.id}/operations-inbox/{approval.id}/decision",
            json={"decision": "approve", "reason": "I created this"},
        )

    assert response.status_code == 403
    assert approval.status == WorkItemStatus.OPEN
    assert "decisions" not in approval.evidence
    assert "approval_grant" not in approval.evidence


async def test_approval_requires_authoritative_author_attribution(db_session):
    _, workspace, proposal, approval = await _seed(db_session, WorkspaceRole.ADMIN)
    proposal.author_actor_type = None
    proposal.author_actor_id = None
    await db_session.flush()
    client = await _client(db_session, RequestIdentity(subject="admin-subject"))
    async with client:
        response = await client.post(
            f"/workspaces/{workspace.id}/operations-inbox/{approval.id}/decision",
            json={"decision": "approve", "reason": "missing author"},
        )

    assert response.status_code == 409
    assert "Author attribution" in response.json()["detail"]


async def test_critical_requires_two_distinct_approvers_including_admin(db_session):
    operator, workspace, proposal, approval = await _seed(db_session, WorkspaceRole.OPERATOR)
    proposal.severity = "critical"
    maintainer = await _add_member(
        db_session, workspace, WorkspaceRole.MAINTAINER, "maintainer-subject"
    )
    admin = await _add_member(db_session, workspace, WorkspaceRole.ADMIN, "critical-admin")

    operator_client = await _client(db_session, RequestIdentity(subject="operator-subject"))
    async with operator_client:
        first = await operator_client.post(
            f"/workspaces/{workspace.id}/operations-inbox/{approval.id}/decision",
            json={"decision": "approve", "reason": "First independent review"},
        )

    assert first.status_code == 200
    assert first.json()["data"]["execution_state"] == "awaiting_additional_approval"
    assert approval.status == WorkItemStatus.IN_PROGRESS
    assert proposal.status == WorkItemStatus.OPEN
    assert approval.evidence["decisions"][0]["requires_actuator"] is False
    assert "approval_grant" not in approval.evidence

    duplicate_client = await _client(db_session, RequestIdentity(subject="operator-subject"))
    async with duplicate_client:
        duplicate = await duplicate_client.post(
            f"/workspaces/{workspace.id}/operations-inbox/{approval.id}/decision",
            json={"decision": "approve", "reason": "Duplicate vote"},
        )
    assert duplicate.status_code == 409
    assert len(approval.evidence["decisions"]) == 1

    maintainer_client = await _client(db_session, RequestIdentity(subject="maintainer-subject"))
    async with maintainer_client:
        no_admin = await maintainer_client.post(
            f"/workspaces/{workspace.id}/operations-inbox/{approval.id}/decision",
            json={"decision": "approve", "reason": "Second non-admin review"},
        )
    assert no_admin.status_code == 409
    assert len(approval.evidence["decisions"]) == 1

    admin_client = await _client(db_session, RequestIdentity(subject="critical-admin"))
    async with admin_client:
        final = await admin_client.post(
            f"/workspaces/{workspace.id}/operations-inbox/{approval.id}/decision",
            json={"decision": "approve", "reason": "Admin confirms critical change"},
        )

    assert final.status_code == 200
    assert final.json()["data"]["execution_state"] == "awaiting_actuator"
    assert approval.status == WorkItemStatus.RESOLVED
    assert proposal.status == WorkItemStatus.IN_PROGRESS
    assert {decision["actor_user_id"] for decision in approval.evidence["decisions"]} == {
        operator.id,
        admin.id,
    }
    assert approval.evidence["approval_grant"]["approver_user_ids"] == [
        operator.id,
        admin.id,
    ]
    assert maintainer.id not in approval.evidence["approval_grant"]["approver_user_ids"]


async def test_proposal_version_change_invalidates_old_decision_and_grant(db_session):
    operator, workspace, proposal, approval = await _seed(db_session, WorkspaceRole.OPERATOR)
    operator_client = await _client(db_session, RequestIdentity(subject="operator-subject"))
    async with operator_client:
        first = await operator_client.post(
            f"/workspaces/{workspace.id}/operations-inbox/{approval.id}/decision",
            json={"decision": "approve", "reason": "Approve plan-v2"},
        )
    assert first.status_code == 200
    assert approval.evidence["approval_grant"]["proposal_version"] == "plan-v2"

    proposal.evidence = {**proposal.evidence, "proposal_version": "plan-v3"}
    admin = await _add_member(db_session, workspace, WorkspaceRole.ADMIN, "version-admin")
    admin_client = await _client(db_session, RequestIdentity(subject="version-admin"))
    async with admin_client:
        revised = await admin_client.post(
            f"/workspaces/{workspace.id}/operations-inbox/{approval.id}/decision",
            json={"decision": "approve", "reason": "Approve revised plan-v3"},
        )

    assert revised.status_code == 200
    assert revised.json()["data"]["execution_state"] == "awaiting_actuator"
    assert approval.evidence["proposal_version"] == "plan-v3"
    assert approval.evidence["approval_grant"]["proposal_version"] == "plan-v3"
    assert approval.evidence["approval_grant"]["approver_user_ids"] == [admin.id]
    assert approval.evidence["decisions"][0]["actor_user_id"] == admin.id
    invalidated = approval.evidence["invalidated_approval_cycles"][0]
    assert invalidated["proposal_version"] == "plan-v2"
    assert invalidated["decisions"][0]["actor_user_id"] == operator.id
    assert invalidated["approval_grant"]["proposal_version"] == "plan-v2"
    assert invalidated["reason"] == "proposal_version_changed"


async def test_non_member_cannot_read_workspace_inbox(db_session):
    _, workspace, _, _ = await _seed(db_session, WorkspaceRole.VIEWER)
    client = await _client(db_session, RequestIdentity(subject="outsider"))
    async with client:
        response = await client.get(f"/workspaces/{workspace.id}/operations-inbox")

    assert response.status_code == 403


async def test_disabled_workspace_blocks_inbox_read_and_approval(db_session):
    _, workspace, _, approval = await _seed(db_session, WorkspaceRole.ADMIN)
    workspace.active = False
    await db_session.commit()
    client = await _client(db_session, RequestIdentity(subject="admin-subject"))
    async with client:
        read = await client.get(f"/workspaces/{workspace.id}/operations-inbox")
        decision = await client.post(
            f"/workspaces/{workspace.id}/operations-inbox/{approval.id}/decision",
            json={"decision": "approve", "reason": "must remain blocked"},
        )

    assert read.status_code == 403
    assert decision.status_code == 403
    assert approval.status == WorkItemStatus.OPEN
