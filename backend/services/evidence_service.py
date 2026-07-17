"""Read-only EvidenceBatch projection service.

Projects batch, cluster, summary, missing-source, and conflict references from
the persisted workflow run state. The service does not dispatch workers,
mutate state, or stream raw records; it reads already-persisted run
projections and node events and returns reference-style payloads.
"""

from __future__ import annotations

import hashlib
from collections.abc import Iterable
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from backend.schemas.evidence import (
    EvidenceAnswerSummary,
    EvidenceArtifactRef,
    EvidenceBatchDetailResponse,
    EvidenceBatchListResponse,
    EvidenceBatchSourceCoverage,
    EvidenceBatchSummary,
    EvidenceCluster,
    EvidenceConflict,
    EvidenceMissingSource,
    EvidenceNodeProjection,
    EvidenceProjectionResponse,
    WorkflowProjectionInclude,
)
from backend.schemas.workflow import (
    WorkflowNodeRunEvent,
    WorkflowRunBatchReference,
    WorkflowRunProjection,
)
from backend.workflow.opencli_hda_tracer import (
    get_workflow_run_projection,
    list_workflow_run_events,
)

_ALLOWED_INCLUDES: set[str] = {
    "clusters",
    "missingSources",
    "summaries",
    "conflicts",
}

_DEFAULT_PAGE_SIZE = 50
_MAX_PAGE_SIZE = 200


class EvidenceBatchNotFoundError(Exception):
    """Raised when a requested batch id is not present for the run."""


class EvidenceRunNotFoundError(Exception):
    """Raised when the requested workflow run id is unknown."""


class EvidenceUnsupportedIncludeError(Exception):
    """Raised when an unsupported include value is requested."""


async def list_evidence_batches(
    run_id: str,
    *,
    node_id: str | None = None,
    source_group: str | None = None,
    cursor: str | None = None,
    limit: int | None = None,
    session: AsyncSession | None = None,
) -> EvidenceBatchListResponse:
    """List evidence batch summaries for a workflow run with cursor pagination.

    The cursor is the ``batchId`` of the last item from the previous page.
    Pagination is offset-free so the result stays stable as new batches arrive.
    """

    projection, events = await _load_run(run_id, session=session)
    page_size = _clamp_limit(limit)
    batches = _project_batches(projection, events)
    filtered = _filter_batches(batches, node_id=node_id, source_group=source_group)
    start_index = _resolve_cursor(filtered, cursor)
    page = filtered[start_index : start_index + page_size]
    more_available = start_index + page_size < len(filtered)
    next_cursor = page[-1].batchId if len(page) == page_size and more_available else None
    return EvidenceBatchListResponse(runId=run_id, batches=page, nextCursor=next_cursor)


async def get_evidence_batch(
    run_id: str,
    batch_id: str,
    *,
    session: AsyncSession | None = None,
) -> EvidenceBatchDetailResponse:
    """Return the detail projection for a single evidence batch."""

    projection, events = await _load_run(run_id, session=session)
    batches = _project_batches(projection, events)
    match = next((batch for batch in batches if batch.batchId == batch_id), None)
    if match is None:
        raise EvidenceBatchNotFoundError(
            f"Evidence batch {batch_id} not found for run {run_id}"
        )

    coverage = _source_coverage_for_batch(match, projection, events)
    return EvidenceBatchDetailResponse(
        runId=run_id,
        batch=match,
        manifestUri=match.manifestUri,
        odpRef=match.odpRef,
        recordCount=match.recordCount,
        itemCount=match.itemCount,
        sourceCoverage=coverage,
    )


