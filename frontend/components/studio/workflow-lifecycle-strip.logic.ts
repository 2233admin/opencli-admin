/**
 * Pure state -> view derivation for WorkflowLifecycleStrip.
 * Kept dependency-free (no JSX) so it can be imported directly by a
 * plain Node regression script without a bundler/test runner.
 */

export type WorkflowLifecycleState =
  | 'draft'
  | 'validating'
  | 'validated'
  | 'publishing'
  | 'published'
  | 'blocked'

export type LifecycleStageKey = 'draft' | 'validate' | 'publish'

export type LifecycleStageStatus = 'pending' | 'active' | 'done' | 'error'

export interface LifecycleStageView {
  key: LifecycleStageKey
  label: string
  status: LifecycleStageStatus
}

export interface WorkflowLifecycleView {
  state: WorkflowLifecycleState
  primaryStatusLabel: string
  blockerText?: string
  stages: LifecycleStageView[]
}

const STAGE_ORDER: LifecycleStageKey[] = ['draft', 'validate', 'publish']

const STAGE_LABELS: Record<LifecycleStageKey, string> = {
  draft: '草稿',
  validate: '验证',
  publish: '版本发布',
}

const PRIMARY_STATUS_LABELS: Record<WorkflowLifecycleState, string> = {
  draft: '草稿',
  validating: '验证中',
  validated: '已验证',
  publishing: '发布中',
  published: '已发布',
  blocked: '已阻塞',
}

const STAGE_STATUSES_BY_STATE: Record<
  WorkflowLifecycleState,
  Record<LifecycleStageKey, LifecycleStageStatus>
> = {
  draft: { draft: 'active', validate: 'pending', publish: 'pending' },
  validating: { draft: 'done', validate: 'active', publish: 'pending' },
  validated: { draft: 'done', validate: 'done', publish: 'pending' },
  publishing: { draft: 'done', validate: 'done', publish: 'active' },
  published: { draft: 'done', validate: 'done', publish: 'done' },
  blocked: { draft: 'done', validate: 'error', publish: 'pending' },
}

export function deriveWorkflowLifecycleView(
  state: WorkflowLifecycleState,
  blockerText?: string,
): WorkflowLifecycleView {
  const statuses = STAGE_STATUSES_BY_STATE[state]

  const stages: LifecycleStageView[] = STAGE_ORDER.map((key) => ({
    key,
    label: STAGE_LABELS[key],
    status: statuses[key],
  }))

  return {
    state,
    primaryStatusLabel: PRIMARY_STATUS_LABELS[state],
    blockerText: state === 'blocked' ? blockerText : undefined,
    stages,
  }
}
