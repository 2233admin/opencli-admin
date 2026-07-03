import { AlertCircle } from 'lucide-react'

interface Props {
  error: Error | string
  onRetry?: () => void
}

export default function ErrorAlert({ error, onRetry }: Props) {
  const message = error instanceof Error ? error.message : error
  return (
    <div className="telemetry-panel flex items-start gap-3 border-signal-red/45 bg-signal-red/10 p-4">
      <AlertCircle className="mt-0.5 shrink-0 text-signal-red" size={18} />
      <div className="flex-1">
        <p className="text-sm text-red-100">{message}</p>
        {onRetry && (
          <button
            onClick={onRetry}
            className="mt-2 font-telemetry text-xs font-semibold uppercase tracking-[0.14em] text-red-200 underline hover:no-underline"
          >
            Retry
          </button>
        )}
      </div>
    </div>
  )
}
