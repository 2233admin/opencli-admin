import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  buildTopologyGraph,
  fallbackLayout,
  nodeId,
  paletteDropToCreatePayload,
  TOPOLOGY_PALETTE_SOURCES,
} from './topologyModel.ts'
import type {
  AIAgent,
  CollectedRecord,
  CollectionTask,
  CronSchedule,
  DataSource,
  EdgeNode,
  NotificationLog,
  NotificationRule,
  WorkerNode,
} from '../../api/types.ts'

const now = '2026-06-21T08:00:00Z'

const source: DataSource = {
  id: 'source-1',
  name: 'OpenCLI Feed',
  channel_type: 'rss',
  channel_config: {},
  enabled: true,
  tags: ['watch'],
  created_at: now,
  updated_at: now,
}

const task: CollectionTask = {
  id: 'task-1',
  source_id: source.id,
  source_name: source.name,
  agent_id: 'agent-1',
  trigger_type: 'manual',
  parameters: {},
  priority: 5,
  status: 'running',
  created_at: now,
  updated_at: now,
}

const schedule: CronSchedule = {
  id: 'schedule-1',
  source_id: source.id,
  name: 'Morning harvest',
  cron_expression: '0 9 * * *',
  timezone: 'Asia/Shanghai',
  parameters: {},
  enabled: true,
  is_one_time: false,
  next_run_at: '2026-06-22T01:00:00Z',
  created_at: now,
  updated_at: now,
}

const agent: AIAgent = {
  id: 'agent-1',
  name: 'Summarizer',
  processor_type: 'openai',
  model: 'gpt-test',
  prompt_template: '{{content}}',
  processor_config: {},
  enabled: true,
  created_at: now,
  updated_at: now,
}

const record: CollectedRecord = {
  id: 'record-1',
  task_id: task.id,
  source_id: source.id,
  raw_data: {},
  normalized_data: { title: 'Node-based console' },
  content_hash: 'abcdef123456',
  status: 'ai_processed',
  created_at: now,
  updated_at: now,
}

const rule: NotificationRule = {
  id: 'rule-1',
  name: 'Webhook ACK',
  source_id: source.id,
  trigger_event: 'on_new_record',
  notifier_type: 'webhook',
  notifier_config: {},
  enabled: true,
  created_at: now,
  updated_at: now,
}

const log: NotificationLog = {
  id: 'log-1',
  rule_id: rule.id,
  record_id: record.id,
  status: 'sent',
  ack_status: 'pending',
  created_at: now,
}

const edgeNode: EdgeNode = {
  id: 'edge-1',
  url: 'http://node.local:19823',
  label: 'NAS node',
  protocol: 'http',
  mode: 'bridge',
  node_type: 'docker',
  status: 'online',
  created_at: now,
  updated_at: now,
}

const worker: WorkerNode = {
  id: 'worker-1',
  worker_id: 'celery@nas',
  hostname: 'nas',
  status: 'online',
  active_tasks: 1,
  last_heartbeat: now,
  created_at: now,
  updated_at: now,
}

