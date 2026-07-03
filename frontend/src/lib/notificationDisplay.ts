export type AckStatusTone = 'success' | 'warning' | 'danger' | 'muted'

const MAX_PREVIEW_LENGTH = 120

function preview(value: unknown): string {
  if (value == null || value === '') return '—'
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > MAX_PREVIEW_LENGTH
    ? `${text.slice(0, MAX_PREVIEW_LENGTH - 1)}…`
    : text
}

export function summarizeNotificationResponse(
  responseData?: Record<string, unknown> | null,
): string {
  if (!responseData) return '—'

  const statusCode = responseData.status_code
  const body = preview(responseData.body)
  if (typeof statusCode === 'number' || typeof statusCode === 'string') {
    return body === '—' ? `HTTP ${statusCode}` : `HTTP ${statusCode} · ${body}`
  }

  return preview(responseData)
}

export function formatJsonPreview(data?: Record<string, unknown> | null): string {
  if (!data || Object.keys(data).length === 0) return '—'
  return JSON.stringify(data, null, 2)
}

export function getAckStatusTone(status?: string | null): AckStatusTone {
  switch (status) {
    case 'acked':
      return 'success'
    case 'pending':
      return 'warning'
    case 'failed':
      return 'danger'
    default:
      return 'muted'
  }
}