async def build_run_projection(
    run_id: str,
    *,
    include: Iterable[WorkflowProjectionInclude | str] | None = None,
    node_id: str | None = None,
    source_group: str | None = None,
    session: AsyncSession | None = None,
) -> EvidenceProjectionResponse:
    """Build the evidence projection for a workflow run.

    ``include`` selects which optional sections to populate. Requesting an
    unknown include raises :class:`EvidenceUnsupportedIncludeError`.
    """

    projection, events = await _load_run(run_id, session=session)
    requested = list(include) if include else []
    if any(value not in _ALLOWED_INCLUDES for value in requested):
        unsupported = [v for v in requested if v not in _ALLOWED_INCLUDES]
        raise EvidenceUnsupportedIncludeError(
            f"Unsupported include values: {unsupported}"
        )

    include_set = set(requested)
    batches = _project_batches(projection, events)
    if node_id or source_group:
        batches = _filter_batches(batches, node_id=node_id, source_group=source_group)

    nodes = _project_node_states(projection, batches)
    artifacts = _project_artifacts(projection, events)
    missing_sources = (
        _project_missing_sources(projection, events) if "missingSources" in include_set else []
    )
    clusters = (
        _project_clusters(projection, events, batches) if "clusters" in include_set else []
    )
    summaries = (
        _project_summaries(projection, batches) if "summaries" in include_set else []
    )
    conflicts = (
        _project_conflicts(projection, events, batches) if "conflicts" in include_set else []
    )

    return EvidenceProjectionResponse(
        runId=run_id,
        status=projection.status,
        valid=projection.valid,
        nodes=nodes,
        clusters=clusters,
        missingSources=missing_sources,
        summaries=summaries,
        conflicts=conflicts,
        artifacts=artifacts,
        batches=batches,
    )


async def _load_run(
    run_id: str,
    *,
    session: AsyncSession | None,
) -> tuple[WorkflowRunProjection, list[WorkflowNodeRunEvent]]:
    projection = await get_workflow_run_projection(run_id, session=session)
    if projection is None:
        raise EvidenceRunNotFoundError(f"Workflow run {run_id} not found")
    events = await list_workflow_run_events(run_id, session=session)
    if events is None:
        raise EvidenceRunNotFoundError(f"Workflow run {run_id} not found")
    return projection, events


def _project_batches(
    projection: WorkflowRunProjection,
    events: list[WorkflowNodeRunEvent],
) -> list[EvidenceBatchSummary]:
    """Project batch summaries from the run projection and node events.

    Batches are deduplicated by ``batchId`` and ordered by first observation.
    The persisted run projection may already carry per-node batch refs in
    ``nodeStates.batches``; we merge those with any ``batch_ready`` events to
    capture both declarative and runtime-observed batches.
    """

    seen: dict[str, EvidenceBatchSummary] = {}
    ordered: list[str] = []

    for state in projection.nodeStates:
        for batch in state.batches:
            if batch.batchId in seen:
                continue
            seen[batch.batchId] = _summary_from_batch(
                batch, state.nodeId, state.packageNodeId, projection.runId
            )
            ordered.append(batch.batchId)

    for event in events:
        if event.eventType != "batch_ready" or event.batch is None:
            continue
        batch = event.batch
        if batch.batchId in seen:
            existing = seen[batch.batchId]
            updates: dict[str, Any] = {}
            if existing.sourceGroup is None and batch.sourceGroup:
                updates["sourceGroup"] = batch.sourceGroup
            if existing.adapterTaskId is None and batch.adapterTaskId:
                updates["adapterTaskId"] = batch.adapterTaskId
            if existing.traceId is None and event.traceId:
                updates["traceId"] = event.traceId
            if existing.packageNodeId is None and event.packageNodeId:
                updates["packageNodeId"] = event.packageNodeId
            if existing.internalNodeId is None and event.internalNodeId:
                updates["internalNodeId"] = event.internalNodeId
            if existing.manifestUri is None and batch.manifestUri:
                updates["manifestUri"] = batch.manifestUri
            if existing.odpRef is None and batch.odpRef:
                updates["odpRef"] = batch.odpRef
            if updates:
                seen[batch.batchId] = existing.model_copy(update=updates)
            continue
        seen[batch.batchId] = EvidenceBatchSummary(
            runId=event.workflowRunId,
            nodeId=event.nodeId,
            packageNodeId=event.packageNodeId,
            internalNodeId=event.internalNodeId,
            sourceGroup=batch.sourceGroup or event.sourceGroup,
            adapterTaskId=batch.adapterTaskId,
            traceId=event.traceId,
            batchId=batch.batchId,
            manifestUri=batch.manifestUri,
            odpRef=batch.odpRef,
            itemCount=batch.itemCount,
            recordCount=batch.recordCount,
            status=_batch_status(event.nodeId, projection, batch.batchId),
            createdAt=event.createdAt,
        )
        ordered.append(batch.batchId)

    return [seen[batch_id] for batch_id in ordered]


