import type {
  BackendNodeCapabilityCatalog,
  BackendNodeCapabilityDefinition,
} from "@/lib/plugins/backend-node-capabilities"

import type {
  WorkflowCapabilitiesResponse,
  WorkflowCapabilityStatus,
  WorkflowRuntimeCapability,
} from "./capabilities"

export function mergeBackendNodeCapabilityCatalog(
  legacy: WorkflowCapabilitiesResponse | null | undefined,
  catalog: BackendNodeCapabilityCatalog | null | undefined,
): WorkflowCapabilitiesResponse | null {
  if (!legacy && !catalog) return null
  const projected = (catalog?.nodes ?? []).map((node) => projectBackendNodeCapability(node, catalog))
  const catalogById = new Map((legacy?.catalog ?? []).map((item) => [item.id, item]))
  for (const capability of projected) catalogById.set(capability.id, capability)
  return {
    version: catalog?.version ?? legacy?.version ?? "workflow-capabilities.v1",
    catalog: [...catalogById.values()],
    primitives: legacy?.primitives ?? [],
    channels: legacy?.channels ?? [],
    notifiers: legacy?.notifiers ?? [],
    triggers: legacy?.triggers ?? [],
    resources: legacy?.resources ?? [],
  }
}

export function projectBackendNodeCapability(
  node: BackendNodeCapabilityDefinition,
  catalog?: Pick<BackendNodeCapabilityCatalog, "authority" | "version"> | null,
): WorkflowRuntimeCapability {
  const runtimeVerified = backendNodeCapabilityIsRunnable(node)
  const status: WorkflowCapabilityStatus = runtimeVerified
    ? "runnable"
    : node.readiness === "composed"
      ? "preview_only"
      : "blocked"
  const missing = node.missing.length > 0
    ? node.missing
    : runtimeVerified
      ? []
      : node.readiness === "composed"
        ? ["composition_dependencies_unverified"]
        : ["runtime_binding_unverified"]
  const reason = runtimeVerified
    ? node.description
    : node.readiness === "composed"
      ? `${node.description} 组合依赖尚未验证，仅可预览。`
      : node.readiness === "runnable"
        ? `${node.description} 运行绑定或依赖尚未通过验证。`
        : node.description
  return {
    id: node.id,
    label: node.label,
    surface: "catalog",
    status,
    backendAvailable: runtimeVerified,
    kind: node.kind,
    capability: node.capability,
    provider: node.provider,
    runtimeBinding: node.runtimeBinding ?? null,
    reason,
    missing,
    tags: [
      "node-capability",
      node.category,
      node.origin,
      ...node.difyNodeTypes.map((type) => `dify:${type}`),
    ],
    source: node.source,
    manifest: {
      schema: "capability.catalog-projection.v1",
      contract: backendNodeRuntimeContract(node, runtimeVerified),
      nodeCatalog: {
        authority: catalog?.authority ?? "backend",
        version: catalog?.version ?? "opencli.node-capabilities.v1",
        category: node.category,
        origin: node.origin,
        readiness: node.readiness,
        difyNodeTypes: node.difyNodeTypes,
      },
      presentation: {
        label: node.label,
        description: node.description,
        icon: node.icon,
        parameters: node.parameters,
      },
      ports: {
        inputs: node.inputPorts,
        outputs: node.outputPorts,
      },
      plugin: node.origin === "plugin"
        ? {
            providerKey: node.provider,
            version: "catalog",
            family: "plugin",
          }
        : undefined,
      canvas: {
        node: true,
        locked: !runtimeVerified,
        lockReason: runtimeVerified ? null : reason,
      },
    },
  }
}

function backendNodeRuntimeContract(
  node: BackendNodeCapabilityDefinition,
  runtimeVerified: boolean,
) {
  return {
    schemaVersion: 1,
    bindingId: node.runtimeBinding ?? `catalog:${node.id}`,
    status: runtimeVerified ? "executable" : "blocked_until_preconditions",
    inputShape: {
      ports: node.inputPorts.map((port) => ({ name: port.name, type: port.type })),
      params: node.parameters.map((parameter) => parameter.name),
    },
    outputShape: {
      ports: node.outputPorts.map((port) => ({ name: port.name, type: port.type })),
      artifacts: [],
    },
    permissionGate: { required: runtimeVerified ? [] : node.missing },
    configGate: { required: [] },
    eventShape: { events: [] },
    fixtureCoverage: { cases: [] },
    certification: {
      realNodeIoContract: runtimeVerified,
      realWebhookDelivery: false,
    },
    canvas: { exposeResourceInternals: false },
  }
}

export function backendNodeCapabilityIsRunnable(
  node: BackendNodeCapabilityDefinition,
): boolean {
  return (
    node.readiness === "runnable" &&
    Boolean(node.runtimeBinding?.trim()) &&
    node.missing.length === 0
  )
}
