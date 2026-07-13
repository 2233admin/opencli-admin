'use client'

import { Blocks, Bot, ChevronDown, Database, FileUp, FolderKanban, Plus, Search, Send, Sparkles } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { PageContainer } from '@/components/shell/page-container'
import { ErrorState } from '@/components/shell/data-states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dock } from '@/components/unlumen-ui/dock'
import { useCreateProjectWorkflow, useCreateWorkspaceProject, useMyWorkspaces, useWorkspaceProjects } from '@/lib/api/hooks'
import { PACKAGED_WORKFLOW_PROJECT } from '@/lib/workflow/collection-pipeline'
import { translateWorkflowDsl, type WorkflowImportResult } from '@/lib/workflow/codec'
import { parseWorkflowProject } from '@/lib/workflow/schema'

const TEMPLATES = [
  { id: 'collect', title: '实时网站采集器', description: '把网站或 CLI 封装为持续运行的数据入口。', icon: Database, tone: 'bg-cyan-500/10 text-cyan-500' },
  { id: 'process', title: '结构化清洗管线', description: '标准化、去重、结构化与 Agent 增强处理。', icon: Blocks, tone: 'bg-violet-500/10 text-violet-500' },
  { id: 'deliver', title: '数据消费 API', description: '将产物发送到 API、数据库、消息系统或其他 AI。', icon: Send, tone: 'bg-emerald-500/10 text-emerald-500' },
  { id: 'collection-to-consumption', title: '采集到消费完整链路', description: '采集、处理、决策、发送与运行观测的完整模板。', icon: Sparkles, tone: 'bg-orange-500/10 text-orange-500' },
] as const