describe('topology model', () => {
  it('builds data-flow edges across source, task, agent, record, and notification nodes', () => {
    const graph = buildTopologyGraph({
      sources: [source],
      schedules: [schedule],
      tasks: [task],
      agents: [agent],
      records: [record],
      notificationRules: [rule],
      notificationLogs: [log],
      edgeNodes: [edgeNode],
      workers: [worker],
    })

    assert.equal(graph.summary.total, 8)
    assert.equal(graph.summary.active, 2)
    assert.equal(graph.summary.warning, 1)
    assert.equal(graph.summary.skills.missing, 4)
    assert.equal(graph.summary.skills.running, 3)

    const edgeIds = graph.edges.map((edge) => edge.id)
    assert.ok(edgeIds.includes(`${nodeId('source', source.id)}->${nodeId('schedule', schedule.id)}:plans`))
    // Since d157881, only scheduled tasks get a schedule->task:triggers edge;
    // manual tasks (this fixture) get a direct source->task:manual edge.
    assert.ok(edgeIds.includes(`${nodeId('source', source.id)}->${nodeId('task', task.id)}:manual`))
    assert.ok(edgeIds.includes(`${nodeId('task', task.id)}->${nodeId('agent', agent.id)}:enriches`))
    assert.ok(edgeIds.includes(`${nodeId('task', task.id)}->${nodeId('record', record.id)}:writes`))
    assert.ok(edgeIds.includes(`${nodeId('record', record.id)}->${nodeId('notification', rule.id)}:sent`))

    const sourceNode = graph.nodes.find((node) => node.id === nodeId('source', source.id))
    assert.deepEqual(
      sourceNode?.data.skills.map((item) => [item.id, item.state]),
      [
        ['collect', 'ready'],
        ['schedule', 'ready'],
        ['process', 'ready'],
        ['notify', 'ready'],
        ['records', 'ready'],
      ],
    )
  })

  it('marks disabled and failed states in the graph summary', () => {
    const graph = buildTopologyGraph({
      sources: [{ ...source, enabled: false }],
      schedules: [{ ...schedule, enabled: false }],
      tasks: [{ ...task, status: 'failed' }],
      agents: [{ ...agent, enabled: false }],
      records: [{ ...record, status: 'error' }],
      notificationRules: [{ ...rule, enabled: false }],
      notificationLogs: [{ ...log, status: 'failed', ack_status: 'failed' }],
      edgeNodes: [{ ...edgeNode, status: 'offline' }],
      workers: [{ ...worker, status: 'offline', active_tasks: 0 }],
    })

    assert.equal(graph.summary.failed, 4)
    assert.equal(graph.summary.disabled, 4)
    assert.equal(graph.summary.skills.blocked, 7)
  })

  it('provides a deterministic fallback layout', () => {
    const graph = buildTopologyGraph({
      sources: [source],
      schedules: [],
      tasks: [task],
      agents: [],
      records: [],
      notificationRules: [],
      notificationLogs: [],
      edgeNodes: [],
      workers: [],
    })

    const layout = fallbackLayout(graph, 100, 50)

    assert.deepEqual(layout.map((node) => node.position), [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
    ])
  })
})

describe('topology palette', () => {
  it('lists one creatable item per channel type, matching SourcesPage CHANNEL_TYPES', () => {
    const types = TOPOLOGY_PALETTE_SOURCES.map((item) => item.type)
    assert.deepEqual(types, ['opencli', 'rss', 'api', 'web_scraper', 'crawl4ai', 'cli', 'skill'])
    // every item has a non-empty label + hint (rendered in the rail)
    for (const item of TOPOLOGY_PALETTE_SOURCES) {
      assert.ok(item.label.length > 0)
      assert.ok(item.hint.length > 0)
    }
  })

  it('maps a palette drop to a real DataSource create payload, not a fabricated node', () => {
    const now = new Date('2026-07-02T09:05:00Z')
    const payload = paletteDropToCreatePayload('rss', { x: 120, y: 80 }, now)

    assert.equal(payload.channel_type, 'rss')
    assert.deepEqual(payload.channel_config, {})
    assert.equal(payload.enabled, true)
    assert.deepEqual(payload.tags, [])
    assert.match(payload.name ?? '', /^rss-\d{4}-\d{4}$/)
    // no id/created_at/etc — this is a creation payload, never a synthesized entity
    assert.ok(!('id' in payload))
  })

  it('produces distinct default names per channel type at the same instant', () => {
    const now = new Date('2026-07-02T09:05:00Z')
    const names = TOPOLOGY_PALETTE_SOURCES.map((item) => paletteDropToCreatePayload(item.type, undefined, now).name)
    assert.equal(new Set(names).size, names.length)
  })
})
