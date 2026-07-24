import type { AdapterBinding, WorkflowProject, WorkflowProjectEdge, WorkflowProjectNode } from "./schema"

export type PortDirection = "input" | "output"
export type PortDataType =
  | "trigger"
  | "items[]"
  | "recordCandidate[]"
  | "record[]"
  | "runtimeArtifact[]"
  | "scoredItems[]"
  | "summary[]"
  | "branch"
  | "delivery"
  | "storedItems[]"
  | "unknown"
export type ParamDataType = "string" | "number" | "boolean" | "string[]" | "object" | "object[]"
export type ContractStatus = "pass" | "warn" | "fail"

export type PortContract = {
  id: string
  direction: PortDirection
  type: PortDataType
  required: boolean
  description: string
}

export type ParamContract = {
  id: string
  source: "params" | "adapter.mode" | "adapter.config"
  type: ParamDataType
  required: boolean
  defaultValue?: unknown
  enum?: string[]
  min?: number
  max?: number
  description: string
}

export type NodeContract = {
  id: string
  title: string
  dataModel: string
  ports: PortContract[]
  params: ParamContract[]
  assertions: string[]
}

export type NodeContractFinding = {
  nodeId: string
  contractId: string
  status: ContractStatus
  summary: string
  evidence: Record<string, unknown>
}

export type ProjectContractReport = {
  status: ContractStatus
  nodeContracts: Array<{
    nodeId: string
    contractId: string
    title: string
    ports: PortContract[]
    params: ParamContract[]
    assertions: string[]
  }>
  portCoverage: {
    nodesWithContracts: number
    totalNodes: number
    percent: number
    missingNodeIds: string[]
  }
  findings: NodeContractFinding[]
}

export type EdgeContractResolution = {
  edgeId: string
  sourceNodeId: string
  targetNodeId: string
  sourcePort: PortContract | null
  targetPort: PortContract | null
  compatible: boolean
  explicit: {
    sourcePort: boolean
    targetPort: boolean
  }
}