def _summary_from_batch(
    batch: WorkflowRunBatchReference,
    node_id: str,
    package_node_id: str | None,
    run_id: str,
) -> EvidenceBatchSummary:
    return EvidenceBatchSummary(
        runId=run_id,
        nodeId=node_id,
        packageNodeId=package_node_id,
        internalNodeId=None,
        sourceGroup=batch.sourceGroup,
        adapterTaskId=batch.adapterTaskId,
        traceId=None,
        batchId=batch.batchId,
        manifestUri=batch.manifestUri,
        odpRef=batch.odpRef,
        itemCount=batch.itemCount,
        recordCount=batch.recordCount,
        status="ready",
    )


def _batch_status(
    node_id: str,
    projection: WorkflowRunProjection,
    batch_id: str,
) -> str:
    state = next((state for state in projection.nodeStates if state.nodeId == node_id), None)
    if state is None:
        return "ready"
    if any(reason.code for reason in state.blockReasons):
        return "blocked"
    if state.status == "failed":
        return "failed"
    if state.status in {"completed"}:
        return "ingested"
    if state.status == "partial":
        return "partial"
    return "ready"


def _filter_batches(
    batches: list[EvidenceBatchSummary],
    *,
    node_id: str | None,
    source_group: str | None,
) -> list[EvidenceBatchSummary]:
    filtered = list(batches)
    if node_id:
        filtered = [batch for batch in filtered if batch.nodeId == node_id]
    if source_group:
        filtered = [batch for batch in filtered if batch.sourceGroup == source_group]
    return filtered


def _resolve_cursor(batches: list[EvidenceBatchSummary], cursor: str | None) -> int:
    if cursor is None:
        return 0
    for index, batch in enumerate(batches):
        if batch.batchId == cursor:
            return index + 1
    return 0


def _clamp_limit(limit: int | None) -> int:
    if limit is None or limit <= 0:
        return _DEFAULT_PAGE_SIZE
    return min(limit, _MAX_PAGE_SIZE)


def _source_coverage_for_batch(
    batch: EvidenceBatchSummary,
    projection: WorkflowRunProjection,
    events: list[WorkflowNodeRunEvent],
) -> list[EvidenceBatchSourceCoverage]:
    """Build a per-source coverage summary for a single batch.

    Coverage is derived from ``batch_ready`` events that share the batch id and
    the run projection node state.
    """

    coverage_by_group: dict[str, EvidenceBatchSourceCoverage] = {}
    site_by_group: dict[str, str | None] = {}
    command_by_group: dict[str, str | None] = {}
    for event in events:
        if event.eventType != "batch_ready" or event.batch is None:
            continue
        if event.batch.batchId != batch.batchId:
            continue
        group = batch.sourceGroup or event.sourceGroup
        if group is None:
            continue
        site, command = _extract_site_command(event)
        site_by_group[group] = site
        command_by_group[group] = command
        if group not in coverage_by_group:
            coverage_by_group[group] = EvidenceBatchSourceCoverage(
                sourceGroup=group,
                site=site,
                command=command,
                itemCount=event.batch.itemCount,
                recordCount=event.batch.recordCount,
                status=_batch_status(event.nodeId, projection, batch.batchId),
            )
        else:
            existing = coverage_by_group[group]
            coverage_by_group[group] = existing.model_copy(
                update={
                    "itemCount": existing.itemCount + event.batch.itemCount,
                    "recordCount": existing.recordCount + event.batch.recordCount,
                }
            )

    if not coverage_by_group and batch.sourceGroup:
        coverage_by_group[batch.sourceGroup] = EvidenceBatchSourceCoverage(
            sourceGroup=batch.sourceGroup,
            site=None,
            command=None,
            itemCount=batch.itemCount,
            recordCount=batch.recordCount,
            status=batch.status,
        )
    return list(coverage_by_group.values())


