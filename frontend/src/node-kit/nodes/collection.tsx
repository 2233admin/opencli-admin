// Collection-stage nodes — the 采集网络 L1/L2 pipeline stages as NodeSpecs, so the
// topology canvas renders them through the one generic <KitNode> instead of a
// hand-rolled component. One node TYPE per stage kind (collection.<kind>), with
// the same status/gap facts + badge chips the old TopologyNodeView drew, and ops
// that call the same backend endpoints StageOperations uses (启停 / 测连通 / 重跑 …).
//
// Lives at frontend/src/node-kit/nodes/ (incubating); promoted with the rest of
// node-kit once stable. `.tsx` because the spec `render()` bodies use JSX.
import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'

import { defineNode } from '../define'
import type { NodeRenderContext, NodeSpec } from '../spec'
import { NodeBadge, NodeField } from '../render/atoms'
import { SourceControlStrip } from '../render/controlState'
import { odpNodeFacts, odpNodeHealth } from '../../labs/topology/odpNode'
import {
  deleteRecord,
  getOdpState,
  testSourceConnectivity,
  triggerTask,
  updateAgent,
  updateNotificationRule,
  updateSchedule,
  updateSource,
} from '../../api/endpoints'

// ── shared card body ─────────────────────────────────────────────────────────
// Reproduces the old TopologyNodeView body: a 状态 row, a 缺口 row, then badge
// chips. Facts are fed in by the host (ReactFlowTopologyCanvas stageFacts), and
// badges arrive via config.__badges so the visual is unchanged.
function readFact(facts: Record<string, unknown>, key: string, fallback: string) {
  const v = facts[key]
  return typeof v === 'string' && v.length > 0 ? v : fallback
}

function StageBody(ctx: NodeRenderContext): ReactNode {
  const facts = ctx.facts ?? {}
  const status = readFact(facts, '状态', '—')
  const gap = readFact(facts, '缺口', '暂无能力缺口')
  const badges = Array.isArray(ctx.config.__badges) ? ctx.config.__badges.map((b) => String(b)) : []
  return (
    <div className="grid gap-1.5">
      <NodeField label="状态" value={status} />
      <NodeField label="缺口" value={gap} />
      {badges.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {badges.slice(0, 2).map((b) => (
            <NodeBadge key={b}>{b}</NodeBadge>
          ))}
        </div>
      )}
    </div>
  )
}

// ── entity-id helpers (carried on config by the host) ────────────────────────
const entityId = (ctx: NodeRenderContext) => String(ctx.config.__entityId ?? '')

// C0 (Control Room v0, docs/CONTROL_THEORY_ARCHITECTURE.md §0): collection.source
// is the node type ReactFlowTopologyCanvas actually renders for a data source
// (stageConfig stamps config.__entityId = the real source id) — reuse the same
// StageBody plus SourceControlStrip so this canvas gets the "never a fake
// healthy" guarantee too, not just the node-kit workbench's source.* atoms.
function SourceStageBody(ctx: NodeRenderContext): ReactNode {
  return (
    <>
      {StageBody(ctx)}
      <SourceControlStrip sourceId={entityId(ctx)} />
    </>
  )
}

// ── specs ────────────────────────────────────────────────────────────────────
const source = defineNode({
  type: 'collection.source',
  category: 'source',
  title: '采集源',
  subtitle: 'source',
  icon: 'satellite-dish',
  // L0/L1 source has NO inbound edge — keep inputs:[] so we don't render a stray,
  // dangling target handle (the model's ports.inputs=['topic'] is unused here).
  ports: { inputs: [], outputs: [{ id: 'collect', label: '采集' }] },
  config: {
    fields: [
      { key: 'name', type: 'string', label: '名称', required: true },
      { key: 'channel_type', type: 'select', label: '渠道', options: [
        { value: 'web_scraper', label: 'web_scraper' },
        { value: 'rss', label: 'rss' },
        { value: 'api', label: 'api' },
        { value: 'cli', label: 'cli' },
        { value: 'opencli', label: 'opencli' },
      ] },
      { key: 'enabled', type: 'boolean', label: '启用', default: true },
      { key: 'tags', type: 'json', label: '标签' },
    ],
  },
  render: SourceStageBody,
  ops: [
    {
      id: 'toggle',
      label: '启停',
      icon: 'power',
      run: (ctx) => void updateSource(entityId(ctx), { enabled: !ctx.config.enabled }),
    },
    {
      id: 'test',
      label: '测连通',
      icon: 'plug',
      run: (ctx) => void testSourceConnectivity(entityId(ctx)),
    },
    {
      id: 'collect',
      label: '采集',
      icon: 'play',
      run: (ctx) => void triggerTask(entityId(ctx)),
    },
  ],
})

