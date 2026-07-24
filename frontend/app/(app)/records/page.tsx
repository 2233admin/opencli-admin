'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Braces,
  ChevronLeft,
  ChevronRight,
  Database,
  Rows3,
  Search,
  Sparkles,
  TableProperties,
} from 'lucide-react'

import { BACKEND_HINT, EmptyState, ErrorState, LoadingState } from '@/components/shell/data-states'
import { PageContainer } from '@/components/shell/page-container'
import { DATA_EXPLORER_TABS, RouteTabs } from '@/components/shell/route-tabs'
import { StatusBadge } from '@/components/shell/status-badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useRecords, useSources } from '@/lib/api/hooks'
import type { CollectedRecord, DataSource } from '@/lib/api/types'
import { formatRelative } from '@/lib/format'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 50
const MAX_VISIBLE_FIELDS = 6
const PRIORITY_FIELDS = [
  'title',
  'name',
  'url',
  'text',
  'content',
  'description',
  'author',
  'published_at',
  'source_id',
]

const CHANNEL_LABEL: Record<DataSource['channel_type'], string> = {
  opencli: 'OpenCLI',
  web_scraper: '网页',
  api: 'API',
  rss: 'RSS',
  cli: 'CLI',
  skill: '技能',
  crawl4ai: 'Crawl4AI',
  browser_act: 'BrowserAct',
}

function recordPayload(record: CollectedRecord) {
  return Object.keys(record.normalized_data ?? {}).length > 0
    ? record.normalized_data
    : record.raw_data
}

function recordTitle(record: CollectedRecord): string {
  const data = recordPayload(record)
  const candidate = data.title ?? data.name ?? data.text ?? data.content ?? data.url
  if (typeof candidate === 'string' && candidate.trim()) return candidate
  return `记录 ${record.id.slice(0, 8)}`
}

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function JsonPanel({ label, value }: { label: string; value: Record<string, unknown> | undefined }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <Braces className="size-3.5 text-muted-foreground" />
        <h3 className="text-sm font-medium">{label}</h3>
      </div>
      <pre className="max-h-72 overflow-auto rounded-lg border bg-muted/35 p-3 font-mono text-xs leading-5 text-foreground">
        {JSON.stringify(value ?? {}, null, 2)}
      </pre>
    </section>
  )
}

