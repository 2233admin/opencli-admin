import type { WorkflowCapability, WorkflowNodeKind } from "./schema"

type JsonRecord = Record<string, unknown>

export type DifyCapabilityResolution = "exact" | "composed" | "backend" | "ambiguous" | "unsupported"

export type DifyNodeCapabilityMapping = {
  capabilityId: string | null
  candidateCapabilityIds: readonly string[]
  resolution: DifyCapabilityResolution
  kind: WorkflowNodeKind
  capability: WorkflowCapability
  icon: string
  color: string
}

type MappingDefinition = Omit<DifyNodeCapabilityMapping, "candidateCapabilityIds">

const EXACT = "exact" as const
const COMPOSED = "composed" as const
const BACKEND = "backend" as const

/**
 * Versioned import vocabulary for user-visible Dify node families.
 *
 * These identifiers are OpenCLI capability catalog IDs, not runtime bindings.
 * Runtime availability remains backend-authoritative after import inspection.
 */
export const DIFY_NODE_CAPABILITY_IDS = {
  start: "primitive.core.start",
  end: "primitive.core.end",
  answer: "primitive.core.answer",
  llm: "primitive.ai.llm",
  agent: "primitive.ai.agent",
  knowledgeRetrieval: "primitive.knowledge.retrieve",
  knowledgeIndex: "primitive.knowledge.index",
  questionClassifier: "primitive.ai.question-classifier",
  ifElse: "primitive.core.if",
  switch: "primitive.core.switch",
  code: "primitive.core.code",
  templateTransform: "primitive.core.template-transform",
  variableAssign: "primitive.core.variable-assign",
  variableAggregate: "primitive.core.variable-aggregate",
  parameterExtract: "primitive.ai.parameter-extract",
  documentExtract: "primitive.document.extract",
  listFilter: "primitive.core.list-filter",
  listSort: "primitive.core.list-sort",
  iteration: "primitive.core.iteration",
  loop: "primitive.core.loop",
  httpRequest: "primitive.integration.http-request",
  tool: "external.tool.capability",
  humanInput: "primitive.human.approval",
  scheduleTrigger: "intelligence.schedule.cron",
  webhookTrigger: "primitive.ops.trigger-webhook",
  pluginTrigger: "primitive.plugin.trigger",
  datasource: "primitive.plugin.datasource",
} as const

export const DIFY_MIGRATABLE_NODE_TYPES = [
  "start",
  "end",
  "answer",
  "llm",
  "knowledge-retrieval",
  "knowledge-index",
  "if-else",
  "code",
  "template-transform",
  "question-classifier",
  "http-request",
  "tool",
  "datasource",
  "variable-aggregator",
  "loop",
  "iteration",
  "parameter-extractor",
  "assigner",
  "document-extractor",
  "list-operator",
  "agent",
  "trigger-webhook",
  "trigger-schedule",
  "trigger-plugin",
  "human-input",
] as const

export const DIFY_INTERNAL_NODE_TYPES = ["loop-start", "loop-end", "iteration-start"] as const