const CONTRACTS: Record<string, NodeContract> = {
  "intelligence.input.collection-need": contract(
    "intelligence.input.collection-need",
    "Collection Need",
    "need -> trigger",
    [],
    [port("out", "output", "trigger", true, "Emits a manual demand trigger for demand-draft assembly.")],
    [
      param("text", "params", "string", true, "抓小红书热帖", {
        description: "Natural-language collection need. Runtime details are resolved by existing source capabilities.",
      }),
      param("locale", "params", "string", false, "zh-CN", {
        enum: ["zh-CN", "en-US"],
        description: "Locale used for demand interpretation and proposal labels.",
      }),
    ],
    [
      "user demand text must remain business intent, not raw executor params",
      "node assembly must call the backend demand-draft endpoint",
    ],
  ),
  "intelligence.schedule.cron": contract(
    "intelligence.schedule.cron",
    "Cron Schedule",
    "clock -> trigger",
    [],
    [port("out", "output", "trigger", true, "Emits a deterministic trigger tick.")],
    [
      param("interval", "params", "string", true, "5m", { description: "Interval or cron-like cadence." }),
      param("timezone", "params", "string", false, "Asia/Shanghai", {
        enum: ["Asia/Shanghai", "UTC", "America/New_York"],
        description: "Timezone used for future wall-clock scheduling.",
      }),
    ],
    ["interval must be present", "output trigger must be traceable"],
  ),
  "intelligence.source.jin10": contract(
    "intelligence.source.jin10",
    "JIN10 Source",
    "trigger -> items[]",
    [port("in", "input", "trigger", true, "Consumes a schedule trigger.")],
    [port("out", "output", "items[]", true, "Emits normalized JIN10 source items.")],
    [
      param("mode", "adapter.mode", "string", true, "fixture", {
        enum: ["fixture", "live"],
        description: "Adapter mode. Fixture is deterministic; live requires network permission.",
      }),
      param("limit", "params", "number", true, 20, { min: 1, max: 100, description: "Maximum source items per run." }),
      param("importantOnly", "params", "boolean", false, false, { description: "Filters to important items only." }),
      param("channel", "params", "string", false, "kuaixun", { enum: ["kuaixun"], description: "JIN10 feed channel." }),
    ],
    ["source adapter must be registered", "items[] output must include stable item ids"],
  ),
  "intelligence.source.opencli-slot": contract(
    "intelligence.source.opencli-slot",
    "OpenCLI Source Slot",
    "trigger -> items[]",
    [port("in", "input", "trigger", false, "Consumes a package fanout trigger.")],
    [port("out", "output", "items[]", true, "Emits items fetched through the OpenCLI channel.")],
    [
      param("site", "params", "string", true, "bilibili", {
        description: "Logical OpenCLI site key such as bilibili or xiaohongshu.",
      }),
      param("command", "params", "string", true, "search", {
        description: "Structured command selected by the package/source planner.",
      }),
      param("sourceGroup", "params", "string", true, "video", {
        description: "Downstream grouping key used in traces and source selection.",
      }),
      param("args", "params", "object", false, { keyword: "ai" }, {
        description: "Structured command args selected by the package/source planner.",
      }),
    ],
    ["source slot params must stay structured", "slot execution is delegated to OpenCLI runtime resources"],
  ),
  "intelligence.source.pool": contract(
    "intelligence.source.pool",
    "Source Pool",
    "need -> trigger",
    [port("in", "input", "trigger", false, "Consumes package demand or trigger context.")],
    [port("out", "output", "trigger", true, "Fans out the trigger to OpenCLI source slots.")],
    [
      param("sourceCount", "params", "number", true, 0, {
        min: 0,
        description: "Number of materialized source slots.",
      }),
      param("sourceGroups", "params", "string[]", false, [], {
        description: "Source groups selected by the demand/package planner.",
      }),
      param("fanout", "params", "string", true, "parallel", {
        enum: ["parallel"],
        description: "OpenCLI HDA source slots always run as parallel fanout.",
      }),
    ],
    [
      "source pool must fan out only to package-owned source slots",
      "resource credentials and runtime identities must stay outside node params",
    ],
  ),
  "intelligence.processing.normalize": contract(
    "intelligence.processing.normalize",
    "Normalize Items",
    "items[] -> recordCandidate[]",
    [port("in", "input", "items[]", true, "Consumes source items.")],
    [port("out", "output", "recordCandidate[]", true, "Emits normalized record candidates.")],
    [
      param("language", "params", "string", true, "zh-CN", { description: "Normalized output language." }),
      param("preserveSourceRefs", "params", "boolean", false, true, { description: "Keeps source references available downstream." }),
    ],
    ["normalized item count should match fetched item count in deterministic simulation"],
  ),
  "intelligence.processing.dedupe": contract(
    "intelligence.processing.dedupe",
    "Dedupe Items",
    "recordCandidate[] -> recordCandidate[]",
    [port("in", "input", "recordCandidate[]", true, "Consumes candidate items.")],
    [port("out", "output", "recordCandidate[]", true, "Emits unique candidates.")],
    [
      param("key", "params", "string", true, "title+source+publishedAt", { description: "Deduplication key expression." }),
      param("window", "params", "string", true, "24h", { description: "Deduplication time window." }),
    ],
    ["dedupe key must be explicit"],
  ),
  "intelligence.flow.merge": contract(
    "intelligence.flow.merge",
    "Merge",
    "recordCandidate[] + recordCandidate[] -> recordCandidate[]",
    [
      port("in1", "input", "recordCandidate[]", true, "Consumes the first candidate stream."),
      port("in2", "input", "recordCandidate[]", true, "Consumes another candidate stream."),
    ],
    [port("out", "output", "recordCandidate[]", true, "Emits merged candidates with lineage preserved.")],
    [
      param("strategy", "params", "string", true, "concat", {
        enum: ["concat", "key_join", "dedupe", "priority", "windowed"],
        description: "Merge strategy. The first loop executes concat and preserves lineage.",
      }),
      param("preserveLineage", "params", "boolean", true, true, {
        description: "Lineage preservation is required for first-loop merges.",
      }),
      param("inputType", "params", "string", true, "recordCandidate[]", {
        enum: ["recordCandidate[]", "record[]", "runtimeArtifact[]"],
        description: "Typed upstream stream accepted by this merge preset.",
      }),
    ],
    [
      "merge requires at least two compatible upstream inputs",
      "lineage must be preserved for every output item",
    ],
  ),
  "intelligence.agent.summary": contract(
    "intelligence.agent.summary",
    "LLM Summary",
    "items[] -> summary[]",
    [port("in", "input", "items[]", true, "Consumes normalized items.")],
    [port("out", "output", "summary[]", true, "Emits item summaries with source evidence.")],
    [
      param("model", "params", "string", true, "deepseek", {
        enum: ["deepseek", "gpt", "claude"],
        description: "LLM provider family.",
      }),
      param("style", "params", "string", true, "macro-brief", {
        enum: ["macro-brief", "risk-brief", "headline"],
        description: "Summary prompt preset.",
      }),
      param("maxChars", "params", "number", true, 280, { min: 80, max: 1200, description: "Maximum summary length." }),
    ],
    ["summary output must preserve source ids"],
  ),
  "intelligence.agent.score": contract(
    "intelligence.agent.score",
    "Importance Score",
    "items[] -> scoredItems[]",
    [port("in", "input", "items[]", true, "Consumes normalized or summarized items.")],
    [port("out", "output", "scoredItems[]", true, "Emits items with score fields.")],
    [
      param("threshold", "params", "number", true, 0.7, { min: 0, max: 1, description: "High-signal threshold." }),
      param("dimensions", "params", "string[]", true, ["market", "policy", "urgency"], {
        description: "Scoring dimensions used for explanation.",
      }),
    ],
    ["threshold must be between 0 and 1", "scored items must expose score"],
  ),
  "intelligence.agent.tag": contract(
    "intelligence.agent.tag",
    "Auto Tag",
    "items[] -> items[]",
    [port("in", "input", "items[]", true, "Consumes items.")],
    [port("out", "output", "items[]", true, "Emits tagged items.")],
    [
      param("taxonomy", "params", "string[]", true, ["macro", "fx", "commodity", "policy", "risk"], {
        description: "Allowed topic taxonomy.",
      }),
    ],
    ["taxonomy must not be empty"],
  ),
  "intelligence.router.importance": contract(
    "intelligence.router.importance",
    "Importance Router",
    "items[] -> review | notify",
    [port("in", "input", "items[]", true, "Consumes items with important/score fields.")],
    [
      port("review", "output", "items[]", true, "Sends reviewable items to inbox."),
      port("notify", "output", "items[]", true, "Sends high-signal items to notification."),
    ],
    [
      param("expression", "params", "string", true, "item.important === true || item.score >= 0.7", {
        description: "Boolean expression evaluated for routing.",
      }),
    ],
    ["router expression must be present", "router should have at least one downstream edge"],
  ),
  "intelligence.control.record-acceptance": contract(
    "intelligence.control.record-acceptance",
    "Record Acceptance Gate",
    "recordCandidate[] -> record[]",
    [port("candidates", "input", "recordCandidate[]", true, "Consumes normalized record candidates.")],
    [port("records", "output", "record[]", true, "Emits accepted records.")],
    [
      param("mode", "params", "string", true, "automatic_with_review", {
        enum: ["automatic_with_review", "manual_review", "automatic_strict"],
        description: "Acceptance policy for candidates that pass or need review.",
      }),
      param("schema", "params", "string", true, "record.v1", {
        description: "Record schema expected before acceptance.",
      }),
      param("dedupe", "params", "string", true, "required", {
        enum: ["required", "advisory", "off"],
        description: "Deduplication requirement before acceptance.",
      }),
      param("lineageRequired", "params", "boolean", true, true, {
        description: "Candidates without lineage cannot become records.",
      }),
      param("minQuality", "params", "number", false, 0, {
        min: 0,
        max: 1,
        description: "Minimum candidate quality score.",
      }),
    ],
    [
      "accepted records must satisfy schema and lineage requirements",
      "raw artifacts or candidates cannot bypass this gate into the record sink",
    ],
  ),
  "intelligence.output.inbox": contract(
    "intelligence.output.inbox",
    "Inbox Store",
    "items[] -> storedItems[]",
    [port("in", "input", "items[]", true, "Consumes reviewable items.")],
    [port("out", "output", "storedItems[]", false, "Emits stored item references for audit.")],
    [
      param("queue", "params", "string", true, "macro-watch", { description: "Inbox queue name." }),
      param("archive", "params", "boolean", false, true, { description: "Whether to archive stored items." }),
    ],
    ["queue must be present", "stored item ids must be traceable"],
  ),
  "intelligence.sink.records": contract(
    "intelligence.sink.records",
    "Record Sink",
    "record[] -> storedItems[]",
    [port("records", "input", "record[]", true, "Consumes accepted records only.")],
    [port("stored", "output", "storedItems[]", false, "Emits stored record references.")],
    [
      param("target", "params", "string", true, "records", {
        enum: ["records"],
        description: "Authoritative records system target.",
      }),
      param("writeMode", "params", "string", true, "append", {
        enum: ["append", "upsert"],
        description: "Record write mode.",
      }),
      param("preserveLineage", "params", "boolean", true, true, {
        description: "Stored records keep lineage and run trace pointers.",
      }),
    ],
    [
      "record sink only accepts records emitted by an acceptance gate",
      "stored records must keep lineage references",
    ],
  ),
  "intelligence.output.collection-result": contract(
    "intelligence.output.collection-result",
    "Collection Output",
    "recordCandidate[] -> items[]",
    [port("in", "input", "recordCandidate[]", true, "Consumes normalized package candidates.")],
    [port("out", "output", "items[]", false, "Exposes normalized package items with lineage.")],
    [
      param("queue", "params", "string", true, "opencli-hda-output", {
        description: "Internal artifact queue for package output.",
      }),
      param("archive", "params", "boolean", false, false, {
        description: "Whether the package output should be archived.",
      }),
    ],
    [
      "collection output must expose package items without credential params",
      "downstream nodes consume items through the package boundary",
    ],
  ),
  "intelligence.output.webhook": contract(
    "intelligence.output.webhook",
    "Webhook Notify",
    "items[] -> delivery",
    [port("in", "input", "items[]", true, "Consumes high-signal notification candidates.")],
    [port("out", "output", "delivery", false, "Emits a delivery preview or webhook result.")],
    [
      param("mode", "adapter.mode", "string", true, "mock", {
        enum: ["mock", "webhook"],
        description: "Notification adapter mode.",
      }),
      param("target", "adapter.config", "string", false, "operator-preview", { description: "Preview or webhook target." }),
      param("template", "params", "string", true, "brief", {
        enum: ["brief", "full", "headline"],
        description: "Notification payload template.",
      }),
    ],
    ["real sends require explicit permission", "delivery payload should be inspectable before send"],
  ),
  "intelligence.output.turbopush-publish": contract(
    "intelligence.output.turbopush-publish",
    "TurboPush Publish",
    "items[] -> delivery",
    [port("in", "input", "items[]", true, "Consumes publishable content or upstream items.")],
    [port("out", "output", "delivery", false, "Emits TurboPush publish result or blocked resource state.")],
    [
      param("mode", "adapter.mode", "string", true, "live", {
        enum: ["live"],
        description: "TurboPush runs through the local service/MCP bridge.",
      }),
      param("contentType", "params", "string", true, "graph_text", {
        enum: ["article", "graph_text", "video"],
        description: "TurboPush content type used to choose create_* and publish_* tools.",
      }),
      param("contentSource", "params", "string", true, "upstream", {
        enum: ["upstream", "inline", "existing_article"],
        description: "Where publishable content comes from.",
      }),
      param("title", "params", "string", true, "{{item.title}}", {
        description: "Title template or inline title.",
      }),
      param("targetPlatforms", "params", "string[]", true, ["xiaohongshu"], {
        description: "Platform intent. Logged accounts and platform settings are resolved by TurboPush.",
      }),
      param("accountSelector", "params", "string", true, "logged_accounts_by_platform", {
        enum: ["logged_accounts_by_platform", "all_logged"],
        description: "Account resolution strategy; account credentials stay in TurboPush.",
      }),
      param("platformSettings", "params", "object", false, {}, {
        description: "Implicit platform settings injected by runtime/agent assembly, not a user credential form.",
      }),
      param("syncDraft", "params", "boolean", false, false, {
        description: "When true, creates/syncs drafts instead of direct publish.",
      }),
    ],
    [
      "account/session/browser resources must be resolved through TurboPush, not node params",
      "publishing requires workflow send permission and local TurboPush service resource",
      "runtime must use list_logged_accounts, platform settings defaults, create_*, publish_*, and SSE result events",
    ],
  ),
  "package.opencli.multi-source-hda": contract(
    "package.opencli.multi-source-hda",
    "多站点采集执行",
    "trigger -> items[]",
    [port("in", "input", "trigger", true, "Consumes a workflow schedule trigger.")],
    [port("out", "output", "items[]", true, "Emits normalized items from locked OpenCLI internal sources.")],
    [
      param("template", "params", "string", true, "opencli-multi-source", {
        enum: ["opencli-multi-source"],
        description: "Locked package template id.",
      }),
      param("runtime", "params", "string", true, "iii", {
        enum: ["iii"],
        description: "Backend runtime plane used by OpenCLI source dispatch.",
      }),
      param("lockedInternals", "params", "boolean", true, true, {
        description: "Internal source graph is package-owned and not assembled by the web AI.",
      }),
      param("sources", "params", "object[]", true, [], {
        description: "Structured OpenCLI source slots. AI may select, add, remove, or fill source args here.",
      }),
      param("execution", "params", "object", true, { fanout: "parallel" }, {
        description: "Package execution policy. Source slots fan out in parallel by default.",
      }),
    ],
    [
      "package internals must include OpenCLI source slots generated from params.sources",
      "source slots must fan out in parallel before internal normalize",
      "OpenCLI dispatch must resolve through III/OpenCLI runtime resources",
    ],
  ),
}

