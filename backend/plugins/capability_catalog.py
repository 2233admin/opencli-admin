"""Backend-authoritative node capability catalog.

The catalog is deliberately independent from Canvas presentation. It provides
stable capability IDs for native, composed, plugin-provided, and Dify-compatible
nodes while keeping runtime readiness truthful.
"""

from __future__ import annotations

from collections import Counter
from typing import Any

from backend.schemas.plugin import (
    PluginInstallationRead,
    PluginNodeCapabilityRead,
    PluginNodeCatalogRead,
    PluginNodeCatalogSummaryRead,
    PluginNodeCategoryRead,
)
from backend.workflow.runtime_contracts import has_runtime_io_contract

CATEGORY_LABELS = {
    "input": "输入",
    "trigger": "触发器",
    "ai": "AI",
    "knowledge": "知识",
    "logic": "逻辑",
    "transform": "转换",
    "flow": "流程控制",
    "tool": "工具",
    "agent": "Agent",
    "human": "人工协作",
    "output": "输出",
    "plugin": "插件扩展",
    "compatibility": "兼容运行时",
}

NATIVE_BINDING_PREFIX = "workflow.native."

DIFY_NODE_TYPE_TO_CAPABILITY_ID = {
    "start": "primitive.core.start",
    "end": "primitive.core.end",
    "answer": "primitive.core.answer",
    "llm": "primitive.ai.llm",
    "knowledge-retrieval": "primitive.knowledge.retrieve",
    "knowledge-index": "primitive.knowledge.index",
    "if-else": "primitive.core.if",
    "code": "primitive.core.code",
    "template-transform": "primitive.core.template-transform",
    "question-classifier": "primitive.ai.question-classifier",
    "http-request": "primitive.integration.http-request",
    "tool": "external.tool.capability",
    "datasource": "primitive.plugin.datasource",
    "variable-aggregator": "primitive.core.variable-aggregate",
    "loop": "primitive.core.loop",
    "iteration": "primitive.core.iteration",
    "parameter-extractor": "primitive.ai.parameter-extract",
    "assigner": "primitive.core.variable-assign",
    # Dify's legacy name refers to the old variable aggregator node.
    "variable-assigner": "primitive.core.variable-aggregate",
    "document-extractor": "primitive.document.extract",
    "list-operator": "primitive.core.list-filter",
    "agent": "primitive.ai.agent",
    "trigger-webhook": "primitive.ops.trigger-webhook",
    "trigger-schedule": "intelligence.schedule.cron",
    "trigger-plugin": "primitive.plugin.trigger",
    "human-input": "primitive.human.approval",
}
OFFICIAL_DIFY_NODE_TYPES = frozenset(DIFY_NODE_TYPE_TO_CAPABILITY_ID) - {"variable-assigner"}


def build_plugin_node_catalog(
    installations: list[PluginInstallationRead] | None = None,
) -> PluginNodeCatalogRead:
    """Return one canonical node catalog, including installed plugin nodes."""

    resolved_installations = installations or []
    dify_runtime_ready = any(
        installation.id == "bundled:dify-graphon-runtime" and installation.runtime_status == "READY"
        for installation in resolved_installations
    )
    nodes = [
        *_builtin_nodes(dify_runtime_ready=dify_runtime_ready),
        *_installed_plugin_nodes(resolved_installations),
    ]
    nodes.sort(key=lambda item: (item.category, item.id))
    category_counts = Counter(item.category for item in nodes)
    readiness_counts = Counter(item.readiness for item in nodes)
    origin_counts = Counter(item.origin for item in nodes)
    return PluginNodeCatalogRead(
        nodes=nodes,
        categories=[
            PluginNodeCategoryRead(id=category, label=label, count=category_counts[category])
            for category, label in CATEGORY_LABELS.items()
            if category_counts[category]
        ],
        summary=PluginNodeCatalogSummaryRead(
            total=len(nodes),
            byReadiness=dict(sorted(readiness_counts.items())),
            byOrigin=dict(sorted(origin_counts.items())),
        ),
    )


def get_plugin_node_capability(
    capability_id: str,
    installations: list[PluginInstallationRead] | None = None,
) -> PluginNodeCapabilityRead | None:
    """Resolve one stable capability ID from the authoritative catalog."""

    return next(
        (
            node
            for node in build_plugin_node_catalog(installations).nodes
            if node.id == capability_id
        ),
        None,
    )


def resolve_dify_node_capability_id(node_type: str) -> str | None:
    """Translate a public Dify node type to its canonical capability ID."""

    return DIFY_NODE_TYPE_TO_CAPABILITY_ID.get(node_type)


