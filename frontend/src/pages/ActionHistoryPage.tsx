import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { formatInTimeZone } from 'date-fns-tz'
import { toast } from 'sonner'

import { getAdvisoryReport, getKillSwitch, listControlActions, setKillSwitch } from '../api/endpoints'
import Card from '../components/Card'
import ConfirmDialog from '../components/ConfirmDialog'
import DataTable from '../components/DataTable'
import ErrorAlert from '../components/ErrorAlert'
import { PageLoader } from '../components/LoadingSpinner'
import Pagination from '../components/Pagination'
import PageHeader from '../components/PageHeader'
import StatTile from '../components/StatTile'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select'
import {
  EMPTY_ACTION_HISTORY_FILTERS,
  formatRecoveryRate,
  killSwitchSourceLabel,
  killSwitchTone,
  toActionHistoryRowView,
  toAdvisoryBucketRowView,
  toListControlActionsParams,
  verdictTone,
  type ActionHistoryFilters,
  type ActionHistoryRowView,
  type AdvisoryBucketRowView,
} from '../labs/topology/actionHistory'

const LIMIT = 20

/** The operator console for the control loop (issue 07 + PR-Control-3.5):
 * the advisory agreement/recovery report (the gate data for ever flipping
 * CONTROL_MODE=automatic), the global actuator kill switch, and the
 * row-level Evidence Ledger listing (GET /control/actions). Advisory-only
 * today: `executed` rows do not exist until PR-Control-4 ships, and this
 * view renders that fact honestly rather than assuming a shape that doesn't
 * exist yet. */
