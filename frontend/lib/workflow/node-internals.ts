import type { WorkflowProjectNode } from "./schema"
import type { ParameterBinding, ParameterFieldType } from "@/lib/flow/types"

export type NodeInternalStatus = "ready" | "simulated" | "future"

export type NodeInternalExposedParam = {
  id: string
  label: string
  groupId: string
  groupLabel: string
  type: ParameterFieldType
  binding?: Omit<ParameterBinding, "nodeId">
  description?: string
  order?: number
  groupOrder?: number
  readonly?: boolean
  value?: unknown
  placeholder?: string
  min?: number
  max?: number
  step?: number
  options?: { value: string; label: string }[]
}

export type NodeInternalStep = {
  id: string
  label: string
  capability: string
  description: string
  evidence: string
  status: NodeInternalStatus
  exposedParams?: NodeInternalExposedParam[]
}

export type NodeInternals = {
  title: string
  summary: string
  steps: NodeInternalStep[]
}

const NODE_INTERNALS: Record<string, NodeInternals> = {
  "intelligence.schedule.cron": {
    title: "Schedule Internals",
    summary: "Turns wall-clock intent into a deterministic workflow trigger.",
    steps: [
      step("interval", "Interval parser", "parse", "Reads interval/cron-like params.", "next tick preview", "ready", [
        exposedParam("interval", "Interval", "transform", "Transform", "text", "5m", { order: 1 }),
      ]),
      step("timezone", "Timezone resolver", "resolve", "Applies the workflow timezone.", "settings.timezone", "ready", [
        exposedParam("timezone", "Timezone", "transform", "Transform", "select", "Asia/Shanghai", {
          options: timezoneOptions(),
          order: 2,
        }),
      ]),
      step("gate", "Enabled gate", "guard", "Allows future pause/resume behavior.", "enabled flag", "future", [
        exposedParam("enabled", "Enabled", "misc", "Misc", "boolean", true, { groupOrder: 3 }),
      ]),
    ],
  },
  "intelligence.source.jin10": {
    title: "JIN10 Internals",
    summary: "Fetches and normalizes JIN10 flash news behind one source node.",
    steps: [
      step("fetch", "Fetch feed", "fetch", "Reads fixture data or live feed by adapter mode.", "item count", "ready", [
        exposedParam("mode", "Mode", "source", "Source", "select", "fixture", {
          binding: { source: "adapter", fieldId: "mode" },
          options: [
            { value: "fixture", label: "Fixture" },
            { value: "mock", label: "Mock" },
            { value: "live", label: "Live" },
          ],
          order: 1,
        }),
        exposedParam("feed", "Feed", "source", "Source", "text", "kuaixun", {
          binding: { source: "adapter", fieldId: "feed" },
          order: 2,
        }),
      ]),
      step("parse", "Parse payload", "parse", "Maps provider payload fields into local source items.", "schema parse", "ready", [
        exposedParam("channel", "Channel", "source", "Source", "text", "kuaixun", { order: 3 }),
      ]),
      step("filter", "Importance filter", "filter", "Applies importantOnly and limit params.", "filtered count", "ready", [
        exposedParam("limit", "Limit", "transform", "Transform", "number", 20, { min: 1, max: 200, step: 1, groupOrder: 2, order: 1 }),
        exposedParam("importantOnly", "Important Only", "transform", "Transform", "boolean", false, { groupOrder: 2, order: 2 }),
      ]),
      step("cache", "Cache window", "cache", "Provides a stable slot for dedupe/cache policy.", "cache key", "future"),
      step("errors", "Source errors", "guard", "Converts provider failures into adapter errors.", "error message", "ready"),
      step("output", "Output schema", "validate", "Ensures downstream receives items[].", "items[] contract", "simulated"),
    ],
  },
  "intelligence.agent.summary": {
    title: "Summary Internals",
    summary: "Builds a brief while preserving source evidence.",
    steps: [
      step("prompt", "Prompt preset", "prompt", "Selects macro/risk/headline prompt style.", "style param", "ready", [
        exposedParam("style", "Style", "render", "Render", "select", "macro-brief", {
          options: [
            { value: "macro-brief", label: "Macro Brief" },
            { value: "risk-note", label: "Risk Note" },
            { value: "headline", label: "Headline" },
          ],
          order: 1,
        }),
      ]),
      step("model", "Model adapter", "model", "Routes to the selected LLM provider.", "model param", "simulated", [
        exposedParam("model", "Model", "render", "Render", "text", "deepseek", { order: 2 }),
      ]),
      step("budget", "Token budget", "budget", "Constrains summary length.", "maxChars", "ready", [
        exposedParam("maxChars", "Max Chars", "render", "Render", "number", 280, { min: 80, max: 2000, step: 10, order: 3 }),
      ]),
      step("schema", "Output schema", "validate", "Keeps generated summaries machine-readable.", "summary fields", "future"),
      step("fallback", "Fallback summary", "fallback", "Keeps deterministic simulation useful without a live model.", "local summary", "simulated"),
      step("refs", "Evidence refs", "evidence", "Carries source references into the brief.", "source ids", "future"),
    ],
  },
  "intelligence.processing.normalize": {
    title: "Normalize Internals",
    summary: "Turns provider-shaped items into the local intelligence item shape.",
    steps: [
      step("map-fields", "Map fields", "parse", "Maps provider fields into local item keys.", "field mapping", "ready"),
      step("language", "Language normalize", "resolve", "Applies the requested output language.", "language param", "ready", [
        exposedParam("language", "Language", "transform", "Transform", "select", "zh-CN", {
          options: [
            { value: "zh-CN", label: "zh-CN" },
            { value: "en-US", label: "en-US" },
          ],
        }),
      ]),
      step("source-refs", "Source refs", "evidence", "Preserves source id and URL for audit.", "source refs", "ready", [
        exposedParam("preserveSourceRefs", "Preserve Source Refs", "misc", "Misc", "boolean", true, { groupOrder: 3 }),
      ]),
      step("schema", "Item schema", "validate", "Ensures downstream receives items[].", "items[] contract", "simulated"),
    ],
  },
  "intelligence.processing.dedupe": {
    title: "Dedupe Internals",
    summary: "Removes duplicate source items while keeping audit evidence.",
    steps: [
      step("key", "Dedupe key", "parse", "Builds a stable key from title/source/time fields.", "dedupe key", "ready", [
        exposedParam("key", "Key", "transform", "Transform", "text", "title+source+publishedAt", { order: 1 }),
      ]),
      step("window", "Window lookup", "cache", "Checks the configured dedupe time window.", "window param", "ready", [
        exposedParam("window", "Window", "transform", "Transform", "text", "24h", { order: 2 }),
      ]),
      step("filter", "Unique filter", "filter", "Keeps first-seen items and drops repeats.", "unique count", "simulated"),
      step("coverage", "Drop coverage", "validate", "Records dropped item evidence.", "dropped ids", "future"),
    ],
  },
  "intelligence.agent.score": {
    title: "Scoring Internals",
    summary: "Turns raw items into ranked signals with an explainable threshold.",
    steps: [
      step("dimensions", "Dimensions", "score", "Chooses scoring axes such as market, policy, and urgency.", "dimensions", "ready", [
        exposedParam("dimensions", "Dimensions", "transform", "Transform", "tokens", ["market", "policy", "urgency"], {
          options: [
            { value: "market", label: "market" },
            { value: "policy", label: "policy" },
            { value: "urgency", label: "urgency" },
            { value: "liquidity", label: "liquidity" },
          ],
          order: 1,
        }),
      ]),
      step("weights", "Weights", "weight", "Reserves a slot for weighted scoring.", "weight map", "future"),
      step("threshold", "Threshold", "threshold", "Defines the cutoff for high-signal items.", "threshold", "ready", [
        exposedParam("threshold", "Threshold", "contract", "Contract", "slider", 0.7, {
          min: 0,
          max: 1,
          step: 0.05,
          groupOrder: 2,
          order: 1,
        }),
      ]),
      step("calibration", "Calibration sample", "calibrate", "Compares scores against sample items.", "sample set", "future"),
      step("explanation", "Score explanation", "explain", "Explains why an item crossed the threshold.", "reason text", "simulated"),
      step("confidence", "Confidence", "confidence", "Separates score from certainty.", "confidence field", "future"),
    ],
  },
  "intelligence.agent.tag": {
    title: "Tag Internals",
    summary: "Classifies items into a controlled taxonomy.",
    steps: [
      step("taxonomy", "Taxonomy", "parse", "Loads the allowed tag vocabulary.", "taxonomy param", "ready", [
        exposedParam("taxonomy", "Taxonomy", "transform", "Transform", "tokens", ["macro", "fx", "commodity", "policy", "risk"], {
          options: [
            { value: "macro", label: "macro" },
            { value: "fx", label: "fx" },
            { value: "commodity", label: "commodity" },
            { value: "policy", label: "policy" },
            { value: "risk", label: "risk" },
          ],
          order: 1,
        }),
      ]),
      step("classifier", "Classifier", "model", "Assigns topic and risk labels.", "tag candidates", "simulated"),
      step("filter", "Allowed tags", "filter", "Drops tags outside the approved taxonomy.", "allowed tags", "ready"),
      step("schema", "Tag schema", "validate", "Keeps tags machine-readable downstream.", "tag fields", "future"),
    ],
  },
  "intelligence.router.importance": {
    title: "Router Internals",
    summary: "Routes scored items into review and notification paths.",
    steps: [
      step("expression", "Condition expression", "route", "Evaluates the route expression against each item.", "expression result", "ready", [
        exposedParam("expression", "Expression", "contract", "Contract", "textarea", "item.important === true || item.score >= 0.7", {
          description: "Route predicate evaluated against each scored item.",
          order: 1,
        }),
      ]),
      step("branches", "Branch list", "branch", "Maps true/false outputs to downstream edges.", "edge labels", "ready"),
      step("default", "Default branch", "fallback", "Keeps unmatched items recoverable.", "default route", "future"),
      step("preview", "Route preview", "preview", "Shows how sample items would route.", "simulation trace", "simulated"),
      step("warnings", "Missing branch warning", "validate", "Flags routers without expected outputs.", "edge count", "ready"),
    ],
  },
  "intelligence.output.webhook": {
    title: "Notify Internals",
    summary: "Prepares outbound delivery while keeping phase-one sends simulated.",
    steps: [
      step("template", "Template", "format", "Formats brief/headline/full payloads.", "template param", "ready", [
        exposedParam("template", "Template", "render", "Render", "select", "brief", {
          options: [
            { value: "brief", label: "brief" },
            { value: "full", label: "full" },
            { value: "headline", label: "headline" },
          ],
          order: 1,
        }),
      ]),
      step("target", "Target", "target", "Selects preview or webhook target.", "target param", "ready", [
        exposedParam("target", "Target", "runtime", "Runtime", "select", "operator-preview", {
          options: notificationTargetOptions(),
          order: 1,
          groupOrder: 2,
        }),
        exposedParam("mode", "Adapter Mode", "runtime", "Runtime", "select", "mock", {
          binding: { source: "adapter", fieldId: "mode" },
          options: [
            { value: "mock", label: "mock" },
            { value: "webhook", label: "webhook" },
          ],
          order: 2,
          groupOrder: 2,
        }),
      ]),
      step("payload", "Payload preview", "preview", "Shows exactly what would be sent.", "payload sample", "simulated"),
      step("mock", "Mock send", "send", "Records simulated delivery without external side effects.", "mock result", "ready"),
      step("retry", "Retry policy", "retry", "Reserves retry behavior for live webhook mode.", "retry policy", "future"),
      step("guard", "Delivery guard", "guard", "Checks permissions before real notification sends.", "agentPermissions", "ready"),
    ],
  },
  "intelligence.output.inbox": {
    title: "Inbox Internals",
    summary: "Writes reviewable intelligence items into a durable operator queue.",
    steps: [
      step("queue", "Queue resolver", "target", "Resolves the target review queue.", "queue param", "ready", [
        exposedParam("queue", "Queue", "runtime", "Runtime", "select", "macro-watch", {
          options: reviewQueueOptions(),
          order: 1,
        }),
      ]),
      step("write", "Inbox write", "send", "Persists review items into the simulated inbox.", "stored ids", "ready"),
      step("archive", "Archive policy", "cache", "Applies archive/retention settings.", "archive param", "simulated", [
        exposedParam("archive", "Archive", "misc", "Misc", "boolean", true, { groupOrder: 2, order: 1 }),
      ]),
      step("audit", "Audit refs", "evidence", "Keeps stored item ids traceable.", "stored refs", "ready"),
    ],
  },
  "package.intelligence.pipeline": {
    title: "Intelligence Pipeline Package",
    summary: "A DOP-level package for the default AI intelligence automation workflow.",
    steps: [
      step("schedule", "Schedule trigger", "trigger", "Starts the pipeline on a cadence.", "tick", "ready"),
      step("source", "JIN10 adapter", "fetch", "Reads the first real data-source adapter.", "items[]", "ready"),
      step("normalize", "Normalize items", "resolve", "Maps provider payloads into canonical items.", "items[] contract", "ready"),
      step("summarize", "Prompt summary", "prompt", "Builds deterministic prompt-ready summaries.", "prompt version", "simulated"),
      step("score", "Score dimensions", "score", "Ranks items by market importance.", "scorecard", "simulated"),
      step("review", "Human review", "audit", "Stores high-signal evidence for review.", "inbox refs", "ready"),
      step("notify", "Mock notify", "send", "Records delivery evidence without live side effects.", "delivery trace", "ready"),
    ],
  },
  "package.opencli.multi-source-hda": {
    title: "OpenCLI Multi-source HDA",
    summary: "A locked HDA package that fans out to existing OpenCLI source adapters and folds runtime dispatch back onto the package node.",
    steps: [
      step("trigger", "Schedule input", "trigger", "Receives the workflow tick from the outer canvas.", "trigger edge", "ready"),
      step("source-bilibili", "Bilibili OpenCLI source", "fetch", "Uses the existing OpenCLI channel through the III collector worker.", "site=bilibili command=search", "ready"),
      step("source-xiaohongshu", "Xiaohongshu OpenCLI source", "fetch", "Uses the existing OpenCLI channel through the III collector worker.", "site=xiaohongshu command=search", "ready"),
      step("normalize", "Internal normalize", "resolve", "Normalizes internal source results before returning items[] to the outer canvas.", "items[] contract", "ready"),
      step("trace", "Runtime trace fold", "evidence", "Backend trace dispatches are folded onto this package node in the run panel.", "opencli-hda trace", "ready"),
    ],
  },
  "package.ops.event": {
    title: "Ops Event Package",
    summary: "A DOP-level package for task automation events and execution evidence.",
    steps: [
      step("manual", "Manual trigger", "trigger", "Allows operator/API launch.", "launch event", "ready"),
      step("schedule", "Schedule trigger", "trigger", "Allows timed launches.", "schedule rule", "ready"),
      step("queue", "Queue limit", "queue", "Applies queue/backpressure policy.", "queue state", "simulated"),
      step("retry", "Retry policy", "retry", "Plans retry attempts after failure.", "retry plan", "simulated"),
      step("artifact", "Run artifact", "evidence", "Persists execution evidence.", "artifact pointer", "ready"),
    ],
  },
  "package.ops.monitor-guard": {
    title: "Monitor Guard Package",
    summary: "A package for metric extraction, threshold checks, and guarded routing.",
    steps: [
      step("metric", "Metric expression", "monitor", "Extracts a numeric signal.", "metric sample", "simulated"),
      step("delta", "Delta monitor", "score", "Computes trend/delta signal.", "delta sample", "simulated"),
      step("threshold", "Threshold gate", "threshold", "Routes when the signal crosses a limit.", "gate result", "ready"),
      step("rate", "Rate limit", "queue", "Prevents noisy repeated alerts.", "rate window", "simulated"),
      step("coverage", "Coverage mark", "evidence", "Records guard coverage.", "coverage mark", "ready"),
    ],
  },
  "package.ops.alert-response": {
    title: "Alert Response Package",
    summary: "A package for notification, ticketing, snapshots, and escalation.",
    steps: [
      step("format", "Payload format", "format", "Formats alert payload.", "payload preview", "ready"),
      step("channel", "Channel action", "send", "Sends through a mocked channel.", "delivery trace", "simulated"),
      step("ticket", "Ticket action", "ticket", "Creates incident ticket evidence.", "ticket ref", "simulated"),
      step("snapshot", "Snapshot action", "snapshot", "Captures server/context snapshot.", "snapshot ref", "simulated"),
      step("escalate", "Escalation gate", "route", "Routes unresolved incidents.", "branch", "future"),
    ],
  },
  "package.ai.prompt-experiment": {
    title: "Prompt Experiment Package",
    summary: "A package for prompt versioning, tests, model comparison, and experiment evidence.",
    steps: [
      step("template", "Prompt template", "prompt", "Builds prompt input.", "prompt", "ready"),
      step("version", "Prompt version", "version", "Pins a prompt revision.", "version id", "ready"),
      step("case", "Prompt test case", "experiment", "Binds test input and expected output.", "case id", "simulated"),
      step("model", "Model compare", "model", "Compares mock/model outputs.", "comparison", "simulated"),
      step("record", "Experiment run", "evaluator", "Records experiment evidence.", "experiment id", "ready"),
    ],
  },
  "package.verify.regression-gate": {
    title: "Regression Gate Package",
    summary: "A package for verification-grade scorecards and regression decisions.",
    steps: [
      step("dataset", "Eval dataset", "experiment", "Selects fixture/eval cases.", "dataset", "ready"),
      step("evaluator", "Evaluator", "evaluator", "Computes deterministic scores.", "scores", "simulated"),
      step("scorecard", "Scorecard", "score", "Summarizes quality gates.", "scorecard", "ready"),
      step("regression", "Regression gate", "threshold", "Blocks quality regressions.", "pass/fail", "ready"),
      step("coverage", "Coverage mark", "evidence", "Records verification coverage.", "coverage", "ready"),
    ],
  },
  "package.map.knowledge-map": {
    title: "Knowledge Map Package",
    summary: "A package for TurnMap-style anchors, semantic links, topic groups, and exports.",
    steps: [
      step("anchor", "Source anchor", "anchor", "Stores jumpable source metadata.", "anchor", "simulated", [
        exposedParam("artifactPath", "Artifact Path", "source", "Source", "text", "runs/{{runId}}/artifact.json", {
          description: "Durable run artifact path used by jump-back.",
          order: 1,
        }),
        exposedParam("runId", "Run ID", "source", "Source", "text", "{{runId}}", {
          description: "Runtime id that produced the source evidence.",
          order: 2,
        }),
        exposedParam("selector", "Selector", "source", "Source", "text", "{{source.selector}}", {
          description: "Optional source selector for jump-back focus.",
          order: 3,
        }),
      ]),
      step("semantic", "Semantic link", "semantic", "Creates typed relationship edges.", "semantic edge", "simulated", [
        exposedParam("relationship", "Relationship", "contract", "Contract", "select", "evidence", {
          options: [
            { value: "related", label: "Related" },
            { value: "depends-on", label: "Depends On" },
            { value: "evidence", label: "Evidence" },
            { value: "contradicts", label: "Contradicts" },
            { value: "implements", label: "Implements" },
          ],
          order: 1,
          groupOrder: 2,
        }),
        exposedParam("confidence", "Confidence", "contract", "Contract", "slider", 0.72, {
          min: 0,
          max: 1,
          step: 0.01,
          order: 2,
          groupOrder: 2,
        }),
        exposedParam("contractId", "Contract ID", "contract", "Contract", "text", "edge.contract.semantic", {
          description: "Contract key used by semantic edge validation.",
          order: 3,
          groupOrder: 2,
        }),
      ]),
      step("weight", "Link weight", "weight", "Stores edge weight and visual strength.", "weight", "ready", [
        exposedParam("weight", "Weight", "contract", "Contract", "slider", 0.75, {
          min: 0,
          max: 1,
          step: 0.01,
          order: 4,
          groupOrder: 2,
        }),
      ]),
      step("topic", "Topic collapse", "topic", "Creates recoverable topic groups.", "topic group", "simulated", [
        exposedParam("mode", "Mode", "runtime", "Runtime", "select", "draft", {
          options: [
            { value: "draft", label: "Draft" },
            { value: "locked", label: "Locked" },
          ],
          order: 1,
          groupOrder: 3,
        }),
        exposedParam("nodeCount", "Node Count", "runtime", "Runtime", "number", 0, {
          readonly: true,
          order: 2,
          groupOrder: 3,
        }),
      ]),
      step("export", "Knowledge export", "format", "Exports Canvas/OPML/Markdown.", "export artifact", "ready", [
        exposedParam("latestArtifact", "Latest Artifact", "runtime", "Runtime", "text", "runs/{{runId}}/knowledge-export.md", {
          readonly: true,
          order: 3,
          groupOrder: 3,
        }),
      ]),
    ],
  },
  "package.review.human-review": {
    title: "Human Review Package",
    summary: "A package for human approval, inbox persistence, and audit evidence.",
    steps: [
      step("approval", "Human approval", "route", "Splits approved and rejected items.", "approval branch", "simulated"),
      step("inbox", "Inbox write", "send", "Stores reviewable items.", "stored refs", "ready"),
      step("audit", "Evidence pack", "audit", "Bundles source and decision evidence.", "evidence pack", "ready"),
      step("notify", "Review notification", "send", "Notifies reviewers in mock mode.", "delivery trace", "simulated"),
    ],
  },
}

