"""Canonical, runtime-aware Dify DSL import."""

from __future__ import annotations

import hashlib
import re
from copy import deepcopy
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import yaml

from backend.schemas.dify_compat import (
    DifyBlocker,
    DifyImportRequest,
    DifyImportResponse,
    DifyInspection,
    DifyTranslationReport,
)
from backend.schemas.workflow import (
    WorkflowAgentPermissions,
    WorkflowPackageInternals,
    WorkflowProject,
    WorkflowProjectEdge,
    WorkflowProjectNode,
    WorkflowSettings,
    WorkflowSourceAnchor,
)
from backend.workflow.dify_graphon_client import (
    DIFY_GRAPHON_COMMIT,
    DIFY_GRAPHON_CONTRACT_VERSION,
    DIFY_GRAPHON_NAME,
    DIFY_GRAPHON_VERSION,
    DifyGraphonClient,
)

DIFY_SOURCE_MAX_BYTES = 1_048_576
SUPPORTED_APP_MODES = frozenset({"workflow", "advanced-chat"})
SUPPORTED_NODE_TYPES = frozenset(
    {
        "start",
        "end",
        "answer",
        "llm",
        "agent",
        "if-else",
        "question-classifier",
        "iteration",
        "loop",
        "exit-loop",
        "code",
        "template-transform",
        "variable-aggregator",
        "variable-assigner",
        "assigner",
        "parameter-extractor",
        "document-extractor",
        "list-operator",
        "list-filter",
        "http-request",
        "tool",
        "knowledge-retrieval",
        "human-input",
    }
)


class DifyImportError(ValueError):
    def __init__(self, code: str, message: str, *, status_code: int = 422) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


async def import_dify_workflow(
    request: DifyImportRequest,
    *,
    graphon_client: DifyGraphonClient,
) -> DifyImportResponse:
    raw_size = len(request.source.encode("utf-8"))
    if raw_size > DIFY_SOURCE_MAX_BYTES:
        raise DifyImportError(
            "dify_source_too_large",
            "Dify DSL source exceeds the 1 MiB import limit.",
            status_code=413,
        )

    payload = _parse_source(request.source)
    app = _record(payload.get("app"))
    if payload.get("kind") != "app" or not isinstance(payload.get("workflow"), dict):
        raise DifyImportError(
            "dify_source_invalid",
            "Source is not a Dify application DSL document.",
        )

    app_mode = _non_empty_string(app.get("mode")) or ""
    if app_mode not in SUPPORTED_APP_MODES:
        raise DifyImportError(
            "dify_app_mode_unsupported",
            f'Dify app mode "{app_mode or "unknown"}" is not supported.',
        )

    sanitized_payload = _sanitize_embedded_secrets(payload)
    canonical_source = yaml.safe_dump(
        sanitized_payload,
        allow_unicode=True,
        sort_keys=True,
        default_flow_style=False,
    )
    source_sha256 = hashlib.sha256(canonical_source.encode("utf-8")).hexdigest()
    workflow_name = (
        request.name
        or _non_empty_string(_record(sanitized_payload.get("app")).get("name"))
        or "Dify Workflow Import"
    )

    inspection_value = await graphon_client.inspect(
        source_content=canonical_source,
        source_sha256=source_sha256,
        policy={"allowNetwork": False, "allowCode": False, "allowTools": False},
    )
    inspection = DifyInspection.model_validate(inspection_value)
    if (
        inspection.engine.name != DIFY_GRAPHON_NAME
        or inspection.engine.version != DIFY_GRAPHON_VERSION
        or inspection.engine.commit != DIFY_GRAPHON_COMMIT
    ):
        raise DifyImportError(
            "dify_graphon_unavailable",
            "The Graphon compatibility runtime does not match the pinned engine.",
            status_code=503,
        )
    if inspection.app_mode != app_mode:
        raise DifyImportError(
            "dify_graphon_unavailable",
            "The pinned Graphon runtime inspected a different Dify app mode.",
            status_code=503,
        )
    project, unknown_blockers = _build_project(
        sanitized_payload,
        workflow_name=workflow_name,
        app_mode=app_mode,
        source_content=canonical_source,
        source_sha256=source_sha256,
    )
    if unknown_blockers:
        inspection = inspection.model_copy(
            update={
                "load_status": "blocked",
                "blockers": [*inspection.blockers, *unknown_blockers],
            }
        )
    project = _with_inspection_snapshot(project, inspection)

    report = DifyTranslationReport(
        workflow_name=workflow_name,
        app_mode=app_mode,
        node_count=len(project.nodes[0].internals.nodes if project.nodes[0].internals else []),
        edge_count=len(project.nodes[0].internals.edges if project.nodes[0].internals else []),
        source_sha256=source_sha256,
        executable=inspection.load_status == "ready",
        blockers=inspection.blockers,
    )
    return DifyImportResponse(
        project=project,
        report=report,
        inspection=inspection,
        metadata={
            "sourceFormat": "dify-app-dsl",
            "contractVersion": DIFY_GRAPHON_CONTRACT_VERSION,
        },
    )


