'use client'

import { ArrowRight, Braces, BrainCircuit, Database, ExternalLink, GitBranch, Network, X } from 'lucide-react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useMemo } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import type { WorkflowEdge, WorkflowNode } from '@/lib/flow/types'
import { useSettingsStore } from '@/lib/flow/settings-store'
import { runtimeStatusLabel, runtimeStatusTone } from '@/lib/workflow/capabilities'
import { localizeNodeText } from '@/lib/workflow/node-i18n'
import { cn } from '@/lib/utils'

export type WorkflowWorkbenchMode = 'data' | 'evidence'

export function WorkflowWorkbenchPanel({
  mode,
  nodes,
  edges,
  onModeChange,
  onClose,
}: {
  mode: WorkflowWorkbenchMode
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  onModeChange: (mode: WorkflowWorkbenchMode) => void
  onClose: () => void
}) {
  const params = useSearchParams()
  const language = useSettingsStore((state) => state.language)
  const workspaceId = params.get('workspace')
  const projectId = params.get('project')
  const workflowId = params.get('workflow')
  const selectedNode = nodes.find((node) => node.selected) ?? nodes[0] ?? null
  const selectedNodeText = selectedNode
    ? localizeNodeText(
        selectedNode.data.canonical?.catalogId ?? selectedNode.data.runtimeCapability?.id ?? selectedNode.id,
        { label: selectedNode.data.label, description: selectedNode.data.description },
        language,
      )
    : null
  const usingFallback = Boolean(selectedNode && !selectedNode.selected)
  const nodePorts = selectedNode ? workbenchPorts(selectedNode, edges) : { inputs: [], outputs: [] }
  const inputPorts = nodePorts.inputs
  const outputPorts = nodePorts.outputs
  const batches = selectedNode?.data.runtimeEvidenceBatches ?? []
  const evidencePath = useMemo(
    () => selectedNode ? upstreamPath(nodes, edges, selectedNode.id) : [],
    [edges, nodes, selectedNode],
  )
  const events = useMemo(
    () => nodes.flatMap((node) => node.data.runtimeLatestEvent ? [{ node, event: node.data.runtimeLatestEvent }] : [])
      .sort((left, right) => right.event.sequence - left.event.sequence)
      .slice(0, 10),
    [nodes],
  )
  const dataHref = workspaceId && projectId
    ? `/studio/projects/${projectId}/data?workspace=${workspaceId}${workflowId ? `&workflow=${workflowId}` : ''}`
    : null
  const evidenceHref = workspaceId && projectId
    ? `/studio/projects/${projectId}/evidence?workspace=${workspaceId}${workflowId ? `&workflow=${workflowId}` : ''}`
    : null

  return (
    <aside className="workflow-floating-panel absolute bottom-3 right-3 top-3 z-40 flex w-[25rem] max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-lg border bg-popover shadow-2xl" aria-label="画布工作台">
      <header className="flex items-center gap-2 border-b px-3 py-2.5">
        <span className="grid size-8 place-items-center rounded-md border bg-background">
          {mode === 'data' ? <Database className="size-4" /> : <BrainCircuit className="size-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold">画布工作台</p>
          <p className="truncate text-[10px] text-muted-foreground">跟随当前选中节点 · 只读诊断</p>
        </div>
        <Button variant="ghost" size="icon" className="size-9" onClick={onClose} aria-label="关闭画布工作台"><X className="size-4" /></Button>
      </header>

      <div className="grid grid-cols-2 border-b p-1.5" role="tablist" aria-label="画布工作台视图">
        <PanelTab active={mode === 'data'} icon={Database} onClick={() => onModeChange('data')}>节点数据</PanelTab>
        <PanelTab active={mode === 'evidence'} icon={GitBranch} onClick={() => onModeChange('evidence')}>逻辑证据</PanelTab>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {!selectedNode ? <EmptyPanel /> : <>
          <section>
            <div className="flex items-center justify-between gap-2">
              <Badge variant="outline">{selectedNode.data.category}</Badge>
              <span className={cn('rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase', runtimeStatusTone(selectedNode.data.runtimeCapability?.status))}>{runtimeStatusLabel(selectedNode.data.runtimeCapability?.status)}</span>
            </div>
            <h2 className="mt-3 text-base font-semibold">{selectedNodeText?.label ?? selectedNode.data.label}</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{selectedNodeText?.description || '该节点没有额外说明。'}{usingFallback ? ' 当前未选择节点，暂时显示流程首节点。' : ''}</p>
          </section>

          {mode === 'data' ? <NodeDataView inputPorts={inputPorts} outputPorts={outputPorts} batches={batches} node={selectedNode} /> : <NodeEvidenceView path={evidencePath} events={events} selectedNode={selectedNode} />}
        </>}
      </div>

      <footer className="flex flex-wrap gap-2 border-t p-3">
        {mode === 'data' && dataHref ? <Link href={dataHref} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'flex-1')}><ExternalLink className="size-3.5" />完整数据工作台</Link> : null}
        {mode === 'evidence' && evidenceHref ? <Link href={evidenceHref} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'flex-1')}><ExternalLink className="size-3.5" />完整逻辑与证据</Link> : null}
      </footer>
    </aside>
  )
}