export default function StudioPage() {
  const router = useRouter()
  const workspaces = useMyWorkspaces()
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [type, setType] = useState('all')
  const [tag, setTag] = useState('all')
  const [creator, setCreator] = useState('all')
  const [sort, setSort] = useState('updated-desc')
  const [createTemplate, setCreateTemplate] = useState<string | null>(null)
  const [projectName, setProjectName] = useState('')
  const [pendingImport, setPendingImport] = useState<Extract<WorkflowImportResult, { ok: true }> | null>(null)
  const [importProjectId, setImportProjectId] = useState('')
  const [importProjectName, setImportProjectName] = useState('')
  const importInputRef = useRef<HTMLInputElement>(null)
  const projects = useWorkspaceProjects(workspaceId)
  const createProject = useCreateWorkspaceProject()
  const createWorkflow = useCreateProjectWorkflow()

  useEffect(() => {
    if (!workspaceId && workspaces.data?.length) setWorkspaceId(workspaces.data[0].id)
  }, [workspaceId, workspaces.data])

  const visibleProjects = useMemo(() => {
    const query = search.trim().toLowerCase()
    const result = (projects.data ?? []).filter((project) => {
      const haystack = `${project.name} ${project.description ?? ''} ${project.slug}`.toLowerCase()
      const projectType = inferProjectType(haystack)
      return (!query || haystack.includes(query)) && (type === 'all' || projectType === type) && (tag === 'all' || projectType === tag) && (creator === 'all' || project.created_by_user_id === creator)
    })
    return result.sort((left, right) => {
      if (sort === 'name') return left.name.localeCompare(right.name, 'zh-CN')
      const field = sort === 'created-asc' ? 'created_at' : 'updated_at'
      const direction = sort === 'created-asc' ? 1 : -1
      return left[field].localeCompare(right[field]) * direction
    })
  }, [creator, projects.data, search, sort, tag, type])

  const creators = useMemo(() => Array.from(new Set((projects.data ?? []).map((project) => project.created_by_user_id))), [projects.data])

  function openCreate(template: string) {
    setCreateTemplate(template)
    setProjectName(template === 'blank' ? '未命名项目' : TEMPLATES.find((item) => item.id === template)?.title ?? '数据节点项目')
  }

  async function submitCreate() {
    if (!workspaceId || !createTemplate || !projectName.trim()) return
    try {
      const project = await createProject.mutateAsync({
        workspaceId,
        data: { name: projectName.trim(), slug: `${slugify(projectName)}-${Date.now().toString(36)}`, description: '由工作区模板创建' },
      })
      const workflow = await createWorkflow.mutateAsync({
        workspaceId,
        projectId: project.id,
        data: { name: projectName.trim(), description: '工作区默认工作流', graph: graphForTemplate(createTemplate, projectName.trim()) },
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
              slug: `${slugify(importProjectName)}-${Date.now().toString(36)}`,
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
      title="工作区"
      eyebrow="Workspace"
      description="创建和管理数据节点应用。"
      className="max-w-none"
      actions={
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button disabled={!workspaceId} />}><Plus className="size-4" />创建<ChevronDown className="size-3.5" /></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={() => openCreate('collection-to-consumption')}>从模板创建</DropdownMenuItem>
            <DropdownMenuItem onClick={() => openCreate('blank')}>创建空白项目</DropdownMenuItem>
            <DropdownMenuItem onClick={() => importInputRef.current?.click()}><FileUp className="size-4" />导入 DSL</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
    >
      <input ref={importInputRef} type="file" accept=".json,.yml,.yaml,application/json,text/yaml" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importDsl(file) }} />
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-background/75 p-1.5 shadow-sm backdrop-blur-xl">
        <Dock
          className="border-0 bg-transparent p-0 shadow-none hover:shadow-none"
          iconSize={32}
          magnification={1.14}
          distance={70}
          borderRadius={10}
          items={[
            { label: '全部类型', icon: <FolderKanban />, active: type === 'all', onClick: () => setType('all') },
            { label: '采集', icon: <Database />, active: type === 'collect', onClick: () => setType('collect') },
            { label: '处理', icon: <Blocks />, active: type === 'process', onClick: () => setType('process') },
            { label: '发送', icon: <Send />, active: type === 'deliver', onClick: () => setType('deliver') },
            { label: '完整链路', icon: <Sparkles />, active: type === 'full', onClick: () => setType('full'), separator: true },
          ]}
        />
        <Select value={workspaceId ?? ''} onValueChange={(value) => setWorkspaceId(value || null)}>
          <SelectTrigger className="rounded-xl"><SelectValue placeholder="工作区" /></SelectTrigger>
          <SelectContent>{(workspaces.data ?? []).map((workspace) => <SelectItem key={workspace.id} value={workspace.id}>{workspace.name}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={tag} onValueChange={(value) => setTag(value ?? 'all')}>
          <SelectTrigger className="rounded-xl"><SelectValue>{tag === 'all' ? '标签' : TYPE_LABELS[tag]}</SelectValue></SelectTrigger>
          <SelectContent><SelectItem value="all">全部标签</SelectItem><SelectItem value="collect">采集</SelectItem><SelectItem value="process">处理</SelectItem><SelectItem value="deliver">发送</SelectItem><SelectItem value="full">完整链路</SelectItem></SelectContent>
        </Select>
        <Select value={creator} onValueChange={(value) => setCreator(value ?? 'all')}>
          <SelectTrigger className="rounded-xl"><SelectValue>{creator === 'all' ? '创建者' : creator.slice(0, 8)}</SelectValue></SelectTrigger>
          <SelectContent><SelectItem value="all">全部创建者</SelectItem>{creators.map((id) => <SelectItem key={id} value={id}>{id.slice(0, 8)}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={sort} onValueChange={(value) => setSort(value ?? 'updated-desc')}>
          <SelectTrigger className="rounded-xl"><SelectValue>{SORT_LABELS[sort]}</SelectValue></SelectTrigger>
          <SelectContent><SelectItem value="updated-desc">最近修改</SelectItem><SelectItem value="created-asc">最早创建</SelectItem><SelectItem value="name">名称</SelectItem></SelectContent>
        </Select>
        <div className="relative min-w-52 flex-1 sm:max-w-72">
          <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} className="pl-9" placeholder="搜索项目" />
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
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {visibleProjects.map((project) => (
            <Link key={project.id} href={`/studio/workflow?workspace=${workspaceId}&project=${project.id}`} className="group rounded-xl border bg-card p-4 transition-[border-color,transform] hover:-translate-y-0.5 hover:border-foreground/20">
              <div className="flex items-start justify-between gap-3"><div className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary"><FolderKanban className="size-5" /></div><Badge variant="outline">{project.slug}</Badge></div>
              <h2 className="mt-5 truncate text-sm font-medium">{project.name}</h2>
              <p className="mt-1 line-clamp-2 min-h-10 text-xs leading-5 text-muted-foreground">{project.description || '数据节点项目'}</p>
            </Link>
          ))}
        </div>
      ) : (
        <div className="flex min-h-[420px] items-center justify-center rounded-xl border border-dashed bg-muted/10 px-4">
          <div className="w-full max-w-xl text-center">
            <div className="mx-auto grid size-11 place-items-center rounded-xl border bg-background"><Bot className="size-5 text-muted-foreground" /></div>
            <h2 className="mt-4 text-sm font-medium">创建你的第一个数据应用</h2>
            <p className="mt-1 text-xs text-muted-foreground">从成熟模板开始、创建空白节点图，或者导入 Dify / n8n DSL。</p>
            <div className="mt-5 grid gap-2 text-left">
              <CreateChoice title="从应用模板创建" description="选择预设的数据链路，最快体验 OpenCLI。" onClick={workspaceId ? () => openCreate('collection-to-consumption') : undefined} icon={Sparkles} />
              <CreateChoice title="创建空白项目" description="从节点画布开始，逐步搭建自己的执行系统。" onClick={workspaceId ? () => openCreate('blank') : undefined} icon={Plus} />
              <div className="my-0.5 flex items-center gap-3 text-[10px] text-muted-foreground before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">或</div>
              <CreateChoice title="导入 DSL 文件" description="兼容迁移 Dify、n8n 和 OpenCLI 工作流。" onClick={workspaceId ? () => importInputRef.current?.click() : undefined} icon={FileUp} />
            </div>
          </div>
        </div>
      )}

      <section>
        <h2 className="text-base font-medium">通过模板学习 OpenCLI</h2>
        <p className="mt-1 text-xs text-muted-foreground">按采集、处理、发送与完整链路分层复用。</p>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {TEMPLATES.map((template) => {
            const Icon = template.icon
            const content = <Card className="h-full transition-colors hover:border-foreground/20"><CardContent className="p-4"><div className={`grid size-10 place-items-center rounded-xl ${template.tone}`}><Icon className="size-5" /></div><h3 className="mt-4 text-sm font-medium">{template.title}</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">{template.description}</p></CardContent></Card>
            return workspaceId ? <button key={template.id} type="button" className="text-left" onClick={() => openCreate(template.id)}>{content}</button> : <div key={template.id} className="opacity-60">{content}</div>
          })}
        </div>
      </section>
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
  if (/采集|collect|source|scrape/.test(value)) return 'collect'
  if (/清洗|处理|process|transform/.test(value)) return 'process'
  if (/发送|消费|deliver|api|notify/.test(value)) return 'deliver'
  return 'full'
}

const TYPE_LABELS: Record<string, string> = { collect: '采集', process: '处理', deliver: '发送', full: '完整链路' }
const SORT_LABELS: Record<string, string> = { 'updated-desc': '最近修改', 'created-asc': '最早创建', name: '名称' }

function CreateChoice({ title, description, href, onClick, icon: Icon }: { title: string; description: string; href?: string; onClick?: () => void; icon: typeof Plus }) {
  const content = <><div className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted"><Icon className="size-4" /></div><div><div className="text-sm font-medium">{title}</div><div className="mt-0.5 text-xs text-muted-foreground">{description}</div></div></>
  if (href) return <Link href={href} className="flex items-center gap-3 rounded-xl border bg-card p-3 transition-colors hover:bg-accent">{content}</Link>
  if (onClick) return <button type="button" onClick={onClick} className="flex items-center gap-3 rounded-xl border bg-card p-3 text-left transition-colors hover:bg-accent">{content}</button>
  return <div className="flex items-center gap-3 rounded-xl border bg-card p-3 opacity-50">{content}</div>
}

function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project'
}

function graphForTemplate(template: string, name: string) {
  const base = PACKAGED_WORKFLOW_PROJECT
  const nodes = template === 'blank' ? base.nodes.slice(0, 1) : base.nodes.filter((node) => {
    const x = (node.ui?.position as { x?: number } | undefined)?.x ?? 0
    if (template === 'collect') return x <= 400
    if (template === 'process') return x > 400 && x <= 1100
    if (template === 'deliver') return x > 1100
    return true
  })
  const ids = new Set(nodes.map((node) => node.id))
  const adapters = base.adapters.filter((adapter) => nodes.some((node) => node.adapter === adapter.id))
  return parseWorkflowProject({ ...base, id: `draft-${Date.now()}`, name, nodes, edges: base.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)), adapters })
}