const schedule = defineNode({
  type: 'collection.schedule',
  category: 'control',
  title: '定时计划',
  subtitle: 'schedule',
  icon: 'clock',
  ports: { inputs: [{ id: 'source_ref', label: '源' }], outputs: [{ id: 'trigger', label: '触发' }] },
  config: {
    fields: [
      { key: 'name', type: 'string', label: '名称' },
      { key: 'cron_expression', type: 'string', label: 'Cron', required: true, placeholder: '0 */5 * * * *' },
      { key: 'timezone', type: 'string', label: '时区' },
      { key: 'enabled', type: 'boolean', label: '启用', default: true },
      { key: 'is_one_time', type: 'boolean', label: '一次性', default: false },
    ],
  },
  render: StageBody,
  ops: [
    {
      id: 'toggle',
      label: '启停',
      icon: 'power',
      run: (ctx) => void updateSchedule(entityId(ctx), { enabled: !ctx.config.enabled }),
    },
  ],
})

const task = defineNode({
  type: 'collection.task',
  category: 'transform',
  title: '采集任务',
  subtitle: 'task',
  icon: 'list-checks',
  ports: { inputs: [{ id: 'trigger', label: '触发' }], outputs: [{ id: 'enrich', label: '增强' }] },
  config: {
    fields: [
      { key: 'trigger_type', type: 'select', label: '触发方式', options: [
        { value: 'manual', label: 'manual' },
        { value: 'scheduled', label: 'scheduled' },
      ] },
      { key: 'priority', type: 'number', label: '优先级', default: 0 },
      { key: 'status', type: 'string', label: '状态' },
    ],
  },
  render: StageBody,
  ops: [
    {
      id: 'rerun',
      label: '重跑',
      icon: 'play',
      run: (ctx) =>
        void triggerTask(
          String(ctx.config.__sourceId ?? ''),
          undefined,
          (ctx.config.__agentId as string | undefined) || undefined,
        ),
    },
  ],
})

const agent = defineNode({
  type: 'collection.agent',
  category: 'agent',
  title: '处理智能体',
  subtitle: 'agent',
  icon: 'bot',
  ports: { inputs: [{ id: 'record', label: '记录' }], outputs: [{ id: 'enrich', label: '增强' }] },
  config: {
    fields: [
      { key: 'name', type: 'string', label: '名称' },
      { key: 'model', type: 'string', label: '模型' },
      { key: 'processor_type', type: 'string', label: '处理器' },
      { key: 'enabled', type: 'boolean', label: '启用', default: true },
    ],
  },
  render: StageBody,
  ops: [
    {
      id: 'toggle',
      label: '启停',
      icon: 'power',
      run: (ctx) => void updateAgent(entityId(ctx), { enabled: !ctx.config.enabled }),
    },
  ],
})

const record = defineNode({
  type: 'collection.record',
  category: 'sink',
  title: '采集记录',
  subtitle: 'record',
  icon: 'file-text',
  // COLLAPSE the model's two inputs (['source','task']) to ONE port: KitNode draws
  // one <Handle> per port and the topology edges carry no targetHandle, so two
  // target handles would make the task→record edge non-deterministic.
  ports: { inputs: [{ id: 'in', label: '写入' }], outputs: [{ id: 'notification', label: '通知' }] },
  config: {
    fields: [
      { key: 'status', type: 'string', label: '状态' },
      { key: 'content_hash', type: 'string', label: '内容哈希' },
    ],
  },
  render: StageBody,
  ops: [
    {
      id: 'delete',
      label: '删除',
      icon: 'trash-2',
      danger: true,
      run: (ctx) => void deleteRecord(entityId(ctx)),
    },
  ],
})

