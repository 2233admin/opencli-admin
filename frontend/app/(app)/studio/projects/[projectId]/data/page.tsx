'use client'

import {
  ArrowLeft,
  BarChart3,
  Braces,
  Database,
  ExternalLink,
  FileStack,
  Filter,
  Rows3,
  Search,
  SlidersHorizontal,
  Upload,
  Workflow,
} from 'lucide-react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { use, useEffect, useMemo, useState } from 'react'

import { EmptyState, ErrorState, LoadingState } from '@/components/shell/data-states'
import { PageContainer } from '@/components/shell/page-container'
import { ProjectNavigation } from '@/components/studio/project-navigation'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useProjectWorkflows, useRecords, useWorkspaceProjects } from '@/lib/api/hooks'
import type { CollectedRecord } from '@/lib/api/types'
import { formatDateTime, formatFreshness, formatRelative, formatSourceDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 50
const PRIORITY_FIELDS = ['title', 'name', 'url', 'text', 'content', 'author', 'published_at', 'source']
const SOURCE_PUBLISHED_RAW_KEYS = ['displayTime', 'published_at', 'publishedAt', 'published', 'sent_at', 'sentAt', 'time', 'timestamp'] as const
const SOURCE_PUBLISHED_FALLBACK_KEYS = ['noticeDate', 'date', 'created_at', 'createdAt', 'listed', 'updated'] as const
type WorkbenchView = 'dataset' | 'profile' | 'files'

function recordPayload(record: CollectedRecord) {
  return Object.keys(record.normalized_data ?? {}).length ? record.normalized_data : record.raw_data
}

function recordTitle(record: CollectedRecord) {
  const payload = recordPayload(record)
  const value = payload.title ?? payload.name ?? payload.text ?? payload.content ?? payload.url
  return typeof value === 'string' && value.trim() ? value : `记录 ${record.id.slice(0, 8)}`
}

function sourceString(payload: Record<string, unknown>, key: string) {
  const value = payload[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function recordSourcePublishedAt(record: CollectedRecord) {
  for (const key of SOURCE_PUBLISHED_RAW_KEYS) {
    const value = sourceString(record.raw_data, key)
    if (value) return value
  }
  const normalized = sourceString(record.normalized_data, 'published_at')
  if (normalized) return normalized
  for (const key of SOURCE_PUBLISHED_FALLBACK_KEYS) {
    const value = sourceString(record.raw_data, key)
    if (value) return value
  }
  return null
}

function formatCell(value: unknown) {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

function fieldKind(values: unknown[]) {
  const sample = values.find((value) => value !== null && value !== undefined && value !== '')
  if (sample === undefined) return 'empty'
  if (Array.isArray(sample)) return 'array'
  if (typeof sample === 'object') return 'object'
  return typeof sample
}

export default function ProjectDataWorkbenchPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params)
  const searchParams = useSearchParams()
  const workspaceId = searchParams.get('workspace')
  const preferredWorkflowId = searchParams.get('workflow')
  const [view, setView] = useState<WorkbenchView>('dataset')
  const [search, setSearch] = useState(searchParams.get('search') ?? '')
  const [status, setStatus] = useState('all')
  const [page, setPage] = useState(1)
  const [selectedField, setSelectedField] = useState<string | null>(null)
  const [selectedRecord, setSelectedRecord] = useState<CollectedRecord | null>(null)
  const [detailMode, setDetailMode] = useState<'normalized' | 'raw' | 'enrichment'>('normalized')

  const projectsQuery = useWorkspaceProjects(workspaceId)
  const workflowsQuery = useProjectWorkflows(workspaceId, projectId)
  const recordsQuery = useRecords({
    project_id: projectId,
    ...(status === 'all' ? {} : { status }),
    ...(search.trim() ? { search: search.trim() } : {}),
    page,
    limit: PAGE_SIZE,
  })
  const project = projectsQuery.data?.find((candidate) => candidate.id === projectId)
  const workflows = workflowsQuery.data ?? []
  const records = useMemo(() => recordsQuery.data?.data ?? [], [recordsQuery.data?.data])
  const meta = recordsQuery.data?.meta
  const total = meta?.total ?? records.length
  const pages = Math.max(1, meta?.pages ?? 1)
  const workflowId = preferredWorkflowId ?? project?.primary_workflow_id ?? workflows[0]?.id ?? null

  const visibleFields = useMemo(() => {
    const keys = new Set<string>()
    records.forEach((record) => Object.keys(recordPayload(record)).forEach((key) => keys.add(key)))
    return [...keys]
      .filter((key) => !key.startsWith('_'))
      .sort((left, right) => {
        const leftIndex = PRIORITY_FIELDS.indexOf(left)
        const rightIndex = PRIORITY_FIELDS.indexOf(right)
        if (leftIndex >= 0 || rightIndex >= 0) {
          if (leftIndex < 0) return 1
          if (rightIndex < 0) return -1
          return leftIndex - rightIndex
        }
        return left.localeCompare(right)
      })
      .slice(0, 24)
  }, [records])

  const activeField = selectedField && visibleFields.includes(selectedField) ? selectedField : visibleFields[0] ?? null
  const fieldProfiles = useMemo(() => visibleFields.map((field) => {
    const values = records.map((record) => recordPayload(record)[field])
    const filled = values.filter((value) => value !== null && value !== undefined && value !== '')
    const unique = new Set(filled.map((value) => JSON.stringify(value))).size
    return { field, kind: fieldKind(values), filled: filled.length, unique, ratio: records.length ? Math.round((filled.length / records.length) * 100) : 0 }
  }), [records, visibleFields])
  const activeProfile = fieldProfiles.find((profile) => profile.field === activeField) ?? null
  const valueDistribution = useMemo(() => {
    if (!activeField) return []
    const counts = new Map<string, number>()
    records.forEach((record) => {
      const label = formatCell(recordPayload(record)[activeField])
      counts.set(label, (counts.get(label) ?? 0) + 1)
    })
    return [...counts.entries()].sort((left, right) => right[1] - left[1]).slice(0, 8)
  }, [activeField, records])
  const sourceGroups = useMemo(() => {
    const groups = new Map<string, { count: number; updatedAt: string; statuses: Set<string> }>()
    records.forEach((record) => {
      const current = groups.get(record.source_id) ?? { count: 0, updatedAt: record.updated_at, statuses: new Set<string>() }
      current.count += 1
      current.statuses.add(record.status)
      if (record.updated_at > current.updatedAt) current.updatedAt = record.updated_at
      groups.set(record.source_id, current)
    })
    return [...groups.entries()].sort((left, right) => right[1].count - left[1].count)
  }, [records])

  useEffect(() => {
    setPage(1)
    setSelectedRecord(null)
  }, [search, status])

  const loading = projectsQuery.isLoading || workflowsQuery.isLoading || recordsQuery.isLoading
  const error = projectsQuery.error || workflowsQuery.error || recordsQuery.error
  const orchestrationHref = workspaceId && workflowId
    ? `/studio/workflow?workspace=${workspaceId}&project=${projectId}&workflow=${workflowId}`
    : null
  const overviewHref = workspaceId ? `/studio/projects/${projectId}?workspace=${workspaceId}` : '/studio'

  return (
    <PageContainer
      eyebrow="Project data workbench"
      title={project ? `${project.name} · 数据工作台` : '项目数据工作台'}
      description="用同一份项目真实数据完成浏览、字段剖析与输入追溯，并反向定位产生它的工作流。"
      className="max-w-none"
      actions={<Link href={overviewHref} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'min-h-11')}><ArrowLeft className="size-4" />返回项目</Link>}
    >
      <div className="border-b pb-3">
        <ProjectNavigation active="data" workspaceId={workspaceId} projectId={projectId} workflowId={workflowId} />
      </div>

      <section className="grid gap-3 sm:grid-cols-3" aria-label="项目数据摘要">
        <Summary label="项目记录" value={total.toLocaleString('zh-CN')} icon={Database} />
        <Summary label="当前字段" value={String(visibleFields.length)} icon={Rows3} />
        <Summary label="数据来源" value={String(sourceGroups.length)} icon={FileStack} />
      </section>

      <section className="overflow-hidden rounded-xl border bg-card">
        <header className="border-b">
          <div className="flex flex-wrap items-center justify-between gap-3 px-3 pt-3">
            <div className="flex rounded-lg border bg-muted/30 p-1" aria-label="数据工作台视图">
              <ViewButton active={view === 'dataset'} icon={Database} onClick={() => setView('dataset')}>数据集</ViewButton>
              <ViewButton active={view === 'profile'} icon={BarChart3} onClick={() => setView('profile')}>字段分析</ViewButton>
              <ViewButton active={view === 'files'} icon={FileStack} onClick={() => setView('files')}>项目文件</ViewButton>
            </div>
            {orchestrationHref ? <Link href={orchestrationHref} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'min-h-10')}><Workflow className="size-4" />打开业务编排</Link> : null}
          </div>
          <div className="grid gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_13rem_auto] lg:items-center">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索标题、正文、URL 或字段值…" className="pl-9" />
            </div>
            <Select value={status} onValueChange={(value) => setStatus(value ?? 'all')}>
              <SelectTrigger><Filter className="size-4" /><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部处理状态</SelectItem>
                <SelectItem value="raw">原始数据</SelectItem>
                <SelectItem value="normalized">已标准化</SelectItem>
                <SelectItem value="ai_processed">已富化</SelectItem>
                <SelectItem value="notified">已交付</SelectItem>
                <SelectItem value="error">处理失败</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><SlidersHorizontal className="size-3.5" />当前视图使用项目过滤条件</div>
          </div>
        </header>

        {loading ? <div className="p-5"><LoadingState rows={7} /></div> : error ? (
          <div className="p-5"><ErrorState message={error instanceof Error ? error.message : '项目数据读取失败'} hint="确认后端、工作区和项目上下文可用。" /></div>
        ) : records.length === 0 ? (
          <EmptyState title="项目还没有可显示的数据" description="运行并完成业务工作流后，记录会按 workflow_id 自动归入当前项目。" />
        ) : view === 'profile' ? (
          <FieldProfileView profiles={fieldProfiles} activeField={activeField} activeProfile={activeProfile} distribution={valueDistribution} total={records.length} onSelect={setSelectedField} />
        ) : view === 'files' ? (
          <ProjectInputsView groups={sourceGroups} />
        ) : (
          <DatasetView records={records} visibleFields={visibleFields} onSelect={setSelectedRecord} />
        )}

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-xs text-muted-foreground">
          <span>当前加载第 {page} / {pages} 页 · 共 {total.toLocaleString('zh-CN')} 条</span>
          <div className="flex gap-2"><Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</Button><Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage((value) => Math.min(pages, value + 1))}>下一页</Button></div>
        </footer>
      </section>

      <Sheet open={Boolean(selectedRecord)} onOpenChange={(open) => !open && setSelectedRecord(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          {selectedRecord ? <>
            <SheetHeader><SheetTitle>{recordTitle(selectedRecord)}</SheetTitle><SheetDescription>对照原始输入、标准化结果和 AI 富化字段；这些内容是可审计的数据处理结果。</SheetDescription></SheetHeader>
            <div className="mt-5 flex flex-wrap gap-2">{(['normalized', 'raw', 'enrichment'] as const).map((mode) => <Button key={mode} size="sm" variant={detailMode === mode ? 'default' : 'outline'} onClick={() => setDetailMode(mode)}>{mode === 'normalized' ? '标准化结果' : mode === 'raw' ? '原始输入' : 'AI 富化'}</Button>)}</div>
            <pre className="mt-3 max-h-[55vh] overflow-auto rounded-lg border bg-muted/30 p-4 font-mono text-xs leading-5">{JSON.stringify(detailMode === 'normalized' ? selectedRecord.normalized_data : detailMode === 'raw' ? selectedRecord.raw_data : selectedRecord.ai_enrichment ?? {}, null, 2)}</pre>
            <div className="mt-4 grid gap-3 rounded-lg border p-4 text-xs sm:grid-cols-2"><Meta label="源发布时间" value={formatSourceDateTime(recordSourcePublishedAt(selectedRecord))} /><Meta label="数据新鲜度" value={formatFreshness(recordSourcePublishedAt(selectedRecord))} /><Meta label="采集时间" value={formatDateTime(selectedRecord.created_at)} /><Meta label="工作流" value={selectedRecord.workflow_id ?? '未绑定'} /><Meta label="运行" value={selectedRecord.workflow_run_id ?? '未绑定'} /><Meta label="来源" value={selectedRecord.source_id} /><Meta label="内容哈希" value={selectedRecord.content_hash} /></div>
            <div className="mt-4 flex flex-wrap gap-2">
              {workspaceId && selectedRecord.workflow_id ? <Link href={`/studio/workflow?workspace=${workspaceId}&project=${projectId}&workflow=${selectedRecord.workflow_id}`} className={buttonVariants({ variant: 'outline' })}><Workflow className="size-4" />定位业务编排</Link> : null}
              {workspaceId ? <Link href={`/studio/projects/${projectId}/evidence?workspace=${workspaceId}${selectedRecord.workflow_id ? `&workflow=${selectedRecord.workflow_id}` : ''}&record=${selectedRecord.id}`} className={buttonVariants({ variant: 'outline' })}><ExternalLink className="size-4" />查看逻辑与证据</Link> : null}
            </div>
          </> : null}
        </SheetContent>
      </Sheet>
    </PageContainer>
  )
}

