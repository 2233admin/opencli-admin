import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  SOURCE_WORKFLOW_LAYOUT_KEY,
  buildCollectionWorkflow,
  loadWorkflowLayout,
  positionsFromNodes,
  saveWorkflowLayout,
  workflowNodeId,
} from './collectionWorkflowModel.ts'
import type { CollectionTask, CronSchedule, DataSource } from '../api/types.ts'

const now = '2026-06-21T08:00:00Z'

const source: DataSource = {
  id: 'source-1',
  name: 'OpenCLI Feed',
  channel_type: 'opencli',
  channel_config: { site: 'x' },
  enabled: true,
  tags: ['watch'],
  created_at: now,
  updated_at: now,
}

const runningTask: CollectionTask = {
  id: 'task-running',
  source_id: source.id,
  source_name: source.name,
  trigger_type: 'manual',
  parameters: {},
  priority: 5,
  status: 'running',
  created_at: '2026-06-21T08:01:00Z',
  updated_at: '2026-06-21T08:03:00Z',
}

const failedTask: CollectionTask = {
  ...runningTask,
  id: 'task-failed',
  status: 'failed',
  created_at: '2026-06-21T07:01:00Z',
  updated_at: '2026-06-21T07:03:00Z',
}

const enabledSchedule: CronSchedule = {
  id: 'schedule-enabled',
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

const laterSchedule: CronSchedule = {
  ...enabledSchedule,
  id: 'schedule-later',
  name: 'Evening harvest',
  next_run_at: '2026-06-22T12:00:00Z',
}

describe('collection workflow model', () => {
  it('aggregates source task, failure, schedule, and next-run metrics', () => {
    const graph = buildCollectionWorkflow({
      sources: [source],
      tasks: [runningTask, failedTask],
      schedules: [laterSchedule, enabledSchedule],
    })

    assert.equal(graph.summary.sources, 1)
    assert.equal(graph.summary.tasks, 2)
    assert.equal(graph.summary.runningTasks, 1)
    assert.equal(graph.summary.failedTasks, 1)
    assert.equal(graph.summary.schedules, 2)
    assert.equal(graph.summary.enabledSchedules, 2)

    assert.deepEqual(graph.sourceStats[source.id], {
      sourceId: source.id,
      taskCount: 2,
      runningTasks: 1,
      failedTasks: 1,
      scheduleCount: 2,
      enabledScheduleCount: 2,
      nextRunAt: enabledSchedule.next_run_at,
      latestTaskStatus: runningTask.status,
      latestTaskUpdatedAt: runningTask.updated_at,
    })
  })

  it('generates fixed source, schedule, and recent task nodes with plan/run edges', () => {
    const graph = buildCollectionWorkflow({
      sources: [source],
      tasks: [runningTask],
      schedules: [enabledSchedule],
    })

    const nodeIds = graph.nodes.map((node) => node.id)
    assert.deepEqual(nodeIds, [
      workflowNodeId('source', source.id),
      workflowNodeId('schedule', enabledSchedule.id),
      workflowNodeId('task', runningTask.id),
    ])

    const edgeIds = graph.edges.map((edge) => edge.id)
    assert.ok(edgeIds.includes(`${workflowNodeId('source', source.id)}->${workflowNodeId('schedule', enabledSchedule.id)}:plans`))
    assert.ok(edgeIds.includes(`${workflowNodeId('source', source.id)}->${workflowNodeId('task', runningTask.id)}:runs`))
  })

  it('loads, saves, and falls back when layout storage is missing or invalid', () => {
    const storage = new MemoryStorage()

    assert.deepEqual(loadWorkflowLayout(storage), {})
    storage.setItem(SOURCE_WORKFLOW_LAYOUT_KEY, '{"source:source-1":{"x":42,"y":64},"bad":{"x":"nope"}}')
    assert.deepEqual(loadWorkflowLayout(storage), {
      [workflowNodeId('source', source.id)]: { x: 42, y: 64 },
    })

    storage.setItem(SOURCE_WORKFLOW_LAYOUT_KEY, 'not json')
    assert.deepEqual(loadWorkflowLayout(storage), {})

    const graph = buildCollectionWorkflow({
      sources: [source],
      tasks: [runningTask],
      schedules: [enabledSchedule],
    }, {
      layout: { [workflowNodeId('source', source.id)]: { x: 12, y: 24 } },
    })
    assert.equal(graph.nodes[0].position.x, 12)
    assert.equal(graph.nodes[1].position.x, 360)

    const positions = positionsFromNodes(graph.nodes)
    saveWorkflowLayout(storage, positions)
    assert.deepEqual(loadWorkflowLayout(storage), positions)
  })
})

class MemoryStorage {
  private items = new Map<string, string>()

  getItem(key: string) {
    return this.items.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.items.set(key, value)
  }
}