function PanelTab({ active, children, icon: Icon, onClick }: { active: boolean; children: React.ReactNode; icon: typeof Database; onClick: () => void }) {
  return <button type="button" role="tab" aria-selected={active} onClick={onClick} className={cn('flex min-h-9 items-center justify-center gap-2 rounded-md text-xs transition-colors', active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}><Icon className="size-3.5" />{children}</button>
}

function NodeDataView({ inputPorts, outputPorts, batches, node }: { inputPorts: Array<{ name: string; type: string }>; outputPorts: Array<{ name: string; type: string }>; batches: NonNullable<WorkflowNode['data']['runtimeEvidenceBatches']>; node: WorkflowNode }) {
  const fields = node.data.fields ?? []
  const canonicalParams = node.data.canonical?.params ?? {}
  const params = fields.length ? fields.map((field) => [field.label, field.value] as const) : Object.entries(canonicalParams).slice(0, 8)
  return <div className="mt-5 space-y-5">
    <section><SectionTitle icon={Network}>输入输出接口</SectionTitle><div className="mt-2 grid grid-cols-2 gap-2"><PortList title="IN" ports={inputPorts} empty="无输入端口" /><PortList title="OUT" ports={outputPorts} empty="无输出端口" /></div></section>
    <section><SectionTitle icon={Braces}>公开参数</SectionTitle><div className="mt-2 overflow-hidden rounded-md border">{params.length ? params.map(([key, value]) => <div key={key} className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2 border-b px-3 py-2 text-xs last:border-b-0"><span className="truncate font-mono text-muted-foreground">{key}</span><span className="truncate text-right">{formatValue(value)}</span></div>) : <p className="p-3 text-xs text-muted-foreground">当前节点没有公开参数。</p>}</div></section>
    <section><SectionTitle icon={Database}>运行批次</SectionTitle><div className="mt-2 space-y-2">{batches.length ? batches.slice(0, 8).map((batch) => <div key={batch.batchId} className="rounded-md border p-3"><div className="flex items-center justify-between gap-2"><span className="truncate font-mono text-[10px]">{batch.batchId}</span><Badge variant="outline">{batch.status}</Badge></div><p className="mt-2 text-xs text-muted-foreground">{batch.itemCount} items · {batch.recordCount} records</p></div>) : <p className="rounded-md border border-dashed p-4 text-xs leading-5 text-muted-foreground">尚未产生运行批次。试运行后这里会显示真实 items、records 和批次状态。</p>}</div></section>
  </div>
}

function NodeEvidenceView({ path, events, selectedNode }: { path: WorkflowNode[]; events: Array<{ node: WorkflowNode; event: NonNullable<WorkflowNode['data']['runtimeLatestEvent']> }>; selectedNode: WorkflowNode }) {
  return <div className="mt-5 space-y-5">
    <section><SectionTitle icon={GitBranch}>上游决策路径</SectionTitle><p className="mt-1 text-[11px] leading-5 text-muted-foreground">显式展示节点和运行事实，不展示模型内部原始思维链。</p><div className="mt-3 space-y-2">{path.map((node, index) => <div key={node.id} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2"><span className="grid size-6 place-items-center rounded-full border bg-background font-mono text-[9px]">{index + 1}</span><div className={cn('rounded-md border px-3 py-2', node.id === selectedNode.id && 'border-primary/60 bg-primary/5')}><p className="truncate text-xs font-medium">{node.data.label}</p><p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">{node.data.runtimeLatestEvent?.eventType ?? node.data.runtimeCapability?.status ?? 'configured'}</p></div>{index < path.length - 1 ? <ArrowRight className="ml-1 size-3 rotate-90 text-muted-foreground" /> : null}</div>)}</div></section>
    <section><SectionTitle icon={BrainCircuit}>最近运行事件</SectionTitle><div className="mt-2 space-y-2">{events.length ? events.map(({ node, event }) => <div key={event.id} className="rounded-md border p-3"><div className="flex items-center justify-between gap-2"><p className="truncate text-xs font-medium">{node.data.label}</p><Badge variant="outline">{event.eventType}</Badge></div><p className="mt-1 line-clamp-2 text-[11px] leading-5 text-muted-foreground">{event.message || `sequence ${event.sequence} · trace ${event.traceId}`}</p></div>) : <p className="rounded-md border border-dashed p-4 text-xs leading-5 text-muted-foreground">尚未产生运行事件。试运行后这里会按 sequence 展示节点事实和 trace 标识。</p>}</div></section>
  </div>
}

function PortList({ title, ports, empty }: { title: string; ports: Array<{ name: string; type: string }>; empty: string }) {
  return <div className="rounded-md border p-2.5"><p className="font-mono text-[9px] text-muted-foreground">{title}</p><div className="mt-2 space-y-2">{ports.length ? ports.map((port) => <div key={port.name}><p className="truncate font-mono text-[11px]">{port.name}</p><p className="truncate font-mono text-[9px] text-muted-foreground">{port.type}</p></div>) : <p className="text-[10px] text-muted-foreground">{empty}</p>}</div></div>
}

function SectionTitle({ children, icon: Icon }: { children: React.ReactNode; icon: typeof Database }) { return <div className="flex items-center gap-2 text-xs font-medium"><Icon className="size-3.5 text-muted-foreground" />{children}</div> }
function EmptyPanel() { return <div className="grid min-h-72 place-items-center text-center"><div><Database className="mx-auto size-5 text-muted-foreground" /><p className="mt-3 text-sm font-medium">画布还没有节点</p><p className="mt-1 text-xs text-muted-foreground">添加节点后可在这里检查数据与证据。</p></div></div> }
function formatValue(value: unknown) { if (value === null || value === undefined || value === '') return '—'; if (typeof value === 'string') return value; if (typeof value === 'number' || typeof value === 'boolean') return String(value); return JSON.stringify(value) }

function upstreamPath(nodes: WorkflowNode[], edges: WorkflowEdge[], targetId: string) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const incomingCount = new Map(nodes.map((node) => [node.id, 0]))
  const outgoing = new Map<string, string[]>()
  edges.forEach((edge) => {
    incomingCount.set(edge.target, (incomingCount.get(edge.target) ?? 0) + 1)
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target])
  })
  const roots = nodes.filter((node) => (incomingCount.get(node.id) ?? 0) === 0).map((node) => node.id)
  const queue = roots.length ? [...roots] : nodes.slice(0, 1).map((node) => node.id)
  const parent = new Map<string, string | null>(queue.map((id) => [id, null]))
  while (queue.length) {
    const current = queue.shift() as string
    if (current === targetId) break
    for (const neighbor of outgoing.get(current) ?? []) if (!parent.has(neighbor)) { parent.set(neighbor, current); queue.push(neighbor) }
  }
  if (!parent.has(targetId)) return nodeById.get(targetId) ? [nodeById.get(targetId) as WorkflowNode] : []
  const ids: string[] = []
  for (let current: string | null = targetId; current; current = parent.get(current) ?? null) ids.unshift(current)
  return ids.flatMap((id) => nodeById.get(id) ? [nodeById.get(id) as WorkflowNode] : [])
}