const notification = defineNode({
  type: 'collection.notification',
  category: 'sink',
  title: '通知规则',
  subtitle: 'notification',
  icon: 'bell',
  ports: { inputs: [{ id: 'record', label: '记录' }], outputs: [{ id: 'ack', label: '回执' }] },
  config: {
    fields: [
      { key: 'name', type: 'string', label: '名称' },
      { key: 'notifier_type', type: 'select', label: '通知方式', options: [
        { value: 'webhook', label: 'webhook' },
        { value: 'email', label: 'email' },
        { value: 'feishu', label: 'feishu' },
        { value: 'serverchan', label: 'serverchan' },
      ] },
      { key: 'trigger_event', type: 'string', label: '触发事件' },
      { key: 'enabled', type: 'boolean', label: '启用', default: true },
    ],
  },
  render: StageBody,
  ops: [
    {
      id: 'toggle',
      label: '启停',
      icon: 'power',
      run: (ctx) => void updateNotificationRule(entityId(ctx), { enabled: !ctx.config.enabled }),
    },
  ],
})

// edge-node / worker: the model attaches no actions → no ops/render, fall through
// to AutoBody (config rows). Pure config bodies.
const edgeNode = defineNode({
  type: 'collection.edge-node',
  category: 'control',
  title: '边缘节点',
  subtitle: 'edge-node',
  icon: 'network',
  ports: { inputs: [{ id: 'control', label: '控制' }], outputs: [{ id: 'route', label: '路由' }] },
  config: {
    fields: [
      { key: 'label', type: 'string', label: '标签' },
      { key: 'url', type: 'string', label: 'URL' },
      { key: 'protocol', type: 'string', label: '协议' },
      { key: 'mode', type: 'string', label: '模式' },
      { key: 'status', type: 'string', label: '状态' },
    ],
  },
})

const worker = defineNode({
  type: 'collection.worker',
  category: 'control',
  title: '执行 Worker',
  subtitle: 'worker',
  icon: 'cpu',
  ports: { inputs: [{ id: 'task', label: '任务' }], outputs: [{ id: 'result', label: '结果' }] },
  config: {
    fields: [
      { key: 'hostname', type: 'string', label: '主机名' },
      { key: 'worker_id', type: 'string', label: 'Worker ID' },
      { key: 'status', type: 'string', label: '状态' },
      { key: 'active_tasks', type: 'number', label: '活动任务' },
    ],
  },
})

// ── ODP system node (issue 07) ────────────────────────────────────────────────
// The shared ODP data plane rendered as a SINGLETON system node on the
// topology canvas — GET /control/odp-state has no source_id, so this node is
// not per-entity like the stages above; the host always plants exactly one
// instance at ODP_NODE_ID. Health/badges come from odpNode.ts's pure mapping
// (the node --test seam); this component only polls + projects that mapping,
// same C0 "never a fake healthy" discipline as SourceControlStrip.
const ODP_POLL_MS = 15_000

function OdpSystemBody(): ReactNode {
  const query = useQuery({
    queryKey: ['odp-state'],
    queryFn: getOdpState,
    refetchInterval: ODP_POLL_MS,
  })

  if (query.isLoading) {
    return <div className="text-3xs text-zinc-600">odp: loading…</div>
  }
  if (query.isError) {
    // Fetch failure must read as "unknown", not silently as "no badges shown"
    // (which would read as calm/healthy) — see odpNode.odpNodeHealth(null).
    return <div className="text-3xs text-red-300">odp: fetch failed</div>
  }

  const facts = odpNodeFacts(query.data ?? null)
  return (
    <div className="grid gap-1.5">
      <div className="flex flex-wrap gap-1.5">
        {facts.badges.map((badge) => (
          <NodeBadge key={badge}>{badge}</NodeBadge>
        ))}
      </div>
    </div>
  )
}

const odpSystem = defineNode({
  type: 'collection.odp-system',
  category: 'control',
  title: 'ODP 数据平面',
  subtitle: 'shared plane',
  icon: 'waves',
  // System-wide plane, not wired into any per-entity edge — no ports.
  ports: { inputs: [], outputs: [] },
  render: OdpSystemBody,
})

export const COLLECTION_NODES: NodeSpec<any>[] = [
  source,
  schedule,
  task,
  agent,
  record,
  notification,
  edgeNode,
  worker,
  odpSystem,
]
