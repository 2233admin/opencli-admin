import type { CollectionTask, CronSchedule, DataSource } from '../api/types'
import {
  getDefaultActionIdForKind,
  listExecutableNodeActions,
  type NodeActionDescriptor,
} from './nodeActions.ts'
import { t as i18nT } from 'i18next'

export const SOURCE_WORKFLOW_LAYOUT_KEY = 'opencli-admin.sourcesCanvasLayout.v1'

export type WorkflowNodeKind = 'source' | 'schedule' | 'task'

export type WorkflowHealth =
  | 'healthy'
  | 'active'
  | 'warning'
  | 'failed'
  | 'disabled'
  | 'unknown'

export interface WorkflowPosition {
  x: number
  y: number
}

export type WorkflowLayoutPositions = Record<string, WorkflowPosition>

export interface WorkflowNodeData extends Record<string, unknown> {
  kind: WorkflowNodeKind
  title: string
  subtitle: string
  health: WorkflowHealth
  sourceId: string
  entityId: string
  actions: WorkflowNodeAction[]
  badges: string[]
  detail: Record<string, unknown>
}

export interface WorkflowNodeAction {
  id: string
  label: string
  description: string
  enabled: boolean
}

function t(key: string, defaultValue: string) {
  return i18nT(key, { defaultValue })
}

export interface WorkflowGraphNode {
  id: string
  kind: WorkflowNodeKind
  sourceId: string
  position: WorkflowPosition
  data: WorkflowNodeData
}

export interface WorkflowGraphEdge {
  id: string
  source: string
  target: string
  label: string
  health: WorkflowHealth
}

export interface SourceWorkflowStats {
  sourceId: string
  taskCount: number
  runningTasks: number
  failedTasks: number
  scheduleCount: number
  enabledScheduleCount: number
  nextRunAt?: string
  latestTaskStatus?: CollectionTask['status']
  latestTaskUpdatedAt?: string
}

export interface CollectionWorkflowGraph {
  nodes: WorkflowGraphNode[]
  edges: WorkflowGraphEdge[]
  sourceStats: Record<string, SourceWorkflowStats>
  summary: {
    sources: number
    schedules: number
    enabledSchedules: number
    tasks: number
    runningTasks: number
    failedTasks: number
  }
}

export interface CollectionWorkflowInput {
  sources: DataSource[]
  tasks: CollectionTask[]
  schedules: CronSchedule[]
}

export interface CollectionWorkflowOptions {
  maxTasksPerSource?: number
  layout?: WorkflowLayoutPositions
}