export default function RecordsPage() {
  const [search, setSearch] = useState('')
  const [selectedSourceId, setSelectedSourceId] = useState<string>('all')
  const [page, setPage] = useState(1)
  const [selectedRecord, setSelectedRecord] = useState<CollectedRecord | null>(null)

  const sourcesQuery = useSources({ page: 1, limit: 100 })
  const recordsQuery = useRecords({
    ...(selectedSourceId === 'all' ? {} : { source_id: selectedSourceId }),
    ...(search ? { search } : {}),
    page,
    limit: PAGE_SIZE,
  })

  const sources = sourcesQuery.data?.data ?? []
  const records = useMemo(() => recordsQuery.data?.data ?? [], [recordsQuery.data?.data])
  const meta = recordsQuery.data?.meta
  const total = meta?.total ?? records.length
  const pages = Math.max(1, meta?.pages ?? 1)
  const selectedSource = sources.find((source) => source.id === selectedSourceId)

  const visibleFields = useMemo(() => {
    const keys = new Set<string>()
    records.forEach((record) => {
      Object.keys(recordPayload(record)).forEach((key) => keys.add(key))
    })
    return [...keys]
      .filter((key) => !key.startsWith('_') && !key.startsWith('extra__workflow'))
      .sort((left, right) => {
        const leftPriority = PRIORITY_FIELDS.indexOf(left)
        const rightPriority = PRIORITY_FIELDS.indexOf(right)
        if (leftPriority >= 0 || rightPriority >= 0) {
          if (leftPriority < 0) return 1
          if (rightPriority < 0) return -1
          return leftPriority - rightPriority
        }
        return left.localeCompare(right)
      })
      .slice(0, MAX_VISIBLE_FIELDS)
  }, [records])

  useEffect(() => {
    setPage(1)
    setSelectedRecord(null)
  }, [search, selectedSourceId])

  useEffect(() => {
    const linkedSearch = new URLSearchParams(window.location.search).get('search')
    if (linkedSearch) setSearch(linkedSearch)
  }, [])

  return (
    <PageContainer
      eyebrow="Data explorer"
      title="成果与数据"
      description="按数据源浏览结构化成果，以表格读取字段，以详情检查原始证据。"
      tabs={<RouteTabs tabs={DATA_EXPLORER_TABS} />}
      className="max-w-none"
    >
      <section className="grid overflow-hidden rounded-xl border bg-card lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col border-b bg-muted/20 lg:border-r lg:border-b-0">
          <div className="border-b px-3 py-3">
            <div className="flex items-center gap-2">
              <Database className="size-4 text-muted-foreground" />
              <h2 className="font-medium">数据集</h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">按采集入口切换数据视图</p>
          </div>

          {sourcesQuery.isLoading ? (
            <div className="p-3">
              <LoadingState rows={4} />
            </div>
          ) : sourcesQuery.isError ? (
            <div className="p-4 text-sm text-destructive">数据源目录暂时无法读取。</div>
          ) : (
            <nav aria-label="成果数据集" className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
              <button
                type="button"
                onClick={() => setSelectedSourceId('all')}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
                  selectedSourceId === 'all'
                    ? 'bg-foreground text-background'
                    : 'text-foreground hover:bg-muted',
                )}
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-md bg-background/15">
                  <TableProperties className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">全部数据</span>
                  <span className={cn('block text-xs', selectedSourceId === 'all' ? 'text-background/65' : 'text-muted-foreground')}>
                    跨数据源查询
                  </span>
                </span>
                {selectedSourceId === 'all' ? (
                  <span className="font-mono text-xs tabular-nums">{total}</span>
                ) : null}
              </button>

              {sources.map((source) => {
                const active = selectedSourceId === source.id
                return (
                  <button
                    key={source.id}
                    type="button"
                    onClick={() => setSelectedSourceId(source.id)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
                      active ? 'bg-foreground text-background' : 'text-foreground hover:bg-muted',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        'size-2 shrink-0 rounded-full',
                        source.enabled ? 'bg-emerald-500' : 'bg-muted-foreground/35',
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{source.name}</span>
                      <span className={cn('block text-xs', active ? 'text-background/65' : 'text-muted-foreground')}>
                        {CHANNEL_LABEL[source.channel_type] ?? source.channel_type}
                      </span>
                    </span>
                  </button>
                )
              })}
            </nav>
          )}
        </aside>

        <div className="flex min-w-0 flex-col">
          <header className="grid gap-3 border-b px-4 py-3 sm:grid-cols-[minmax(0,1fr)_18rem] sm:items-center">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="truncate font-medium">{selectedSource?.name ?? '全部数据'}</h2>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {total.toLocaleString('zh-CN')} 行
                </span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                当前显示 {visibleFields.length} 个业务字段，每页 {PAGE_SIZE} 行
              </p>
            </div>
            <div className="relative w-full">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索当前数据集…"
                className="h-9 pl-8"
              />
            </div>
          </header>

          {recordsQuery.isLoading ? (
            <div className="min-h-[20rem] p-4">
              <LoadingState rows={8} />
            </div>
          ) : recordsQuery.isError ? (
            <div className="grid min-h-[20rem] place-items-center p-4">
              <ErrorState message={(recordsQuery.error as Error)?.message} hint={BACKEND_HINT} />
            </div>
          ) : records.length === 0 ? (
            <div className="grid min-h-[20rem] place-items-center px-4 py-6 sm:px-8">
              <div className="w-full max-w-xl">
                <EmptyState
                  title="这个数据集暂无成果"
                  description="运行采集管线后，结构化字段和原始证据会显示在这里。"
                />
              </div>
            </div>
          ) : (
            <>
              <div className="min-h-[32rem] flex-1 overflow-auto">
                <Table className="min-w-max">
                  <TableHeader className="sticky top-0 z-10 bg-card shadow-[0_1px_0_hsl(var(--border))]">
                    <TableRow>
                      <TableHead className="w-32 bg-card">记录 ID</TableHead>
                      {visibleFields.map((field) => (
                        <TableHead key={field} className="min-w-44 max-w-72 bg-card font-mono text-xs">
                          {field}
                        </TableHead>
                      ))}
                      <TableHead className="w-28 bg-card">状态</TableHead>
                      <TableHead className="w-24 bg-card">AI</TableHead>
                      <TableHead className="w-32 bg-card">采集时间</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {records.map((record) => {
                      const payload = recordPayload(record)
                      const enriched = Boolean(record.ai_enrichment && Object.keys(record.ai_enrichment).length > 0)
                      return (
                        <TableRow key={record.id} className="group">
                          <TableCell>
                            <button
                              type="button"
                              onClick={() => setSelectedRecord(record)}
                              className="inline-flex items-center gap-2 font-mono text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              aria-label={`查看${recordTitle(record)}详情`}
                            >
                              {record.id.slice(0, 8)}
                              <ChevronRight className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
                            </button>
                          </TableCell>
                          {visibleFields.map((field) => (
                            <TableCell key={field} className="max-w-72 truncate text-sm" title={formatCellValue(payload[field])}>
                              {formatCellValue(payload[field])}
                            </TableCell>
                          ))}
                          <TableCell>
                            <StatusBadge status={record.status} />
                          </TableCell>
                          <TableCell>
                            {enriched ? (
                              <span className="inline-flex items-center gap-1 text-xs text-primary">
                                <Sparkles className="size-3.5" />
                                已富化
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                            {formatRelative(record.created_at)}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>

              <footer className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
                <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                  <Rows3 className="size-3.5" />
                  第 {page.toLocaleString('zh-CN')} / {pages.toLocaleString('zh-CN')} 页
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                  >
                    <ChevronLeft className="size-4" />
                    上一页
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={page >= pages}
                    onClick={() => setPage((current) => Math.min(pages, current + 1))}
                  >
                    下一页
                    <ChevronRight className="size-4" />
                  </Button>
                </div>
              </footer>
            </>
          )}
        </div>
      </section>

      <Sheet open={Boolean(selectedRecord)} onOpenChange={(open) => !open && setSelectedRecord(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          {selectedRecord ? (
            <>
              <SheetHeader className="border-b pr-12">
                <SheetTitle>{recordTitle(selectedRecord)}</SheetTitle>
                <SheetDescription className="font-mono">
                  {selectedRecord.id} · {formatRelative(selectedRecord.created_at)}
                </SheetDescription>
              </SheetHeader>
              <div className="space-y-6 px-4 pb-6">
                <JsonPanel label="标准化数据" value={selectedRecord.normalized_data} />
                <JsonPanel label="AI 富化" value={selectedRecord.ai_enrichment} />
                <JsonPanel label="原始数据" value={selectedRecord.raw_data} />
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </PageContainer>
  )
}
