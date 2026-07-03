import { clsx } from 'clsx'

const STATUS_STYLES: Record<string, string> = {
  pending:       'border-signal-amber/40 bg-signal-amber/10 text-amber-200',
  running:       'border-zinc-200/50 bg-zinc-100/10 text-zinc-100',
  ai_processing: 'border-primary-500/50 bg-primary-500/10 text-primary-100',
  completed:     'border-signal-green/40 bg-signal-green/10 text-emerald-200',
  failed:        'border-signal-red/60 bg-signal-red/15 text-red-100',
  cancelled:     'border-zinc-500/40 bg-zinc-500/10 text-zinc-300',
  online:        'border-signal-green/40 bg-signal-green/10 text-emerald-200',
  offline:       'border-zinc-500/40 bg-zinc-500/10 text-zinc-300',
  sent:          'border-signal-green/40 bg-signal-green/10 text-emerald-200',
  acked:         'border-signal-green/40 bg-signal-green/10 text-emerald-200',
  not_required:  'border-zinc-500/40 bg-zinc-500/10 text-zinc-300',
  raw:           'border-zinc-500/40 bg-zinc-500/10 text-zinc-300',
  normalized:    'border-zinc-200/50 bg-zinc-100/10 text-zinc-100',
  ai_processed:  'border-primary-500/50 bg-primary-500/10 text-primary-100',
  // Skill.status (record→distill→execute→correct loop, ADR-0003)
  draft:         'border-signal-amber/40 bg-signal-amber/10 text-amber-200',
  active:        'border-signal-green/40 bg-signal-green/10 text-emerald-200',
  deprecated:    'border-zinc-500/40 bg-zinc-500/10 text-zinc-300',
}

const STATUS_LABELS: Record<string, string> = {
  pending:       '待执行',
  running:       '采集中',
  ai_processing: 'AI 处理中',
  completed:     '已完成',
  failed:        '失败',
  cancelled:     '已取消',
  raw:           '原始',
  normalized:    '已归一化',
  ai_processed:  '已处理',
  sent:          '已发送',
  acked:         '已回执',
  not_required:  '无需回执',
  online:        '在线',
  offline:       '离线',
  draft:         '草稿',
  active:        '生效',
  deprecated:    '已弃用',
}

interface Props {
  status: string
  className?: string
}

export default function StatusBadge({ status, className }: Props) {
  const style = STATUS_STYLES[status] ?? 'border-zinc-500/40 bg-zinc-500/10 text-zinc-300'
  const label = STATUS_LABELS[status] ?? status
  return (
    <span
      className={clsx(
        'inline-flex items-center border px-2 py-0.5 font-telemetry text-2xs font-semibold uppercase tracking-[0.08em]',
        style,
        className
      )}
    >
      {label}
    </span>
  )
}
