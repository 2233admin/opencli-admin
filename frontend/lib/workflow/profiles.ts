import type { AdapterBinding, WorkflowNodeKind, WorkflowProfile } from "./schema"

export type WorkflowVisiblePanel =
  | "project"
  | "canvas"
  | "palette"
  | "inspector"
  | "simulation"
  | "proposals"
  | "logs"

export type WorkflowInspectorSection =
  | "identity"
  | "schedule"
  | "adapter"
  | "agent"
  | "routing"
  | "delivery"
  | "storage"
  | "params"
  | "debug"
  | "sdk"

export type WorkflowScoringProfile = {
  id: string
  label: string
  scoreField: string
  threshold: number
  sort: "ascending" | "descending"
}

export type WorkflowProfileDefinition = {
  id: WorkflowProfile
  label: string
  description: string
  visiblePanels: readonly WorkflowVisiblePanel[]
  defaultAdapters: readonly AdapterBinding[]
  defaultScoringProfile: WorkflowScoringProfile
  inspectorSectionsFor: (kind: WorkflowNodeKind) => readonly WorkflowInspectorSection[]
}

const COMMON_SECTIONS = ["identity", "params"] as const

const BASE_SECTIONS_BY_KIND = {
  schedule: ["identity", "schedule", "params"],
  source: ["identity", "adapter", "params"],
  agent: ["identity", "agent", "params"],
  router: ["identity", "routing", "params"],
  flow: ["identity", "routing", "params"],
  control: ["identity", "routing", "params"],
  notify: ["identity", "adapter", "delivery", "params"],
  inbox: ["identity", "storage", "params"],
  action: ["identity", "adapter", "params"],
  sink: ["identity", "storage", "params"],
} as const satisfies Record<WorkflowNodeKind, readonly WorkflowInspectorSection[]>

function sectionsWith(
  kind: WorkflowNodeKind,
  extra: readonly WorkflowInspectorSection[],
): readonly WorkflowInspectorSection[] {
  return [...BASE_SECTIONS_BY_KIND[kind], ...extra]
}

export const WORKFLOW_PROFILE_REGISTRY = {
  intelligence: {
    id: "intelligence",
    label: "Intelligence",
    description: "News and signal monitoring workflows with review queues and guarded webhook delivery.",
    visiblePanels: ["project", "canvas", "palette", "inspector", "simulation", "proposals"],
    defaultAdapters: [
      {
        id: "jin10-kuaixun",
        type: "source",
        provider: "jin10",
        mode: "fixture",
        config: { feed: "kuaixun" },
      },
      {
        id: "webhook-notifier",
        type: "notification",
        provider: "webhook",
        mode: "webhook",
        config: { notifierType: "webhook", target: "webhook" },
      },
    ],
    defaultScoringProfile: {
      id: "importance",
      label: "Importance",
      scoreField: "score",
      threshold: 0.7,
      sort: "descending",
    },
    inspectorSectionsFor: (kind) => BASE_SECTIONS_BY_KIND[kind],
  },
  "agent-debug": {
    id: "agent-debug",
    label: "Agent Debug",
    description: "Verbose agent runs with permission, proposal, and execution log surfaces enabled.",
    visiblePanels: ["project", "canvas", "inspector", "simulation", "proposals", "logs"],
    defaultAdapters: [
      {
        id: "debug-agent",
        type: "agent",
        provider: "local-debug-agent",
        mode: "mock",
        config: { trace: true },
      },
    ],
    defaultScoringProfile: {
      id: "confidence",
      label: "Confidence",
      scoreField: "confidence",
      threshold: 0.5,
      sort: "descending",
    },
    inspectorSectionsFor: (kind) => sectionsWith(kind, ["debug"]),
  },
  "sdk-dev": {
    id: "sdk-dev",
    label: "SDK Dev",
    description: "Adapter and integration development profile focused on schemas and IO contracts.",
    visiblePanels: ["project", "canvas", "palette", "inspector", "logs"],
    defaultAdapters: [
      {
        id: "sdk-fixture-source",
        type: "source",
        provider: "sdk-fixture",
        mode: "fixture",
        config: { fixture: "empty" },
      },
      {
        id: "sdk-webhook",
        type: "utility",
        provider: "sdk-webhook",
        mode: "webhook",
        config: {},
      },
    ],
    defaultScoringProfile: {
      id: "latency",
      label: "Latency",
      scoreField: "latencyMs",
      threshold: 1000,
      sort: "ascending",
    },
    inspectorSectionsFor: (kind) => (kind === "action" ? sectionsWith(kind, ["sdk"]) : [...COMMON_SECTIONS, "sdk"]),
  },
} as const satisfies Record<WorkflowProfile, WorkflowProfileDefinition>

export const WORKFLOW_PROFILE_IDS = Object.keys(WORKFLOW_PROFILE_REGISTRY) as WorkflowProfile[]

export function getWorkflowProfileDefinition(profile: WorkflowProfile): WorkflowProfileDefinition {
  return WORKFLOW_PROFILE_REGISTRY[profile]
}

export function getWorkflowProfileDefaultAdapters(profile: WorkflowProfile): readonly AdapterBinding[] {
  return getWorkflowProfileDefinition(profile).defaultAdapters
}

export function getWorkflowProfileInspectorSections(
  profile: WorkflowProfile,
  kind: WorkflowNodeKind,
): readonly WorkflowInspectorSection[] {
  return getWorkflowProfileDefinition(profile).inspectorSectionsFor(kind)
}