def _builtin_nodes(*, dify_runtime_ready: bool = False) -> list[PluginNodeCapabilityRead]:
    return [
        _node(
            "primitive.core.start",
            "开始 / 用户输入",
            "input",
            "schedule",
            "trigger",
            "Play",
            "workflow",
            "backend.workflow.opencli_hda_tracer",
            outputs=[_port("out", "object")],
            params=[_param("variables", "输入变量", "object", default={})],
            dify=["start", "user-input"],
            readiness="composed",
            missing=["native_manual_input_binding"],
        ),
        _node(
            "primitive.core.end",
            "结束",
            "output",
            "sink",
            "store",
            "CircleStop",
            "workflow",
            "backend.workflow.opencli_hda_tracer",
            inputs=[_port("in", "any", True)],
            params=[_param("outputs", "输出映射", "object", default={})],
            dify=["end"],
            readiness="composed",
            missing=["native_end_binding"],
        ),
        _node(
            "primitive.core.answer",
            "回答",
            "output",
            "notify",
            "send",
            "MessageSquare",
            "workflow",
            "backend.workflow.capability_catalog",
            inputs=[_port("in", "any", True)],
            outputs=[_port("out", "text")],
            params=[_param("template", "回答模板", "text", True)],
            dify=["answer"],
            readiness="composed",
            missing=["answer_delivery_projection"],
        ),
        _node(
            "primitive.ai.llm",
            "LLM",
            "ai",
            "agent",
            "summarize",
            "BrainCircuit",
            "model-runtime",
            "backend.llm",
            inputs=[_port("in", "any")],
            outputs=[_port("text", "text")],
            params=[
                _param("model", "模型", "resource", True),
                _param("prompt", "提示词", "text", True),
                _param("temperature", "温度", "number", default=0.7),
            ],
            dify=["llm"],
            missing=["provider_resource_binding", "workflow_agent_executor"],
        ),
        _node(
            "primitive.knowledge.retrieve",
            "知识检索",
            "knowledge",
            "source",
            "fetch",
            "Search",
            "knowledge-runtime",
            "backend.workflow.capability_catalog",
            inputs=[_port("query", "text", True)],
            outputs=[_port("documents", "document[]")],
            params=[
                _param("knowledgeBase", "知识库", "resource", True),
                _param("topK", "返回条数", "integer", default=4),
            ],
            dify=["knowledge-retrieval"],
            missing=["knowledge_retrieval_binding"],
        ),
        _node(
            "primitive.knowledge.index",
            "知识索引",
            "knowledge",
            "action",
            "store",
            "DatabaseZap",
            "knowledge-runtime",
            "backend.workflow.capability_catalog",
            inputs=[_port("documents", "document[]", True)],
            outputs=[_port("indexed", "object")],
            params=[_param("knowledgeBase", "知识库", "resource", True)],
            dify=["knowledge-index"],
            missing=["knowledge_index_binding"],
        ),
        _node(
            "primitive.document.extract",
            "文档提取",
            "transform",
            "agent",
            "normalize",
            "FileSearch",
            "document-runtime",
            "backend.workflow.capability_catalog",
            inputs=[_port("file", "file", True)],
            outputs=[_port("text", "text")],
            params=[
                _param(
                    "parser", "解析器", "select", default="auto", options=["auto", "text", "ocr"]
                )
            ],
            dify=["document-extractor"],
            readiness="plugin_required",
            missing=["document_parser_provider"],
        ),
        _node(
            "primitive.ai.question-classifier",
            "问题分类器",
            "ai",
            "router",
            "route",
            "MessagesSquare",
            "model-runtime",
            "backend.workflow.capability_catalog",
            inputs=[_port("query", "text", True)],
            outputs=[_port("branch", "route")],
            params=[
                _param("model", "模型", "resource", True),
                _param("classes", "分类", "array", True, default=[]),
            ],
            dify=["question-classifier"],
            readiness="composed",
            missing=["llm_classifier_composition"],
        ),
        _native_node(
            "primitive.core.if",
            "条件分支",
            "logic",
            "router",
            "route",
            "GitBranch",
            inputs=[_port("in", "any", True)],
            outputs=[_port("true", "any"), _port("false", "any")],
            params=[_param("condition", "条件", "object", True)],
            dify=["if-else"],
        ),
        _native_node(
            "primitive.core.switch",
            "多路分支",
            "logic",
            "router",
            "route",
            "Split",
            inputs=[_port("in", "any", True)],
            outputs=[_port("out", "any")],
            params=[
                _param("cases", "分支规则", "array", True),
                _param("default", "默认分支", "string", default="default"),
            ],
            dify=["switch"],
        ),
        _node(
            "primitive.core.code",
            "代码",
            "transform",
            "agent",
            "normalize",
            "Code2",
            "workflow",
            "backend.workflow.capability_catalog",
            inputs=[_port("in", "any")],
            outputs=[_port("out", "any")],
            params=[
                _param(
                    "language",
                    "语言",
                    "select",
                    True,
                    default="python",
                    options=["python", "javascript"],
                ),
                _param("code", "代码", "code", True),
            ],
            dify=["code"],
            missing=["sandboxed_code_runtime"],
        ),
        _native_node(
            "primitive.core.template-transform",
            "模板转换",
            "transform",
            "agent",
            "normalize",
            "Braces",
            inputs=[_port("in", "any")],
            outputs=[_port("text", "text")],
            params=[
                _param("template", "模板", "text", True),
                _param("output_key", "输出字段", "string", default="text"),
            ],
            dify=["template-transform"],
        ),
        _native_node(
            "primitive.core.variable-assign",
            "变量赋值",
            "transform",
            "action",
            "store",
            "Variable",
            inputs=[_port("in", "any")],
            outputs=[_port("out", "object")],
            params=[_param("assignments", "变量赋值", "object", True)],
            dify=["assigner"],
        ),
        _native_node(
            "primitive.core.variable-aggregate",
            "变量聚合",
            "transform",
            "control",
            "route",
            "Combine",
            inputs=[_port("in", "any")],
            outputs=[_port("out", "array")],
            params=[
                _param("variables", "变量", "array", True),
                _param(
                    "strategy",
                    "聚合策略",
                    "select",
                    default="first_non_null",
                    options=["first_non_null", "list", "object"],
                ),
                _param("output_key", "输出字段", "string", default="value"),
            ],
            dify=["variable-aggregator", "variable-assigner"],
        ),
        _native_node(
            "primitive.core.list-filter",
            "列表过滤",
            "transform",
            "agent",
            "normalize",
            "ListFilter",
            inputs=[_port("items", "array", True)],
            outputs=[_port("items", "array")],
            params=[
                _param("field", "过滤字段", "string", default=""),
                _param(
                    "operator",
                    "操作符",
                    "select",
                    default="eq",
                    options=[
                        "eq",
                        "ne",
                        "gt",
                        "gte",
                        "lt",
                        "lte",
                        "contains",
                        "not_contains",
                        "in",
                        "exists",
                        "is_empty",
                    ],
                ),
                _param("value", "比较值", "any"),
            ],
            dify=["list-operator"],
        ),
        _native_node(
            "primitive.core.list-sort",
            "列表排序",
            "transform",
            "agent",
            "normalize",
            "ArrowDownAZ",
            inputs=[_port("items", "array", True)],
            outputs=[_port("items", "array")],
            params=[
                _param("field", "排序字段", "string", default=""),
                _param("direction", "顺序", "select", default="asc", options=["asc", "desc"]),
            ],
            dify=["list-operator:sort"],
        ),
        _native_node(
            "primitive.core.iteration",
            "迭代",
            "flow",
            "control",
            "route",
            "Repeat2",
            inputs=[_port("items", "array", True)],
            outputs=[_port("results", "array")],
            params=[_param("max_items", "最大条数", "integer", default=100)],
            dify=["iteration"],
        ),
        _native_node(
            "primitive.core.loop",
            "循环",
            "flow",
            "control",
            "route",
            "RefreshCw",
            inputs=[_port("in", "any")],
            outputs=[_port("out", "any")],
            params=[
                _param("condition", "继续条件", "object", True),
                _param("max_iterations", "最大次数", "integer", default=100),
            ],
            dify=["loop"],
        ),
        _node(
            "primitive.ai.parameter-extract",
            "参数提取器",
            "ai",
            "agent",
            "normalize",
            "ScanText",
            "model-runtime",
            "backend.workflow.capability_catalog",
            inputs=[_port("text", "text", True)],
            outputs=[_port("parameters", "object")],
            params=[
                _param("model", "模型", "resource", True),
                _param("schema", "参数 Schema", "object", True, default={}),
            ],
            dify=["parameter-extractor"],
            readiness="composed",
            missing=["llm_structured_output_composition"],
        ),
        _node(
            "primitive.integration.http-request",
            "HTTP 请求",
            "tool",
            "action",
            "fetch",
            "Globe2",
            "http-api",
            "backend.channels.api_channel",
            inputs=[_port("in", "any")],
            outputs=[_port("response", "httpResponse")],
            params=[
                _param("url", "URL", "string", True),
                _param(
                    "method",
                    "方法",
                    "select",
                    default="GET",
                    options=["GET", "POST", "PUT", "PATCH", "DELETE"],
                ),
                _param("headers", "请求头", "object", default={}),
                _param("body", "请求体", "any"),
            ],
            dify=["http-request"],
            readiness="plugin_required",
            missing=["http_tool_capability_registration"],
        ),
        _node(
            "external.tool.capability",
            "工具",
            "tool",
            "action",
            "send",
            "Wrench",
            "opencli-admin",
            "backend.workflow.tool_capabilities",
            binding="workflow.external-tool.capability",
            inputs=[_port("in", "unknown")],
            outputs=[_port("out", "unknown")],
            params=[_param("toolCapabilityId", "工具能力", "resource", True)],
            dify=["tool"],
            readiness="plugin_required",
            missing=["node_level_tool_capability_binding"],
        ),
        _node(
            "primitive.ai.agent",
            "Agent",
            "agent",
            "agent",
            "summarize",
            "Bot",
            "agent-runtime",
            "backend.agent_runtimes",
            inputs=[_port("in", "any")],
            outputs=[_port("out", "any")],
            params=[
                _param("strategy", "Agent 策略", "resource", True),
                _param("tools", "工具", "array", default=[]),
            ],
            dify=["agent"],
            readiness="plugin_required",
            missing=["agent_strategy_provider"],
        ),
        _node(
            "primitive.human.approval",
            "人工审批",
            "human",
            "inbox",
            "accept",
            "UserCheck",
            "workflow",
            "backend.control.gate",
            inputs=[_port("request", "object", True)],
            outputs=[_port("approved", "object"), _port("rejected", "object")],
            params=[_param("instructions", "审批说明", "text")],
            dify=["human-input"],
            readiness="composed",
            missing=["durable_human_work_item_binding"],
        ),
        _node(
            "intelligence.schedule.cron",
            "定时触发",
            "trigger",
            "schedule",
            "trigger",
            "Clock3",
            "workflow",
            "backend.workflow.runtime_registry",
            binding="workflow.trigger.schedule_tick",
            outputs=[_port("tick", "trigger")],
            params=[
                _param("interval", "Cron / 间隔", "string", True),
                _param("timezone", "时区", "string", default="Asia/Shanghai"),
            ],
            dify=["trigger-schedule"],
            readiness="runnable",
        ),
        _node(
            "primitive.ops.trigger-webhook",
            "Webhook 触发",
            "trigger",
            "schedule",
            "trigger",
            "Webhook",
            "workflow",
            "backend.workflow.runtime_registry",
            binding="workflow.trigger.webhook_input",
            outputs=[_port("request", "webhookRequest")],
            params=[_param("path", "路径", "string", True)],
            dify=["trigger-webhook"],
            readiness="composed",
            missing=["workflow_webhook_ingress"],
        ),
        _node(
            "primitive.plugin.trigger",
            "插件触发器",
            "plugin",
            "schedule",
            "trigger",
            "PlugZap",
            "plugin",
            "backend.services.plugin_registry_service",
            outputs=[_port("event", "object")],
            params=[_param("pluginCapabilityId", "插件能力", "resource", True)],
            dify=["trigger-plugin"],
            readiness="plugin_required",
            missing=["plugin_trigger_provider"],
        ),
        _node(
            "primitive.plugin.datasource",
            "插件数据源",
            "plugin",
            "source",
            "fetch",
            "Database",
            "plugin",
            "backend.services.plugin_registry_service",
            outputs=[_port("items", "items[]")],
            params=[_param("pluginCapabilityId", "插件能力", "resource", True)],
            dify=["datasource"],
            readiness="plugin_required",
            missing=["plugin_datasource_provider"],
        ),
        _node(
            "package.compat.dify-workflow",
            "Dify 工作流包",
            "compatibility",
            "action",
            "store",
            "Package",
            "opencli-admin/dify-graphon-runtime",
            "backend.workflow.dify_compile",
            binding="workflow.compat.dify.graphon",
            inputs=[_port("in", "any")],
            outputs=[_port("out", "any")],
            params=[_param("sourceSha256", "DSL 摘要", "string", True)],
            dify=["workflow", "chatflow"],
            readiness="runnable" if dify_runtime_ready else "blocked",
            missing=[] if dify_runtime_ready else ["dify_graphon_runtime_health"],
            origin="compatibility",
        ),
    ]