export function getNodeContract(node: WorkflowProjectNode | undefined): NodeContract | undefined {
  if (!node) return undefined
  const catalogId = typeof node.ui?.catalogId === "string" ? node.ui.catalogId : undefined
  return catalogId ? CONTRACTS[catalogId] : undefined
}

export function buildProjectContractReport(project: WorkflowProject): ProjectContractReport {
  const nodeContracts = project.nodes.flatMap((node) => {
    const contract = getNodeContract(node)
    if (!contract) return []
    return [{
      nodeId: node.id,
      contractId: contract.id,
      title: contract.title,
      ports: contract.ports,
      params: contract.params,
      assertions: contract.assertions,
    }]
  })
  const contractedIds = new Set(nodeContracts.map((entry) => entry.nodeId))
  const missingNodeIds = project.nodes.map((node) => node.id).filter((nodeId) => !contractedIds.has(nodeId))
  const findings = project.nodes.flatMap((node) => validateNodeContract(node, project.adapters.find((adapter) => adapter.id === node.adapter)))
  findings.push(...validateEdgeContracts(project))
  if (missingNodeIds.length > 0) {
    findings.push({
      nodeId: "*",
      contractId: "missing-contracts",
      status: "warn",
      summary: "Some workflow nodes do not have a variable/port contract.",
      evidence: { missingNodeIds },
    })
  }

  return {
    status: aggregateStatus(findings),
    nodeContracts,
    portCoverage: {
      nodesWithContracts: nodeContracts.length,
      totalNodes: project.nodes.length,
      percent: project.nodes.length === 0 ? 100 : roundMetric((nodeContracts.length / project.nodes.length) * 100),
      missingNodeIds,
    },
    findings,
  }
}