export function getNodeInternals(node: WorkflowProjectNode | undefined): NodeInternals | undefined {
  if (!node) return undefined
  const catalogId = typeof node.ui?.catalogId === "string" ? node.ui.catalogId : undefined
  if (catalogId && NODE_INTERNALS[catalogId]) return NODE_INTERNALS[catalogId]

  if (node.kind === "schedule" && node.capability === "trigger") return NODE_INTERNALS["intelligence.schedule.cron"]
  if (node.kind === "source" && node.adapter === "jin10-kuaixun") return NODE_INTERNALS["intelligence.source.jin10"]
  if (node.kind === "agent" && node.capability === "normalize") return NODE_INTERNALS["intelligence.processing.normalize"]
  if (node.kind === "agent" && node.capability === "dedupe") return NODE_INTERNALS["intelligence.processing.dedupe"]
  if (node.kind === "agent" && node.capability === "summarize") return NODE_INTERNALS["intelligence.agent.summary"]
  if (node.kind === "agent" && node.capability === "score") return NODE_INTERNALS["intelligence.agent.score"]
  if (node.kind === "agent" && node.capability === "tag") return NODE_INTERNALS["intelligence.agent.tag"]
  if (node.kind === "router" && node.capability === "route") return NODE_INTERNALS["intelligence.router.importance"]
  if (node.kind === "inbox" && node.capability === "store") return NODE_INTERNALS["intelligence.output.inbox"]
  if (node.kind === "notify" && node.capability === "send") return NODE_INTERNALS["intelligence.output.webhook"]
  return undefined
}

