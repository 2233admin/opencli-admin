/** Shared display formatters for the admin tables. */

function parseDate(value?: string | null): Date | null {
  if (!value) return null
  // Some Chinese announcement feeds use a colon before milliseconds.
  const normalized = value.replace(
    /^(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}):(\d{3})(?=$|Z|[+-]\d{2}:?\d{2}$)/,
    '$1.$2',
  )
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatDateTime(value?: string | null): string {
  const d = parseDate(value)
  if (!d) return '—'
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatRelative(value?: string | null): string {
  const d = parseDate(value)
  if (!d) return '—'
  const diff = Date.now() - d.getTime()
  const sec = Math.round(diff / 1000)
  if (sec < 0) return '未来时间'
  if (sec < 60) return `${sec} 秒前`
  const min = Math.round(sec / 60)
  if (min < 60) return `${min} 分钟前`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr} 小时前`
  const day = Math.round(hr / 24)
  return `${day} 天前`
}

export function formatSourceDateTime(value?: string | null): string {
  if (!value) return '源时间缺失'
  const formatted = formatDateTime(value)
  return formatted === '—' ? value : formatted
}

export function formatFreshness(value?: string | null): string {
  if (!value) return '无法判断'
  const relative = formatRelative(value)
  if (relative === '未来时间') return '源时间在未来'
  return relative === '—' ? '无法判断' : relative
}

export function formatDuration(ms?: number | null): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms} ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)} s`
  const m = Math.floor(s / 60)
  const rem = Math.round(s % 60)
  return `${m}m ${rem}s`
}

export function formatNumber(value?: number | null): string {
  if (value == null) return '—'
  return value.toLocaleString('zh-CN')
}