export function validateEdgeContracts(project: WorkflowProject): NodeContractFinding[] {
  return project.edges.flatMap((edge) => {
    const resolution = resolveEdgeContract(project, edge)
    const contractId = `edge:${edge.id}`
    if (!resolution.sourcePort) {
      return [finding(edge.source, contractId, "fail", `Edge "${edge.id}" has no compatible source output port.`, { edge, resolution })]
    }
    if (!resolution.targetPort) {
      return [finding(edge.target, contractId, "fail", `Edge "${edge.id}" has no compatible target input port.`, { edge, resolution })]
    }
    if (!resolution.compatible) {
      return [
        finding(edge.target, contractId, "fail", `Edge "${edge.id}" connects incompatible port types.`, {
          edge,
          sourceType: resolution.sourcePort.type,
          targetType: resolution.targetPort.type,
          resolution,
        }),
      ]
    }
    return []
  })
}

export function resolveEdgeContract(project: WorkflowProject, edge: WorkflowProjectEdge): EdgeContractResolution {
  const sourceNode = project.nodes.find((node) => node.id === edge.source)
  const targetNode = project.nodes.find((node) => node.id === edge.target)
  const sourceContract = getNodeContract(sourceNode)
  const targetContract = getNodeContract(targetNode)
  const outputs = sourceContract?.ports.filter((port) => port.direction === "output") ?? []
  const inputs = targetContract?.ports.filter((port) => port.direction === "input") ?? []
  const targetPort = edge.targetPort
    ? inputs.find((port) => port.id === edge.targetPort) ?? null
    : inferTargetPort(inputs)
  const sourcePort = edge.sourcePort
    ? outputs.find((port) => port.id === edge.sourcePort) ?? null
    : inferSourcePort(outputs, edge, targetNode, targetPort)

  return {
    edgeId: edge.id,
    sourceNodeId: edge.source,
    targetNodeId: edge.target,
    sourcePort,
    targetPort,
    compatible: Boolean(sourcePort && targetPort && portTypesCompatible(sourcePort.type, targetPort.type)),
    explicit: {
      sourcePort: Boolean(edge.sourcePort),
      targetPort: Boolean(edge.targetPort),
    },
  }
}