def _parse_source(source: str) -> dict[str, Any]:
    try:
        parsed = yaml.safe_load(source)
    except yaml.YAMLError as error:
        raise DifyImportError(
            "dify_source_invalid",
            "Dify DSL source is not valid YAML or JSON.",
        ) from error
    if not isinstance(parsed, dict):
        raise DifyImportError(
            "dify_source_invalid",
            "Dify DSL root must be an object.",
        )
    return parsed


def _with_inspection_snapshot(
    project: WorkflowProject,
    inspection: DifyInspection,
) -> WorkflowProject:
    package = project.nodes[0]
    params = deepcopy(package.params)
    compat_runtime = _record(params.get("compatRuntime"))
    params["compatRuntime"] = {
        **compat_runtime,
        "inspection": inspection.model_dump(mode="json", by_alias=True),
    }
    return project.model_copy(
        update={
            "nodes": [
                package.model_copy(update={"params": params}),
                *project.nodes[1:],
            ]
        }
    )


def _build_project(
    payload: dict[str, Any],
    *,
    workflow_name: str,
    app_mode: str,
    source_content: str,
    source_sha256: str,
) -> tuple[WorkflowProject, list[DifyBlocker]]:
    workflow = _record(payload.get("workflow"))
    graph = _record(workflow.get("graph"))
    raw_nodes = graph.get("nodes") if isinstance(graph.get("nodes"), list) else []
    raw_edges = graph.get("edges") if isinstance(graph.get("edges"), list) else []
    internal_nodes: list[WorkflowProjectNode] = []
    node_ids: set[str] = set()
    internal_node_ids: set[str] = set()
    internal_id_by_source_id: dict[str, str] = {}
    blockers: list[DifyBlocker] = []

    for index, raw_node in enumerate(raw_nodes):
        if not isinstance(raw_node, dict):
            continue
        source_node_id = _non_empty_string(raw_node.get("id")) or f"node-{index + 1}"
        if source_node_id in node_ids:
            raise DifyImportError(
                "dify_source_invalid",
                f'Dify DSL contains duplicate node id "{source_node_id}".',
            )
        node_ids.add(source_node_id)
        internal_node_id = _internal_node_id(source_node_id, used=internal_node_ids)
        internal_node_ids.add(internal_node_id)
        internal_id_by_source_id[source_node_id] = internal_node_id
        data = _record(raw_node.get("data"))
        node_type = _non_empty_string(data.get("type")) or "unknown"
        internal_nodes.append(
            _build_internal_node(
                internal_node_id,
                source_node_id=source_node_id,
                node_type=node_type,
                data=data,
                position=_record(raw_node.get("position")),
                index=index,
            )
        )
        if node_type not in SUPPORTED_NODE_TYPES:
            blockers.append(
                DifyBlocker(
                    code="dify_node_unsupported",
                    message=(
                        f'Dify node type "{node_type}" is not supported by the pinned runtime.'
                    ),
                    node_id=source_node_id,
                )
            )

    if not internal_nodes:
        raise DifyImportError(
            "dify_source_invalid",
            "Dify workflow graph must contain at least one node.",
        )

    internal_edges: list[WorkflowProjectEdge] = []
    for index, raw_edge in enumerate(raw_edges):
        if not isinstance(raw_edge, dict):
            continue
        source_id = _non_empty_string(raw_edge.get("source")) or ""
        target_id = _non_empty_string(raw_edge.get("target")) or ""
        if source_id not in node_ids or target_id not in node_ids:
            continue
        source = internal_id_by_source_id[source_id]
        target = internal_id_by_source_id[target_id]
        edge_id = _non_empty_string(raw_edge.get("id")) or f"edge-{index + 1}"
        internal_edges.append(
            WorkflowProjectEdge(
                id=edge_id,
                source=source,
                target=target,
                sourcePort=_non_empty_string(raw_edge.get("sourceHandle")),
                targetPort=_non_empty_string(raw_edge.get("targetHandle")),
                contractId="edge.contract.dify",
                proposalState="accepted",
                ui={"dify": {"source": "dify", "originalId": edge_id}},
            )
        )

    project_slug = _slugify(workflow_name)
    package_id = f"dify-package-{project_slug}"
    package = WorkflowProjectNode(
        id=package_id,
        kind="action",
        capability="store",
        params={
            "packageFormat": "dify",
            "packageExecution": "managed",
            "appMode": app_mode,
            "dslVersion": _non_empty_string(payload.get("version")),
            "compatRuntime": {
                "engine": "graphon",
                "contractVersion": DIFY_GRAPHON_CONTRACT_VERSION,
                "sourceFormat": "dify-app-dsl",
                "sourceSha256": source_sha256,
                "sourceContent": source_content,
                "engineVersion": DIFY_GRAPHON_VERSION,
                "engineCommit": DIFY_GRAPHON_COMMIT,
            },
        },
        internals=WorkflowPackageInternals(
            locked=True,
            nodes=internal_nodes,
            edges=internal_edges,
        ),
        ui={
            "label": workflow_name,
            "description": f"Dify managed workflow · {len(internal_nodes)} nodes",
            "icon": "Boxes",
            "color": "var(--chart-2)",
            "catalogId": "package.compat.dify-workflow",
            "package": {
                "format": "dify",
                "expandable": True,
                "nodeCount": len(internal_nodes),
                "edgeCount": len(internal_edges),
                "managed": True,
            },
        },
    )
    project = WorkflowProject(
        id=f"dify-{project_slug}",
        name=workflow_name,
        profile="intelligence",
        version=1,
        nodes=[package],
        edges=[],
        settings=WorkflowSettings(
            timezone=_non_empty_string(workflow.get("timezone")) or "Asia/Shanghai",
            deterministicSimulation=True,
            maxItemsPerRun=max(20, len(internal_nodes)),
        ),
        adapters=[],
        agentPermissions=WorkflowAgentPermissions(
            canFetchNetwork=False,
            canSendNotifications=False,
            canWriteInbox=True,
            canMutateExternalSites=False,
            allowedDomains=[],
        ),
    )
    return project, blockers