def _native_node(
    id: str,
    label: str,
    category: str,
    kind: str,
    capability: str,
    icon: str,
    *,
    inputs: list[dict[str, Any]] | None = None,
    outputs: list[dict[str, Any]] | None = None,
    params: list[dict[str, Any]] | None = None,
    dify: list[str] | None = None,
) -> PluginNodeCapabilityRead:
    slug = id.removeprefix("primitive.core.")
    binding = f"{NATIVE_BINDING_PREFIX}{slug}"
    runnable = has_runtime_io_contract(binding)
    return _node(
        id,
        label,
        category,
        kind,
        capability,
        icon,
        "workflow",
        "backend.workflow.native_primitives",
        binding=binding,
        inputs=inputs,
        outputs=outputs,
        params=params,
        dify=dify,
        readiness="runnable" if runnable else "blocked",
        missing=[] if runnable else ["runtime_binding"],
    )


def _node(
    id: str,
    label: str,
    category: str,
    kind: str,
    capability: str,
    icon: str,
    provider: str,
    source: str,
    *,
    binding: str | None = None,
    inputs: list[dict[str, Any]] | None = None,
    outputs: list[dict[str, Any]] | None = None,
    params: list[dict[str, Any]] | None = None,
    dify: list[str] | None = None,
    readiness: str = "blocked",
    missing: list[str] | None = None,
    origin: str = "native",
) -> PluginNodeCapabilityRead:
    if origin == "native" and readiness == "composed":
        origin = "composite"
    return PluginNodeCapabilityRead(
        id=id,
        label=label,
        description=f"{label} 的后端能力定义。",
        category=category,
        origin=origin,
        kind=kind,
        capability=capability,
        icon=icon,
        provider=provider,
        source=source,
        readiness=readiness,
        runtimeBinding=binding,
        inputPorts=inputs or [],
        outputPorts=outputs or [],
        parameters=params or [],
        difyNodeTypes=dify or [],
        missing=missing or [],
    )