interface StorageLike {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

const SOURCE_X = 0
const SCHEDULE_X = 360
const TASK_X = 720
const SOURCE_ROW_GAP = 280
const NODE_ROW_GAP = 118

export function buildCollectionWorkflow(
  input: CollectionWorkflowInput,
  options: CollectionWorkflowOptions = {},
): CollectionWorkflowGraph {
  const maxTasksPerSource = options.maxTasksPerSource ?? 3
  const layout = options.layout ?? {}
  const nodes: WorkflowGraphNode[] = []
  const edges: WorkflowGraphEdge[] = []
  const sourceStats: Record<string, SourceWorkflowStats> = {}
  const sourceIds = new Set(input.sources.map((source) => source.id))
  const tasksBySource = groupBy(
    input.tasks.filter((task) => sourceIds.has(task.source_id)),
    (task) => task.source_id,
  )
  const schedulesBySource = groupBy(
    input.schedules.filter((schedule) => sourceIds.has(schedule.source_id)),
    (schedule) => schedule.source_id,
  )

  input.sources.forEach((source, sourceIndex) => {
    const sourceTasks = sortByRecent(tasksBySource.get(source.id) ?? [])
    const sourceSchedules = sortSchedules(schedulesBySource.get(source.id) ?? [])
    const stats = calculateSourceStats(source.id, sourceTasks, sourceSchedules)
    sourceStats[source.id] = stats

    const sourceNodeId = workflowNodeId('source', source.id)
    nodes.push({
      id: sourceNodeId,
      kind: 'source',
      sourceId: source.id,
      position: resolvePosition(layout, sourceNodeId, {
        x: SOURCE_X,
        y: sourceIndex * SOURCE_ROW_GAP,
      }),
      data: {
        kind: 'source',
        title: source.name,
        subtitle: source.channel_type,
        health: healthFromSource(source, stats),
        sourceId: source.id,
        entityId: source.id,
        badges: compact([
          source.enabled ? 'enabled' : 'disabled',
          `${stats.taskCount} tasks`,
          `${stats.enabledScheduleCount}/${stats.scheduleCount} plans`,
        ]),
        actions: getActionsForKind('source', {
          enabled: source.enabled,
        }),
        detail: {
          id: source.id,
          channel_type: source.channel_type,
          description: source.description,
          enabled: source.enabled,
          tags: source.tags,
          updated_at: source.updated_at,
          stats,
        },
      },
    })

    sourceSchedules.forEach((schedule, scheduleIndex) => {
      const scheduleNodeId = workflowNodeId('schedule', schedule.id)
      nodes.push({
        id: scheduleNodeId,
        kind: 'schedule',
        sourceId: source.id,
        position: resolvePosition(layout, scheduleNodeId, {
          x: SCHEDULE_X,
          y: sourceIndex * SOURCE_ROW_GAP + scheduleIndex * NODE_ROW_GAP,
        }),
        data: {
          kind: 'schedule',
          title: schedule.name,
          subtitle: schedule.cron_expression,
          health: healthFromSchedule(schedule),
          sourceId: source.id,
          entityId: schedule.id,
          badges: compact([
            schedule.enabled ? 'enabled' : 'disabled',
            schedule.timezone,
            schedule.next_run_at ? `next ${formatShortDate(schedule.next_run_at)}` : undefined,
          ]),
          actions: [],
          detail: {
            id: schedule.id,
            source_id: schedule.source_id,
            agent_id: schedule.agent_id,
            cron_expression: schedule.cron_expression,
            timezone: schedule.timezone,
            enabled: schedule.enabled,
            is_one_time: schedule.is_one_time,
            next_run_at: schedule.next_run_at,
            last_run_at: schedule.last_run_at,
            parameters: schedule.parameters,
            updated_at: schedule.updated_at,
          },
        },
      })
      edges.push({
        id: `${sourceNodeId}->${scheduleNodeId}:plans`,
        source: sourceNodeId,
        target: scheduleNodeId,
        label: 'plans',
        health: healthFromSchedule(schedule),
      })
    })

    sourceTasks.slice(0, maxTasksPerSource).forEach((task, taskIndex) => {
      const taskNodeId = workflowNodeId('task', task.id)
      nodes.push({
        id: taskNodeId,
        kind: 'task',
        sourceId: source.id,
        position: resolvePosition(layout, taskNodeId, {
          x: TASK_X,
          y: sourceIndex * SOURCE_ROW_GAP + taskIndex * NODE_ROW_GAP,
        }),
        data: {
          kind: 'task',
          title: task.source_name || `Task ${shortId(task.id)}`,
          subtitle: task.trigger_type,
          health: healthFromTaskStatus(task.status),
          sourceId: source.id,
          entityId: task.id,
          badges: compact([task.status, `P${task.priority}`, formatShortDate(task.updated_at)]),
          actions: getActionsForKind('task', {
            enabled: task.status !== 'cancelled' && source.enabled,
          }),
          detail: {
            id: task.id,
            source_id: task.source_id,
            agent_id: task.agent_id,
            trigger_type: task.trigger_type,
            priority: task.priority,
            status: task.status,
            error_message: task.error_message,
            parameters: task.parameters,
            created_at: task.created_at,
            updated_at: task.updated_at,
          },
        },
      })
      edges.push({
        id: `${sourceNodeId}->${taskNodeId}:runs`,
        source: sourceNodeId,
        target: taskNodeId,
        label: 'runs',
        health: healthFromTaskStatus(task.status),
      })
    })
  })

  return {
    nodes,
    edges,
    sourceStats,
    summary: {
      sources: input.sources.length,
      schedules: input.schedules.filter((schedule) => sourceIds.has(schedule.source_id)).length,
      enabledSchedules: input.schedules.filter((schedule) => sourceIds.has(schedule.source_id) && schedule.enabled).length,
      tasks: input.tasks.filter((task) => sourceIds.has(task.source_id)).length,
      runningTasks: input.tasks.filter((task) => sourceIds.has(task.source_id) && task.status === 'running').length,
      failedTasks: input.tasks.filter((task) => sourceIds.has(task.source_id) && isFailedTask(task)).length,
    },
  }
}

interface SourceTaskActionContext {
  enabled: boolean
}

function getActionsForKind(kind: WorkflowNodeKind, context: SourceTaskActionContext): WorkflowNodeAction[] {
  const actionId = getDefaultActionIdForKind(kind)
  if (!actionId) {
    return []
  }

  const item = listExecutableNodeActions(kind).find((candidate) => candidate.id === actionId)
  if (!item) {
    return [fallbackAction(actionId, context.enabled)]
  }

  return [nodeActionFromDescriptor(item, context.enabled)]
}

function fallbackAction(actionId: string, enabled: boolean): WorkflowNodeAction {
  return {
    id: actionId,
    label:
      actionId === 'task.trigger'
        ? t('nodeActions.task.trigger.label', '再次触发')
        : t('nodeActions.source.trigger.label', '触发采集'),
    description:
      actionId === 'task.trigger'
        ? t('nodeActions.task.trigger.description', '再次触发一次采集任务')
        : t('nodeActions.source.trigger.description', '触发一次采集'),
    enabled,
  }
}

function nodeActionFromDescriptor(descriptor: NodeActionDescriptor, enabled: boolean): WorkflowNodeAction {
  return {
    id: descriptor.id,
    label: descriptor.label,
    description: descriptor.description,
    enabled,
  }
}

export function loadWorkflowLayout(storage: StorageLike | undefined, key = SOURCE_WORKFLOW_LAYOUT_KEY): WorkflowLayoutPositions {
  if (!storage) return {}
  try {
    const raw = storage.getItem(key)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const positions: WorkflowLayoutPositions = {}
    for (const [nodeId, value] of Object.entries(parsed)) {
      if (!value || typeof value !== 'object') continue
      const maybePosition = value as Partial<WorkflowPosition>
      if (typeof maybePosition.x !== 'number' || typeof maybePosition.y !== 'number') continue
      positions[nodeId] = { x: maybePosition.x, y: maybePosition.y }
    }
    return positions
  } catch {
    return {}
  }
}

export function saveWorkflowLayout(
  storage: StorageLike | undefined,
  positions: WorkflowLayoutPositions,
  key = SOURCE_WORKFLOW_LAYOUT_KEY,
) {
  if (!storage) return
  storage.setItem(key, JSON.stringify(positions))
}

export function positionsFromNodes(nodes: Array<{ id: string; position: WorkflowPosition }>): WorkflowLayoutPositions {
  return Object.fromEntries(nodes.map((node) => [node.id, node.position]))
}

export function workflowNodeId(kind: WorkflowNodeKind, rawId: string) {
  return `${kind}:${rawId}`
}

function calculateSourceStats(
  sourceId: string,
  tasks: CollectionTask[],
  schedules: CronSchedule[],
): SourceWorkflowStats {
  const latestTask = sortByRecent(tasks)[0]
  const nextSchedule = schedules
    .filter((schedule) => schedule.enabled && schedule.next_run_at)
    .sort((a, b) => String(a.next_run_at).localeCompare(String(b.next_run_at)))[0]

  return {
    sourceId,
    taskCount: tasks.length,
    runningTasks: tasks.filter((task) => task.status === 'running').length,
    failedTasks: tasks.filter(isFailedTask).length,
    scheduleCount: schedules.length,
    enabledScheduleCount: schedules.filter((schedule) => schedule.enabled).length,
    nextRunAt: nextSchedule?.next_run_at,
    latestTaskStatus: latestTask?.status,
    latestTaskUpdatedAt: latestTask?.updated_at ?? latestTask?.created_at,
  }
}

function healthFromSource(source: DataSource, stats: SourceWorkflowStats): WorkflowHealth {
  if (!source.enabled) return 'disabled'
  if (stats.failedTasks > 0) return 'failed'
  if (stats.runningTasks > 0) return 'active'
  if (stats.scheduleCount === 0 || stats.enabledScheduleCount === 0) return 'warning'
  return 'healthy'
}

function healthFromSchedule(schedule: CronSchedule): WorkflowHealth {
  if (!schedule.enabled) return 'disabled'
  if (!schedule.next_run_at && !schedule.is_one_time) return 'warning'
  return 'healthy'
}

function healthFromTaskStatus(status: CollectionTask['status']): WorkflowHealth {
  if (status === 'failed' || status === 'cancelled') return 'failed'
  if (status === 'running') return 'active'
  if (status === 'pending') return 'warning'
  return 'healthy'
}

function resolvePosition(
  layout: WorkflowLayoutPositions,
  id: string,
  fallback: WorkflowPosition,
): WorkflowPosition {
  return layout[id] ?? fallback
}

function sortByRecent(tasks: CollectionTask[]) {
  return [...tasks].sort((a, b) => taskTime(b).localeCompare(taskTime(a)))
}

function sortSchedules(schedules: CronSchedule[]) {
  return [...schedules].sort((a, b) => {
    const aEnabled = a.enabled ? 0 : 1
    const bEnabled = b.enabled ? 0 : 1
    if (aEnabled !== bEnabled) return aEnabled - bEnabled
    return String(a.next_run_at ?? a.created_at).localeCompare(String(b.next_run_at ?? b.created_at))
  })
}

function taskTime(task: CollectionTask) {
  return task.updated_at || task.created_at
}

function isFailedTask(task: CollectionTask) {
  return task.status === 'failed' || task.status === 'cancelled'
}

function shortId(value?: string | null, length = 8) {
  return value ? value.slice(0, length) : ''
}

function formatShortDate(value?: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function groupBy<T>(items: T[], keyFn: (item: T) => string) {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const key = keyFn(item)
    groups.set(key, [...(groups.get(key) ?? []), item])
  }
  return groups
}

function compact(items: Array<string | undefined | null | false>) {
  return items.filter((item): item is string => typeof item === 'string' && item.length > 0)
}
