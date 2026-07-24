'use client'

import { Bot, Building2, ChevronDown, FileUp, FolderKanban, Plus, Search, Sparkles } from 'lucide-react'
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
import { useBootstrapWorkspaceProject, useCreateProjectWorkflow, useMyWorkspaces, useWorkspaceProjects } from '@/lib/api/hooks'
import { formatRelative } from '@/lib/format'
import { projectAppTypeForDifyMode } from '@/lib/studio/app-types'
import { translateWorkflowDsl, type WorkflowImportResult } from '@/lib/workflow/codec'
import { studioAppTypeForTemplate, studioGraphForTemplate, studioSlug, type StudioTemplateId } from '@/lib/workflow/studio-templates'

export default function StudioPage() {
  const router = useRouter()
  const workspaces = useMyWorkspaces()
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('updated-desc')
  const [createTemplate, setCreateTemplate] = useState<StudioTemplateId | null>(null)
  const [projectName, setProjectName] = useState('')
  const [pendingImport, setPendingImport] = useState<Extract<WorkflowImportResult, { ok: true }> | null>(null)
  const [importProjectId, setImportProjectId] = useState('')
  const [importProjectName, setImportProjectName] = useState('')
  const importInputRef = useRef<HTMLInputElement>(null)
  const createIntentHandled = useRef(false)
  const projects = useWorkspaceProjects(workspaceId)
  const bootstrapProject = useBootstrapWorkspaceProject()
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
      return !query || haystack.includes(query)
    })
    return result.sort((left, right) => {
      if (sort === 'name') return left.name.localeCompare(right.name, 'zh-CN')
      const field = sort === 'created-asc' ? 'created_at' : 'updated_at'
      const direction = sort === 'created-asc' ? 1 : -1
      return left[field].localeCompare(right[field]) * direction
    })
  }, [projects.data, search, sort])

  const selectedWorkspace = workspaces.data?.find((workspace) => workspace.id === workspaceId)

  async function submitCreate() {
    if (!workspaceId || !createTemplate || !projectName.trim()) return
    try {
      const result = await bootstrapProject.mutateAsync({
        workspaceId,
        data: {
          project: { name: projectName.trim(), slug: `${studioSlug(projectName)}-${Date.now().toString(36)}`, description: '由工作区模板创建', app_type: studioAppTypeForTemplate(createTemplate) },
          workflow: { name: projectName.trim(), description: '工作区默认工作流', graph: studioGraphForTemplate(createTemplate, projectName.trim()) },
        },
      })
      setCreateTemplate(null)
      toast.success('项目与工作流已创建')
      router.push(`/studio/workflow?workspace=${workspaceId}&project=${result.project.id}&workflow=${result.primary_workflow.id}`)
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
      let projectId = importProjectId
      let workflowId: string
      if (importProjectId === '__new__') {
        const result = await bootstrapProject.mutateAsync({
            workspaceId,
            data: {
              project: {
                name: importProjectName.trim(),
                slug: `${studioSlug(importProjectName)}-${Date.now().toString(36)}`,
                description: `${pendingImport.format} DSL 导入`,
                app_type: projectAppTypeForDifyMode(pendingImport.format === 'dify' && pendingImport.report?.source === 'dify' ? pendingImport.report.appMode : undefined),
              },
              workflow: { name, description: `${pendingImport.format} 兼容工作流`, graph: pendingImport.project },
            },
          })
        projectId = result.project.id
        workflowId = result.primary_workflow.id
      } else {
        const workflow = await createWorkflow.mutateAsync({
          workspaceId,
          projectId,
          data: { name, description: `${pendingImport.format} 兼容工作流`, graph: pendingImport.project },
        })
        workflowId = workflow.id
      }
      toast.success(`已创建 ${pendingImport.format} WorkflowDraft`)
      setPendingImport(null)
      router.push(`/studio/workflow?workspace=${workspaceId}&project=${projectId}&workflow=${workflowId}`)
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
          <Select value={sort} onValueChange={(value) => setSort(value ?? 'updated-desc')}>
            <SelectTrigger className="h-9 min-w-28 rounded-lg bg-transparent text-xs shadow-none" aria-label="项目排序"><SelectValue>{SORT_LABELS[sort]}</SelectValue></SelectTrigger>
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
          <div className="mb-3 text-xs font-medium">{visibleProjects.length} 个项目</div>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {visibleProjects.map((project) => (
            <Link key={project.id} href={`/studio/workflow?workspace=${workspaceId}&project=${project.id}`} className="group min-w-0 rounded-xl border border-border/80 bg-card/30 p-3.5 transition-[border-color,background-color,transform] hover:-translate-y-0.5 hover:border-foreground/25 hover:bg-card/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
              <div className="flex items-start justify-between gap-3"><div className="grid size-9 place-items-center rounded-lg bg-muted text-muted-foreground transition-colors group-hover:text-foreground"><FolderKanban className="size-4" aria-hidden /></div>{project.archived ? <Badge variant="secondary">已归档</Badge> : null}</div>
              <h2 className="mt-4 truncate text-sm font-semibold">{project.name}</h2>
              <p className="mt-1 line-clamp-2 min-h-10 text-xs leading-5 text-muted-foreground">{project.description || '数据节点项目'}</p>
              <div className="mt-3 flex items-center justify-between gap-3 border-t border-border/70 pt-2.5 text-[10px] text-muted-foreground"><span className="truncate font-mono">{project.slug}</span><span className="shrink-0">{formatRelative(project.updated_at)}</span></div>
            </Link>
          ))}
          </div>
        </section>
      ) : (
        <div className="flex min-h-[420px] items-center justify-center rounded-xl border border-dashed bg-muted/10 px-4">
          <div className="w-full max-w-xl text-center">
            <div className="mx-auto grid size-11 place-items-center rounded-xl border bg-background"><Bot className="size-5 text-muted-foreground" /></div>
            <h2 className="mt-4 text-sm font-medium">创建你的第一个项目</h2>
            <p className="mt-1 text-xs text-muted-foreground">从模板开始、让 Agent 创建，或者导入现有工作流。</p>
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
          <DialogFooter><Button variant="outline" onClick={() => setCreateTemplate(null)}>取消</Button><Button onClick={submitCreate} disabled={!projectName.trim() || bootstrapProject.isPending}>创建并打开</Button></DialogFooter>
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
            <Button onClick={submitImport} disabled={!importProjectId || (importProjectId === '__new__' && !importProjectName.trim()) || bootstrapProject.isPending || createWorkflow.isPending}>创建 Draft 并打开</Button>
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

const SORT_LABELS: Record<string, string> = { 'updated-desc': '最近修改', 'created-asc': '最早创建', name: '名称' }

function CreateChoice({ title, description, href, onClick, icon: Icon }: { title: string; description: string; href?: string; onClick?: () => void; icon: typeof Plus }) {
  const content = <><div className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted"><Icon className="size-4" /></div><div><div className="text-sm font-medium">{title}</div><div className="mt-0.5 text-xs text-muted-foreground">{description}</div></div></>
  if (href) return <Link href={href} className="flex items-center gap-3 rounded-xl border bg-card p-3 transition-colors hover:bg-accent">{content}</Link>
  if (onClick) return <button type="button" onClick={onClick} className="flex items-center gap-3 rounded-xl border bg-card p-3 text-left transition-colors hover:bg-accent">{content}</button>
  return <div className="flex items-center gap-3 rounded-xl border bg-card p-3 opacity-50">{content}</div>
}
