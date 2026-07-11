from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import get_db
from backend.models.identity import User, Workspace, WorkspaceMembership, WorkspaceRole
from backend.models.operations_work_item import (
    OperationsWorkItem,
    WorkItemStatus,
    WorkItemType,
)
from backend.schemas.common import ApiResponse, PaginationMeta
from backend.schemas.operations_inbox import (
    ApprovalDecision,
    ApprovalDecisionRead,
    OperationsWorkItemRead,
)
from backend.security.identity import RequestIdentity, get_request_identity

router = APIRouter(prefix="/workspaces/{workspace_id}/operations-inbox", tags=["operations-inbox"])

APPROVER_ROLES = frozenset({WorkspaceRole.ADMIN, WorkspaceRole.MAINTAINER, WorkspaceRole.OPERATOR})


def _decisions(evidence: dict) -> list[dict]:
    decisions = evidence.get("decisions")
    if isinstance(decisions, list):
        return [dict(item) for item in decisions if isinstance(item, dict)]
    legacy = evidence.get("decision")
    return [dict(legacy)] if isinstance(legacy, dict) else []


def _bind_version(evidence: dict, proposal_version: str, now: datetime) -> tuple[dict, list[dict]]:
    updated = dict(evidence)
    decisions = _decisions(updated)
    bound_version = updated.get("proposal_version")
    if bound_version is None and decisions:
        bound_version = decisions[0].get("proposal_version")

    if bound_version is not None and bound_version != proposal_version:
        grant = updated.get("approval_grant")
        if decisions or isinstance(grant, dict):
            invalidated = list(updated.get("invalidated_approval_cycles") or [])
            invalidated.append(
                {
                    "proposal_version": bound_version,
                    "decisions": decisions,
                    "approval_grant": grant if isinstance(grant, dict) else None,
                    "invalidated_at": now.isoformat(),
                    "reason": "proposal_version_changed",
                    "superseded_by_proposal_version": proposal_version,
                }
            )
            updated["invalidated_approval_cycles"] = invalidated
        decisions = []
        updated.pop("approval_grant", None)

    updated.pop("decision", None)
    updated["proposal_version"] = proposal_version
    updated["decisions"] = decisions
    return updated, decisions


def _approval_context(proposal: OperationsWorkItem) -> dict[str, str]:
    context: dict[str, str] = {"risk_level": proposal.severity}
    for field in (
        "target_resource_version",
        "policy_state_version",
        "permission_state_version",
    ):
        value = proposal.evidence.get(field)
        if not isinstance(value, str) or not value.strip():
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"{field} is required before a decision",
            )
        context[field] = value
    return context


def _approval_grant(
    proposal: OperationsWorkItem,
    proposal_version: str,
    decisions: list[dict],
    approval_context: dict[str, str],
    now: datetime,
) -> dict:
    return {
        "proposal_id": proposal.id,
        "proposal_version": proposal_version,
        "granted_at": now.isoformat(),
        "expires_at": (now + timedelta(hours=24)).isoformat(),
        "approver_user_ids": [decision["actor_user_id"] for decision in decisions],
        **approval_context,
        "requires_actuator": True,
    }


async def _membership(
    db: AsyncSession, workspace_id: str, identity: RequestIdentity
) -> WorkspaceMembership:
    membership = await db.scalar(
        select(WorkspaceMembership)
        .join(User, User.id == WorkspaceMembership.user_id)
        .where(WorkspaceMembership.workspace_id == workspace_id)
        .where(User.subject == identity.subject)
        .where(User.disabled.is_(False))
        .join(Workspace, Workspace.id == WorkspaceMembership.workspace_id)
        .where(Workspace.active.is_(True))
    )
    if membership is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Workspace membership required")
    return membership


