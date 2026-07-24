import type { WorkflowCapability, WorkflowNodeKind } from "./schema"

export const DIFY_NODE_MAPPING_VERSION = "opencli.dify.node-mapping.v2" as const

export type DifyNodeRuntimeStatus = "blocked" | "preview_only" | "design_only"

export type DifyNodeMapping = {
  id: string
  family: string
  kind: WorkflowNodeKind
  capability: WorkflowCapability
  icon: string
  color: string
  runtimeStatus: DifyNodeRuntimeStatus
  runtimeReason: string
  missing: string[]
}

type MappingDefinition = DifyNodeMapping & { aliases: readonly string[] }

const CONTROL_PLANE_ONLY = "Imported faithfully, but an OpenCLI runtime contract is not registered for this Dify node family yet."
const EXTERNAL_RUNTIME_REQUIRED = "Imported faithfully and blocked until its provider, credentials, and runtime adapter are bound in OpenCLI."

const DEFINITIONS: readonly MappingDefinition[] = [
  define("input", ["start", "input"], "flow", "accept", "LogIn", "var(--chart-1)", "design_only", CONTROL_PLANE_ONLY),
  define("output", ["end", "answer", "output"], "sink", "send", "LogOut", "var(--chart-1)", "design_only", CONTROL_PLANE_ONLY),
  define("llm", ["llm"], "agent", "summarize", "Sparkles", "var(--chart-2)", "blocked", EXTERNAL_RUNTIME_REQUIRED, ["model_binding", "runtime_adapter"]),
  define("retrieval", ["knowledge-retrieval", "retrieval"], "source", "fetch", "BookOpen", "var(--chart-4)", "blocked", EXTERNAL_RUNTIME_REQUIRED, ["knowledge_base_binding", "runtime_adapter"]),
  define("branch", ["if-else", "if", "switch"], "router", "route", "GitBranch", "var(--chart-5)", "design_only", CONTROL_PLANE_ONLY),
  define("question-classifier", ["question-classifier"], "router", "route", "ListTree", "var(--chart-5)", "blocked", EXTERNAL_RUNTIME_REQUIRED, ["model_binding", "runtime_adapter"]),
  define("parameter-extractor", ["parameter-extractor"], "agent", "normalize", "Braces", "var(--chart-2)", "blocked", EXTERNAL_RUNTIME_REQUIRED, ["model_binding", "runtime_adapter"]),
  define("iteration", ["iteration"], "control", "route", "Repeat2", "var(--chart-5)", "design_only", CONTROL_PLANE_ONLY),
  define("loop", ["loop"], "control", "route", "RefreshCw", "var(--chart-5)", "design_only", CONTROL_PLANE_ONLY),
  define("human-input", ["human-input", "human_input"], "inbox", "accept", "UserRoundCheck", "var(--chart-3)", "blocked", EXTERNAL_RUNTIME_REQUIRED, ["human_input_runtime"]),
  define("tool", ["tool"], "action", "accept", "Wrench", "var(--chart-3)", "blocked", EXTERNAL_RUNTIME_REQUIRED, ["tool_binding", "runtime_adapter"]),
  define("http", ["http-request", "http"], "source", "fetch", "Globe", "var(--chart-4)", "blocked", EXTERNAL_RUNTIME_REQUIRED, ["network_permission", "runtime_adapter"]),
  define("code", ["code"], "action", "normalize", "Code2", "var(--chart-2)", "blocked", EXTERNAL_RUNTIME_REQUIRED, ["sandbox_runtime"]),
  define("template", ["template-transform", "template"], "agent", "normalize", "FileCode2", "var(--chart-2)", "design_only", CONTROL_PLANE_ONLY),
  define("document-extractor", ["document-extractor", "document-extraction"], "source", "normalize", "FileSearch", "var(--chart-4)", "blocked", EXTERNAL_RUNTIME_REQUIRED, ["document_parser", "runtime_adapter"]),
  define("list-operator", ["list-operator", "list-operation"], "agent", "normalize", "ListFilter", "var(--chart-2)", "design_only", CONTROL_PLANE_ONLY),
  define("variable-aggregator", ["variable-aggregator"], "control", "merge", "Merge", "var(--chart-5)", "design_only", CONTROL_PLANE_ONLY),
  define("variable-assigner", ["variable-assigner", "assigner", "variable-assignment"], "control", "store", "Variable", "var(--chart-5)", "design_only", CONTROL_PLANE_ONLY),
  define("agent", ["agent", "agent-v2", "agent_v2"], "agent", "accept", "Bot", "var(--chart-2)", "blocked", EXTERNAL_RUNTIME_REQUIRED, ["agent_strategy", "runtime_adapter"]),
  define("schedule-trigger", ["schedule", "schedule-trigger", "trigger-schedule"], "schedule", "trigger", "Clock3", "var(--chart-1)", "blocked", EXTERNAL_RUNTIME_REQUIRED, ["trigger_runtime"]),
  define("webhook-trigger", ["webhook", "webhook-trigger", "trigger-webhook"], "schedule", "trigger", "Webhook", "var(--chart-1)", "blocked", EXTERNAL_RUNTIME_REQUIRED, ["webhook_configuration", "trigger_runtime"]),
  define("plugin-trigger", ["plugin-trigger", "trigger-plugin"], "schedule", "trigger", "PlugZap", "var(--chart-1)", "blocked", EXTERNAL_RUNTIME_REQUIRED, ["plugin_installation", "trigger_runtime"]),
  define("datasource", ["datasource", "data-source", "data-source-node"], "source", "fetch", "Database", "var(--chart-4)", "blocked", EXTERNAL_RUNTIME_REQUIRED, ["datasource_binding", "runtime_adapter"]),
  define("knowledge-index", ["knowledge-index", "knowledge-indexing", "knowledge-indexer"], "sink", "store", "LibraryBig", "var(--chart-4)", "blocked", EXTERNAL_RUNTIME_REQUIRED, ["knowledge_base_binding", "index_runtime"]),
]

const MAPPINGS = new Map(
  DEFINITIONS.flatMap((definition) => definition.aliases.map((alias) => [normalizeDifyNodeType(alias), definition] as const)),
)

const CAPABILITY_GAP: DifyNodeMapping = {
  id: "capability-gap",
  family: "unsupported",
  kind: "control",
  capability: "accept",
  icon: "CircleAlert",
  color: "var(--destructive)",
  runtimeStatus: "blocked",
  runtimeReason: "This Dify node type has no semantic OpenCLI mapping. Its source configuration is preserved, but execution is blocked.",
  missing: ["dify_node_mapping", "runtime_adapter"],
}

export function resolveDifyNodeMapping(type: string): DifyNodeMapping {
  return MAPPINGS.get(normalizeDifyNodeType(type)) ?? CAPABILITY_GAP
}

export function isDifyCapabilityGap(mapping: DifyNodeMapping): boolean {
  return mapping.id === CAPABILITY_GAP.id
}

function define(
  id: string,
  aliases: readonly string[],
  kind: WorkflowNodeKind,
  capability: WorkflowCapability,
  icon: string,
  color: string,
  runtimeStatus: DifyNodeRuntimeStatus,
  runtimeReason: string,
  missing: string[] = ["runtime_contract"],
): MappingDefinition {
  return { id, aliases, family: id, kind, capability, icon, color, runtimeStatus, runtimeReason, missing }
}

function normalizeDifyNodeType(type: string): string {
  return type.trim().toLowerCase().replace(/[\s_]+/g, "-")
}
