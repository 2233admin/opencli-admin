"""Resolve browser-worker capacity and profile/session runtime resources."""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.browser_pool import get_pool
from backend.models.browser import (
    BrowserBinding,
)
from backend.models.browser import (
    ProfileBinding as ProfileBindingRow,
)
from backend.models.browser import (
    SessionSnapshot as SessionSnapshotRow,
)
from backend.schemas.workflow import (
    CompiledWorkflowNode,
    WorkflowFleetCapabilityMatchResponse,
    WorkflowOpenCLIHDATraceDispatch,
    WorkflowRunBlockReason,
    WorkflowRuntimeResourceRequirement,
    WorkflowRuntimeResourceResolution,
)
from backend.workflow.block_reasons import (
    MISSING_ADAPTER_RESOURCE,
    MISSING_OPENCLI_COMMAND,
    MISSING_PROFILE_BINDING,
    MISSING_SESSION_SNAPSHOT,
    MISSING_WORKER_CAPACITY,
    MUTATION_MODE_UNSUPPORTED,
    PROFILE_LOCK_CONTENDED,
)
from backend.workflow.opencli_adapter_nodes import resolve_opencli_adapter_node


@dataclass(frozen=True)
class ProfileBinding:
    """A saved site/profile reference shared by browser workers."""

    binding_id: str
    site: str
    browser_endpoint: str
    profile_id: str | None = None


@dataclass(frozen=True)
class SessionSnapshot:
    """An immutable, shareable read-only browser session snapshot."""

    snapshot_id: str
    profile_binding_id: str
    created_at: datetime
    blob_uri: str | None = None


@dataclass(frozen=True)
class ProfileLock:
    """A lease granting one worker exclusive profile mutation access."""

    lock_id: str
    profile_binding_id: str
    worker_slot_id: str
    acquired_at: datetime


class ProfileLockManager:
    """Process-local lock manager used by local browser-worker execution."""

    def __init__(self) -> None:
        self._locks: dict[str, ProfileLock] = {}
        self._guard = asyncio.Lock()

    async def acquire(
        self,
        profile_binding_id: str,
        worker_slot_id: str,
    ) -> ProfileLock | None:
        async with self._guard:
            if profile_binding_id in self._locks:
                return None
            lock = ProfileLock(
                lock_id=str(uuid.uuid4()),
                profile_binding_id=profile_binding_id,
                worker_slot_id=worker_slot_id,
                acquired_at=datetime.now(UTC),
            )
            self._locks[profile_binding_id] = lock
            return lock

    async def release(self, lock_id: str) -> bool:
        async with self._guard:
            profile_binding_id = next(
                (
                    binding_id
                    for binding_id, lock in self._locks.items()
                    if lock.lock_id == lock_id
                ),
                None,
            )
            if profile_binding_id is None:
                return False
            del self._locks[profile_binding_id]
            return True

    def get(self, profile_binding_id: str) -> ProfileLock | None:
        return self._locks.get(profile_binding_id)


class SessionSnapshotStore:
    """In-memory index for snapshot references shared by read-only workers."""

    def __init__(self) -> None:
        self._snapshots: dict[str, SessionSnapshot] = {}

    def publish(
        self,
        profile_binding_id: str,
        *,
        snapshot_id: str | None = None,
        blob_uri: str | None = None,
    ) -> SessionSnapshot:
        snapshot = SessionSnapshot(
            snapshot_id=snapshot_id or str(uuid.uuid4()),
            profile_binding_id=profile_binding_id,
            created_at=datetime.now(UTC),
            blob_uri=blob_uri,
        )
        self._snapshots[profile_binding_id] = snapshot
        return snapshot

    def get(self, profile_binding_id: str) -> SessionSnapshot | None:
        return self._snapshots.get(profile_binding_id)


profile_locks = ProfileLockManager()
session_snapshots = SessionSnapshotStore()


