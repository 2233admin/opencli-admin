'use client'

import { ArrowLeft, Workflow } from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'

import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useProjectWorkflows, useWorkspaceProjects } from '@/lib/api/hooks'

export function WorkflowProjectHeader() {
  const params = useSearchParams()
  const router = useRouter()
  const workspaceId = params.get('workspace')
  const projectId = params.get('project')
  const workflowId = params.get('workflow')
  const projects = useWorkspaceProjects(workspaceId)
  const workflows = useProjectWorkflows(workspaceId, projectId)
  const project = projects.data?.find((candidate) => candidate.id === projectId)
  const selectedWorkflowId = workflowId ?? workflows.data?.[0]?.id ?? ''
  const returnHref = workspaceId ? `/studio?workspace=${workspaceId}` : '/studio'

  function selectWorkflow(nextWorkflowId: string | null) {
    if (!workspaceId || !projectId || !nextWorkflowId) return
    router.push(`/studio/workflow?workspace=${workspaceId}&project=${projectId}&workflow=${nextWorkflowId}`)
  }

  return (
    <header className="flex min-w-0 shrink-0 flex-wrap items-center justify-between gap-3 border-b bg-card/30 px-3 py-2.5 sm:px-4" aria-label="当前项目">
      <div className="flex min-w-0 items-center gap-3">
        <Link href={returnHref} className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
          <ArrowLeft className="size-3.5" aria-hidden />
          返回项目
        </Link>
        <span className="h-5 w-px bg-border" aria-hidden />
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate text-sm font-semibold">{project?.name ?? (projects.isLoading ? '正在加载项目…' : '节点工作流')}</h1>
            {project?.archived ? <Badge variant="secondary">已归档</Badge> : null}
          </div>
          <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{project?.description || '在正式节点系统中编排、验证并发布当前项目工作流。'}</p>
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <nav className="flex items-center gap-1 overflow-x-auto" aria-label="项目生命周期">
          <span aria-current="page" className="shrink-0 rounded-lg bg-muted px-2.5 py-1.5 text-[10px] font-medium text-foreground">编排</span>
        </nav>
        <Select value={selectedWorkflowId} onValueChange={selectWorkflow} disabled={workflows.isLoading || !workflows.data?.length}>
          <SelectTrigger className="h-8 min-w-40 rounded-lg" aria-label="选择工作流"><Workflow className="size-3.5" aria-hidden /><SelectValue placeholder={workflows.isLoading ? '加载工作流…' : '暂无工作流'} /></SelectTrigger>
          <SelectContent>{(workflows.data ?? []).map((workflow) => <SelectItem key={workflow.id} value={workflow.id}>{workflow.name}</SelectItem>)}</SelectContent>
        </Select>
        <Badge variant="outline" className="gap-1.5"><Workflow className="size-3" aria-hidden />正式节点系统</Badge>
      </div>
    </header>
  )
}
