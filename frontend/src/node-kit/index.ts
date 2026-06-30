// @opencli/node-kit — public API.
// L3 reusable node layer: one serializable NodeSpec contract, one registry, one
// generic xyflow renderer, a set of atomic node primitives, and an agent bridge.
// Authored by humans (defineNode) and agents (instantiate JSON) alike.

// contract
export type {
  NodeSpec,
  NodeInstance,
  NodeCategory,
  PortDef,
  NodeOp,
  FieldDef,
  ConfigSchema,
  ConfigValues,
  NodeRenderContext,
  // reserved execution surface
  NodeRunContext,
  EdgeValue,
  RunResult,
} from './spec'

// authoring
export { defineNode, parseConfig, type ConfigParseResult } from './define'

// registry
export {
  registerNode,
  registerNodes,
  getNode,
  listNodes,
  hasNode,
  instantiate,
  _clearRegistry,
} from './registry'

// render
export { KitNode, type KitNodeData } from './render/KitNode'
export { nodeTypesForXyflow } from './render/nodeTypes'
export { NodeWorkbench, type WorkbenchSeed } from './render/NodeWorkbench'

// runtime — self-built P0 executor (topo-sort → run pure nodes → backend hook → artifact)
export { runGraph, type RunNode, type RunEdge, type RunGraphResult, type BackendRunner } from './runtime/engine'
export {
  NodeHeader,
  NodePort,
  NodeField,
  NodeFieldEdit,
  NodeStat,
  NodeBadge,
  NodeOpButton,
  NodeToggle,
  iconByName,
} from './render/atoms'

// atomic node library (real system functionality, nodified)
export { ALL_NODES, SOURCE_NODES, PROCESSOR_NODES, PIPELINE_NODES, PRIMITIVE_NODES, COLLECTION_NODES } from './nodes'

// macros — saved subgraph + collapse/expand (pure graph ops) + runGraph flatten
export type { MacroDef, MacroPort } from './macros'
export {
  buildMacroDef,
  deriveBoundaryPorts,
  makeMacroSpec,
  registerMacroSpec,
  registerSavedMacros,
  inlineMacro,
  flattenForRun,
  listMacros,
  saveMacro,
  getMacro,
  deleteMacro,
} from './macros'

// agent bridge
export {
  nodeCatalogForAgent,
  nodeToAgentDescriptor,
  configToJsonSchema,
  type AgentNodeDescriptor,
} from './agent/toSchema'
