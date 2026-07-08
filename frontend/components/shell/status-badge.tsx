import { cn } from '@/lib/utils'

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'muted'

const TONE_CLASS: Record<Tone, string> = {
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  danger: 'bg-destructive/10 text-destructive',
  info: 'bg-info/10 text-info',
  muted: 'bg-muted text-muted-foreground',
}

const TONE_DOT: Record<Tone, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-destructive',
  info: 'bg-info',
  muted: 'bg-muted-foreground/50',
}

// Maps every status string the backend can emit → tone + zh label.
const STATUS_MAP: Record<string, { tone: Tone; label: string }> = {
  // task / run
  completed: { tone: 'success', label: '已完成' },
  success: { tone: 'success', label: '成功' },
  running: { tone: 'warning', label: '运行中' },
  pending: { tone: 'info', label: '等待中' },
  queued: { tone: 'info', label: '排队中' },
  failed: { tone: 'danger', label: '失败' },
  error: { tone: 'danger', label: '错误' },
  cancelled: { tone: 'muted', label: '已取消' },
  // node / worker
  online: { tone: 'success', label: '在线' },
  offline: { tone: 'muted', label: '离线' },
  // enable state
  enabled: { tone: 'success', label: '启用' },
  disabled: { tone: 'muted', label: '停用' },
  // control-state
  healthy: { tone: 'success', label: '健康' },
  degraded: { tone: 'warning', label: '降级' },
  backpressured: { tone: 'warning', label: '背压' },
  rate_limited: { tone: 'warning', label: '限流' },
  auth_failed: { tone: 'danger', label: '鉴权失败' },
  schema_drift: { tone: 'danger', label: '结构漂移' },
  blocked_by_odp: { tone: 'warning', label: 'ODP 阻塞' },
  paused: { tone: 'muted', label: '已暂停' },
  dead: { tone: 'danger', label: '失效' },
  unknown: { tone: 'muted', label: '未知' },
  // control-action outcome
  recovered: { tone: 'success', label: '已恢复' },
  persisted: { tone: 'danger', label: '未恢复' },
  insufficient_data: { tone: 'muted', label: '数据不足' },
}

export function StatusBadge({ status, className }: { status?: string | null; className?: string }) {
  const key = (status ?? 'unknown').toLowerCase()
  const meta = STATUS_MAP[key] ?? { tone: 'muted' as Tone, label: status ?? '未知' }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium',
        TONE_CLASS[meta.tone],
        className,
      )}
    >
      <span className={cn('size-1.5 rounded-full', TONE_DOT[meta.tone])} />
      {meta.label}
    </span>
  )
}
