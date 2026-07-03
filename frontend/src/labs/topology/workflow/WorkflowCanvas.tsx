import { useMemo } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  type Edge,
  type Node,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { CalendarClock, Database, Filter, Mail, Webhook } from 'lucide-react'

import { WF, workflowNodeTypes } from './WorkflowNodes'

/* Sample xyops-style workflow graph for the data-collection pipeline.
 * Demonstrates the full node taxonomy reused from 2233admin/xyops:
 * trigger → job → controller → event(s), with action + limit attached, + note. */

const NODES: Node[] = [
  {
    id: 'trig',
    type: 'wfTrigger',
    position: { x: 24, y: 150 },
    data: { label: 'schedule', icon: CalendarClock },
  },
  {
    id: 'job',
    type: 'wfJob',
    position: { x: 150, y: 118 },
    data: {
      kind: 'job',
      title: '采集任务 · binance-funding',
      pill: 'JOB',
      pillTone: 'cyan',
      icon: Database,
      state: 'running',
      rows: [
        { k: 'plugin', v: 'opencli.collect' },
        { k: 'target', v: 'coinglass' },
        { k: 'status', v: 'running' },
      ],
    },
  },
  {
    id: 'limit',
    type: 'wfLimit',
    position: { x: 232, y: 330 },
    data: { label: 'concurrency 4' },
  },
  {
    id: 'act',
    type: 'wfAction',
    position: { x: 470, y: 330 },
    data: { label: 'notify', icon: Mail },
  },
  {
    id: 'ctrl',
    type: 'wfController',
    position: { x: 470, y: 140 },
    data: { label: 'fan-out', icon: Filter },
  },
  {
    id: 'evtA',
    type: 'wfEvent',
    position: { x: 660, y: 40 },
    data: {
      kind: 'event',
      title: '归一化处理器',
      pill: 'EVENT',
      icon: CalendarClock,
      state: 'success',
      rows: [
        { k: 'event', v: 'normalize.v1' },
        { k: 'agent', v: 'gpt-4o-mini' },
      ],
    },
  },
  {
    id: 'evtB',
    type: 'wfEvent',
    position: { x: 660, y: 250 },
    data: {
      kind: 'event',
      title: '存储 + 通知规则',
      pill: 'EVENT',
      icon: Webhook,
      state: 'warning',
      rows: [
        { k: 'event', v: 'store.records' },
        { k: 'rules', v: '7 active' },
      ],
    },
  },
  {
    id: 'note',
    type: 'wfNote',
    position: { x: 24, y: 320 },
    data: { text: '触发器→任务→分支→事件；动作与限流节点附着在任务上，运行时并入子作业。' },
  },
]

function edge(id: string, source: string, target: string, color: string, sh = 'out', th = 'in'): Edge {
  return {
    id,
    source,
    target,
    sourceHandle: sh,
    targetHandle: th,
    type: 'default',
    animated: color === WF.orange || color === WF.blue,
    style: { stroke: color, strokeWidth: 1.8 },
    markerEnd: { type: MarkerType.ArrowClosed, color },
  }
}

const EDGES: Edge[] = [
  edge('e-trig-job', 'trig', 'job', WF.orange),
  edge('e-job-ctrl', 'job', 'ctrl', WF.blue),
  edge('e-job-act', 'job', 'act', WF.green),
  edge('e-job-limit', 'job', 'limit', WF.cyan, 'limit', 'up'),
  edge('e-ctrl-a', 'ctrl', 'evtA', WF.purple),
  edge('e-ctrl-b', 'ctrl', 'evtB', WF.purple),
]

function miniColor(node: Node): string {
  switch (node.type) {
    case 'wfTrigger': return WF.orange
    case 'wfAction': return WF.green
    case 'wfController': return WF.purple
    case 'wfLimit': return WF.cyan
    case 'wfNote': return '#d99a3d'
    default: return WF.blue
  }
}

export function WorkflowCanvas() {
  const nodeTypes = useMemo(() => workflowNodeTypes, [])

  return (
    <ReactFlow
      nodes={NODES}
      edges={EDGES}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.18 }}
      minZoom={0.4}
      maxZoom={1.6}
      nodesDraggable
      nodesConnectable={false}
      proOptions={{ hideAttribution: true }}
      className="bg-ops-black"
    >
      <Background variant={BackgroundVariant.Dots} color="#2a2a32" gap={22} size={1.6} />
      <Controls position="bottom-left" showInteractive={false} />
      <MiniMap position="bottom-right" nodeColor={miniColor} maskColor="rgba(5,7,8,0.78)" pannable zoomable />
      <Panel position="top-left">
        <div className="border border-white/10 bg-black/80 px-3 py-1.5 font-mono text-2xs text-zinc-400">
          workflow nodes · xyops taxonomy
        </div>
      </Panel>
    </ReactFlow>
  )
}
