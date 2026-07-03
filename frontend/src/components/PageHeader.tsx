import { useTranslation } from 'react-i18next'

interface Props {
  title: string
  description?: string
  action?: React.ReactNode
}

export default function PageHeader({ title, description, action }: Props) {
  const { t } = useTranslation()

  return (
    <div className="mb-6 flex flex-col gap-4 border-b border-white/10 pb-5 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        <p className="telemetry-label mb-2 flex items-center gap-2">
          <span className="inline-block h-3 w-0.5 bg-primary-500" />
          {t('brand.opsConsole')}
        </p>
        <h1 className="truncate text-[1.75rem] font-semibold tracking-tight text-zinc-50">{title}</h1>
        {description && (
          <p className="mt-1.5 max-w-3xl text-sm leading-6 text-zinc-400">{description}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}