const DEFINITIONS: Record<string, MappingDefinition> = {
  start: definition(DIFY_NODE_CAPABILITY_IDS.start, EXACT, "schedule", "trigger", "Play", "var(--chart-1)"),
  "user-input": definition(DIFY_NODE_CAPABILITY_IDS.start, EXACT, "schedule", "trigger", "Play", "var(--chart-1)"),
  end: definition(DIFY_NODE_CAPABILITY_IDS.end, EXACT, "inbox", "store", "Square", "var(--chart-1)"),
  answer: definition(DIFY_NODE_CAPABILITY_IDS.answer, EXACT, "notify", "send", "Send", "var(--chart-1)"),
  llm: definition(DIFY_NODE_CAPABILITY_IDS.llm, EXACT, "agent", "summarize", "Sparkles", "var(--chart-2)"),
  agent: definition(DIFY_NODE_CAPABILITY_IDS.agent, EXACT, "agent", "summarize", "Bot", "var(--chart-2)"),
  "knowledge-retrieval": definition(DIFY_NODE_CAPABILITY_IDS.knowledgeRetrieval, EXACT, "source", "fetch", "Database", "var(--chart-4)"),
  "knowledge-index": definition(DIFY_NODE_CAPABILITY_IDS.knowledgeIndex, EXACT, "action", "store", "Database", "var(--chart-4)"),
  "question-classifier": definition(DIFY_NODE_CAPABILITY_IDS.questionClassifier, COMPOSED, "router", "route", "GitBranch", "var(--chart-5)"),
  "if-else": definition(DIFY_NODE_CAPABILITY_IDS.ifElse, EXACT, "router", "route", "GitBranch", "var(--chart-5)"),
  switch: definition(DIFY_NODE_CAPABILITY_IDS.switch, EXACT, "router", "route", "Split", "var(--chart-5)"),
  code: definition(DIFY_NODE_CAPABILITY_IDS.code, EXACT, "agent", "normalize", "Code", "var(--chart-2)"),
  "template-transform": definition(DIFY_NODE_CAPABILITY_IDS.templateTransform, EXACT, "agent", "normalize", "Braces", "var(--chart-2)"),
  // Legacy Dify exports used this spelling for the aggregator family.
  "variable-assigner": definition(DIFY_NODE_CAPABILITY_IDS.variableAggregate, EXACT, "flow", "merge", "GitMerge", "var(--chart-3)"),
  assigner: definition(DIFY_NODE_CAPABILITY_IDS.variableAssign, EXACT, "action", "store", "Variable", "var(--chart-3)"),
  "variable-aggregator": definition(DIFY_NODE_CAPABILITY_IDS.variableAggregate, EXACT, "flow", "merge", "GitMerge", "var(--chart-3)"),
  "parameter-extractor": definition(DIFY_NODE_CAPABILITY_IDS.parameterExtract, COMPOSED, "agent", "normalize", "ListChecks", "var(--chart-2)"),
  "document-extractor": definition(DIFY_NODE_CAPABILITY_IDS.documentExtract, EXACT, "agent", "normalize", "FileText", "var(--chart-2)"),
  "list-filter": definition(DIFY_NODE_CAPABILITY_IDS.listFilter, EXACT, "agent", "normalize", "Filter", "var(--chart-2)"),
  "list-sort": definition(DIFY_NODE_CAPABILITY_IDS.listSort, EXACT, "agent", "normalize", "ArrowUpDown", "var(--chart-2)"),
  iteration: definition(DIFY_NODE_CAPABILITY_IDS.iteration, EXACT, "control", "route", "Repeat", "var(--chart-5)"),
  loop: definition(DIFY_NODE_CAPABILITY_IDS.loop, EXACT, "control", "route", "Repeat2", "var(--chart-5)"),
  "http-request": definition(DIFY_NODE_CAPABILITY_IDS.httpRequest, EXACT, "source", "fetch", "Globe", "var(--chart-4)"),
  tool: definition(DIFY_NODE_CAPABILITY_IDS.tool, BACKEND, "action", "send", "Wrench", "var(--chart-3)"),
  "human-input": definition(DIFY_NODE_CAPABILITY_IDS.humanInput, EXACT, "inbox", "accept", "UserCheck", "var(--chart-5)"),
  "trigger-schedule": definition(DIFY_NODE_CAPABILITY_IDS.scheduleTrigger, EXACT, "schedule", "trigger", "Clock", "var(--chart-1)"),
  "schedule-trigger": definition(DIFY_NODE_CAPABILITY_IDS.scheduleTrigger, EXACT, "schedule", "trigger", "Clock", "var(--chart-1)"),
  schedule: definition(DIFY_NODE_CAPABILITY_IDS.scheduleTrigger, EXACT, "schedule", "trigger", "Clock", "var(--chart-1)"),
  "trigger-webhook": definition(DIFY_NODE_CAPABILITY_IDS.webhookTrigger, EXACT, "schedule", "trigger", "Webhook", "var(--chart-1)"),
  "webhook-trigger": definition(DIFY_NODE_CAPABILITY_IDS.webhookTrigger, EXACT, "schedule", "trigger", "Webhook", "var(--chart-1)"),
  "trigger-plugin": definition(DIFY_NODE_CAPABILITY_IDS.pluginTrigger, BACKEND, "schedule", "trigger", "PlugZap", "var(--chart-1)"),
  "plugin-trigger": definition(DIFY_NODE_CAPABILITY_IDS.pluginTrigger, BACKEND, "schedule", "trigger", "PlugZap", "var(--chart-1)"),
  datasource: definition(DIFY_NODE_CAPABILITY_IDS.datasource, BACKEND, "source", "fetch", "DatabaseZap", "var(--chart-4)"),
  "data-source": definition(DIFY_NODE_CAPABILITY_IDS.datasource, BACKEND, "source", "fetch", "DatabaseZap", "var(--chart-4)"),
}

const UNSUPPORTED_INTERNAL_TYPES = new Set<string>(DIFY_INTERNAL_NODE_TYPES)