type WorkbenchPort = { name: string; type: string }

function workbenchPorts(node: WorkflowNode, edges: WorkflowEdge[]): { inputs: WorkbenchPort[]; outputs: WorkbenchPort[] } {
  const runtimeContract = node.data.runtimeContract
  const primitivePorts = Array.isArray(node.data.primitivePorts)
    ? node.data.primitivePorts as Array<{ id: string; direction: string; type: string }>
    : []
  const declaredInputs = runtimeContract?.inputShape.ports?.length
    ? runtimeContract.inputShape.ports.map((port) => ({ name: port.name, type: port.type }))
    : primitivePorts.filter((port) => port.direction === 'input').map((port) => ({ name: port.id, type: port.type }))
  const declaredOutputs = runtimeContract?.outputShape.ports?.length
    ? runtimeContract.outputShape.ports.map((port) => ({ name: port.name, type: port.type }))
    : primitivePorts.filter((port) => port.direction === 'output').map((port) => ({ name: port.id, type: port.type }))
  const semantic = semanticWorkbenchPorts(node.data.canonical?.kind)
  return {
    inputs: mergeWorkbenchPorts(declaredInputs.length ? declaredInputs : semantic.inputs, edges.filter((edge) => edge.target === node.id).map((edge) => edge.targetHandle)),
    outputs: mergeWorkbenchPorts(declaredOutputs.length ? declaredOutputs : semantic.outputs, edges.filter((edge) => edge.source === node.id).map((edge) => edge.sourceHandle)),
  }
}

function semanticWorkbenchPorts(kind: string | undefined): { inputs: WorkbenchPort[]; outputs: WorkbenchPort[] } {
  if (kind === 'schedule') return { inputs: [], outputs: [{ name: 'out', type: 'trigger' }] }
  if (kind === 'source') return { inputs: [{ name: 'in', type: 'trigger' }], outputs: [{ name: 'out', type: 'items[]' }] }
  if (kind === 'sink') return { inputs: [{ name: 'records', type: 'record[]' }], outputs: [{ name: 'stored', type: 'storedItems[]' }] }
  return { inputs: [], outputs: [] }
}

function mergeWorkbenchPorts(declared: WorkbenchPort[], connectedIds: Array<string | null | undefined>) {
  const ports = new Map(declared.map((port) => [port.name, port]))
  connectedIds.forEach((id) => {
    if (!id && declared.length) return
    const name = id ?? 'default'
    if (!ports.has(name)) ports.set(name, { name, type: 'unknown' })
  })
  return [...ports.values()]
}