def _extract_site_command(event: WorkflowNodeRunEvent) -> tuple[str | None, str | None]:
    details = event.details if isinstance(event.details, dict) else {}
    site = details.get("site") if isinstance(details, dict) else None
    command = details.get("command") if isinstance(details, dict) else None
    if not site and isinstance(details.get("function_id"), str):
        site = None
    return _safe_string(site), _safe_string(command)


def _project_node_states(
    projection: WorkflowRunProjection,
    batches: list[EvidenceBatchSummary],
) -> list[EvidenceNodeProjection]:
    batch_by_node: dict[str, list[str]] = {}
    for batch in batches:
        batch_by_node.setdefault(batch.nodeId, []).append(batch.batchId)

    nodes: list[EvidenceNodeProjection] = []
    for state in projection.nodeStates:
        nodes.append(
            EvidenceNodeProjection(
                nodeId=state.nodeId,
                packageNodeId=state.packageNodeId,
                internalNodeId=state.internalNodeId,
                sourceGroup=state.sourceGroups[0] if state.sourceGroups else None,
                status=state.status,
                itemCount=sum(
                    batch.itemCount
                    for batch in batches
                    if batch.nodeId == state.nodeId
                ),
                batchRefs=batch_by_node.get(state.nodeId, []),
                blockReasons=[reason.code for reason in state.blockReasons if reason.code],
            )
        )
    return nodes


def _project_artifacts(
    projection: WorkflowRunProjection,
    events: list[WorkflowNodeRunEvent],
) -> list[EvidenceArtifactRef]:
    artifacts: list[EvidenceArtifactRef] = []
    seen: set[str] = set()
    for event in events:
        if not event.batch or not event.batch.manifestUri:
            continue
        if event.batch.manifestUri in seen:
            continue
        seen.add(event.batch.manifestUri)
        artifacts.append(
            EvidenceArtifactRef(
                kind="manifest",
                uri=event.batch.manifestUri,
                nodeId=event.nodeId,
                batchId=event.batch.batchId,
                label=event.batch.sourceGroup,
            )
        )
    if projection.traceId:
        artifacts.append(
            EvidenceArtifactRef(
                kind="trace",
                uri=f"/api/v1/workflows/runs/{projection.runId}/trace",
                label=projection.traceId,
            )
        )
    return artifacts


def _project_missing_sources(
    projection: WorkflowRunProjection,
    events: list[WorkflowNodeRunEvent],
) -> list[EvidenceMissingSource]:
    """Project missing-source descriptors from blocked node events."""

    reasons_by_node: dict[str, EvidenceMissingSource] = {}
    for state in projection.nodeStates:
        if not state.blockReasons:
            continue
        for reason in state.blockReasons:
            key = state.nodeId
            if key in reasons_by_node:
                continue
            reasons_by_node[key] = EvidenceMissingSource(
                nodeId=state.nodeId,
                packageNodeId=state.packageNodeId,
                internalNodeId=state.internalNodeId,
                sourceGroup=state.sourceGroups[0] if state.sourceGroups else None,
                reason=reason.message,
                code=reason.code,
                details=dict(reason.details or {}),
            )

    for event in events:
        if event.eventType not in {"blocked", "failed"} or event.blockReason is None:
            continue
        key = event.nodeId
        if key in reasons_by_node:
            continue
        reasons_by_node[key] = EvidenceMissingSource(
            nodeId=event.nodeId,
            packageNodeId=event.packageNodeId,
            internalNodeId=event.internalNodeId,
            sourceGroup=event.sourceGroup,
            reason=event.blockReason.message,
            code=event.blockReason.code,
            details=dict(event.blockReason.details or {}),
        )
    return list(reasons_by_node.values())