export function validateNodeContract(node: WorkflowProjectNode, adapter?: AdapterBinding): NodeContractFinding[] {
  const contract = getNodeContract(node)
  if (!contract) {
    return [{
      nodeId: node.id,
      contractId: "unknown",
      status: "warn",
      summary: "Node has no registered variable/port contract.",
      evidence: { kind: node.kind, capability: node.capability, adapter: node.adapter },
    }]
  }

  return contract.params.flatMap((paramSpec) => {
    const value = readParamValue(node, adapter, paramSpec)
    if ((value === undefined || value === "") && paramSpec.required) {
      return [finding(node.id, contract.id, "fail", `Required param "${paramSpec.id}" is missing.`, { param: paramSpec })]
    }
    if (value === undefined || value === "") return []
    if (!matchesType(value, paramSpec.type)) {
      return [finding(node.id, contract.id, "fail", `Param "${paramSpec.id}" should be ${paramSpec.type}.`, { value, param: paramSpec })]
    }
    if (paramSpec.type === "number" && typeof value === "number") {
      if (typeof paramSpec.min === "number" && value < paramSpec.min) {
        return [finding(node.id, contract.id, "fail", `Param "${paramSpec.id}" is below minimum.`, { value, min: paramSpec.min })]
      }
      if (typeof paramSpec.max === "number" && value > paramSpec.max) {
        return [finding(node.id, contract.id, "fail", `Param "${paramSpec.id}" is above maximum.`, { value, max: paramSpec.max })]
      }
    }
    if (paramSpec.enum && typeof value === "string" && !paramSpec.enum.includes(value)) {
      return [finding(node.id, contract.id, "fail", `Param "${paramSpec.id}" is outside allowed options.`, { value, allowed: paramSpec.enum })]
    }
    if (paramSpec.type === "string[]" && Array.isArray(value) && value.length === 0 && paramSpec.required) {
      return [finding(node.id, contract.id, "fail", `Param "${paramSpec.id}" must not be empty.`, { value })]
    }
    return []
  })
}

