import { Fragment, useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { listRecords, batchDeleteRecords, clearAllRecords, listSources } from '../api/endpoints'
import ErrorAlert from '../components/ErrorAlert'
import Card from '../components/Card'
import StatusBadge from '../components/StatusBadge'
import PageHeader from '../components/PageHeader'
import { TableSkeleton } from '../components/SkeletonLoader'
import EmptyState from '../components/EmptyState'
import ConfirmDialog from '../components/ConfirmDialog'
import Pagination from '../components/Pagination'
import { MetricTile, PanelHeader } from '../components/opencli'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatInTimeZone } from 'date-fns-tz'
import { AlertTriangle, ChevronDown, ChevronRight, FileText, Search, StickyNote, Trash2 } from 'lucide-react'
import type { CollectedRecord } from '../api/types'

const RECORD_NOTES_KEY = 'opencli-admin.recordNotes.v1'

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState<T>(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

function JsonBlock({ data }: { data: Record<string, unknown> }) {
  return (
    <pre className="max-h-64 overflow-auto border border-white/10 bg-black/35 p-3 font-mono text-xs text-zinc-200">
      {JSON.stringify(data, null, 2)}
    </pre>
  )
}

function loadRecordNotes(): Record<string, string> {
  try {
    const raw = localStorage.getItem(RECORD_NOTES_KEY)
    return raw ? JSON.parse(raw) as Record<string, string> : {}
  } catch {
    return {}
  }
}

function saveRecordNotes(notes: Record<string, string>) {
  localStorage.setItem(RECORD_NOTES_KEY, JSON.stringify(notes))
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable
}

function recordTitle(record: CollectedRecord) {
  const title = record.normalized_data.title ?? record.raw_data.title
  return typeof title === 'string' && title.trim() ? title : '未命名记录'
}

function tableHeaderClass(columnId: string) {
  const base = 'px-3 py-3 text-left font-telemetry text-3xs font-semibold uppercase tracking-[0.14em] text-zinc-500'
  if (columnId === 'expand') return 'w-8 px-2 py-3'
  if (columnId === 'select') return 'w-10 px-3 py-3'
  if (columnId === 'id') return `${base} w-20`
  if (columnId === 'title') return `${base} w-80 max-w-xs`
  if (columnId === 'status') return `${base} w-24`
  if (columnId === 'createdAt') return `${base} w-32`
  return base
}

function tableCellClass(columnId: string) {
  if (columnId === 'expand') return 'px-2 py-2.5 text-zinc-500'
  if (columnId === 'select') return 'px-3 py-2.5'
  if (columnId === 'title') return 'px-3 py-2.5 w-80 max-w-xs'
  return 'px-3 py-2.5'
}

function recordUrl(record: CollectedRecord) {
  const url = record.normalized_data.url ?? record.raw_data.url
  return typeof url === 'string' && url.trim() ? url : ''
}

function RecordFocusPanel({
  record,
  sourceName,
  note,
  onNoteChange,
  expanded,
  onToggleExpand,
}: {
  record: CollectedRecord | null
  sourceName?: string
  note: string
  onNoteChange: (note: string) => void
  expanded: boolean
  onToggleExpand: () => void
}) {
  if (!record) {
    return (
      <Card className="h-full border-dashed border-white/15">
        <div className="flex min-h-[280px] items-center justify-center px-6 text-center text-sm text-zinc-500">
          选择一条记录开始整理，右侧会固定保留上下文和本地笔记。
        </div>
      </Card>
    )
  }

  const url = recordUrl(record)

  return (
    <Card className="h-full xl:sticky xl:top-6">
      <div className="flex items-start justify-between gap-3 border-b border-white/10 pb-4">
        <div className="min-w-0">
          <p className="telemetry-label">Focus record</p>
          <h2 className="mt-1 line-clamp-2 text-base font-semibold text-zinc-50">
            {recordTitle(record)}
          </h2>
          <p className="mt-1 font-mono text-xs text-zinc-500">
            {sourceName ?? record.source_id.slice(0, 8)}
          </p>
        </div>
        <StatusBadge status={record.status} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
        <div className="border border-white/10 bg-black/20 p-2">
          <p className="telemetry-label">Record</p>
          <p className="mt-1 font-mono text-zinc-300">{record.id.slice(0, 8)}</p>
        </div>
        <div className="border border-white/10 bg-black/20 p-2">
          <p className="telemetry-label">Task</p>
          <p className="mt-1 font-mono text-zinc-300">{record.task_id.slice(0, 8)}</p>
        </div>
      </div>

      {url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 block truncate border border-white/10 bg-white/[0.035] px-3 py-2 font-mono text-xs text-zinc-300 transition-colors hover:border-primary-500/50 hover:text-primary-100"
        >
          {url}
        </a>
      )}

      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between">
          <label htmlFor={`record-note-${record.id}`} className="telemetry-label">
            操作笔记
          </label>
          <Badge variant="secondary">本地保存</Badge>
        </div>
        <textarea
          id={`record-note-${record.id}`}
          value={note}
          onChange={(e) => onNoteChange(e.target.value)}
          placeholder="下一步、判断、要回看的问题..."
          className="min-h-[140px] w-full resize-y border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-100 outline-hidden transition-colors placeholder:text-zinc-600 focus:border-primary-500/70 focus:ring-2 focus:ring-primary-500/20"
        />
      </div>

      <div className="mt-4 flex items-center gap-2">
        <Button
          type="button"
          onClick={onToggleExpand}
          variant="outline"
          className="flex-1"
        >
          {expanded ? '收起 JSON' : '展开 JSON'}
        </Button>
      </div>

      <div className="mt-5 space-y-3">
        <div>
          <p className="telemetry-label mb-2">标准化数据</p>
          <JsonBlock data={record.normalized_data} />
        </div>
        {record.ai_enrichment && (
          <div>
            <p className="telemetry-label mb-2">AI 分析</p>
            <JsonBlock data={record.ai_enrichment} />
          </div>
        )}
      </div>

      <p className="mt-4 border-t border-white/10 pt-3 font-mono text-2xs text-zinc-500">
        j/k 或方向键移动焦点，Enter 展开当前记录。
      </p>
    </Card>
  )
}

