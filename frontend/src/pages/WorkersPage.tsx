import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { listWorkers, getCeleryStats, getSystemConfig } from '../api/endpoints'
import { PageLoader } from '../components/LoadingSpinner'
import ErrorAlert from '../components/ErrorAlert'
import Card from '../components/Card'
import DataTable from '../components/DataTable'
import StatusBadge from '../components/StatusBadge'
import PageHeader from '../components/PageHeader'
import { formatInTimeZone } from 'date-fns-tz'
import { AlertTriangle, Server } from 'lucide-react'

function getStatsError(stats?: Record<string, unknown>) {
  const error = stats?.error
  return typeof error === 'string' && error.trim() ? error : null
}

export default function WorkersPage() {
  const { t } = useTranslation()

  // task_executor moved off the public /health liveness probe (issue 04:
  // /health is auth-exempt so it must leak nothing) to the authenticated
  // system config endpoint. Same queryKey as NodesPage's system-config cache.
  const healthQ = useQuery({
    queryKey: ['system-config'],
    queryFn: getSystemConfig,
    staleTime: 60_000,
  })

  const isLocalMode = healthQ.data?.task_executor === 'local'

  const workersQ = useQuery({
    queryKey: ['workers'],
    queryFn: listWorkers,
    refetchInterval: 10_000,
    enabled: !isLocalMode,
  })

  const statsQ = useQuery({
    queryKey: ['celery-stats'],
    queryFn: getCeleryStats,
    refetchInterval: 10_000,
    enabled: !isLocalMode,
  })

  const workers = workersQ.data?.data ?? []
  const statsError = getStatsError(statsQ.data)

  if (healthQ.isLoading) return <PageLoader />

  if (isLocalMode) {
    return (
      <div>
        <PageHeader title={t('workers.title')} description={t('workers.description')} />
        <Card>
          <div className="flex flex-col items-center py-10 text-center gap-4">
            <div className="p-4 bg-white/6 rounded-full">
              <Server size={32} className="text-zinc-500" />
            </div>
            <div>
              <p className="text-base font-medium text-zinc-100">{t('workers.localModeTitle')}</p>
              <p className="mt-1 text-sm text-zinc-400 max-w-sm">
                {t('workers.localModeDescription')}{' '}
                {t('workers.localModeHint')}{' '}
                <code className="border border-white/10 bg-black/40 font-code px-1 py-0.5 rounded-sm text-xs">TASK_EXECUTOR</code>{' '}
                {t('workers.localModeSetTo')}{' '}
                <code className="border border-white/10 bg-black/40 font-code px-1 py-0.5 rounded-sm text-xs">celery</code>
                {t('workers.localModeSuffix')}
              </p>
            </div>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div>
      <PageHeader title={t('workers.title')} description={t('workers.description')} />

      <Card className="mb-6">
        <h2 className="font-semibold text-zinc-100 mb-3">{t('workers.liveStats')}</h2>
        {statsQ.isLoading ? (
          <p className="text-sm text-zinc-400">{t('workers.statsLoading')}</p>
        ) : statsError ? (
          <div className="rounded-md border border-amber-500/25 bg-amber-500/10 p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle size={18} className="mt-0.5 text-amber-400" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-amber-100">{t('workers.statsUnavailableTitle')}</p>
                <p className="mt-1 text-sm text-amber-100/75">{t('workers.statsUnavailableDetail')}</p>
                <code className="mt-3 block wrap-break-word rounded-sm bg-black/20 px-3 py-2 text-xs text-amber-50/80">
                  {statsError}
                </code>
              </div>
            </div>
          </div>
        ) : statsQ.data ? (
          <pre className="text-xs border border-white/8 bg-black/40 font-code p-3 rounded-lg overflow-auto max-h-48">
            {JSON.stringify(statsQ.data, null, 2)}
          </pre>
        ) : (
          <p className="text-sm text-zinc-400">{t('workers.notReachable')}</p>
        )}
      </Card>

      <Card padding={false}>
        {workersQ.isLoading ? (
          <PageLoader />
        ) : workersQ.error ? (
          <ErrorAlert error={workersQ.error as Error} />
        ) : (
          <DataTable
            data={workers}
            keyFn={(w) => w.id}
            emptyMessage={t('workers.noWorkers')}
            columns={[
              {
                key: 'id', header: t('common.id'), width: '100px',
                render: (w) => <span className="font-mono text-xs text-zinc-500">{w.id.slice(0, 8)}</span>,
              },
              { key: 'worker_id', header: t('workers.workerId'), render: (w) => <code className="text-xs">{w.worker_id}</code> },
              { key: 'hostname', header: t('workers.host'), render: (w) => <span className="text-sm">{w.hostname}</span> },
              { key: 'status', header: t('common.status'), render: (w) => <StatusBadge status={w.status} /> },
              { key: 'active', header: t('workers.activeTasks'), render: (w) => <span className="text-sm">{w.active_tasks}</span> },
              {
                key: 'heartbeat',
                header: t('workers.lastHeartbeat'),
                render: (w) => (
                  <span className="text-xs text-zinc-500">
                    {w.last_heartbeat
                      ? formatInTimeZone(new Date(w.last_heartbeat), 'Asia/Shanghai', 'MM-dd HH:mm:ss')
                      : '—'}
                  </span>
                ),
              },
            ]}
          />
        )}
      </Card>
    </div>
  )
}