export default function ActionHistoryPage() {
  const queryClient = useQueryClient()
  const [filters, setFilters] = useState<ActionHistoryFilters>(EMPTY_ACTION_HISTORY_FILTERS)
  const [page, setPage] = useState(1)
  const [confirmToggleOpen, setConfirmToggleOpen] = useState(false)

  const query = useQuery({
    queryKey: ['control-actions', filters, page],
    queryFn: () => listControlActions(toListControlActionsParams(filters, page, LIMIT)),
    refetchInterval: 15_000,
  })

  const reportQuery = useQuery({
    queryKey: ['control-advisory-report'],
    queryFn: () => getAdvisoryReport(),
    refetchInterval: 15_000,
  })

  const killSwitchQuery = useQuery({
    queryKey: ['control-kill-switch'],
    queryFn: () => getKillSwitch(),
    refetchInterval: 15_000,
  })

  const toggleKillSwitch = useMutation({
    mutationFn: (engaged: boolean) => setKillSwitch(engaged),
    onSuccess: (data) => {
      queryClient.setQueryData(['control-kill-switch'], data)
      setConfirmToggleOpen(false)
      toast.success(data.engaged ? '已启用 kill switch — 执行器已停止' : '已解除 kill switch')
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '切换失败'),
  })

  const rows = (query.data?.data ?? []).map(toActionHistoryRowView)
  const meta = query.data?.meta

  const updateFilter = (key: keyof ActionHistoryFilters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }))
    setPage(1)
  }

  const killSwitch = killSwitchQuery.data
  const bucketRows = (reportQuery.data?.buckets ?? []).map(toAdvisoryBucketRowView)

  return (
    <div className="space-y-4">
      <PageHeader
        title="Control Console"
        description="Evidence Ledger + advisory gate report + kill switch — the operator surface over the control loop."
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <AdvisoryReportSection
          totals={reportQuery.data?.totals}
          modeBreakdown={reportQuery.data?.mode_breakdown}
          buckets={bucketRows}
          isLoading={reportQuery.isLoading}
          error={reportQuery.error as Error | null}
          onRetry={() => reportQuery.refetch()}
        />

        <KillSwitchPanel
          state={killSwitch}
          isLoading={killSwitchQuery.isLoading}
          error={killSwitchQuery.error as Error | null}
          onRetry={() => killSwitchQuery.refetch()}
          onRequestToggle={() => setConfirmToggleOpen(true)}
          pending={toggleKillSwitch.isPending}
        />
      </div>

      <Card padding={false} className="border-white/10 bg-black/20">
        <div className="flex flex-wrap items-center gap-2 border-b border-white/8 px-4 py-3">
          <Input
            type="text"
            placeholder="source_id"
            value={filters.sourceId}
            onChange={(e) => updateFilter('sourceId', e.target.value)}
            className="h-8 w-40 text-xs"
          />
          <Select value={filters.mode || 'all'} onValueChange={(v: string) => updateFilter('mode', v === 'all' ? '' : v)}>
            <SelectTrigger className="h-8 w-36 text-xs">
              <SelectValue placeholder="all modes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">all modes</SelectItem>
              <SelectItem value="advisory">advisory</SelectItem>
              <SelectItem value="automatic">automatic</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filters.outcome || 'all'} onValueChange={(v: string) => updateFilter('outcome', v === 'all' ? '' : v)}>
            <SelectTrigger className="h-8 w-44 text-xs">
              <SelectValue placeholder="all outcomes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">all outcomes</SelectItem>
              <SelectItem value="pending">pending</SelectItem>
              <SelectItem value="recovered">recovered</SelectItem>
              <SelectItem value="persisted">persisted</SelectItem>
              <SelectItem value="insufficient_data">insufficient_data</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {query.isLoading ? (
          <PageLoader />
        ) : query.error ? (
          <ErrorAlert error={query.error as Error} onRetry={() => query.refetch()} />
        ) : (
          <>
            <DataTable
              data={rows}
              keyFn={(r) => r.id}
              emptyMessage="No ledger rows match these filters."
              columns={[
                {
                  key: 'source_id',
                  header: 'Source',
                  width: '140px',
                  render: (r: ActionHistoryRowView) => (
                    <span className="font-mono text-xs text-zinc-400">{r.sourceId.slice(0, 8)}</span>
                  ),
                },
                {
                  key: 'state',
                  header: 'State',
                  render: (r: ActionHistoryRowView) => <span className="text-sm">{r.state}</span>,
                },
                {
                  key: 'action_type',
                  header: 'Action',
                  render: (r: ActionHistoryRowView) => <span className="text-sm">{r.actionType}</span>,
                },
                {
                  key: 'reason',
                  header: 'Reason',
                  render: (r: ActionHistoryRowView) => (
                    <span className="block truncate text-xs text-zinc-500" title={r.reason}>
                      {r.reason}
                    </span>
                  ),
                },
                {
                  key: 'mode',
                  header: 'Mode',
                  width: '100px',
                  render: (r: ActionHistoryRowView) => (
                    <Badge variant={r.mode === 'automatic' ? 'default' : 'secondary'}>{r.mode}</Badge>
                  ),
                },
                {
                  key: 'executed',
                  header: 'Executed',
                  width: '90px',
                  render: (r: ActionHistoryRowView) => (
                    <span className={r.executed ? 'text-emerald-300' : 'text-zinc-500'}>
                      {r.executed ? 'yes' : 'no'}
                    </span>
                  ),
                },
                {
                  key: 'verdict',
                  header: 'Outcome',
                  width: '140px',
                  render: (r: ActionHistoryRowView) => <VerdictBadge label={r.verdictLabel} tone={verdictTone(r.verdict)} />,
                },
                {
                  key: 'created_at',
                  header: 'Recorded',
                  width: '140px',
                  render: (r: ActionHistoryRowView) => (
                    <span className="text-xs text-zinc-500">
                      {formatInTimeZone(new Date(r.createdAt), 'Asia/Shanghai', 'MM-dd HH:mm:ss')}
                    </span>
                  ),
                },
              ]}
            />
            {meta && meta.total > 0 && (
              <Pagination page={meta.page} pages={meta.pages} total={meta.total} limit={meta.limit} onChange={setPage} />
            )}
          </>
        )}
      </Card>

      <ConfirmDialog
        open={confirmToggleOpen}
        onOpenChange={setConfirmToggleOpen}
        title={killSwitch?.engaged ? '解除 kill switch？' : '启用 kill switch？'}
        description={
          killSwitch?.engaged
            ? '解除后，一旦 CONTROL_MODE 为 automatic，控制器的执行器将可以重新执行动作。'
            : '启用后将立即停止执行器执行任何动作，直到手动解除。这是一个全局开关，影响所有 source。'
        }
        confirmLabel={toggleKillSwitch.isPending ? '处理中…' : killSwitch?.engaged ? '确认解除' : '确认启用'}
        variant="destructive"
        onConfirm={() => toggleKillSwitch.mutate(!(killSwitch?.engaged ?? false))}
      />
    </div>
  )
}