export default function RecordsPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmClearOpen, setConfirmClearOpen] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [recordNotes, setRecordNotes] = useState<Record<string, string>>(() => loadRecordNotes())

  const search = useDebounce(searchInput, 400)

  const STATUS_FILTERS = [
    { value: '',             label: t('records.filterAll') },
    { value: 'raw',          label: t('records.filterRaw') },
    { value: 'normalized',   label: t('records.filterNormalized') },
    { value: 'ai_processed', label: t('records.filterAiProcessed') },
    { value: 'error',        label: t('records.filterError') },
  ]

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['records', page, statusFilter, search],
    queryFn: () =>
      listRecords({
        page,
        limit: 20,
        status: statusFilter || undefined,
        search: search || undefined,
      }),
  })

  const { data: sourcesData } = useQuery({
    queryKey: ['sources', 'all'],
    queryFn: () => listSources({ limit: 100 }),
  })

  const records: CollectedRecord[] = data?.data ?? []
  const meta = data?.meta
  const sourceMap = useMemo(() => {
    const next: Record<string, string> = {}
    for (const s of sourcesData?.data ?? []) {
      next[s.id] = s.name
    }
    return next
  }, [sourcesData?.data])

  const focusedRecord = records.find((record) => record.id === focusedId) ?? null
  const focusedPosition = focusedRecord
    ? Math.max(1, records.findIndex((record) => record.id === focusedRecord.id) + 1)
    : 0
  const pageErrorCount = useMemo(
    () => records.filter((record) => record.status === 'error').length,
    [records],
  )
  const pageNoteCount = useMemo(
    () => records.filter((record) => recordNotes[record.id]?.trim()).length,
    [records, recordNotes],
  )

  useEffect(() => {
    if (records.length === 0) {
      setFocusedId(null)
      return
    }
    if (!focusedId || !records.some((record) => record.id === focusedId)) {
      setFocusedId(records[0].id)
    }
  }, [focusedId, records])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target) || records.length === 0) return
      const currentIndex = Math.max(0, records.findIndex((record) => record.id === focusedId))
      if (event.key === 'j' || event.key === 'ArrowDown') {
        event.preventDefault()
        setFocusedId(records[Math.min(records.length - 1, currentIndex + 1)].id)
      }
      if (event.key === 'k' || event.key === 'ArrowUp') {
        event.preventDefault()
        setFocusedId(records[Math.max(0, currentIndex - 1)].id)
      }
      if (event.key === 'Enter' && focusedId) {
        event.preventDefault()
        toggleExpand(focusedId)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [focusedId, records])

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['records'] })
    setSelected(new Set())
  }

  const updateNote = (recordId: string, note: string) => {
    setRecordNotes((prev) => {
      const next = { ...prev, [recordId]: note }
      if (!note.trim()) delete next[recordId]
      saveRecordNotes(next)
      return next
    })
  }

  const batchDelete = useMutation({
    mutationFn: (ids: string[]) => batchDeleteRecords(ids),
    onSuccess: () => { invalidate(); toast.success('已批量删除') },
    onError: (err) => toast.error(err instanceof Error ? err.message : '删除失败'),
  })

  const clearAll = useMutation({
    mutationFn: () => clearAllRecords(),
    onSuccess: () => { invalidate(); setConfirmClearOpen(false); toast.success('已清空') },
    onError: (err) => toast.error(err instanceof Error ? err.message : '操作失败'),
  })

  const allIds = records.map((r) => r.id)
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id))
  const someSelected = selected.size > 0

  const toggleAll = () => {
    if (allSelected) {
      setSelected((prev) => {
        const next = new Set(prev)
        allIds.forEach((id) => next.delete(id))
        return next
      })
    } else {
      setSelected((prev) => new Set([...prev, ...allIds]))
    }
  }

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id))
  }

  const columns = useMemo<ColumnDef<CollectedRecord>[]>(
    () => [
      {
        id: 'expand',
        size: 32,
        header: () => null,
        cell: ({ row }) => {
          const r = row.original
          return (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); toggleExpand(r.id); setFocusedId(r.id) }}
              className="grid h-6 w-6 place-items-center border border-transparent text-zinc-500 transition-colors hover:border-white/10 hover:bg-white/5.5 hover:text-zinc-100"
              title={expandedId === r.id ? t('common.collapse') : t('common.expand')}
            >
              {expandedId === r.id
                ? <ChevronDown className="h-4 w-4" />
                : <ChevronRight className="h-4 w-4" />}
            </button>
          )
        },
      },
      {
        id: 'select',
        size: 40,
        header: () => (
          <input
            type="checkbox"
            checked={allSelected}
            ref={(el) => { if (el) el.indeterminate = !allSelected && someSelected }}
            onChange={toggleAll}
            className="h-4 w-4 accent-primary-500"
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            checked={selected.has(row.original.id)}
            onClick={(e) => e.stopPropagation()}
            onChange={() => toggleOne(row.original.id)}
            className="h-4 w-4 accent-primary-500"
          />
        ),
      },
      {
        id: 'id',
        size: 80,
        header: () => t('common.id'),
        cell: ({ row }) => (
          <span className="font-mono text-xs text-zinc-500">{row.original.id.slice(0, 8)}</span>
        ),
      },
      {
        id: 'source',
        header: () => '来源',
        cell: ({ row }) => (
          <span className="text-xs text-zinc-400">
            {sourceMap[row.original.source_id] ?? row.original.source_id.slice(0, 8)}
          </span>
        ),
      },
      {
        id: 'title',
        size: 320,
        header: () => t('records.titleCol'),
        cell: ({ row }) => {
          const r = row.original
          return (
            <div className="space-y-1">
              <p className="truncate text-sm font-medium text-zinc-100" title={recordTitle(r)}>
                {recordTitle(r)}
              </p>
              {typeof r.normalized_data.url === 'string' && r.normalized_data.url && (
                <a
                  href={r.normalized_data.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="block truncate font-mono text-xs text-zinc-500 hover:text-primary-200"
                >
                  {r.normalized_data.url.slice(0, 60)}
                </a>
              )}
            </div>
          )
        },
      },
      {
        id: 'status',
        size: 96,
        header: () => t('common.status'),
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: 'createdAt',
        size: 128,
        header: () => t('records.collectedAt'),
        cell: ({ row }) => (
          <span className="font-mono text-xs text-zinc-500">
            {formatInTimeZone(new Date(row.original.created_at), 'Asia/Shanghai', 'MM-dd HH:mm:ss')}
          </span>
        ),
      },
    ],
    [allSelected, expandedId, records, selected, someSelected, sourceMap, t],
  )

  const recordTable = useReactTable({
    data: records,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
  })

  if (isLoading) return (
    <div>
      <PageHeader title={t('records.title')} description={t('records.description')} />
      <Card padding={false}><TableSkeleton rows={8} /></Card>
    </div>
  )
  if (error) return <ErrorAlert error={error as Error} onRetry={refetch} />

  return (
    <div>
      <PageHeader title={t('records.title')} description={t('records.description')} />

      <div className="mb-4 grid gap-3 md:grid-cols-4">
        <MetricTile
          label="Total records"
          value={meta?.total ?? records.length}
          sub={`当前页 ${records.length} 条`}
          icon={FileText}
          tone="neutral"
        />
        <MetricTile
          label="Focus index"
          value={focusedPosition ? `${focusedPosition}/${records.length}` : '0/0'}
          sub={focusedRecord ? focusedRecord.id.slice(0, 8) : '未选择'}
          icon={Search}
          tone="accent"
        />
        <MetricTile
          label="Error on page"
          value={pageErrorCount}
          sub={pageErrorCount > 0 ? '优先处理失败记录' : '本页无失败记录'}
          icon={AlertTriangle}
          tone={pageErrorCount > 0 ? 'danger' : 'neutral'}
        />
        <MetricTile
          label="Notes on page"
          value={pageNoteCount}
          sub={pageNoteCount > 0 ? '已有本地整理上下文' : '可在右侧添加笔记'}
          icon={StickyNote}
          tone="neutral"
        />
      </div>

      <Card className="mb-4" padding={false}>
        <PanelHeader
          label="Record workbench"
          title={<h2 className="text-base font-semibold text-zinc-50">搜索、筛选和批量整理</h2>}
          description="筛选只改变当前工作视图，右侧焦点会跟随键盘或点击移动。"
          actions={(
            <div className="flex flex-wrap items-center gap-2">
              {someSelected && (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => batchDelete.mutate([...selected])}
                  disabled={batchDelete.isPending}
                >
                  <Trash2 />
                  {batchDelete.isPending ? '删除中...' : `删除已选 ${selected.size}`}
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setConfirmClearOpen(true)}
              >
                <Trash2 />
                一键清空
              </Button>
            </div>
          )}
        />

        <div className="grid gap-3 p-4 xl:grid-cols-[minmax(260px,420px)_minmax(0,1fr)] xl:items-center">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <Input
              value={searchInput}
              onChange={(e) => {
                setSearchInput(e.target.value)
                setPage(1)
              }}
              placeholder="搜索标题、内容..."
              className="pl-9"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 xl:justify-end">
            {STATUS_FILTERS.map(({ value, label }) => (
              <button
                key={value || 'all'}
                type="button"
                onClick={() => { setStatusFilter(value); setPage(1); setSelected(new Set()) }}
                data-active={statusFilter === value}
                className="telemetry-button px-3 py-2 text-3xs uppercase tracking-[0.12em]"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card padding={false}>
          <table className="w-full text-sm">
            <thead>
              {recordTable.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id} className="border-b border-white/10 bg-white/[0.035]">
                  {headerGroup.headers.map((header) => (
                    <th
                      key={header.id}
                      className={tableHeaderClass(header.column.id)}
                      style={{ width: header.getSize() }}
                    >
                      {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody className="divide-y divide-white/6">
              {records.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <EmptyState
                      icon={FileText}
                      title="暂无采集记录"
                      description="触发一次采集任务后，数据将在此展示"
                    />
                  </td>
                </tr>
              ) : recordTable.getRowModel().rows.map((row) => {
                const r = row.original
                return (
                <Fragment key={row.id}>
                  <tr
                    onClick={() => setFocusedId(r.id)}
                    onDoubleClick={() => toggleExpand(r.id)}
                    aria-selected={focusedId === r.id}
                    className={`cursor-pointer transition-colors hover:bg-white/4.5 ${
                      focusedId === r.id ? 'bg-primary-500/9 shadow-[inset_2px_0_0_var(--oc-line-hot)]' : ''
                    } ${selected.has(r.id) ? 'bg-white/6' : ''}`}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className={tableCellClass(cell.column.id)}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                  {expandedId === r.id && (
                    <tr className="bg-black/25">
                      <td colSpan={7} className="px-6 py-4">
                        <div className="space-y-4">
                          <div>
                            <p className="telemetry-label mb-2">标准化数据</p>
                            <JsonBlock data={r.normalized_data} />
                          </div>
                          {r.ai_enrichment && (
                            <div>
                              <p className="telemetry-label mb-2">AI 分析</p>
                              <JsonBlock data={r.ai_enrichment} />
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
                )
              })}
            </tbody>
          </table>

          {meta && (meta.pages > 1 || meta.total > 0) && (
            <Pagination
              page={page}
              pages={meta.pages}
              total={meta.total}
              limit={20}
              onChange={setPage}
            />
          )}
        </Card>

        <RecordFocusPanel
          record={focusedRecord}
          sourceName={focusedRecord ? sourceMap[focusedRecord.source_id] : undefined}
          note={focusedRecord ? recordNotes[focusedRecord.id] ?? '' : ''}
          onNoteChange={(note) => {
            if (focusedRecord) updateNote(focusedRecord.id, note)
          }}
          expanded={focusedRecord ? expandedId === focusedRecord.id : false}
          onToggleExpand={() => {
            if (focusedRecord) toggleExpand(focusedRecord.id)
          }}
        />
      </div>

      <ConfirmDialog
        open={confirmClearOpen}
        onOpenChange={setConfirmClearOpen}
        title="确认清空全部记录？"
        description="此操作不可撤销，所有采集记录将被永久删除。"
        confirmLabel={clearAll.isPending ? '清空中…' : '确认清空'}
        variant="destructive"
        onConfirm={() => clearAll.mutate()}
      />
    </div>
  )
}
