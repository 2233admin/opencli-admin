"""Assemble collection needs into reviewable WorkflowProject patches."""

from __future__ import annotations

import re
from typing import Any

from backend.schemas.workflow import (
    WorkflowAdapterBinding,
    WorkflowDemandDraftRequest,
    WorkflowPatchOperation,
    WorkflowPatchResponse,
    WorkflowProject,
    WorkflowProjectEdge,
    WorkflowProjectNode,
)
from backend.workflow.patcher import preview_workflow_patch


def draft_workflow_demand(body: WorkflowDemandDraftRequest) -> WorkflowPatchResponse:
    """Translate a user collection need into reviewable native-node patches.

    This is intentionally deterministic and conservative. It never emits raw
    executors or OpenCLI payloads; it only assembles packaged OpenCLI Admin
    capabilities that the Canvas can review before materialization.
    """

    sources = _source_slots_for_need(body.text)
    if not sources:
        return preview_workflow_patch(
            body.project,
            [
                WorkflowPatchOperation(
                    op="request_missing_capability",
                    capability="collection.source.intent_mapping",
                    reason=(
                        "No existing Canvas source capability matched this collection need. "
                        "Add a real source/channel mapping before assembling runnable nodes."
                    ),
                )
            ],
        )

    operations = _native_first_loop_operations(body.project, sources, body.text, body.locale)
    return preview_workflow_patch(body.project, operations)


def _native_first_loop_operations(
    project: WorkflowProject,
    sources: list[dict[str, Any]],
    demand_text: str,
    locale: str | None,
) -> list[WorkflowPatchOperation]:
    operations: list[WorkflowPatchOperation] = []
    used_node_ids = {node.id for node in project.nodes}
    used_edge_ids = {edge.id for edge in project.edges}
    used_adapter_ids = {adapter.id for adapter in project.adapters}
    normalize_ids: list[str] = []

    for index, source in enumerate(sources):
        source_slug = _read_string(source.get("id")) or f"source-{index + 1}"
        adapter_id = _unique_id(used_adapter_ids, f"opencli-{source_slug}")
        if adapter_id not in {adapter.id for adapter in project.adapters}:
            operations.append(
                WorkflowPatchOperation(
                    op="add_adapter",
                    adapter=WorkflowAdapterBinding(
                        id=adapter_id,
                        type="source",
                        provider="opencli",
                        mode="live",
                        config={"channel": "opencli"},
                    ),
                )
            )

        source_id = _unique_id(used_node_ids, f"source-{source_slug}")
        normalize_id = _unique_id(used_node_ids, f"normalize-{source_slug}")
        normalize_ids.append(normalize_id)
        operations.extend(
            [
                WorkflowPatchOperation(
                    op="add_node",
                    node=WorkflowProjectNode(
                        id=source_id,
                        kind="source",
                        capability="fetch",
                        adapter=adapter_id,
                        params={
                            "site": source["site"],
                            "command": source["command"],
                            "args": source.get("args", {}),
                            "sourceGroup": source.get("sourceGroup"),
                            "demand": {
                                "text": demand_text,
                                "locale": locale,
                                "source": "ai_plan_draft",
                            },
                        },
                        ui={
                            "catalogId": "intelligence.source.opencli-slot",
                            "label": source.get("label", source_slug),
                            "position": {"x": 180, "y": 180 + index * 120},
                        },
                    ),
                ),
                WorkflowPatchOperation(
                    op="add_node",
                    node=WorkflowProjectNode(
                        id=normalize_id,
                        kind="agent",
                        capability="normalize",
                        params={"language": locale or "zh-CN", "preserveSourceRefs": True},
                        ui={
                            "catalogId": "intelligence.processing.normalize",
                            "label": "Normalize",
                            "position": {"x": 440, "y": 180 + index * 120},
                        },
                    ),
                ),
                WorkflowPatchOperation(
                    op="connect_nodes",
                    edge=WorkflowProjectEdge(
                        id=_unique_id(used_edge_ids, f"e-{source_id}-{normalize_id}"),
                        source=source_id,
                        target=normalize_id,
                        sourcePort="out",
                        targetPort="in",
                    ),
                ),
            ]
        )

    merge_id = _unique_id(used_node_ids, "merge-candidates")
    accept_id = _unique_id(used_node_ids, "accept-records")
    sink_id = _unique_id(used_node_ids, "record-sink")
    operations.extend(
        [
            WorkflowPatchOperation(
                op="add_node",
                node=WorkflowProjectNode(
                    id=merge_id,
                    kind="flow",
                    capability="merge",
                    params={
                        "strategy": "concat",
                        "preserveLineage": True,
                        "inputType": "recordCandidate[]",
                        "outputType": "recordCandidate[]",
                    },
                    ui={
                        "catalogId": "intelligence.flow.merge",
                        "label": "Merge Candidates",
                        "position": {"x": 700, "y": 240},
                    },
                ),
            ),
            WorkflowPatchOperation(
                op="add_node",
                node=WorkflowProjectNode(
                    id=accept_id,
                    kind="control",
                    capability="accept",
                    params={
                        "mode": "automatic_with_review",
                        "schema": "record.v1",
                        "dedupe": "required",
                        "lineageRequired": True,
                        "minQuality": 0,
                    },
                    ui={
                        "catalogId": "intelligence.control.record-acceptance",
                        "label": "Record Acceptance",
                        "position": {"x": 960, "y": 240},
                    },
                ),
            ),
            WorkflowPatchOperation(
                op="add_node",
                node=WorkflowProjectNode(
                    id=sink_id,
                    kind="sink",
                    capability="store",
                    params={
                        "target": "records",
                        "writeMode": "append",
                        "preserveLineage": True,
                    },
                    ui={
                        "catalogId": "intelligence.sink.records",
                        "label": "Records",
                        "position": {"x": 1220, "y": 240},
                    },
                ),
            ),
        ]
    )
    for index, normalize_id in enumerate(normalize_ids, start=1):
        operations.append(
            WorkflowPatchOperation(
                op="connect_nodes",
                edge=WorkflowProjectEdge(
                    id=_unique_id(used_edge_ids, f"e-{normalize_id}-{merge_id}"),
                    source=normalize_id,
                    target=merge_id,
                    sourcePort="out",
                    targetPort=f"in{index}",
                ),
            )
        )
    operations.extend(
        [
            WorkflowPatchOperation(
                op="connect_nodes",
                edge=WorkflowProjectEdge(
                    id=_unique_id(used_edge_ids, f"e-{merge_id}-{accept_id}"),
                    source=merge_id,
                    target=accept_id,
                    sourcePort="out",
                    targetPort="candidates",
                ),
            ),
            WorkflowPatchOperation(
                op="connect_nodes",
                edge=WorkflowProjectEdge(
                    id=_unique_id(used_edge_ids, f"e-{accept_id}-{sink_id}"),
                    source=accept_id,
                    target=sink_id,
                    sourcePort="records",
                    targetPort="records",
                ),
            ),
        ]
    )
    return operations


