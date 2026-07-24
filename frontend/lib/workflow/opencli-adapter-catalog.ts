import type { AdapterBinding, WorkflowCapability, WorkflowNodeKind } from "./schema"
import {
  runtimeContractForCapability,
  type WorkflowRuntimeCapability,
} from "./capabilities"
import type { WorkflowOpenCLIAdapterNode } from "./backend-opencli-adapter-nodes"
import type { WorkflowNodeCatalogItem } from "./node-catalog"

function safeIdPart(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "adapter"
}

function readAdapterBinding(node: WorkflowOpenCLIAdapterNode): AdapterBinding | undefined {
  const id = typeof node.adapter.id === "string" ? node.adapter.id : null
  if (!id || node.access !== "read") return undefined
  return {
    id,
    type: "source",
    provider: "opencli",
    mode: "live",
    config: { channel: "opencli" },
  }
}

function runtimeCapabilityForAdapterNode(node: WorkflowOpenCLIAdapterNode): WorkflowRuntimeCapability {
  const blockedForParams = node.status === "blocked" && node.requiredArgs.length > 0
  const blockedForReview = node.status === "blocked" && node.access !== "read"
  const runtime = node.manifest.runtime as Record<string, unknown> | undefined
  const runtimeBinding =
    runtime && typeof runtime.binding === "string"
      ? runtime.binding
      : null
  return {
    id: node.id,
    label: node.label,
    surface: "catalog",
    status: node.status,
    backendAvailable: true,
    kind: node.kind,
    capability: node.capability,
    provider: "opencli",
    channelType: node.access === "read" ? "opencli" : null,
    runtimeBinding,
    reason: blockedForParams
      ? `Configure required parameters: ${node.requiredArgs.join(", ")}`
      : blockedForReview
        ? "Review this write-capable OpenCLI command before execution."
        : "Discovered from the active OpenCLI adapter registry.",
    missing: blockedForParams ? node.requiredArgs.map((name) => `parameter:${name}`) : [],
    tags: ["opencli", "adapter", node.site, node.command, node.access],
    source: "backend.workflow.opencli_adapter_nodes",
    manifest: node.manifest,
  }
}

export function openCLIAdapterNodeToCatalogItem(
  node: WorkflowOpenCLIAdapterNode,
): WorkflowNodeCatalogItem {
  const isRead = node.access === "read"
  const adapter = readAdapterBinding(node)
  const runtimeCapability = runtimeCapabilityForAdapterNode(node)
  const kind: WorkflowNodeKind = isRead ? "source" : "action"
  const capability: WorkflowCapability = isRead ? "fetch" : "store"
  const params = isRead
    ? {
        ...node.params,
        opencliAdapterNodeId: node.id,
      }
    : {
        opencliAdapterNode: {
          id: node.id,
          site: node.site,
          command: node.command,
          access: node.access,
        },
        toolParams: node.params,
      }

  return {
    id: node.id,
    idPrefix: `opencli-${safeIdPart(node.site)}-${safeIdPart(node.command)}`,
    label: node.label,
    description: node.description || `${node.site} ${node.command} via OpenCLI`,
    category: isRead ? "source" : "output",
    profile: "intelligence",
    kind,
    capability,
    icon: isRead ? "Globe" : "Wrench",
    color: isRead ? "var(--chart-4)" : "var(--chart-3)",
    adapter: adapter?.id,
    requiredAdapters: adapter ? [adapter] : undefined,
    params,
    runtimeCapability,
    runtimeContract: runtimeContractForCapability(runtimeCapability),
    keywords: [
      "opencli",
      "adapter",
      node.site,
      node.command,
      node.access,
      ...(node.browser ? ["browser"] : []),
      ...(node.requiredArgs ?? []),
    ],
  }
}

export function mergeWorkflowNodeCatalog(
  staticItems: WorkflowNodeCatalogItem[],
  dynamicItems: WorkflowNodeCatalogItem[],
): WorkflowNodeCatalogItem[] {
  const merged = new Map(staticItems.map((item) => [item.id, item]))
  for (const item of dynamicItems) merged.set(item.id, item)
  return Array.from(merged.values())
}
