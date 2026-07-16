import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

import { deriveWorkflowLifecycleView, type LifecycleStageStatus, type WorkflowLifecycleState } from './workflow-lifecycle-strip.logic'

export interface WorkflowLifecycleStripProps {
  /** Current authoring state of the workflow project. */
  state: WorkflowLifecycleState
  revision: number | null
  publishedVersion?: number | null
  /** Concise reason the lifecycle is blocked. Only shown when state is "blocked". */
  blockerText?: string
  className?: string
}

const STAGE_STATUS_STYLES: Record<LifecycleStageStatus, string> = {
  pending: 'border-border text-muted-foreground',
  active: 'border-primary bg-primary text-primary-foreground',
  done: 'border-success/40 bg-success/10 text-success',
  error: 'border-destructive/40 bg-destructive/10 text-destructive',
}

/**
 * Compact strip of the Workflow authoring stages. Runtime activation belongs
 * to Automation and is deliberately not represented here.
 */
export function WorkflowLifecycleStrip({ state, revision, publishedVersion, blockerText, className }: WorkflowLifecycleStripProps) {
  const view = deriveWorkflowLifecycleView(state, blockerText)

  return (
    <div className={cn('flex flex-col gap-1.5', className)} role="group" aria-label="工作流生命周期">
      <span className="sr-only">当前状态：{view.primaryStatusLabel}</span>
      <div className="flex items-center gap-2">
        <ol className="flex flex-1 items-center gap-1.5" role="list">
          {view.stages.map((stage, index) => (
            <li key={stage.key} className="flex flex-1 items-center gap-1.5" role="listitem">
              <span
                aria-current={stage.status === 'active' ? 'step' : undefined}
                aria-label={stage.label}
                className={cn('flex h-6 flex-1 items-center justify-center gap-1 rounded-md border px-2 text-xs font-medium whitespace-nowrap', STAGE_STATUS_STYLES[stage.status])}
              >
                <span>{stage.label}</span>
              </span>
              {index < view.stages.length - 1 ? <span aria-hidden="true" className="bg-border h-px w-2 shrink-0" /> : null}
            </li>
          ))}
        </ol>
        <Badge variant="outline" className="shrink-0 font-mono text-[10px]">
          {publishedVersion ? `v${publishedVersion} · ${view.primaryStatusLabel}` : `r${revision ?? '—'} · ${view.primaryStatusLabel}`}
        </Badge>
      </div>
      {view.blockerText ? (
        <p role="alert" className="text-destructive text-xs">
          {view.blockerText}
        </p>
      ) : null}
    </div>
  )
}