def _source_slots_for_need(text: str) -> list[dict[str, Any]]:
    normalized = text.lower()
    slots: list[dict[str, Any]] = []
    keyword = _keyword_from_need(text)

    if any(token in normalized for token in ("小红书", "xiaohongshu", "xhs")):
        slots.append(
            {
                "id": "xiaohongshu",
                "label": "Xiaohongshu Search",
                "sourceGroup": "social",
                "site": "xiaohongshu",
                "command": "search",
                "args": {"keyword": keyword},
                "resourceTags": ["browser-session:xiaohongshu"],
            }
        )

    if any(token in normalized for token in ("哔哩", "bilibili", "b站", "bili")):
        slots.append(
            {
                "id": "bilibili",
                "label": "Bilibili Search",
                "sourceGroup": "video",
                "site": "bilibili",
                "command": "search",
                "args": {"keyword": keyword},
                "resourceTags": ["browser-session:bilibili"],
            }
        )

    return slots


def _keyword_from_need(text: str) -> str:
    value = text.strip()
    for pattern in (
        r"^(抓|采集|收集|监控|找|看)\s*",
        r"(小红书|xiaohongshu|xhs|哔哩哔哩|哔哩|bilibili|b站|bili)",
        r"(热帖|热门帖子|热门内容|hot posts?)",
    ):
        value = re.sub(pattern, " ", value, flags=re.IGNORECASE)
    value = re.sub(r"\s+", " ", value).strip(" ，,。")
    return value or "热门"


def _unique_node_id(project: WorkflowProject, base: str) -> str:
    return _unique_id({node.id for node in project.nodes}, base)


def _unique_id(used: set[str], base: str) -> str:
    candidate = base
    suffix = 2
    while candidate in used:
        candidate = f"{base}-{suffix}"
        suffix += 1
    used.add(candidate)
    return candidate


def _read_string(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None