function contract(
  id: string,
  title: string,
  dataModel: string,
  inputs: PortContract[],
  outputs: PortContract[],
  params: ParamContract[],
  assertions: string[],
): NodeContract {
  return { id, title, dataModel, ports: [...inputs, ...outputs], params, assertions }
}

function port(id: string, direction: PortDirection, type: PortDataType, required: boolean, description: string): PortContract {
  return { id, direction, type, required, description }
}

function param(
  id: string,
  source: ParamContract["source"],
  type: ParamDataType,
  required: boolean,
  defaultValue: unknown,
  options: Omit<ParamContract, "id" | "source" | "type" | "required" | "defaultValue">,
): ParamContract {
  return { id, source, type, required, defaultValue, ...options }
}

function readParamValue(node: WorkflowProjectNode, adapter: AdapterBinding | undefined, paramSpec: ParamContract): unknown {
  if (paramSpec.source === "adapter.mode") return adapter?.mode
  if (paramSpec.source === "adapter.config") return adapter?.config[paramSpec.id]
  return node.params[paramSpec.id]
}

function matchesType(value: unknown, type: ParamDataType): boolean {
  if (type === "string[]") return Array.isArray(value) && value.every((item) => typeof item === "string")
  if (type === "object") return Boolean(value) && typeof value === "object" && !Array.isArray(value)
  if (type === "object[]") return Array.isArray(value) && value.every((item) => Boolean(item) && typeof item === "object" && !Array.isArray(item))
  return typeof value === type
}