def resolve_runtime_resources(
    dispatch: WorkflowOpenCLIHDATraceDispatch,
    node: CompiledWorkflowNode,
    match: WorkflowFleetCapabilityMatchResponse | None,
) -> tuple[WorkflowRuntimeResourceRequirement, WorkflowRuntimeResourceResolution]:
    """Resolve compiled OpenCLI metadata without exposing profile secrets."""
    adapter_node_id = _read_string(node.params.get("opencliAdapterNodeId"))
    adapter_node = resolve_opencli_adapter_node(adapter_node_id) if adapter_node_id else None
    mutation_mode = "write" if adapter_node and adapter_node.access == "write" else "read"
    requirement = WorkflowRuntimeResourceRequirement(
        nodeId=dispatch.nodeId,
        sourceGroup=dispatch.sourceGroup,
        site=dispatch.site,
        mutationMode=mutation_mode,
        requestedCapability=f"opencli.{dispatch.site}.{dispatch.command or 'unresolved'}",
        adapterNodeId=adapter_node_id,
    )

    if not dispatch.command:
        return requirement, _blocked(
            MISSING_OPENCLI_COMMAND,
            "OpenCLI command could not be resolved from runtime metadata.",
            requirement,
        )
    if adapter_node_id and adapter_node is None:
        return requirement, _blocked(
            MISSING_ADAPTER_RESOURCE,
            f'OpenCLI adapter capability "{adapter_node_id}" is not registered.',
            requirement,
        )
    if match is None:
        return requirement, WorkflowRuntimeResourceResolution(
            status="resolved",
            adapterNodeId=adapter_node_id or (node.adapter.id if node.adapter else None),
            command=dispatch.command,
            workerSlotId="iii:collector-opencli",
            concurrencyLimit=1,
        )
    if (
        not adapter_node_id
        and node.adapter is not None
        and node.adapter.provider == "opencli"
        and not match.matched
    ):
        return requirement, WorkflowRuntimeResourceResolution(
            status="resolved",
            adapterNodeId=node.adapter.id,
            command=dispatch.command,
            workerSlotId="iii:collector-opencli",
            concurrencyLimit=1,
        )
    if not match.matched or match.selected is None:
        code = _block_code(match.missing, mutation_mode=mutation_mode)
        return requirement, _blocked(
            code,
            _block_message(code, dispatch.site),
            requirement,
            missing=match.missing,
        )

    selected = match.selected
    profile_binding_id = None
    session_snapshot_id = None
    lock_id = None
    if match.requiresSiteBinding:
        profile_binding_id = _resource_id("profile-binding", dispatch.site, selected.endpoint)
        if mutation_mode == "write":
            lock_id = _resource_id("profile-lock", dispatch.site, selected.endpoint)
        else:
            session_snapshot_id = _resource_id(
                "session-snapshot", dispatch.site, selected.endpoint
            )
    return requirement, WorkflowRuntimeResourceResolution(
        status="resolved",
        adapterNodeId=match.adapterNodeId or adapter_node_id,
        command=match.command or dispatch.command,
        workerSlotId=selected.endpoint,
        profileBindingId=profile_binding_id,
        sessionSnapshotId=session_snapshot_id,
        lockId=lock_id,
        concurrencyLimit=1,
    )


