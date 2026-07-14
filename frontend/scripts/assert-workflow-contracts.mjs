import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import {
  isUserFacingRuntimeParam,
  projectedCatalogRuntimeCapability,
  runtimeContractForCapability,
} from "../lib/workflow/capabilities.ts"
import {
  MAX_WORKFLOW_NODE_DEPTH,
  validateWorkflowNodeHierarchy,
  workflowNodeLayerAtDepth,
} from "../lib/workflow/node-hierarchy.ts"
import {
  normalizeWorkflowRuntimeNodePath,
  workflowRuntimeCanvasNodeIds,
} from "../lib/workflow/node-path.ts"
import { parseWorkflowProject } from "../lib/workflow/schema.ts"

const capability = {
  id: "intelligence.source.opencli-slot",
  label: "OpenCLI Source Slot",
  surface: "catalog",
  status: "runnable",
  backendAvailable: true,
  missing: [],
  tags: [],
  manifest: {
    contract: {
      schemaVersion: 1,
      bindingId: "iii.collector-opencli.snapshot",
      status: "dispatch_only",
      inputShape: { ports: [{ name: "in", type: "trigger" }], params: ["site", "command", "profileId"] },
      outputShape: { ports: [{ name: "out", type: "items[]" }], artifacts: ["batch_ready"] },
      permissionGate: { required: ["canFetchNetwork"] },
      configGate: { required: ["opencli_channel"] },
      eventShape: { events: ["batch_ready", "completed"] },
      fixtureCoverage: { cases: ["happy-path"] },
      certification: { realNodeIoContract: true, realWebhookDelivery: false },
      canvas: { exposeResourceInternals: false },
    },
  },
}

const contract = runtimeContractForCapability(capability)
assert.equal(contract?.bindingId, "iii.collector-opencli.snapshot")
assert.deepEqual(contract?.outputShape.ports, [{ name: "out", type: "items[]" }])
assert.deepEqual(contract?.eventShape.events, ["batch_ready", "completed"])

const unsupported = projectedCatalogRuntimeCapability(
  undefined,
  { id: "canvas.placeholder", label: "Placeholder", kind: "schedule", capability: "trigger" },
  true,
)
assert.equal(unsupported?.status, "design_only")
assert.equal(projectedCatalogRuntimeCapability(undefined, { id: "loading", label: "Loading" }, false), undefined)

assert.equal(isUserFacingRuntimeParam("interval"), true)
for (const hidden of ["cookieJar", "profileId", "sessionPolicy", "workerTags", "command"]) {
  assert.equal(isUserFacingRuntimeParam(hidden), false, `${hidden} must not become a user input`)
}

assert.equal(MAX_WORKFLOW_NODE_DEPTH, 4)
assert.deepEqual(
  [1, 2, 3, 4].map((depth) => workflowNodeLayerAtDepth(depth).role),
  ["operator", "implementation", "component", "primitive"],
)

const hierarchyNode = (depth, maxDepth) => ({
  id: `node-${depth}`,
  kind: "action",
  capability: "store",
  params: {},
  ...(depth < maxDepth
    ? { internals: { locked: false, nodes: [hierarchyNode(depth + 1, maxDepth)], edges: [] } }
    : {}),
})

assert.doesNotThrow(() => validateWorkflowNodeHierarchy([hierarchyNode(1, 4)]))
const fourLayerHierarchyWithEmptyPrimitiveInternals = hierarchyNode(1, 4)
fourLayerHierarchyWithEmptyPrimitiveInternals.internals.nodes[0].internals.nodes[0].internals.nodes[0].internals = {
  locked: false,
  nodes: [],
  edges: [],
}
assert.doesNotThrow(() => validateWorkflowNodeHierarchy([fourLayerHierarchyWithEmptyPrimitiveInternals]))
assert.throws(
  () => validateWorkflowNodeHierarchy([hierarchyNode(1, 5)]),
  /exceeds the 4-layer limit/,
)
const duplicateInternalEdges = hierarchyNode(1, 2)
duplicateInternalEdges.internals.edges = [
  { id: "duplicate", source: "node-2", target: "node-2" },
  { id: "duplicate", source: "node-2", target: "node-2" },
]
assert.throws(
  () => validateWorkflowNodeHierarchy([duplicateInternalEdges]),
  /duplicate edge id "duplicate"/,
)
const minimalProject = {
  id: "workflow-contract",
  name: "Workflow contract",
  profile: "intelligence",
  version: 1,
  nodes: [{ id: "valid-node", kind: "action", capability: "store", params: {} }],
  edges: [],
  adapters: [],
  settings: { timezone: "Asia/Shanghai", deterministicSimulation: true, maxItemsPerRun: 20 },
  agentPermissions: {
    canFetchNetwork: false,
    canSendNotifications: false,
    canWriteInbox: true,
    allowedDomains: [],
  },
}
for (const reservedId of ["ambiguous::node", "ambiguous__node"]) {
  assert.throws(
    () => parseWorkflowProject({
      ...minimalProject,
      nodes: [{ ...minimalProject.nodes[0], id: reservedId }],
    }),
    /reserved path separators/,
  )
}
assert.deepEqual(
  workflowRuntimeCanvasNodeIds({
    nodeId: "operator::implementation::component::primitive",
    nodePath: ["operator", "implementation", "component", "primitive"],
  }),
  ["operator", "operator__implementation", "operator__implementation__component", "operator__implementation__component__primitive"],
)
assert.deepEqual(
  normalizeWorkflowRuntimeNodePath({
    nodeId: "operator::implementation",
    packageNodeId: "operator",
    internalNodeId: "operator::implementation",
  }),
  ["operator", "implementation"],
)

const root = fileURLToPath(new URL("..", import.meta.url))
const contractsSource = readFileSync(`${root}/lib/workflow/node-contracts.ts`, "utf8")
const templatesSource = readFileSync(`${root}/lib/workflow/node-templates.ts`, "utf8")
const catalogSource = readFileSync(`${root}/lib/workflow/node-catalog.ts`, "utf8")
assert.doesNotMatch(contractsSource, /node\.kind === "schedule" && node\.capability === "trigger"/)
assert.doesNotMatch(templatesSource, /node\.kind === "schedule" && node\.capability === "trigger"/)
assert.match(catalogSource, /export function createOperatorNodeFromCatalog/)
assert.match(catalogSource, /execution:\s*"internals"/)
assert.match(catalogSource, /nodes:\s*\[implementationNode\]/)
assert.match(catalogSource, /networkRole:\s*"operator"/)
assert.match(catalogSource, /networkRole:\s*"implementation"/)

console.log("workflow contract assertions passed")
