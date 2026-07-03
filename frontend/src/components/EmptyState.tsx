import type { ElementType } from 'react'

interface EmptyStateProps {
  icon?: ElementType
  title: string
  description?: string
  action?: { label: string; onClick: () => void }
}

export default function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      {Icon && (
        <Icon
          size={48}
          className="text-zinc-600 mb-4"
          strokeWidth={1.5}
        />
      )}
      <h3 className="text-base font-medium text-zinc-400 mb-1">
        {title}
      </h3>
      {description && (
        <p className="text-sm text-zinc-500 max-w-xs">
          {description}
        </p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-4 px-4 py-2 text-sm rounded-lg bg-primary-500/20 border border-primary-500/50 text-primary-300 hover:bg-primary-500/30 transition-colors"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