def _project_clusters(
    projection: WorkflowRunProjection,
    events: list[WorkflowNodeRunEvent],
    batches: list[EvidenceBatchSummary],
) -> list[EvidenceCluster]:
    """Project canonical-evidence clusters from accepted-record lineage.

    Clusters group records by ``sourceGroup`` to give consumers an inspectable
    summary that links back to the originating batch refs. They are projected
    deterministically and require no extra schema state.
    """

    by_source_group: dict[str, EvidenceCluster] = {}
    for state in projection.nodeStates:
        groups = list(state.sourceGroups or [])
        if not groups:
            for event in events:
                if event.nodeId == state.nodeId and event.sourceGroup:
                    groups.append(event.sourceGroup)
        for group in groups:
            if group in by_source_group:
                continue
            cluster_id = _stable_id("cluster", projection.runId, group)
            batch_refs = [batch.batchId for batch in batches if batch.sourceGroup == group]
            by_source_group[group] = EvidenceCluster(
                clusterId=cluster_id,
                label=group,
                sourceGroups=[group],
                batchRefs=batch_refs,
                status="ready" if state.status == "completed" else "partial",
            )
    return list(by_source_group.values())


def _project_summaries(
    projection: WorkflowRunProjection,
    batches: list[EvidenceBatchSummary],
) -> list[EvidenceAnswerSummary]:
    """Project run-level answer summaries derived from the projection state."""

    if projection.status not in {"completed", "partial"}:
        return []
    summary_id = _stable_id("summary", projection.runId, projection.status)
    total_items = sum(batch.itemCount for batch in batches)
    total_records = sum(batch.recordCount for batch in batches)
    batch_refs = [batch.batchId for batch in batches]
    return [
        EvidenceAnswerSummary(
            summaryId=summary_id,
            title=f"Workflow {projection.workflowId} projection summary",
            text=(
                f"Run {projection.runId} collected {total_items} items across "
                f"{len(batches)} batches ({total_records} records accepted)."
            ),
            clusterRefs=[],
            batchRefs=batch_refs,
            confidence=None,
            generatedAt=projection.updatedAt,
        )
    ]


def _project_conflicts(
    projection: WorkflowRunProjection,
    events: list[WorkflowNodeRunEvent],
    batches: list[EvidenceBatchSummary],
) -> list[EvidenceConflict]:
    """Project structural conflicts from blocked or failed nodes.

    Each blocked/failed node contributes a conflict descriptor so consumers can
    link missing sources and runtime blocks back to the originating batch
    references without losing provenance.
    """

    conflicts: list[EvidenceConflict] = []
    for state in projection.nodeStates:
        if state.status not in {"blocked", "failed"} or not state.blockReasons:
            continue
        for reason in state.blockReasons:
            conflict_id = _stable_id("conflict", projection.runId, state.nodeId, reason.code)
            batch_refs = [batch.batchId for batch in batches if batch.nodeId == state.nodeId]
            kind = (reason.details or {}).get("bindingId") if reason.details else None
            conflicts.append(
                EvidenceConflict(
                    conflictId=conflict_id,
                    kind=kind,
                    description=reason.message,
                    batchRefs=batch_refs,
                    clusterRefs=[],
                    details=dict(reason.details or {}),
                )
            )
    return conflicts


def _safe_string(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _stable_id(prefix: str, *parts: str) -> str:
    digest = hashlib.sha1("/".join((prefix, *parts)).encode("utf-8")).hexdigest()
    return f"{prefix}-{digest[:16]}"


__all__ = [
    "EvidenceBatchNotFoundError",
    "EvidenceRunNotFoundError",
    "EvidenceUnsupportedIncludeError",
    "build_run_projection",
    "get_evidence_batch",
    "list_evidence_batches",
]