function finding(
  nodeId: string,
  contractId: string,
  status: ContractStatus,
  summary: string,
  evidence: Record<string, unknown>,
): NodeContractFinding {
  return { nodeId, contractId, status, summary, evidence }
}

function aggregateStatus(findings: NodeContractFinding[]): ContractStatus {
  if (findings.some((finding) => finding.status === "fail")) return "fail"
  if (findings.some((finding) => finding.status === "warn")) return "warn"
  return "pass"
}

function roundMetric(value: number): number {
  return Math.round(value * 1000) / 1000
}

function inferTargetPort(inputs: PortContract[]): PortContract | null {
  if (inputs.length === 0) return null
  return inputs.find((port) => port.required) ?? inputs[0]
}

function inferSourcePort(
  outputs: PortContract[],
  edge: WorkflowProjectEdge,
  targetNode: WorkflowProjectNode | undefined,
  targetPort: PortContract | null,
): PortContract | null {
  if (outputs.length === 0) return null
  if (outputs.length === 1) return outputs[0]

  const label = `${edge.label ?? ""} ${edge.condition ?? ""}`.toLowerCase()
  if (label.includes("review") || targetNode?.kind === "inbox") {
    return outputs.find((port) => port.id === "review") ?? outputs[0]
  }
  if (label.includes("notify") || label.includes("webhook") || targetNode?.kind === "notify") {
    return outputs.find((port) => port.id === "notify") ?? outputs[0]
  }
  if (targetPort) {
    const compatible = outputs.find((port) => portTypesCompatible(port.type, targetPort.type))
    if (compatible) return compatible
  }
  return outputs.find((port) => port.required) ?? outputs[0]
}

function portTypesCompatible(source: PortDataType, target: PortDataType): boolean {
  if (source === target) return true
  if (source === "unknown" || target === "unknown") return true
  return false
}
