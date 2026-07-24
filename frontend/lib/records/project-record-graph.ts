import { MultiUndirectedGraph } from 'graphology'

import type {
  ProjectRecordGraphPreview,
  RecordGraphEdge,
  RecordGraphNode,
  RecordGraphNodeKind,
} from '@/lib/api/types'

export type ProjectGraphNodeAttributes = {
  baseColor: string
  baseLabel: string
  baseSize: number
  color: string
  count: number
  forceLabel: boolean
  graphNode: RecordGraphNode
  highlighted: boolean
  kind: RecordGraphNodeKind
  label: string
  selected: boolean
  size: number
  x: number
  y: number
  zIndex: number
}

export type ProjectGraphEdgeAttributes = {
  activeColor: string
  baseSize: number
  color: string
  graphEdge: RecordGraphEdge
  hidden: boolean
  label: string
  size: number
}

export const RECORD_GRAPH_KIND_LABEL: Record<RecordGraphNodeKind, string> = {
  project: '项目',
  workflow: '工作流',
  run: '采集运行',
  source: '数据源',
  record: '消息 / 成果',
  entity: '实体 / 标签',
}

export const RECORD_GRAPH_KIND_COLOR: Record<RecordGraphNodeKind, string> = {
  project: '#8b5cf6',
  workflow: '#6366f1',
  run: '#38bdf8',
  source: '#22c55e',
  record: '#94a3b8',
  entity: '#f59e0b',
}

const KIND_RADIUS: Record<RecordGraphNodeKind, number> = {
  project: 0,
  workflow: 0.28,
  run: 0.48,
  source: 0.56,
  entity: 0.76,
  record: 0.92,
}

const EDGE_ACTIVE_COLOR: Record<RecordGraphEdge['kind'], string> = {
  contains: '#a78bfa',
  produced: '#818cf8',
  origin: '#4ade80',
  semantic: '#fbbf24',
  reference: '#f472b6',
  batch: '#38bdf8',
  duplicate: '#fb7185',
}

function stableFraction(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) / 4_294_967_295
}

function nodePosition(node: RecordGraphNode, index: number, total: number) {
  if (node.kind === 'project') return { x: 0, y: 0 }
  const jitter = stableFraction(node.id)
  const angle = ((index + jitter) / Math.max(1, total)) * Math.PI * 2
    + stableFraction(`${node.id}:angle`) * 0.7
  const radius = KIND_RADIUS[node.kind] * (0.88 + jitter * 0.2)
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  }
}

function nodeSize(node: RecordGraphNode) {
  const countSize = Math.log1p(Math.max(1, node.count)) * 2.15
  const base = node.kind === 'project'
    ? 13
    : node.kind === 'workflow'
      ? 8
      : node.kind === 'record'
        ? 3.4
        : 5
  return Math.min(28, base + countSize)
}

export function buildProjectRecordGraph(preview: ProjectRecordGraphPreview) {
  const graph = new MultiUndirectedGraph<
    ProjectGraphNodeAttributes,
    ProjectGraphEdgeAttributes
  >()
  const kindIndex = new Map<RecordGraphNodeKind, number>()
  const kindTotals = preview.nodes.reduce((totals, node) => {
    totals.set(node.kind, (totals.get(node.kind) ?? 0) + 1)
    return totals
  }, new Map<RecordGraphNodeKind, number>())

  preview.nodes.forEach((node) => {
    const index = kindIndex.get(node.kind) ?? 0
    kindIndex.set(node.kind, index + 1)
    const position = nodePosition(node, index, kindTotals.get(node.kind) ?? 1)
    const color = RECORD_GRAPH_KIND_COLOR[node.kind]
    const size = nodeSize(node)
    const overviewLabel = node.kind === 'record' ? '' : node.label
    graph.addNode(node.id, {
      ...position,
      baseColor: color,
      baseLabel: node.label,
      baseSize: size,
      color,
      count: node.count,
      forceLabel: false,
      graphNode: node,
      highlighted: false,
      kind: node.kind,
      label: overviewLabel,
      selected: false,
      size,
      zIndex: node.kind === 'project' ? 3 : node.kind === 'record' ? 0 : 2,
    })
  })

  preview.edges.forEach((edge) => {
    if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) return
    const size = Math.min(1.6, 0.16 + Math.log1p(edge.weight) * 0.22)
    graph.addUndirectedEdgeWithKey(edge.id, edge.source, edge.target, {
      activeColor: EDGE_ACTIVE_COLOR[edge.kind],
      baseSize: size,
      color: '#3f3f46',
      graphEdge: edge,
      hidden: edge.kind === 'batch' || edge.kind === 'duplicate',
      label: edge.label,
      size,
    })
  })

  return graph
}
