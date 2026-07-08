import { fetchJin10Fixture, fetchJin10Live, type WorkflowSourceItem } from "./adapters/jin10"
import type { AdapterBinding, WorkflowProject, WorkflowProjectNode } from "./schema"

export type SourceAdapterResult =
  | { ok: true; items: WorkflowSourceItem[] }
  | { ok: false; error: string }

export type SourceAdapter = {
  provider: string
  fetch: (binding: AdapterBinding, node: WorkflowProjectNode) => Promise<WorkflowSourceItem[]> | WorkflowSourceItem[]
}

export type AdapterRegistry = {
  sourceAdapters: Record<string, SourceAdapter>
}

export type AdapterRegistryOptions = {
  fetcher?: typeof fetch
}

export function createDefaultAdapterRegistry(options: AdapterRegistryOptions = {}): AdapterRegistry {
  return {
    sourceAdapters: {
      jin10: {
        provider: "jin10",
        fetch: (binding, node) => {
          const fetchOptions = {
            limit: readNumberParam(node, "limit"),
            importantOnly: readBooleanParam(node, "importantOnly"),
            channel: readStringParam(node, "channel") ?? readStringConfig(binding, "channel"),
            hot: readStringParam(node, "hot") ?? readStringConfig(binding, "hot"),
            fetcher: options.fetcher,
          }
          if (binding.mode === "live") return fetchJin10Live(fetchOptions)
          return fetchJin10Fixture(fetchOptions)
        },
      },
    },
  }
}

export async function runWorkflowSourceNode(
  project: WorkflowProject,
  nodeId: string,
  registry: AdapterRegistry,
): Promise<SourceAdapterResult> {
  const node = project.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) return { ok: false, error: `Workflow node "${nodeId}" was not found` }
  if (node.kind !== "source") return { ok: false, error: `Workflow node "${nodeId}" is not a source node` }
  if (!node.adapter) return { ok: false, error: `Workflow node "${nodeId}" has no adapter binding` }

  const binding = project.adapters.find((candidate) => candidate.id === node.adapter)
  if (!binding) return { ok: false, error: `Adapter binding "${node.adapter}" was not found` }

  const adapter = registry.sourceAdapters[binding.provider]
  if (!adapter) return { ok: false, error: `Source adapter provider "${binding.provider}" is not registered` }

  try {
    return { ok: true, items: await adapter.fetch(binding, node) }
  } catch (error) {
    return { ok: false, error: `Source adapter "${binding.provider}" failed: ${error instanceof Error ? error.message : "Unknown error"}` }
  }
}

function readNumberParam(node: WorkflowProjectNode, key: string): number | undefined {
  const value = node.params[key]
  return typeof value === "number" ? value : undefined
}

function readBooleanParam(node: WorkflowProjectNode, key: string): boolean | undefined {
  const value = node.params[key]
  return typeof value === "boolean" ? value : undefined
}

function readStringParam(node: WorkflowProjectNode, key: string): string | undefined {
  const value = node.params[key]
  return typeof value === "string" ? value : undefined
}

function readStringConfig(binding: AdapterBinding, key: string): string | undefined {
  const value = binding.config[key]
  return typeof value === "string" ? value : undefined
}