@router.get("", response_model=ApiResponse[list[OperationsWorkItemRead]])
async def list_work_items(
    workspace_id: str,
    item_type: WorkItemType | None = Query(None, alias="type"),
    item_status: WorkItemStatus | None = Query(None, alias="status"),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    identity: RequestIdentity = Depends(get_request_identity),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse:
    await _membership(db, workspace_id, identity)
    filters = [OperationsWorkItem.workspace_id == workspace_id]
    if item_type is not None:
        filters.append(OperationsWorkItem.type == item_type)
    if item_status is not None:
        filters.append(OperationsWorkItem.status == item_status)

    total = await db.scalar(select(func.count()).select_from(OperationsWorkItem).where(*filters))
    rows = (
        (
            await db.execute(
                select(OperationsWorkItem)
                .where(*filters)
                .order_by(OperationsWorkItem.created_at.desc())
                .offset((page - 1) * limit)
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    return ApiResponse.ok(
        [OperationsWorkItemRead.model_validate(row) for row in rows],
        PaginationMeta(
            total=total or 0,
            page=page,
            limit=limit,
            pages=max(1, -(-(total or 0) // limit)),
        ),
    )


@router.get("/{item_id}", response_model=ApiResponse[OperationsWorkItemRead])
async def get_work_item(
    workspace_id: str,
    item_id: str,
    identity: RequestIdentity = Depends(get_request_identity),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse:
    await _membership(db, workspace_id, identity)
    item = await db.scalar(
        select(OperationsWorkItem)
        .where(OperationsWorkItem.workspace_id == workspace_id)
        .where(OperationsWorkItem.id == item_id)
    )
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Work item not found")
    return ApiResponse.ok(OperationsWorkItemRead.model_validate(item))


@router.post(
    "/{approval_id}/decision",
    response_model=ApiResponse[ApprovalDecisionRead],
)
async def decide_approval(
    workspace_id: str,
    approval_id: str,
    body: ApprovalDecision,
    identity: RequestIdentity = Depends(get_request_identity),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse:
    membership = await _membership(db, workspace_id, identity)
    if membership.role not in APPROVER_ROLES:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Approval permission required")

    approval = await db.scalar(
        select(OperationsWorkItem)
        .where(OperationsWorkItem.workspace_id == workspace_id)
        .where(OperationsWorkItem.id == approval_id)
        .with_for_update()
    )
    if approval is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Approval work item not found")
    if approval.type != WorkItemType.APPROVAL:
        raise HTTPException(status.HTTP_409_CONFLICT, "Work item is not an approval")
    proposal_id = approval.proposal_id or approval.parent_id
    proposal = await db.scalar(
        select(OperationsWorkItem)
        .where(OperationsWorkItem.workspace_id == workspace_id)
        .where(OperationsWorkItem.id == proposal_id)
        .where(OperationsWorkItem.type == WorkItemType.CHANGE_PROPOSAL)
        .with_for_update()
    )
    if proposal is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Linked change proposal not found")
    proposal_version = proposal.evidence.get("proposal_version")
    if not isinstance(proposal_version, str) or not proposal_version.strip():
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Versioned evidence is required before a decision",
        )
    approval_context = _approval_context(proposal)
    if not proposal.author_actor_type or not proposal.author_actor_id:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Author attribution is required before a decision",
        )

    if (
        body.decision == "approve"
        and proposal.author_actor_type == "user"
        and proposal.author_actor_id == membership.user_id
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Proposal authors cannot self-approve")

    now = datetime.now(UTC)
    bound_version = approval.evidence.get("proposal_version")
    version_changed = bound_version is not None and bound_version != proposal_version
    evidence, decisions = _bind_version(approval.evidence, proposal_version, now)

    if not version_changed:
        if approval.status not in {WorkItemStatus.OPEN, WorkItemStatus.IN_PROGRESS}:
            raise HTTPException(status.HTTP_409_CONFLICT, "Approval has already been decided")
        if isinstance(evidence.get("approval_grant"), dict):
            raise HTTPException(status.HTTP_409_CONFLICT, "Approval Grant already exists")
        if any(decision.get("decision") != "approve" for decision in decisions):
            raise HTTPException(status.HTTP_409_CONFLICT, "Approval has already been decided")
    if (
        proposal.status not in {WorkItemStatus.OPEN, WorkItemStatus.IN_PROGRESS}
        and not version_changed
    ):
        raise HTTPException(status.HTTP_409_CONFLICT, "Change proposal is not actionable")
    if any(decision.get("actor_user_id") == membership.user_id for decision in decisions):
        raise HTTPException(status.HTTP_409_CONFLICT, "Approver already decided this version")

    audit = {
        "decision": body.decision,
        "reason": body.reason,
        "decided_at": now.isoformat(),
        "actor_subject": identity.subject,
        "actor_user_id": membership.user_id,
        "actor_role": membership.role.value,
        "proposal_id": proposal.id,
        "proposal_version": proposal_version,
        "requires_actuator": False,
    }
    decisions.append(audit)
    evidence["decisions"] = decisions

    if body.decision == "reject":
        approval.status = WorkItemStatus.RESOLVED
        proposal.status = WorkItemStatus.RESOLVED
        execution_state = "denied"
    elif body.decision == "request_changes":
        approval.status = WorkItemStatus.RESOLVED
        proposal.status = WorkItemStatus.OPEN
        execution_state = "changes_requested"
    elif proposal.severity == "critical" and len(decisions) == 1:
        approval.status = WorkItemStatus.IN_PROGRESS
        proposal.status = WorkItemStatus.OPEN
        execution_state = "awaiting_additional_approval"
    else:
        if proposal.severity == "critical" and not any(
            decision.get("actor_role") == WorkspaceRole.ADMIN.value for decision in decisions
        ):
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "Critical approval requires an Admin among the two approvers",
            )
        audit["requires_actuator"] = True
        evidence["approval_grant"] = _approval_grant(
            proposal,
            proposal_version,
            decisions,
            approval_context,
            now,
        )
        approval.status = WorkItemStatus.RESOLVED
        proposal.status = WorkItemStatus.IN_PROGRESS
        execution_state = "awaiting_actuator"

    approval.evidence = evidence
    await db.flush()

    return ApiResponse.ok(
        ApprovalDecisionRead(
            approval=OperationsWorkItemRead.model_validate(approval),
            proposal=OperationsWorkItemRead.model_validate(proposal),
            execution_state=execution_state,
        )
    )