def _build_internal_node(
    internal_node_id: str,
    *,
    source_node_id: str,
    node_type: str,
    data: dict[str, Any],
    position: dict[str, Any],
    index: int,
) -> WorkflowProjectNode:
    kind, capability, catalog_id = _node_projection(node_type)
    title = _non_empty_string(data.get("title")) or f"Dify {node_type} {index + 1}"
    ui: dict[str, Any] = {
        "label": title,
        "description": _non_empty_string(data.get("desc")) or f"{node_type} from Dify import",
        "catalogId": catalog_id,
        "dify": {"source": "dify", "originalId": source_node_id, "type": node_type},
    }
    if isinstance(position.get("x"), (int, float)) and isinstance(
        position.get("y"), (int, float)
    ):
        ui["position"] = {"x": position["x"], "y": position["y"]}
    return WorkflowProjectNode(
        id=internal_node_id,
        kind=kind,
        capability=capability,
        params={
            "difyType": node_type,
            "title": title,
            "config": deepcopy(data),
            "compatRuntime": {
                "target": "dify",
                "nodeType": node_type,
                "sourceNodeId": source_node_id,
            },
            "blocked": node_type not in SUPPORTED_NODE_TYPES,
        },
        sourceAnchor=WorkflowSourceAnchor(
            kind="artifact",
            label=f"dify:{title}",
            artifactPath="dify-workflow.yml",
            selector=source_node_id,
        ),
        proposalState="accepted",
        ui=ui,
    )


def _node_projection(node_type: str) -> tuple[str, str, str]:
    if node_type not in SUPPORTED_NODE_TYPES:
        return "control", "accept", "compat.dify.unsupported"
    if node_type in {"start", "trigger", "trigger-webhook"}:
        return "schedule", "trigger", "compat.dify.start"
    if node_type in {"if-else", "question-classifier", "iteration", "loop", "exit-loop"}:
        return "router", "route", f"compat.dify.{node_type}"
    if node_type in {"llm", "agent"}:
        return "agent", "summarize", f"compat.dify.{node_type}"
    if node_type in {"knowledge-retrieval", "http-request", "tool"}:
        return "source", "fetch", f"compat.dify.{node_type}"
    if node_type in {"answer", "end"}:
        return "notify", "send", f"compat.dify.{node_type}"
    return "agent", "normalize", f"compat.dify.{node_type}"


