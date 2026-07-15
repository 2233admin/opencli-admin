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

export type LifecycleStageKey = 'draft' | 'validate' | 'publish' | 'activate'

export type LifecycleStageStatus = 'pending' | 'active' | 'done' | 'error' | 'unavailable'

export interface LifecycleStageView {
  key: LifecycleStageKey
  label: string
  status: LifecycleStageStatus
  note?: string
}

export interface WorkflowLifecycleView {
  state: WorkflowLifecycleState
  primaryStatusLabel: string
  blockerText?: string
  stages: LifecycleStageView[]
}

const STAGE_ORDER: LifecycleStageKey[] = ['draft', 'validate', 'publish', 'activate']

const STAGE_LABELS: Record<LifecycleStageKey, string> = {
  draft: '草稿',
  validate: '验证',
  publish: '版本发布',
  activate: '激活',
}

const PRIMARY_STATUS_LABELS: Record<WorkflowLifecycleState, string> = {
  draft: '草稿',
  validating: '验证中',
  validated: '已验证',
  publishing: '发布中',
  published: '已发布',
  blocked: '已阻塞',
}

/**
 * Activation has no backend-integrated meaning yet. This note must render
 * unconditionally regardless of state — publishing/published must never
 * imply the project is active.
 */
const ACTIVATION_NOTE = '待后端接入'

const STAGE_STATUSES_BY_STATE: Record<
  WorkflowLifecycleState,
  Record<LifecycleStageKey, LifecycleStageStatus>
> = {
  draft: { draft: 'active', validate: 'pending', publish: 'pending', activate: 'unavailable' },
  validating: { draft: 'done', validate: 'active', publish: 'pending', activate: 'unavailable' },
  validated: { draft: 'done', validate: 'done', publish: 'pending', activate: 'unavailable' },
  publishing: { draft: 'done', validate: 'done', publish: 'active', activate: 'unavailable' },
  published: { draft: 'done', validate: 'done', publish: 'done', activate: 'unavailable' },
  blocked: { draft: 'done', validate: 'error', publish: 'pending', activate: 'unavailable' },
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
    note: key === 'activate' ? ACTIVATION_NOTE : undefined,
  }))

  return {
    state,
    primaryStatusLabel: PRIMARY_STATUS_LABELS[state],
    blockerText: state === 'blocked' ? blockerText : undefined,
    stages,
  }
}