def _port(name: str, type_: str, required: bool = False) -> dict[str, Any]:
    return {"name": name, "type": type_, "required": required}


def _param(
    name: str,
    label: str,
    type_: str,
    required: bool = False,
    *,
    default: Any = None,
    options: list[Any] | None = None,
) -> dict[str, Any]:
    return {
        "name": name,
        "label": label,
        "type": type_,
        "required": required,
        "default": default,
        "options": options or [],
    }


def _installed_plugin_nodes(
    installations: list[PluginInstallationRead],
) -> list[PluginNodeCapabilityRead]:
    nodes: list[PluginNodeCapabilityRead] = []
    for installation in installations:
        if installation.bundled:
            continue
        capabilities = {item.id: item for item in installation.capabilities}
        for definition in installation.node_definitions:
            declared = capabilities.get(definition.capability_id)
            family = declared.family if declared is not None else definition.family
            kind, capability, category = _plugin_workflow_shape(family)
            runtime_binding = declared.runtime_adapter_id if declared is not None else None
            runnable = definition.status == "READY" and runtime_binding is not None
            nodes.append(
                _node(
                    definition.id,
                    definition.label,
                    category,
                    kind,
                    capability,
                    "Puzzle",
                    installation.provider_key,
                    f"plugin:{installation.id}",
                    binding=runtime_binding,
                    inputs=[_port("in", "unknown")],
                    outputs=[_port("out", "unknown")],
                    params=[_param("config", "配置", "object", default={})],
                    dify=[family],
                    readiness="runnable" if runnable else "plugin_required",
                    missing=[] if runnable else ["compatible_runtime_adapter"],
                    origin="plugin",
                )
            )
    return nodes


def _plugin_workflow_shape(family: str) -> tuple[str, str, str]:
    if family == "datasource":
        return "source", "fetch", "plugin"
    if family == "trigger":
        return "schedule", "trigger", "plugin"
    if family in {"model", "agent_strategy"}:
        return "agent", "summarize", "plugin"
    if family == "endpoint":
        return "action", "send", "plugin"
    return "action", "store", "plugin"


__all__ = [
    "CATEGORY_LABELS",
    "DIFY_NODE_TYPE_TO_CAPABILITY_ID",
    "NATIVE_BINDING_PREFIX",
    "OFFICIAL_DIFY_NODE_TYPES",
    "build_plugin_node_catalog",
    "get_plugin_node_capability",
    "resolve_dify_node_capability_id",
]
