'use client'

import { ArrowLeft, Workflow } from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'

import { Badge } from '@/components/ui/badge'
import { ProjectNavigation } from '@/components/studio/project-navigation'
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
  const selectedWorkflowId = workflowId ?? project?.primary_workflow_id ?? ''
  const selectedWorkflow = workflows.data?.find((candidate) => candidate.id === selectedWorkflowId)
  const returnHref = workspaceId && projectId ? `/studio/projects/${projectId}?workspace=${workspaceId}` : '/studio'
  const projectError = projects.error instanceof Error ? projects.error.message : '项目资料加载失败'
  const workflowError = workflows.error instanceof Error ? workflows.error.message : '工作流列表加载失败'

  function selectWorkflow(nextWorkflowId: string | null) {
    if (!workspaceId || !projectId || !nextWorkflowId) return
    router.push(`/studio/workflow?workspace=${workspaceId}&project=${projectId}&workflow=${nextWorkflowId}`)
  }

  return (
    <header className="flex min-w-0 shrink-0 flex-wrap items-center justify-between gap-3 border-b bg-card/30 px-3 py-2.5 sm:px-4" aria-label="当前项目">
      <div className="flex min-w-0 items-center gap-3">
        <Link href={returnHref} className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-xs px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
          <ArrowLeft className="size-3.5" aria-hidden />
          返回项目
        </Link>
        <span className="h-5 w-px bg-border" aria-hidden />
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate text-sm font-semibold">{project?.name ?? (projects.isLoading ? '正在加载项目…' : projects.isError ? '项目资料加载失败' : '节点工作流')}</h1>
            {project?.archived ? <Badge variant="secondary">已归档</Badge> : null}
          </div>
          {projects.isError ? (
            <p className="mt-0.5 max-w-xl break-words text-xs text-destructive" role="alert">项目资料加载失败：{projectError}</p>
          ) : (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{project?.description || '在正式节点系统中编排、验证并发布当前项目工作流。'}</p>
          )}
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <ProjectNavigation active="orchestration" workspaceId={workspaceId} projectId={projectId} workflowId={selectedWorkflowId || null} />
        {workflows.isError ? (
          <p className="max-w-sm break-words text-xs text-destructive" role="alert">工作流列表加载失败：{workflowError}</p>
        ) : (
          <Select value={selectedWorkflowId} onValueChange={selectWorkflow} disabled={workflows.isLoading || !workflows.data?.length}>
            <SelectTrigger className="min-h-11 min-w-40 rounded-xs" aria-label="选择工作流"><Workflow className="size-3.5" aria-hidden /><SelectValue>{selectedWorkflow?.name ?? (workflows.isLoading ? '加载工作流…' : selectedWorkflowId ? '工作流不可用' : '暂无工作流')}</SelectValue></SelectTrigger>
            <SelectContent>{(workflows.data ?? []).map((workflow) => <SelectItem className="min-h-11" key={workflow.id} value={workflow.id}>{workflow.name}</SelectItem>)}</SelectContent>
          </Select>
        )}
        <Badge variant="outline" className="gap-1.5"><Workflow className="size-3" aria-hidden />正式节点系统</Badge>
      </div>
    </header>
  )
}