export function resolveDifyNodeCapability(
  sourceType: string,
  config: JsonRecord = {},
): DifyNodeCapabilityMapping {
  const nodeType = normalizeType(sourceType)
  if (nodeType === "list-operator") return resolveListOperator(config)
  if (nodeType === "trigger") return resolveGenericTrigger(config)

  const mapping = DEFINITIONS[nodeType]
  if (mapping) return withCandidates(mapping)
  return {
    capabilityId: null,
    candidateCapabilityIds: [],
    resolution: "unsupported",
    kind: "control",
    capability: "accept",
    icon: UNSUPPORTED_INTERNAL_TYPES.has(nodeType) ? "CircleDotDashed" : "CircleHelp",
    color: "var(--muted-foreground)",
  }
}

export function difyNodeMappingBlocker(
  mapping: DifyNodeCapabilityMapping,
  sourceNodeId: string | undefined,
  sourceType: string,
): { code: "import.mapping_missing" | "import.mapping_ambiguous"; message: string; nodeId?: string } | null {
  if (mapping.resolution === "unsupported") {
    return {
      code: "import.mapping_missing",
      message: `Dify node type "${sourceType}" has no OpenCLI capability mapping.`,
      nodeId: sourceNodeId,
    }
  }
  if (mapping.resolution === "ambiguous" || mapping.resolution === "backend") {
    return {
      code: "import.mapping_ambiguous",
      message: mapping.candidateCapabilityIds.length > 1
        ? `Dify node type "${sourceType}" requires one of: ${mapping.candidateCapabilityIds.join(", ")}.`
        : `Dify node type "${sourceType}" requires backend plugin capability resolution.`,
      nodeId: sourceNodeId,
    }
  }
  return null
}

function resolveListOperator(config: JsonRecord): DifyNodeCapabilityMapping {
  const operation = readOperation(config)
  if (operation.includes("sort") || operation.includes("order")) {
    return withCandidates(DEFINITIONS["list-sort"])
  }
  if (operation.includes("filter") || operation.includes("select")) {
    return withCandidates(DEFINITIONS["list-filter"])
  }
  return {
    capabilityId: null,
    candidateCapabilityIds: [DIFY_NODE_CAPABILITY_IDS.listFilter, DIFY_NODE_CAPABILITY_IDS.listSort],
    resolution: "ambiguous",
    kind: "agent",
    capability: "normalize",
    icon: "ListFilter",
    color: "var(--chart-2)",
  }
}

function resolveGenericTrigger(config: JsonRecord): DifyNodeCapabilityMapping {
  const discriminator = readOperation(config)
  if (discriminator.includes("schedule") || discriminator.includes("cron")) {
    return withCandidates(DEFINITIONS.schedule)
  }
  if (discriminator.includes("webhook")) {
    return withCandidates(DEFINITIONS["trigger-webhook"])
  }
  if (discriminator.includes("plugin") || hasPluginProvenance(config)) {
    return withCandidates(DEFINITIONS["trigger-plugin"])
  }
  return {
    capabilityId: null,
    candidateCapabilityIds: [
      DIFY_NODE_CAPABILITY_IDS.start,
      DIFY_NODE_CAPABILITY_IDS.scheduleTrigger,
      DIFY_NODE_CAPABILITY_IDS.webhookTrigger,
      DIFY_NODE_CAPABILITY_IDS.pluginTrigger,
    ],
    resolution: "ambiguous",
    kind: "schedule",
    capability: "trigger",
    icon: "Play",
    color: "var(--chart-1)",
  }
}

function definition(
  capabilityId: string,
  resolution: typeof EXACT | typeof COMPOSED | typeof BACKEND,
  kind: WorkflowNodeKind,
  capability: WorkflowCapability,
  icon: string,
  color: string,
): MappingDefinition {
  return { capabilityId, resolution, kind, capability, icon, color }
}

function withCandidates(mapping: MappingDefinition): DifyNodeCapabilityMapping {
  return {
    ...mapping,
    candidateCapabilityIds: mapping.capabilityId ? [mapping.capabilityId] : [],
  }
}

function readOperation(config: JsonRecord): string {
  return [
    config.operation,
    config.action,
    config.operation_type,
    config.trigger_type,
    config.provider_type,
  ].filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase()
}

function hasPluginProvenance(config: JsonRecord): boolean {
  return ["provider_id", "provider_name", "plugin_id", "plugin_unique_identifier"].some((key) => {
    const value = config[key]
    return typeof value === "string" && value.trim().length > 0
  })
}

function normalizeType(value: string): string {
  return value.trim().toLowerCase().replaceAll("_", "-")
}