def _sanitize_embedded_secrets(value: Any, *, key: str = "") -> Any:
    if _is_secret_key(key):
        return "[REDACTED]"
    if _is_header_container_key(key):
        return _sanitize_header_value(value)
    if isinstance(value, str) and key.lower().replace("-", "_").endswith("url"):
        return _sanitize_url_value(value)
    if isinstance(value, dict):
        descriptor = next(
            (
                item
                for item_key, item in value.items()
                if str(item_key).lower() in {"key", "name"}
                and isinstance(item, str)
                and _is_sensitive_descriptor_name(item)
            ),
            None,
        )
        sanitized: dict[str, Any] = {}
        for item_key, item in value.items():
            item_key_string = str(item_key)
            if descriptor is not None and item_key_string.lower() in {
                "value",
                "content",
                "default",
            }:
                sanitized[item_key_string] = "[REDACTED]"
            else:
                sanitized[item_key_string] = _sanitize_embedded_secrets(
                    item,
                    key=item_key_string,
                )
        return sanitized
    if isinstance(value, list):
        return [_sanitize_embedded_secrets(item) for item in value]
    return value


def _internal_node_id(source_node_id: str, *, used: set[str]) -> str:
    if "::" not in source_node_id and "__" not in source_node_id:
        base = source_node_id
    else:
        digest = hashlib.sha256(source_node_id.encode("utf-8")).hexdigest()[:16]
        base = f"dify-source-{digest}"
    candidate = base
    suffix = 2
    while candidate in used:
        candidate = f"{base}-{suffix}"
        suffix += 1
    return candidate


def _is_secret_key(key: str) -> bool:
    normalized = key.lower().replace("-", "_")
    if normalized.endswith("_id"):
        return False
    exact = {
        "api_key",
        "apikey",
        "authorization",
        "proxy_authorization",
        "password",
        "secret",
        "client_secret",
        "token",
        "access_token",
        "refresh_token",
        "credential",
        "credentials",
    }
    suffixes = ("_api_key", "_password", "_secret", "_access_token", "_refresh_token")
    return normalized in exact or normalized.endswith(suffixes)


def _is_header_container_key(key: str) -> bool:
    normalized = key.lower().replace("-", "_")
    return normalized in {
        "header",
        "headers",
        "http_header",
        "http_headers",
        "extra_headers",
    } or normalized.endswith(("_header", "_headers"))


def _is_sensitive_header_name(value: str) -> bool:
    normalized = value.strip().lower().replace("_", "-")
    return normalized in {
        "authorization",
        "proxy-authorization",
        "cookie",
        "set-cookie",
        "x-api-key",
        "api-key",
    }


def _is_sensitive_descriptor_name(value: str) -> bool:
    return _is_sensitive_header_name(value) or _is_secret_key(value)


def _sanitize_header_value(value: Any) -> Any:
    if isinstance(value, str):
        redacted = re.sub(
            r"(?i)(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key)"
            r"\s*[:=]\s*[^\r\n]*",
            lambda match: f"{match.group(1)}: [REDACTED]",
            value,
        )
        return re.sub(
            r"(?i)\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]+",
            lambda match: f"{match.group(1)} [REDACTED]",
            redacted,
        )
    if isinstance(value, dict):
        return _sanitize_embedded_secrets(value)
    if isinstance(value, list):
        return [_sanitize_embedded_secrets(item) for item in value]
    return value


def _sanitize_url_value(value: str) -> str:
    try:
        parsed = urlsplit(value)
    except ValueError:
        return value
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return value
    hostname = parsed.hostname or ""
    if ":" in hostname and not hostname.startswith("["):
        hostname = f"[{hostname}]"
    port = f":{parsed.port}" if parsed.port is not None else ""
    userinfo = "[REDACTED]@" if parsed.username is not None else ""
    query = urlencode(
        [
            (
                query_key,
                "[REDACTED]"
                if _is_secret_key(query_key)
                or _is_sensitive_header_name(query_key)
                else query_value,
            )
            for query_key, query_value in parse_qsl(
                parsed.query,
                keep_blank_values=True,
            )
        ]
    )
    return urlunsplit(
        (parsed.scheme, f"{userinfo}{hostname}{port}", parsed.path, query, parsed.fragment)
    )


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")[:64]
    if not slug:
        return "workflow"
    return f"d-{slug}" if slug[0].isdigit() else slug


def _record(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _non_empty_string(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None
