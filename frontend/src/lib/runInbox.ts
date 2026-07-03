import type { CollectionTask, TaskRun } from '../api/types'

export type RunInboxState =
  | 'running'
  | 'needs_attention'
  | 'ready_to_review'
  | 'resolved'
  | 'ignored'

export type LocalHandlingState = Extract<RunInboxState, 'resolved' | 'ignored'>

const ACTIVE_STATUSES = new Set(['pending', 'running', 'ai_processing', 'queued'])
const ATTENTION_STATUSES = new Set(['failed', 'cancelled', 'error', 'timeout'])
const REVIEW_STATUSES = new Set(['completed', 'success', 'succeeded', 'done'])

function normalizeStatus(status?: string | null) {
  return (status ?? '').trim().toLowerCase()
}

export function deriveRunInboxState(
  task: Pick<CollectionTask, 'status' | 'error_message'>,
  latestRun?: Pick<TaskRun, 'status' | 'error_message'>,
  localState?: LocalHandlingState,
): RunInboxState {
  if (localState === 'resolved' || localState === 'ignored') return localState

  const taskStatus = normalizeStatus(task.status)
  const runStatus = normalizeStatus(latestRun?.status)

  if (ACTIVE_STATUSES.has(taskStatus) || ACTIVE_STATUSES.has(runStatus)) return 'running'
  if (
    Boolean(task.error_message || latestRun?.error_message) ||
    ATTENTION_STATUSES.has(taskStatus) ||
    ATTENTION_STATUSES.has(runStatus)
  ) {
    return 'needs_attention'
  }
  if (REVIEW_STATUSES.has(taskStatus) || REVIEW_STATUSES.has(runStatus)) return 'ready_to_review'

  return 'needs_attention'
}

export function runInboxStateLabel(state: RunInboxState) {
  const labels: Record<RunInboxState, string> = {
    running: '运行中',
    needs_attention: '需要处理',
    ready_to_review: '待复核',
    resolved: '已解决',
    ignored: '已忽略',
  }
  return labels[state]
}

export function runInboxStateOrder(state: RunInboxState) {
  const order: Record<RunInboxState, number> = {
    needs_attention: 0,
    running: 1,
    ready_to_review: 2,
    resolved: 3,
    ignored: 4,
  }
  return order[state]
}