function ViewButton({ active, children, icon: Icon, onClick }: { active: boolean; children: React.ReactNode; icon: typeof Database; onClick: () => void }) {
  return <button type="button" aria-pressed={active} onClick={onClick} className={cn('flex min-h-9 items-center gap-2 rounded-md px-3 text-xs transition-colors', active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}><Icon className="size-3.5" />{children}</button>
}

function DatasetView({ records, visibleFields, onSelect }: { records: CollectedRecord[]; visibleFields: string[]; onSelect: (record: CollectedRecord) => void }) {
  return <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead className="min-w-64">记录</TableHead>{visibleFields.slice(0, 4).map((field) => <TableHead key={field} className="min-w-40">{field}</TableHead>)}<TableHead>状态</TableHead><TableHead>源发布时间</TableHead></TableRow></TableHeader><TableBody>{records.map((record) => { const payload = recordPayload(record); const sourcePublishedAt = recordSourcePublishedAt(record); return <TableRow key={record.id} className="cursor-pointer" onClick={() => onSelect(record)}><TableCell><div className="max-w-80"><div className="truncate font-medium">{recordTitle(record)}</div><div className="mt-1 truncate font-mono text-[10px] text-muted-foreground">{record.id}</div></div></TableCell>{visibleFields.slice(0, 4).map((field) => <TableCell key={field}><span className="block max-w-64 truncate text-xs text-muted-foreground">{formatCell(payload[field])}</span></TableCell>)}<TableCell><Badge variant={record.status === 'error' ? 'destructive' : 'outline'}>{record.status}</Badge></TableCell><TableCell className="whitespace-nowrap text-xs text-muted-foreground" title={formatSourceDateTime(sourcePublishedAt)}><span className="block text-foreground/80">{formatFreshness(sourcePublishedAt)}</span><span className="mt-0.5 block text-[10px]">{formatSourceDateTime(sourcePublishedAt)}</span></TableCell></TableRow> })}</TableBody></Table></div>
}

function FieldProfileView({ profiles, activeField, activeProfile, distribution, total, onSelect }: { profiles: Array<{ field: string; kind: string; filled: number; unique: number; ratio: number }>; activeField: string | null; activeProfile: { field: string; kind: string; filled: number; unique: number; ratio: number } | null; distribution: Array<[string, number]>; total: number; onSelect: (field: string) => void }) {
  const max = Math.max(1, ...distribution.map(([, count]) => count))
  return <div className="grid min-h-[32rem] lg:grid-cols-[16rem_minmax(0,1fr)]"><aside className="border-b p-3 lg:border-b-0 lg:border-r"><p className="px-2 pb-2 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">字段 · {profiles.length}</p><div className="max-h-[30rem] space-y-1 overflow-y-auto">{profiles.map((profile) => <button type="button" key={profile.field} onClick={() => onSelect(profile.field)} className={cn('flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-xs', activeField === profile.field ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground')}><span className="truncate font-mono">{profile.field}</span><span>{profile.ratio}%</span></button>)}</div></aside><div className="p-5">{activeProfile ? <><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><Braces className="size-4 text-muted-foreground" /><h2 className="font-mono text-base font-semibold">{activeProfile.field}</h2></div><p className="mt-1 text-xs text-muted-foreground">按当前筛选结果即时计算，不写回源数据。</p></div><Badge variant="outline">{activeProfile.kind}</Badge></div><div className="mt-5 grid gap-3 sm:grid-cols-3"><Fact label="字段填充" value={`${activeProfile.filled} / ${total}`} /><Fact label="完整率" value={`${activeProfile.ratio}%`} /><Fact label="唯一值" value={String(activeProfile.unique)} /></div><section className="mt-6"><div className="flex items-center justify-between"><p className="text-xs font-medium">值分布</p><span className="text-[10px] text-muted-foreground">Top {distribution.length}</span></div><div className="mt-3 space-y-3">{distribution.map(([label, count]) => <div key={label} className="grid grid-cols-[minmax(8rem,15rem)_minmax(0,1fr)_3rem] items-center gap-3 text-xs"><span className="truncate font-mono text-muted-foreground" title={label}>{label}</span><span className="h-2 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-primary" style={{ width: `${Math.max(4, (count / max) * 100)}%` }} /></span><span className="text-right font-mono">{count}</span></div>)}</div></section></> : <p className="text-sm text-muted-foreground">当前数据没有可分析字段。</p>}</div></div>
}

function ProjectInputsView({ groups }: { groups: Array<[string, { count: number; updatedAt: string; statuses: Set<string> }]> }) {
  return <div className="p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">项目输入与处理批次</h2><p className="mt-1 text-xs text-muted-foreground">先用现有来源记录验证文件工作台结构；上传与解析引擎接线后仍沿用这里的项目上下文。</p></div><Button variant="outline" size="sm" disabled title="文件上传适配器尚未接入"><Upload className="size-4" />上传文件 · 接入中</Button></div><div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{groups.map(([sourceId, group]) => <article key={sourceId} className="rounded-lg border p-4"><div className="flex items-start justify-between gap-3"><span className="grid size-9 place-items-center rounded-md bg-muted"><FileStack className="size-4 text-muted-foreground" /></span><Badge variant="outline">{group.count} 条</Badge></div><h3 className="mt-4 truncate font-mono text-xs font-medium" title={sourceId}>{sourceId}</h3><p className="mt-1 text-[11px] text-muted-foreground">最近处理 {formatRelative(group.updatedAt)}</p><div className="mt-3 flex flex-wrap gap-1.5">{[...group.statuses].map((status) => <Badge key={status} variant={status === 'error' ? 'destructive' : 'secondary'}>{status}</Badge>)}</div></article>)}</div></div>
}

function Summary({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Database }) {
  return <div className="flex items-center gap-3 rounded-xl border bg-card p-4"><span className="grid size-10 place-items-center rounded-lg bg-muted"><Icon className="size-4 text-muted-foreground" /></span><div><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-mono text-xl font-semibold">{value}</p></div></div>
}

function Fact({ label, value }: { label: string; value: string }) { return <div className="rounded-lg border p-3"><p className="text-[10px] text-muted-foreground">{label}</p><p className="mt-1 font-mono text-sm font-semibold">{value}</p></div> }
function Meta({ label, value }: { label: string; value: string }) { return <div><p className="text-muted-foreground">{label}</p><p className="mt-1 break-all font-mono text-[11px]">{value}</p></div> }