async def resolve_runtime_resources_from_db(
    session: AsyncSession,
    requirement: WorkflowRuntimeResourceRequirement,
    *,
    worker_slot_id: str | None = None,
) -> WorkflowRuntimeResourceResolution:
    """Resolve registered profile and snapshot resources against the control plane."""
    if requirement.mutationMode not in {"read", "write"}:
        return _blocked(
            MUTATION_MODE_UNSUPPORTED,
            f"Unsupported browser mutation mode: {requirement.mutationMode!r}.",
            requirement,
        )

    profile_row = (
        await session.execute(
            select(ProfileBindingRow).where(
                ProfileBindingRow.site == requirement.site,
                ProfileBindingRow.active.is_(True),
            )
        )
    ).scalar_one_or_none()
    browser_row = None
    if profile_row is None:
        browser_row = (
            await session.execute(
                select(BrowserBinding).where(BrowserBinding.site == requirement.site)
            )
        ).scalar_one_or_none()
    if profile_row is None and browser_row is None:
        return _blocked(
            MISSING_PROFILE_BINDING,
            f'No browser profile binding is available for "{requirement.site}".',
            requirement,
        )

    pool = _read_pool()
    endpoint = worker_slot_id or (
        profile_row.browser_endpoint if profile_row is not None else browser_row.browser_endpoint
    )
    if pool is None or endpoint not in pool.endpoints:
        return _blocked(
            MISSING_WORKER_CAPACITY,
            "No registered browser-worker slot satisfies the requirement.",
            requirement,
            endpoint=endpoint,
        )

    profile_binding_id = profile_row.id if profile_row is not None else browser_row.id
    if requirement.mutationMode == "write":
        lock = await profile_locks.acquire(profile_binding_id, endpoint)
        if lock is None:
            return _blocked(
                PROFILE_LOCK_CONTENDED,
                f'The browser profile lock for "{requirement.site}" is already held.',
                requirement,
                profileBindingId=profile_binding_id,
            )
        return WorkflowRuntimeResourceResolution(
            status="resolved",
            workerSlotId=endpoint,
            profileBindingId=profile_binding_id,
            lockId=lock.lock_id,
        )

    snapshot = (
        await session.execute(
            select(SessionSnapshotRow)
            .where(SessionSnapshotRow.profile_binding_id == profile_binding_id)
            .order_by(SessionSnapshotRow.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if snapshot is None:
        return _blocked(
            MISSING_SESSION_SNAPSHOT,
            f'No shareable browser session snapshot is available for "{requirement.site}".',
            requirement,
            profileBindingId=profile_binding_id,
        )
    return WorkflowRuntimeResourceResolution(
        status="resolved",
        workerSlotId=endpoint,
        profileBindingId=profile_binding_id,
        sessionSnapshotId=snapshot.snapshot_id,
    )


@asynccontextmanager
async def profile_mutation_lock(
    profile_binding_id: str,
    worker_slot_id: str,
) -> AsyncIterator[ProfileLock]:
    """Hold an exclusive profile mutation lock for the context lifetime."""
    lock = await profile_locks.acquire(profile_binding_id, worker_slot_id)
    if lock is None:
        raise RuntimeError("profile lock is already held")
    try:
        yield lock
    finally:
        await profile_locks.release(lock.lock_id)


def _blocked(
    code: str,
    message: str,
    requirement: WorkflowRuntimeResourceRequirement,
    *,
    missing: list[str] | None = None,
    **details: Any,
) -> WorkflowRuntimeResourceResolution:
    return WorkflowRuntimeResourceResolution(
        status="blocked",
        adapterNodeId=requirement.adapterNodeId,
        blockReason=WorkflowRunBlockReason(
            code=code,
            message=message,
            source="workflow_runtime_resources",
            details={
                "nodeId": requirement.nodeId,
                "sourceGroup": requirement.sourceGroup,
                "site": requirement.site,
                "mutationMode": requirement.mutationMode,
                "requestedCapability": requirement.requestedCapability,
                "adapterNodeId": requirement.adapterNodeId,
                "missing": missing or [],
                **details,
            },
        ),
    )


def _block_code(missing: list[str], *, mutation_mode: str) -> str:
    if "opencli_adapter_node" in missing:
        return MISSING_ADAPTER_RESOURCE
    if any(value.startswith("site_binding:") for value in missing):
        return MISSING_PROFILE_BINDING
    if "profile_lock" in missing and mutation_mode == "write":
        return PROFILE_LOCK_CONTENDED
    if "session_snapshot" in missing:
        return MISSING_SESSION_SNAPSHOT
    return MISSING_WORKER_CAPACITY


def _block_message(code: str, site: str) -> str:
    if code == MISSING_ADAPTER_RESOURCE:
        return "OpenCLI adapter capability is unavailable in the registered catalog."
    if code == MISSING_PROFILE_BINDING:
        return f'No browser profile/site binding is available for "{site}".'
    if code == MISSING_SESSION_SNAPSHOT:
        return f'No shareable browser session snapshot is available for "{site}".'
    if code == PROFILE_LOCK_CONTENDED:
        return f'The browser profile lock for "{site}" is already held.'
    return "No connected worker slot currently has capacity for this OpenCLI task."


def _resource_id(kind: str, site: str, endpoint: str) -> str:
    return str(
        uuid.uuid5(
            uuid.NAMESPACE_URL,
            f"opencli-admin/runtime-resource/{kind}/{site}/{endpoint}",
        )
    )


def _read_pool():
    try:
        return get_pool()
    except RuntimeError:
        return None


def _read_string(value: object) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


__all__ = [
    "ProfileBinding",
    "ProfileLock",
    "ProfileLockManager",
    "SessionSnapshot",
    "SessionSnapshotStore",
    "profile_locks",
    "profile_mutation_lock",
    "resolve_runtime_resources",
    "resolve_runtime_resources_from_db",
    "session_snapshots",
]
