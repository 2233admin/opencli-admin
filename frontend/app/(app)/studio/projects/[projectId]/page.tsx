'use client'

import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, Clock3, GitBranch, Layers3, Plus, Rocket, Workflow } from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { use } from 'react'
import { toast } from 'sonner'

import { ErrorState, LoadingState } from '@/components/shell/data-states'
import { PageContainer } from '@/components/shell/page-container'
import { ProjectNavigation } from '@/components/studio/project-navigation'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useCreateProjectWorkflow, useMyWorkspaces, useProjectWorkflows, useWorkspaceProjects } from '@/lib/api/hooks'
import { formatRelative } from '@/lib/format'
import { projectAppTypeLabel } from '@/lib/studio/app-types'
import { cn } from '@/lib/utils'
import { studioGraphForTemplate } from '@/lib/workflow/studio-templates'

export default function ProjectOverviewPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params)
  const searchParams = useSearchParams()
  const router = useRouter()
  const workspaces = useMyWorkspaces()
  const workspaceId = searchParams.get('workspace') ?? workspaces.data?.[0]?.id ?? null
  const projects = useWorkspaceProjects(workspaceId)
  const projectWorkflows = useProjectWorkflows(workspaceId, projectId)
  const createWorkflow = useCreateProjectWorkflow()
  const project = projects.data?.find((candidate) => candidate.id === projectId)
  const workspace = workspaces.data?.find((candidate) => candidate.id === workspaceId)
  const primaryWorkflow = projectWorkflows.data?.find((workflow) => workflow.id === project?.primary_workflow_id)
    ?? projectWorkflows.data?.[0]
  const workflowHref = workspaceId && primaryWorkflow
    ? `/studio/workflow?workspace=${workspaceId}&project=${projectId}&workflow=${primaryWorkflow.id}`
    : null
  const returnHref = workspaceId ? `/studio?workspace=${workspaceId}` : '/studio'

  async function createPrimaryWorkflow() {
    if (!workspaceId || !project || createWorkflow.isPending) return
    try {
      const workflow = await createWorkflow.mutateAsync({
        workspaceId,
        projectId,
        data: {
          name: `${project.name} 主工作流`,
          description: '从项目概览创建的主工作流草稿',
          graph: studioGraphForTemplate('blank', project.name),
        },
      })
      toast.success('主工作流已创建')
      router.push(`/studio/workflow?workspace=${workspaceId}&project=${projectId}&workflow=${workflow.id}&guide=blank`)
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : '工作流创建失败')
    }
  }

  if (workspaces.isLoading || projects.isLoading || projectWorkflows.isLoading) {
    return (
      <PageContainer eyebrow="Project" title="正在加载项目" description="读取项目身份、工作流和发布状态。">
        <LoadingState rows={4} />
      </PageContainer>
    )
  }

  if (workspaces.isError || projects.isError) {
    return (
      <PageContainer eyebrow="Project" title="项目加载失败" description="无法读取当前项目上下文。">
        <ErrorState message={(workspaces.error ?? projects.error)?.message} hint="确认后端与身份会话可用后重试。" />
      </PageContainer>
    )
  }

  if (!project) {
    return (
      <PageContainer eyebrow="Project" title="项目不存在" description="这个项目已删除，或不属于当前工作区。">
        <ErrorState message="找不到项目" hint="返回项目列表，重新选择一个可访问的项目。" action={<Link href={returnHref} className={cn(buttonVariants({ variant: 'outline' }), 'min-h-11')}>返回项目列表</Link>} />
      </PageContainer>
    )
  }

  if (projectWorkflows.isError) {
    return (
      <PageContainer
        eyebrow={`Project · ${projectAppTypeLabel(project.app_type)}`}
        title={project.name}
        description="项目身份已加载，但工作流状态暂时不可用。"
        actions={<Link href={returnHref} className={cn(buttonVariants({ variant: 'outline' }), 'min-h-11')}>返回项目列表</Link>}
      >
        <ProjectNavigation active="overview" workspaceId={workspaceId} projectId={projectId} />
        <ErrorState
          message={projectWorkflows.error?.message ?? '工作流列表加载失败'}
          hint="当前不会把查询失败当成空项目，也不会创建重复工作流。"
          action={<Button className="min-h-11" variant="outline" onClick={() => void projectWorkflows.refetch()} disabled={projectWorkflows.isFetching}>重新加载工作流</Button>}
        />
      </PageContainer>
    )
  }

  const publishedVersion = primaryWorkflow?.current_published_version ?? null
  const needsWorkflow = !primaryWorkflow
  const needsPublish = primaryWorkflow && publishedVersion === null
  const headline = project.archived
    ? '这个项目已归档'
    : needsWorkflow
      ? '先创建主工作流，再推进项目'
      : needsPublish
        ? '工作流草稿可编辑，下一步是检查并验证'
        : `版本 v${publishedVersion} 已发布，可以继续观察运行结果`
  const guidance = project.archived
    ? '归档项目保留历史上下文，但不应继续创建新的执行。'
    : needsWorkflow
      ? '旧项目可能没有 Primary Workflow。创建一份空白草稿后，项目会自动绑定它作为主工作流。'
      : needsPublish
        ? '存在草稿不代表已经检查完成。进入编排核对来源、频率和交付配置，验证通过后再发布。'
        : '项目已经有可执行版本。后续运行、数据和协作入口会在同一个项目导航中逐步接入。'

  return (
    <PageContainer
      eyebrow={`Project · ${projectAppTypeLabel(project.app_type)}`}
      title={project.name}
      description={project.description || '从项目概览判断当前状态，并进入正确的下一步。'}
      className="max-w-none"
      actions={(
        <Link href={returnHref} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'min-h-11 sm:min-h-0')}>
          <ArrowLeft className="size-4" />返回项目列表
        </Link>
      )}
    >
      <div className="border-b pb-3">
        <ProjectNavigation active="overview" workspaceId={workspaceId} projectId={projectId} workflowId={primaryWorkflow?.id} />
      </div>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(280px,0.55fr)]" aria-label="项目下一步">
        <Card className="border-0 bg-primary/[0.045] ring-1 ring-primary/20">
          <CardContent className="flex min-h-64 flex-col justify-between gap-8 p-5 sm:p-7">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">当前需要做什么</Badge>
                {project.archived ? <Badge variant="secondary">已归档</Badge> : null}
              </div>
              <h2 className="mt-4 max-w-3xl text-balance text-2xl font-semibold tracking-tight sm:text-3xl">{headline}</h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">{guidance}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {workflowHref ? (
                <Link href={workflowHref} className={cn(buttonVariants({ size: 'lg' }), 'min-h-11')}>
                  打开工作流草稿<ArrowRight className="size-4" />
                </Link>
              ) : (
                <Button className="min-h-11" size="lg" onClick={() => void createPrimaryWorkflow()} disabled={project.archived || createWorkflow.isPending}>
                  <Plus className="size-4" />{createWorkflow.isPending ? '正在创建' : '创建主工作流'}
                </Button>
              )}
              <Link href={returnHref} className={cn(buttonVariants({ variant: 'ghost', size: 'lg' }), 'min-h-11')}>浏览其他项目</Link>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">项目身份</CardTitle></CardHeader>
          <CardContent className="space-y-4 text-sm">
            <ContextRow label="工作区" value={workspace?.name ?? workspaceId ?? '未知'} />
            <ContextRow label="应用类型" value={projectAppTypeLabel(project.app_type)} />
            <ContextRow label="项目标识" value={project.slug} mono />
            <ContextRow label="创建者" value={project.created_by_user_id.slice(0, 12)} mono />
            <ContextRow label="最近修改" value={formatRelative(project.updated_at)} />
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="readiness-title">
        <div className="mb-3">
          <p className="eyebrow-mono">Project readiness</p>
          <h2 id="readiness-title" className="mt-1 text-lg font-semibold">项目准备度</h2>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <ReadinessCard icon={Layers3} label="工作流资产" value={`${projectWorkflows.data?.length ?? 0} 个`} detail={primaryWorkflow ? `主工作流：${primaryWorkflow.name}` : '还没有可编辑工作流'} ready={Boolean(primaryWorkflow)} />
          <ReadinessCard icon={GitBranch} label="草稿状态" value={primaryWorkflow ? '可编辑' : '待创建'} detail={primaryWorkflow ? '进入编排后可继续保存与验证' : '先创建主工作流草稿'} ready={Boolean(primaryWorkflow)} />
          <ReadinessCard icon={Rocket} label="发布版本" value={publishedVersion === null ? '未发布' : `v${publishedVersion}`} detail={publishedVersion === null ? '验证通过后才能发布' : '已有不可变 Workflow Version'} ready={publishedVersion !== null} />
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]" aria-labelledby="path-title">
        <Card>
          <CardHeader>
            <CardTitle id="path-title" className="text-base">从这里继续</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <ProjectStep number="01" title="创建草稿" description="先准备一份可编辑的主工作流草稿。" done={Boolean(primaryWorkflow)} />
            <ProjectStep number="02" title="运行验证" description="用正式能力目录检查节点、连接和运行合同。" done={publishedVersion !== null} />
            <ProjectStep number="03" title="发布版本" description="把验证过的修订发布为不可变 Workflow Version。" done={publishedVersion !== null} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">主工作流</CardTitle></CardHeader>
          <CardContent>
            {primaryWorkflow ? (
              <div>
                <div className="flex items-center gap-2"><Workflow className="size-4 text-muted-foreground" /><span className="font-medium">{primaryWorkflow.name}</span></div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">{primaryWorkflow.description || '项目的默认编排入口。'}</p>
                <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground"><Clock3 className="size-3.5" />{formatRelative(primaryWorkflow.updated_at)}</div>
              </div>
            ) : (
              <div className="flex items-start gap-3 text-sm text-muted-foreground"><AlertTriangle className="mt-0.5 size-4 shrink-0" />没有工作流时，重新加载不会修复问题。请创建主工作流。</div>
            )}
          </CardContent>
        </Card>
      </section>
    </PageContainer>
  )
}

function ContextRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b pb-3 last:border-0 last:pb-0">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('max-w-48 break-words text-right', mono && 'font-mono text-xs')}>{value}</span>
    </div>
  )
}

function ReadinessCard({ icon: Icon, label, value, detail, ready }: { icon: typeof Layers3; label: string; value: string; detail: string; ready: boolean }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-3">
          <span className="grid size-9 place-items-center rounded-md bg-muted text-muted-foreground"><Icon className="size-4" /></span>
          {ready ? <CheckCircle2 className="size-4 text-success" aria-label="已就绪" /> : <Clock3 className="size-4 text-muted-foreground" aria-label="待完成" />}
        </div>
        <div className="mt-4 text-xs text-muted-foreground">{label}</div>
        <div className="mt-1 font-mono text-xl font-semibold">{value}</div>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  )
}

function ProjectStep({ number, title, description, done }: { number: string; title: string; description: string; done: boolean }) {
  return (
    <div className="rounded-md border p-4">
      <div className="flex items-center justify-between gap-3"><span className="font-mono text-xs text-muted-foreground">{number}</span>{done ? <CheckCircle2 className="size-4 text-success" aria-label="已完成" /> : null}</div>
      <h3 className="mt-4 text-sm font-medium">{title}</h3>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{description}</p>
    </div>
  )
}
