"""Project-scoped, server-aggregated record graph previews.

This module is the single query and aggregation seam for the graph UI. Callers
request a bounded preview; they never need to understand workflow ownership,
sampling, semantic hubs, or the indexed SQL needed to keep large projects fast.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections import defaultdict
from collections.abc import Iterable
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlparse

from sqlalchemy import distinct, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.record import CollectedRecord
from backend.models.source import DataSource
from backend.models.studio import StudioProject, StudioWorkflow
from backend.schemas.record_graph import (
    ProjectRecordGraphPreview,
    RecordGraphEdge,
    RecordGraphNode,
    RecordGraphStats,
)

_UUID_PATTERN = re.compile(
    r"\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b",
    re.IGNORECASE,
)
_URL_PATTERN = re.compile(r"https?://[^\s\"'<>]+", re.IGNORECASE)
_ENTITY_LABEL = {"author": "作者", "domain": "域名", "tag": "标签"}
_EDGE_LABEL = {
    "contains": "项目归属",
    "produced": "工作流产出",
    "origin": "采集来源",
    "semantic": "语义双链",
    "reference": "显式引用",
    "batch": "同一采集批次",
    "duplicate": "相同内容",
}


def _read_string(value: object) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _payload(record: CollectedRecord) -> dict[str, Any]:
    return record.normalized_data or record.raw_data or {}


def _record_title(record: CollectedRecord) -> str:
    payload = _payload(record)
    for key in ("title", "name", "text", "content", "url"):
        candidate = _read_string(payload.get(key))
        if candidate:
            return candidate[:160]
    return f"记录 {record.id[:8]}"


def _record_preview(record: CollectedRecord) -> str | None:
    payload = _payload(record)
    for key in ("summary", "content", "text", "description", "title"):
        candidate = _read_string(payload.get(key))
        if candidate:
            return candidate[:320]
    return None


def _record_url(record: CollectedRecord) -> str | None:
    return _read_string(_payload(record).get("url")) or _read_string(
        (record.raw_data or {}).get("url")
    )


def _record_domain(record: CollectedRecord) -> str | None:
    url = _record_url(record)
    if not url:
        return None
    try:
        return urlparse(url).hostname.removeprefix("www.").lower()
    except (AttributeError, ValueError):
        return None


def _collect_terms(value: object, target: set[str]) -> None:
    if isinstance(value, str):
        term = value.strip().lower()
        if 1 < len(term) <= 80:
            target.add(term)
        return
    if isinstance(value, list):
        for item in value[:24]:
            _collect_terms(item, target)
        return
    if not isinstance(value, dict):
        return
    for key in ("name", "label", "text", "value"):
        _collect_terms(value.get(key), target)


def _record_entities(record: CollectedRecord) -> set[tuple[str, str]]:
    entities: set[tuple[str, str]] = set()
    payload = _payload(record)
    author = _read_string(payload.get("author")) or _read_string(
        (record.raw_data or {}).get("author")
    )
    domain = _record_domain(record)
    if author:
        entities.add(("author", author.lower()))
    if domain:
        entities.add(("domain", domain))

    terms: set[str] = set()
    for source in (record.ai_enrichment or {}, record.normalized_data or {}):
        for key in ("tags", "topics", "entities", "keywords", "categories"):
            _collect_terms(source.get(key), terms)
    entities.update(("tag", term) for term in terms)
    return entities


def _entity_node_id(kind: str, value: str) -> str:
    digest = hashlib.sha1(f"{kind}:{value}".encode()).hexdigest()[:16]
    return f"entity:{kind}:{digest}"


def _serialize_record(record: CollectedRecord) -> str:
    try:
        return json.dumps(
            {
                "raw": record.raw_data,
                "normalized": record.normalized_data,
                "enrichment": record.ai_enrichment,
            },
            ensure_ascii=False,
            default=str,
        )
    except (TypeError, ValueError):
        return ""


def _add_edge(
    edges: list[RecordGraphEdge],
    seen: set[tuple[str, str, str]],
    source: str,
    target: str,
    kind: str,
    *,
    weight: int = 1,
) -> None:
    if not source or not target or source == target:
        return
    left, right = sorted((source, target))
    key = (left, right, kind)
    if key in seen:
        return
    seen.add(key)
    edges.append(
        RecordGraphEdge(
            id=f"{kind}:{len(edges)}:{left}:{right}",
            source=source,
            target=target,
            kind=kind,
            label=_EDGE_LABEL[kind],
            weight=max(1, weight),
        )
    )


def _add_star_edges(
    groups: Iterable[list[str]],
    edges: list[RecordGraphEdge],
    seen: set[tuple[str, str, str]],
    kind: str,
) -> None:
    for ids in groups:
        unique = list(dict.fromkeys(ids))
        if len(unique) < 2:
            continue
        anchor = unique[0]
        for target in unique[1:]:
            _add_edge(edges, seen, anchor, target, kind)


async def build_project_record_graph_preview(
    session: AsyncSession,
    *,
    workspace_id: str,
    project_id: str,
    max_nodes: int = 700,
) -> ProjectRecordGraphPreview | None:
    """Return a bounded graph preview for one project, or ``None`` if absent."""

    project = await session.scalar(
        select(StudioProject).where(
            StudioProject.id == project_id,
            StudioProject.workspace_id == workspace_id,
            StudioProject.archived.is_(False),
        )
    )
    if project is None:
        return None

    workflows = list(
        (
            await session.execute(
                select(StudioWorkflow).where(
                    StudioWorkflow.project_id == project_id,
                    StudioWorkflow.archived.is_(False),
                )
            )
        )
        .scalars()
        .all()
    )
    workflow_ids = [workflow.id for workflow in workflows]
    project_node_id = f"project:{project.id}"

    if not workflow_ids:
        node = RecordGraphNode(
            id=project_node_id,
            kind="project",
            label=project.name,
            subtitle="项目",
            count=0,
        )
        return ProjectRecordGraphPreview(
            workspace_id=workspace_id,
            project_id=project_id,
            project_name=project.name,
            truncated=False,
            max_nodes=max_nodes,
            nodes=[node],
            edges=[],
            stats=RecordGraphStats(
                total_records=0,
                sampled_records=0,
                hidden_records=0,
                total_sources=0,
                total_workflows=0,
                total_runs=0,
                visible_nodes=1,
                visible_edges=0,
            ),
            generated_at=datetime.now(UTC),
        )

    scope = CollectedRecord.workflow_id.in_(workflow_ids)
    total_records, total_sources, total_runs = (
        await session.execute(
            select(
                func.count(CollectedRecord.id),
                func.count(distinct(CollectedRecord.source_id)),
                func.count(distinct(CollectedRecord.workflow_run_id)),
            ).where(scope)
        )
    ).one()
    total_records = int(total_records or 0)
    total_sources = int(total_sources or 0)
    total_runs = int(total_runs or 0)

    workflow_counts = {
        str(workflow_id): int(count)
        for workflow_id, count in (
            await session.execute(
                select(CollectedRecord.workflow_id, func.count(CollectedRecord.id))
                .where(scope)
                .group_by(CollectedRecord.workflow_id)
            )
        ).all()
        if workflow_id
    }

    workflow_limit = min(24, max(4, max_nodes // 18))
    visible_workflows = sorted(
        workflows,
        key=lambda workflow: (
            workflow.id != project.primary_workflow_id,
            -workflow_counts.get(workflow.id, 0),
            workflow.name,
        ),
    )[:workflow_limit]
    source_limit = min(48, max(6, max_nodes // 14))
    source_rows = (
        await session.execute(
            select(
                CollectedRecord.source_id,
                CollectedRecord.workflow_id,
                DataSource.name,
                DataSource.channel_type,
                func.count(CollectedRecord.id).label("record_count"),
            )
            .outerjoin(DataSource, DataSource.id == CollectedRecord.source_id)
            .where(scope)
            .group_by(
                CollectedRecord.source_id,
                CollectedRecord.workflow_id,
                DataSource.name,
                DataSource.channel_type,
            )
            .order_by(func.count(CollectedRecord.id).desc())
            .limit(source_limit)
        )
    ).all()

    run_limit = min(36, max(4, max_nodes // 18))
    run_rows = (
        await session.execute(
            select(
                CollectedRecord.workflow_run_id,
                CollectedRecord.workflow_id,
                func.count(CollectedRecord.id).label("record_count"),
                func.max(CollectedRecord.created_at).label("last_seen"),
            )
            .where(scope, CollectedRecord.workflow_run_id.is_not(None))
            .group_by(CollectedRecord.workflow_run_id, CollectedRecord.workflow_id)
            .order_by(func.count(CollectedRecord.id).desc())
            .limit(run_limit)
        )
    ).all()

    entity_budget = min(96, max(16, max_nodes // 5))
    structural_budget = 1 + len(visible_workflows) + len(source_rows) + len(run_rows)
    sample_limit = min(1000, max(0, max_nodes - structural_budget - entity_budget))
    records = list(
        (
            await session.execute(
                select(CollectedRecord)
                .where(scope)
                .order_by(CollectedRecord.created_at.desc())
                .limit(sample_limit)
            )
        )
        .scalars()
        .all()
    )

    nodes: list[RecordGraphNode] = [
        RecordGraphNode(
            id=project_node_id,
            kind="project",
            label=project.name,
            subtitle="项目预览",
            count=total_records,
        )
    ]
    node_ids = {project_node_id}
    edges: list[RecordGraphEdge] = []
    seen_edges: set[tuple[str, str, str]] = set()

    for workflow in visible_workflows:
        workflow_node_id = f"workflow:{workflow.id}"
        nodes.append(
            RecordGraphNode(
                id=workflow_node_id,
                kind="workflow",
                label=workflow.name,
                subtitle="主工作流" if workflow.id == project.primary_workflow_id else "工作流",
                count=workflow_counts.get(workflow.id, 0),
                workflow_id=workflow.id,
            )
        )
        node_ids.add(workflow_node_id)
        _add_edge(
            edges,
            seen_edges,
            project_node_id,
            workflow_node_id,
            "contains",
            weight=workflow_counts.get(workflow.id, 0),
        )

    for source_id, workflow_id, name, channel_type, count in source_rows:
        source_node_id = f"source:{source_id}"
        if source_node_id not in node_ids:
            nodes.append(
                RecordGraphNode(
                    id=source_node_id,
                    kind="source",
                    label=name or f"数据源 {str(source_id)[:8]}",
                    subtitle=channel_type or "数据源",
                    count=int(count),
                    source_id=str(source_id),
                    workflow_id=str(workflow_id) if workflow_id else None,
                )
            )
            node_ids.add(source_node_id)
        workflow_node_id = f"workflow:{workflow_id}"
        _add_edge(
            edges,
            seen_edges,
            workflow_node_id if workflow_node_id in node_ids else project_node_id,
            source_node_id,
            "produced",
            weight=int(count),
        )

    for run_id, workflow_id, count, last_seen in run_rows:
        run_node_id = f"run:{run_id}"
        nodes.append(
            RecordGraphNode(
                id=run_node_id,
                kind="run",
                label=f"运行 {str(run_id)[:8]}",
                subtitle="采集运行",
                count=int(count),
                workflow_id=str(workflow_id) if workflow_id else None,
                workflow_run_id=str(run_id),
                created_at=last_seen,
            )
        )
        node_ids.add(run_node_id)
        workflow_node_id = f"workflow:{workflow_id}"
        _add_edge(
            edges,
            seen_edges,
            workflow_node_id if workflow_node_id in node_ids else project_node_id,
            run_node_id,
            "produced",
            weight=int(count),
        )

    entity_members: dict[tuple[str, str], list[str]] = defaultdict(list)
    task_groups: dict[str, list[str]] = defaultdict(list)
    content_groups: dict[str, list[str]] = defaultdict(list)
    known_record_ids: dict[str, str] = {}
    known_urls: dict[str, str] = {}

    for record in records:
        record_node_id = f"record:{record.id}"
        url = _record_url(record)
        nodes.append(
            RecordGraphNode(
                id=record_node_id,
                kind="record",
                label=_record_title(record),
                subtitle=_record_domain(record) or record.status,
                record_id=record.id,
                source_id=record.source_id,
                workflow_id=record.workflow_id,
                workflow_run_id=record.workflow_run_id,
                url=url,
                preview=_record_preview(record),
                status=record.status,
                created_at=record.created_at,
            )
        )
        node_ids.add(record_node_id)
        known_record_ids[record.id.lower()] = record_node_id
        if url:
            known_urls[url.lower().rstrip("/")] = record_node_id
        task_groups[record.task_id].append(record_node_id)
        content_groups[record.content_hash].append(record_node_id)
        for entity in _record_entities(record):
            entity_members[entity].append(record_node_id)

        source_node_id = f"source:{record.source_id}"
        run_node_id = (
            f"run:{record.workflow_run_id}" if record.workflow_run_id else ""
        )
        workflow_node_id = f"workflow:{record.workflow_id}"
        if source_node_id in node_ids:
            _add_edge(edges, seen_edges, source_node_id, record_node_id, "origin")
        if run_node_id in node_ids:
            _add_edge(edges, seen_edges, run_node_id, record_node_id, "produced")
        if source_node_id not in node_ids and run_node_id not in node_ids:
            _add_edge(
                edges,
                seen_edges,
                workflow_node_id if workflow_node_id in node_ids else project_node_id,
                record_node_id,
                "produced",
            )

    ranked_entities = sorted(
        (
            (entity, members)
            for entity, members in entity_members.items()
            if len(set(members)) >= 2
        ),
        key=lambda item: (-len(set(item[1])), item[0][0], item[0][1]),
    )[:entity_budget]
    for (kind, value), members in ranked_entities:
        entity_node_id = _entity_node_id(kind, value)
        nodes.append(
            RecordGraphNode(
                id=entity_node_id,
                kind="entity",
                label=value,
                subtitle=_ENTITY_LABEL[kind],
                count=len(set(members)),
            )
        )
        node_ids.add(entity_node_id)
        for record_node_id in dict.fromkeys(members):
            _add_edge(edges, seen_edges, record_node_id, entity_node_id, "semantic")

    _add_star_edges(task_groups.values(), edges, seen_edges, "batch")
    _add_star_edges(content_groups.values(), edges, seen_edges, "duplicate")

    for record in records:
        source_node_id = f"record:{record.id}"
        text = _serialize_record(record)
        for referenced_id in _UUID_PATTERN.findall(text):
            target_node_id = known_record_ids.get(referenced_id.lower())
            if target_node_id:
                _add_edge(edges, seen_edges, source_node_id, target_node_id, "reference")
        for referenced_url in _URL_PATTERN.findall(text):
            normalized_url = referenced_url.rstrip(".,);]}/").lower()
            target_node_id = known_urls.get(normalized_url)
            if target_node_id:
                _add_edge(edges, seen_edges, source_node_id, target_node_id, "reference")

    max_edges = max_nodes * 6
    if len(edges) > max_edges:
        edges = edges[:max_edges]

    sampled_records = len(records)
    stats = RecordGraphStats(
        total_records=total_records,
        sampled_records=sampled_records,
        hidden_records=max(0, total_records - sampled_records),
        total_sources=total_sources,
        total_workflows=len(workflows),
        total_runs=total_runs,
        visible_nodes=len(nodes),
        visible_edges=len(edges),
    )
    return ProjectRecordGraphPreview(
        workspace_id=workspace_id,
        project_id=project_id,
        project_name=project.name,
        truncated=sampled_records < total_records,
        max_nodes=max_nodes,
        nodes=nodes,
        edges=edges,
        stats=stats,
        generated_at=datetime.now(UTC),
    )