function step(
  id: string,
  label: string,
  capability: string,
  description: string,
  evidence: string,
  status: NodeInternalStatus,
  exposedParams?: NodeInternalExposedParam[],
): NodeInternalStep {
  return { id, label, capability, description, evidence, status, exposedParams }
}

function exposedParam(
  id: string,
  label: string,
  groupId: string,
  groupLabel: string,
  type: ParameterFieldType,
  value: unknown,
  options: Partial<Omit<NodeInternalExposedParam, "id" | "label" | "groupId" | "groupLabel" | "type" | "value">> = {},
): NodeInternalExposedParam {
  return {
    id,
    label,
    groupId,
    groupLabel,
    type,
    value,
    binding: options.binding ?? { source: "params", fieldId: id },
    ...options,
  }
}

function timezoneOptions() {
  return [
    { value: "Asia/Shanghai", label: "Asia/Shanghai" },
    { value: "UTC", label: "UTC" },
    { value: "America/New_York", label: "America/New_York" },
  ]
}

function notificationTargetOptions() {
  return [
    { value: "operator-preview", label: "Operator Preview" },
    { value: "mock-webhook", label: "Mock Webhook" },
    { value: "ops-alerts", label: "Ops Alerts" },
    { value: "human-review", label: "Human Review" },
  ]
}

function reviewQueueOptions() {
  return [
    { value: "macro-watch", label: "Macro Watch" },
    { value: "risk-review", label: "Risk Review" },
    { value: "ops-triage", label: "Ops Triage" },
  ]
}