function VerdictBadge({ label, tone }: { label: string; tone: 'success' | 'danger' | 'neutral' }) {
  const cls =
    tone === 'success'
      ? 'border-emerald-400/35 bg-emerald-400/10 text-emerald-100'
      : tone === 'danger'
        ? 'border-red-400/35 bg-red-400/10 text-red-100'
        : 'border-zinc-500/30 bg-zinc-500/10 text-zinc-300'
  return <span className={`inline-flex border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}>{label}</span>
}

interface AdvisoryReportSectionProps {
  totals?: {
    total: number
    pending: number
    evaluated: number
    recovered: number
    persisted: number
    insufficient_data: number
    recovery_rate: number | null
  }
  modeBreakdown?: Record<string, number>
  buckets: AdvisoryBucketRowView[]
  isLoading: boolean
  error: Error | null
  onRetry: () => void
}

function AdvisoryReportSection({ totals, modeBreakdown, buckets, isLoading, error, onRetry }: AdvisoryReportSectionProps) {
  return (
    <Card padding={false} className="border-white/10 bg-black/20">
      <div className="border-b border-white/8 px-4 py-3">
        <h2 className="text-sm font-semibold text-zinc-100">Advisory Gate Report</h2>
        <p className="mt-1 text-xs leading-5 text-zinc-500">
          This is the gate data for ever flipping CONTROL_MODE to "automatic" — recovery_rate must be read per (state,
          action_type) bucket, not just at the totals level, before trusting the controller to act on its own.
        </p>
      </div>

      {isLoading ? (
        <PageLoader />
      ) : error ? (
        <div className="p-4">
          <ErrorAlert error={error} onRetry={onRetry} />
        </div>
      ) : (
        <div className="space-y-4 p-4">
          {totals && (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-7">
              <StatTile label="Total" value={totals.total} />
              <StatTile label="Pending" value={totals.pending} />
              <StatTile label="Evaluated" value={totals.evaluated} />
              <StatTile label="Recovered" value={totals.recovered} />
              <StatTile label="Persisted" value={totals.persisted} />
              <StatTile label="Insuf. data" value={totals.insufficient_data} />
              <StatTile label="Recovery rate" value={formatRecoveryRate(totals.recovery_rate)} />
            </div>
          )}

          {modeBreakdown && Object.keys(modeBreakdown).length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-code text-[10px] uppercase tracking-wide text-zinc-500">Mode breakdown:</span>
              {Object.entries(modeBreakdown).map(([mode, count]) => (
                <Badge key={mode} variant={mode === 'automatic' ? 'default' : 'secondary'}>
                  {mode}: {count}
                </Badge>
              ))}
            </div>
          )}

          <DataTable
            data={buckets}
            keyFn={(b) => b.key}
            emptyMessage="No advisory ledger rows yet."
            columns={[
              { key: 'state', header: 'State', render: (b: AdvisoryBucketRowView) => <span className="text-xs">{b.state}</span> },
              {
                key: 'action_type',
                header: 'Action',
                render: (b: AdvisoryBucketRowView) => <span className="text-xs">{b.actionType}</span>,
              },
              { key: 'total', header: 'Total', width: '70px', render: (b: AdvisoryBucketRowView) => <span className="font-code text-xs">{b.total}</span> },
              { key: 'pending', header: 'Pending', width: '70px', render: (b: AdvisoryBucketRowView) => <span className="font-code text-xs">{b.pending}</span> },
              { key: 'recovered', header: 'Recovered', width: '80px', render: (b: AdvisoryBucketRowView) => <span className="font-code text-xs text-emerald-300">{b.recovered}</span> },
              { key: 'persisted', header: 'Persisted', width: '80px', render: (b: AdvisoryBucketRowView) => <span className="font-code text-xs text-red-300">{b.persisted}</span> },
              {
                key: 'insufficient_data',
                header: 'Insuf. data',
                width: '90px',
                render: (b: AdvisoryBucketRowView) => <span className="font-code text-xs text-zinc-400">{b.insufficientData}</span>,
              },
              {
                key: 'recovery_rate',
                header: 'Recovery rate',
                width: '100px',
                render: (b: AdvisoryBucketRowView) => <span className="font-code text-xs">{b.recoveryRateLabel}</span>,
              },
            ]}
          />
        </div>
      )}
    </Card>
  )
}

interface KillSwitchPanelProps {
  state?: { engaged: boolean; runtime_override: boolean | null; config_default: boolean }
  isLoading: boolean
  error: Error | null
  onRetry: () => void
  onRequestToggle: () => void
  pending: boolean
}

function KillSwitchPanel({ state, isLoading, error, onRetry, onRequestToggle, pending }: KillSwitchPanelProps) {
  return (
    <Card className="h-fit border-white/10 bg-black/20">
      <h2 className="text-sm font-semibold text-zinc-100">Kill Switch</h2>
      <p className="mt-1 text-xs leading-5 text-zinc-500">
        Global actuator halt. When engaged, the Control Cycle never executes anything regardless of CONTROL_MODE.
      </p>

      {isLoading ? (
        <div className="mt-3">
          <PageLoader />
        </div>
      ) : error ? (
        <div className="mt-3">
          <ErrorAlert error={error} onRetry={onRetry} />
        </div>
      ) : state ? (
        <div className="mt-4 space-y-3">
          <div
            className={
              killSwitchTone(state.engaged) === 'danger'
                ? 'border border-red-400/35 bg-red-400/10 px-3 py-2 text-red-100'
                : 'border border-white/8 bg-black/25 px-3 py-2 text-zinc-300'
            }
          >
            <p className="font-code text-[10px] uppercase tracking-wide opacity-70">Effective state</p>
            <p className="mt-1 font-code text-lg font-semibold">{state.engaged ? 'ENGAGED' : 'DISENGAGED'}</p>
          </div>

          <p className="font-code text-[11px] text-zinc-500">{killSwitchSourceLabel(state)}</p>
          <p className="font-code text-[11px] text-zinc-500">
            config_default: {state.config_default ? 'engaged' : 'disengaged'}
          </p>

          <Button
            type="button"
            variant={state.engaged ? 'outline' : 'destructive'}
            size="sm"
            className="w-full"
            onClick={onRequestToggle}
            disabled={pending}
          >
            {pending ? '处理中…' : state.engaged ? '解除 kill switch' : '启用 kill switch'}
          </Button>
        </div>
      ) : null}
    </Card>
  )
}
