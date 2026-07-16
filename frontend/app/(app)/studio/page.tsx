'use client'

import { Bot, Building2, ChevronDown, FileText, FileUp, FolderKanban, MessageCircle, MessagesSquare, Plus, Search, Sparkles, Workflow } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { PageContainer } from '@/components/shell/page-container'
import { ErrorState } from '@/components/shell/data-states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCreateProjectWorkflow, useCreateWorkspaceProject, useMyWorkspaces, useWorkspaceProjects } from '@/lib/api/hooks'
import { formatRelative } from '@/lib/format'
import { translateWorkflowDsl, type WorkflowImportResult } from '@/lib/workflow/codec'
import { studioGraphForTemplate, studioSlug } from '@/lib/workflow/studio-templates'

const PROJECT_TYPE_FILTERS = [
  { value: 'all', label: '全部', icon: FolderKanban },
  { value: 'chatbot', label: '聊天助手', icon: MessageCircle },
  { value: 'agent', label: 'Agent', icon: Bot },
  { value: 'chatflow', label: 'Chatflow', icon: MessagesSquare },
  { value: 'workflow', label: 'Workflow', icon: Workflow },
  { value: 'text-generator', label: '文本生成', icon: FileText },
] as const

export default function StudioPage() {
  const router = useRouter()
  const workspaces = useMyWorkspaces()
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [type, setType] = useState('all')
  const [creator, setCreator] = useState('all')
  const [sort, setSort] = useState('updated-desc')
  const [createTemplate, setCreateTemplate] = useState<string | null>(null)
  const [projectName, setProjectName] = useState('')
  const [pendingImport, setPendingImport] = useState<Extract<WorkflowImportResult, { ok: true }> | null>(null)
  const [importProjectId, setImportProjectId] = useState('')
  const [importProjectName, setImportProjectName] = useState('')
  const importInputRef = useRef<HTMLInputElement>(null)
  const createIntentHandled = useRef(false)
  const projects = useWorkspaceProjects(workspaceId)
  const createProject = useCreateWorkspaceProject()
  const createWorkflow = useCreateProjectWorkflow()

  useEffect(() => {
    if (workspaceId || !workspaces.data?.length) return
    const requestedWorkspaceId = new URLSearchParams(window.location.search).get('workspace')
    const requestedWorkspace = workspaces.data.find((workspace) => workspace.id === requestedWorkspaceId)
    setWorkspaceId(requestedWorkspace?.id ?? workspaces.data[0].id)
  }, [workspaceId, workspaces.data])

  useEffect(() => {
    if (!workspaceId || createIntentHandled.current) return
    if (new URLSearchParams(window.location.search).get('create') === 'workflow') {
      createIntentHandled.current = true
      setCreateTemplate('collection-to-consumption')
      setProjectName('采集到消费完整链路')
      const url = new URL(window.location.href)
      url.searchParams.delete('create')
      window.history.replaceState(window.history.state, '', url)
    }
  }, [workspaceId])

  const visibleProjects = useMemo(() => {
    const query = search.trim().toLowerCase()
    const result = (projects.data ?? []).filter((project) => {
      const haystack = `${project.name} ${project.description ?? ''} ${project.slug}`.toLowerCase()
      const projectType = inferProjectType(haystack)
      return (!query || haystack.includes(query)) && (type === 'all' || projectType === type) && (creator === 'all' || project.created_by_user_id === creator)
    })
    return result.sort((left, right) => {
      if (sort === 'name') return left.name.localeCompare(right.name, 'zh-CN')
      const field = sort === 'created-asc' ? 'created_at' : 'updated_at'
      const direction = sort === 'created-asc' ? 1 : -1
      return left[field].localeCompare(right[field]) * direction
    })
  }, [creator, projects.data, search, sort, type])

  const creators = useMemo(() => Array.from(new Set((projects.data ?? []).map((project) => project.created_by_user_id))), [projects.data])
  const selectedWorkspace = workspaces.data?.find((workspace) => workspace.id === workspaceId)

  async function submitCreate() {
    if (!workspaceId || !createTemplate || !projectName.trim()) return
    try {
      const project = await createProject.mutateAsync({
        workspaceId,
        data: { name: projectName.trim(), slug: `${studioSlug(projectName)}-${Date.now().toString(36)}`, description: '由工作区模板创建' },
      })
      const workflow = await createWorkflow.mutateAsync({
        workspaceId,
        projectId: project.id,
        data: { name: projectName.trim(), description: '工作区默认工作流', graph: studioGraphForTemplate(createTemplate as Parameters<typeof studioGraphForTemplate>[0], projectName.trim()) },
      })
      setCreateTemplate(null)
      toast.success('项目与工作流已创建')
      router.push(`/studio/workflow?workspace=${workspaceId}&project=${project.id}&workflow=${workflow.id}`)
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : '创建失败')
    }
  }

  async function importDsl(file: File) {
    if (!workspaceId) return
    const translated = translateWorkflowDsl(await file.text())
    if (!translated.ok) {
      toast.error(translated.error)
      return
    }
    const name = translated.project.name || file.name.replace(/\.[^.]+$/, '')
    setPendingImport(translated)
    setImportProjectId(projects.data?.[0]?.id ?? '__new__')
    setImportProjectName(name)
    if (importInputRef.current) importInputRef.current.value = ''
  }

  async function submitImport() {
    if (!workspaceId || !pendingImport || !importProjectId) return
    try {
      const name = pendingImport.project.name
      const projectId = importProjectId === '__new__'
        ? (await createProject.mutateAsync({
            workspaceId,
            data: {
              name: importProjectName.trim(),
              slug: `${studioSlug(importProjectName)}-${Date.now().toString(36)}`,
              description: `${pendingImport.format} DSL 导入`,
            },
          })).id
        : importProjectId
      const workflow = await createWorkflow.mutateAsync({
        workspaceId,
        projectId,
        data: { name, description: `${pendingImport.format} 兼容工作流`, graph: pendingImport.project },
      })
      toast.success(`已创建 ${pendingImport.format} WorkflowDraft`)
      setPendingImport(null)
      router.push(`/studio/workflow?workspace=${workspaceId}&project=${projectId}&workflow=${workflow.id}`)
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : 'DSL 导入失败')
    }
  }

  return (
    <PageContainer
      title="项目"
      eyebrow="Workspace · Projects"
      description="从真实工作区进入项目，在正式节点系统中编排、验证和发布工作流。"
      className="max-w-none"
      actions={
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button disabled={!workspaceId} />}><Plus className="size-4" />创建<ChevronDown className="size-3.5" /></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={() => router.push(`/studio/new?workspace=${workspaceId}`)}><Bot className="size-4" />与 Agent 创建</DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push(`/studio/templates?workspace=${workspaceId}`)}>从模板创建</DropdownMenuItem>
            <DropdownMenuItem onClick={() => importInputRef.current?.click()}><FileUp className="size-4" />导入 DSL</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
    >
      <input ref={importInputRef} type="file" accept=".json,.yml,.yaml,application/json,text/yaml" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importDsl(file) }} />
      <div className="space-y-3 border-b pb-4" aria-label="项目浏览工具栏">
        <div className="flex flex-wrap items-center gap-2">
          {(workspaces.data?.length ?? 0) > 1 ? (
            <Select value={workspaceId ?? ''} onValueChange={(value) => setWorkspaceId(value || null)}>
              <SelectTrigger className="min-w-48 rounded-lg border-0 bg-muted/60 shadow-none" aria-label="切换工作区">
                <Building2 className="size-3.5 text-muted-foreground" aria-hidden />
                <SelectValue>{selectedWorkspace?.name ?? '选择工作区'}</SelectValue>
              </SelectTrigger>
              <SelectContent>{(workspaces.data ?? []).map((workspace) => <SelectItem key={workspace.id} value={workspace.id}>{workspace.name}</SelectItem>)}</SelectContent>
            </Select>
          ) : selectedWorkspace ? (
            <div className="flex h-8 items-center gap-2 px-1 text-xs" aria-label="当前工作区">
              <Building2 className="size-3.5 text-muted-foreground" aria-hidden />
              <span className="font-medium">{selectedWorkspace.name}</span>
            </div>
          ) : null}
          <div className="relative ml-auto min-w-52 flex-1 sm:max-w-80">
            <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" aria-hidden />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} className="rounded-lg pl-9" placeholder="搜索名称、描述或标识" />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Dify 应用类型筛选">
          <span className="px-1 text-2xs text-muted-foreground">应用类型</span>
          {PROJECT_TYPE_FILTERS.map(({ value, label, icon: Icon }) => (
            <Button key={value} type="button" size="sm" variant={type === value ? 'secondary' : 'ghost'} className="h-8 rounded-lg px-2.5 text-xs" onClick={() => setType(value)}>
              <Icon className="size-3.5" aria-hidden />{label}
            </Button>
          ))}
          <span className="mx-1 hidden h-4 w-px bg-border sm:block" aria-hidden />
          <Select value={creator} onValueChange={(value) => setCreator(value ?? 'all')}>
            <SelectTrigger className="h-8 rounded-lg border-0 bg-transparent text-xs shadow-none"><SelectValue>{creator === 'all' ? '创建者' : creator.slice(0, 8)}</SelectValue></SelectTrigger>
            <SelectContent><SelectItem value="all">全部创建者</SelectItem>{creators.map((id) => <SelectItem key={id} value={id}>{id.slice(0, 8)}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={sort} onValueChange={(value) => setSort(value ?? 'updated-desc')}>
            <SelectTrigger className="h-8 rounded-lg border-0 bg-transparent text-xs shadow-none sm:ml-auto"><SelectValue>{SORT_LABELS[sort]}</SelectValue></SelectTrigger>
            <SelectContent><SelectItem value="updated-desc">最近修改</SelectItem><SelectItem value="created-asc">最早创建</SelectItem><SelectItem value="name">名称</SelectItem></SelectContent>
          </Select>
        </div>
      </div>

      {workspaces.isError || projects.isError ? (
        <div className="space-y-3">
          <ErrorState
            message={(workspaces.error ?? projects.error)?.message}
            hint="确认后端已启动并完成身份验证后重试。"
          />
          <Button variant="outline" onClick={() => void (workspaces.isError ? workspaces.refetch() : projects.refetch())}>重试</Button>
        </div>
      ) : projects.isLoading ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-40 animate-pulse rounded-xl bg-muted" />)}</div>
      ) : visibleProjects.length ? (
        <section aria-label="项目列表">
          <div className="mb-3 flex items-center justify-between gap-3 text-xs"><span className="font-medium">{visibleProjects.length} 个项目</span><span className="text-muted-foreground">{SORT_LABELS[sort]}</span></div>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {visibleProjects.map((project) => (
            <Link key={project.id} href={`/studio/workflow?workspace=${workspaceId}&project=${project.id}`} className="group min-w-0 rounded-xl border border-border/80 bg-card/30 p-3.5 transition-[border-color,background-color,transform] hover:-translate-y-0.5 hover:border-foreground/25 hover:bg-card/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
              <div className="flex items-start justify-between gap-3"><div className="grid size-9 place-items-center rounded-lg bg-muted text-muted-foreground transition-colors group-hover:text-foreground"><FolderKanban className="size-4" aria-hidden /></div><Badge variant={project.archived ? 'secondary' : 'outline'}>{project.archived ? '已归档' : project.slug}</Badge></div>
              <div className="mt-4 flex items-center gap-2"><span className="eyebrow-mono">{TYPE_LABELS[inferProjectType(`${project.name} ${project.description ?? ''} ${project.slug}`)]}</span><span className="truncate font-mono text-[10px] text-muted-foreground">{project.slug}</span></div>
              <h2 className="mt-1 truncate text-sm font-semibold">{project.name}</h2>
              <p className="mt-1 line-clamp-2 min-h-10 text-xs leading-5 text-muted-foreground">{project.description || '数据节点项目'}</p>
              <div className="mt-3 flex items-center justify-between border-t border-border/70 pt-2.5 text-[10px] text-muted-foreground"><span>创建者 {project.created_by_user_id.slice(0, 8)}</span><span>{formatRelative(project.updated_at)}</span></div>
            </Link>
          ))}
          </div>
        </section>
      ) : (
        <div className="flex min-h-[420px] items-center justify-center rounded-xl border border-dashed bg-muted/10 px-4">
          <div className="w-full max-w-xl text-center">
            <div className="mx-auto grid size-11 place-items-center rounded-xl border bg-background"><Bot className="size-5 text-muted-foreground" /></div>
            <h2 className="mt-4 text-sm font-medium">创建你的第一个数据应用</h2>
            <p className="mt-1 text-xs text-muted-foreground">从成熟模板开始、创建空白节点图，或者导入 Dify / n8n DSL。</p>
            <div className="mt-5 grid gap-2 text-left">
              <CreateChoice title="与 Agent 创建项目" description="描述目标，由 Agent 生成第一版节点工作流。" href={workspaceId ? `/studio/new?workspace=${workspaceId}` : undefined} icon={Bot} />
              <CreateChoice title="从应用模板创建" description="选择预设的数据链路，最快体验 OpenCLI。" href={workspaceId ? `/studio/templates?workspace=${workspaceId}` : undefined} icon={Sparkles} />
              <div className="my-0.5 flex items-center gap-3 text-[10px] text-muted-foreground before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">或</div>
              <CreateChoice title="导入 DSL 文件" description="兼容迁移 Dify、n8n 和 OpenCLI 工作流。" onClick={workspaceId ? () => importInputRef.current?.click() : undefined} icon={FileUp} />
            </div>
          </div>
        </div>
      )}

      <Dialog open={createTemplate !== null} onOpenChange={(open) => !open && setCreateTemplate(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>创建数据节点项目</DialogTitle><DialogDescription>项目和第一份 WorkflowDraft 会同时保存到当前工作区。</DialogDescription></DialogHeader>
          <label className="space-y-2 text-sm"><span>项目名称</span><Input value={projectName} onChange={(event) => setProjectName(event.target.value)} autoFocus /></label>
          <DialogFooter><Button variant="outline" onClick={() => setCreateTemplate(null)}>取消</Button><Button onClick={submitCreate} disabled={!projectName.trim() || createProject.isPending || createWorkflow.isPending}>创建并打开</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={pendingImport !== null} onOpenChange={(open) => !open && setPendingImport(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>导入为 WorkflowDraft</DialogTitle>
            <DialogDescription>选择现有 Project，或明确新建一个 Project 后保存并打开画布。</DialogDescription>
          </DialogHeader>
          {pendingImport ? <ImportCompatibilitySummary imported={pendingImport} /> : null}
          <label className="space-y-2 text-sm">
            <span>目标 Project</span>
            <Select value={importProjectId} onValueChange={(value) => setImportProjectId(value ?? '')}>
              <SelectTrigger className="w-full"><SelectValue placeholder="选择 Project" /></SelectTrigger>
              <SelectContent>
                {(projects.data ?? []).map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}
                <SelectItem value="__new__">＋ 新建 Project</SelectItem>
              </SelectContent>
            </Select>
          </label>
          {importProjectId === '__new__' ? (
            <label className="space-y-2 text-sm"><span>新 Project 名称</span><Input value={importProjectName} onChange={(event) => setImportProjectName(event.target.value)} /></label>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingImport(null)}>取消</Button>
            <Button onClick={submitImport} disabled={!importProjectId || (importProjectId === '__new__' && !importProjectName.trim()) || createProject.isPending || createWorkflow.isPending}>创建 Draft 并打开</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}

function ImportCompatibilitySummary({ imported }: { imported: Extract<WorkflowImportResult, { ok: true }> }) {
  const report = imported.report
  const unsupported = report && ('unsupportedConnectionCount' in report ? report.unsupportedConnectionCount : report.unsupportedEdgeCount)
  return (
    <div className="rounded-xl border bg-muted/30 p-3 text-xs">
      <div className="flex items-center justify-between gap-3"><span className="font-medium">兼容报告</span><Badge variant="outline">{imported.format}</Badge></div>
      <p className="mt-2 text-muted-foreground">
        {report ? `${report.nodeCount} 个节点 · ${report.edgeCount} 条连线 · ${report.adapterCount} 个适配器` : 'Canonical WorkflowProject，无需翻译。'}
      </p>
      {unsupported ? <p className="mt-2 text-amber-600">有 {unsupported} 条连接无法映射，已保留其余可兼容内容。</p> : <p className="mt-2 text-emerald-600">未发现缺失连接。</p>}
    </div>
  )
}

function inferProjectType(value: string) {
  const normalized = value.toLowerCase()
  if (/chatflow|对话流|会话流/.test(normalized)) return 'chatflow'
  if (/\bagent\b|智能体|专题研究|research/.test(normalized)) return 'agent'
  if (/chatbot|聊天|客服|问答/.test(normalized)) return 'chatbot'
  if (/text.generator|文本生成|文案|摘要|翻译|写作/.test(normalized)) return 'text-generator'
  return 'workflow'
}

const TYPE_LABELS: Record<string, string> = { chatbot: '聊天助手', agent: 'Agent', chatflow: 'Chatflow', workflow: 'Workflow', 'text-generator': '文本生成' }
const SORT_LABELS: Record<string, string> = { 'updated-desc': '最近修改', 'created-asc': '最早创建', name: '名称' }

function CreateChoice({ title, description, href, onClick, icon: Icon }: { title: string; description: string; href?: string; onClick?: () => void; icon: typeof Plus }) {
  const content = <><div className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted"><Icon className="size-4" /></div><div><div className="text-sm font-medium">{title}</div><div className="mt-0.5 text-xs text-muted-foreground">{description}</div></div></>
  if (href) return <Link href={href} className="flex items-center gap-3 rounded-xl border bg-card p-3 transition-colors hover:bg-accent">{content}</Link>
  if (onClick) return <button type="button" onClick={onClick} className="flex items-center gap-3 rounded-xl border bg-card p-3 text-left transition-colors hover:bg-accent">{content}</button>
  return <div className="flex items-center gap-3 rounded-xl border bg-card p-3 opacity-50">{content}</div>
}
