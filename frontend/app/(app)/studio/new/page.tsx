'use client'

import { ArrowLeft, Bot, ChevronRight, CircleDot, GitBranch, Play, Workflow, X } from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { PageContainer } from '@/components/shell/page-container'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useCreateProjectWorkflow, useCreateWorkspaceProject, useMyWorkspaces } from '@/lib/api/hooks'
import { studioGraphForTemplate, studioSlug } from '@/lib/workflow/studio-templates'

export default function NewBlankStudioPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const workspaces = useMyWorkspaces()
  const createProject = useCreateWorkspaceProject()
  const createWorkflow = useCreateProjectWorkflow()
  const [workspaceId, setWorkspaceId] = useState<string | null>(searchParams.get('workspace'))
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  useEffect(() => { if (!workspaceId && workspaces.data?.length) setWorkspaceId(workspaces.data[0].id) }, [workspaceId, workspaces.data])

  async function createBlank() {
    if (!workspaceId || !name.trim()) return
    try {
      const project = await createProject.mutateAsync({ workspaceId, data: { name: name.trim(), slug: `${studioSlug(name)}-${Date.now().toString(36)}`, description: description.trim() || '从空白画布创建' } })
      const workflow = await createWorkflow.mutateAsync({ workspaceId, projectId: project.id, data: { name: name.trim(), description: description.trim() || '空白工作流', graph: studioGraphForTemplate('blank', name.trim()) } })
      toast.success('空白项目已创建')
      router.push(`/studio/workflow?workspace=${workspaceId}&project=${project.id}&workflow=${workflow.id}&guide=blank`)
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : '创建失败') }
  }

  return (
    <PageContainer title="创建空白项目" eyebrow="Studio · Blank project" description="定义目标后进入节点画布，从第一条执行链路开始。" className="max-w-none" actions={<Button size="icon" variant="ghost" nativeButton={false} render={<Link href="/studio" />} aria-label="关闭"><X className="size-4" /></Button>}>
      <div className="grid min-h-[680px] overflow-hidden rounded-2xl border bg-card/25 xl:grid-cols-[minmax(440px,0.9fr)_minmax(560px,1.3fr)]">
        <section className="flex flex-col border-b p-6 sm:p-10 xl:border-b-0 xl:border-r">
          <div className="mx-auto w-full max-w-xl">
            <Link href="/studio" className="mb-10 inline-flex items-center gap-2 text-xs text-muted-foreground transition-colors hover:text-foreground"><ArrowLeft className="size-3.5" />返回模板与项目</Link>
            <div className="eyebrow-mono">选择编排方式</div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <button type="button" className="rounded-xl border-2 border-foreground bg-background p-4 text-left shadow-[inset_0_0_0_1px_hsl(var(--background))]"><div className="grid size-9 place-items-center rounded-lg bg-foreground text-background"><Workflow className="size-4" /></div><h2 className="mt-3 text-sm font-semibold">节点工作流</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">适合采集、处理、判断和分发任务。</p></button>
              <div className="relative rounded-xl border bg-muted/15 p-4 text-left opacity-60"><span className="absolute right-3 top-3 font-mono text-[9px] text-muted-foreground">COMING SOON</span><div className="grid size-9 place-items-center rounded-lg border bg-background"><Bot className="size-4" /></div><h2 className="mt-3 text-sm font-semibold">Agent 协作</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">面向多 Agent 分工与人工审批。</p></div>
            </div>

            <div className="my-8 h-px bg-border" />
            <div className="eyebrow-mono">项目信息</div>
            <div className="mt-4 space-y-5">
              <label className="block space-y-2 text-sm"><span className="font-medium">项目名称</span><Input value={name} onChange={(event) => setName(event.target.value)} className="h-11 rounded-xl bg-background" placeholder="例如：竞品动态监控" autoFocus /></label>
              <label className="block space-y-2 text-sm"><span className="font-medium">目标描述 <span className="font-normal text-muted-foreground">（可选）</span></span><Textarea value={description} onChange={(event) => setDescription(event.target.value)} className="min-h-28 resize-none rounded-xl bg-background" placeholder="这个工作流要读取什么、处理什么、最终交付什么？" /></label>
            </div>
          </div>
          <div className="mx-auto mt-auto flex w-full max-w-xl items-center justify-between gap-4 border-t pt-6"><Link href={`/studio/templates?workspace=${workspaceId ?? ''}`} className="text-xs text-muted-foreground transition-colors hover:text-foreground">没有明确方案？从模板开始 <ChevronRight className="inline size-3" /></Link><div className="flex gap-2"><Button variant="outline" nativeButton={false} render={<Link href="/studio" />}>取消</Button><Button onClick={createBlank} disabled={!workspaceId || !name.trim() || createProject.isPending || createWorkflow.isPending}>创建项目</Button></div></div>
        </section>

        <section className="relative hidden overflow-hidden bg-muted/10 xl:block" aria-label="空白工作流预览">
          <div className="absolute inset-0 opacity-50 [background-image:radial-gradient(circle_at_center,hsl(var(--border))_1px,transparent_1px)] [background-size:22px_22px]" />
          <div className="relative flex h-full flex-col">
            <div className="flex items-center justify-between border-b bg-background/70 px-6 py-4 backdrop-blur"><div><div className="text-xs font-medium">{name.trim() || '未命名项目'}</div><div className="mt-0.5 font-mono text-[9px] text-muted-foreground">DRAFT · AUTO-SAVED</div></div><div className="flex items-center gap-2"><Button size="sm" variant="outline" disabled><Play className="size-3.5" />试运行</Button><Button size="sm" disabled>发布</Button></div></div>
            <div className="relative flex-1">
              <div className="absolute left-[12%] top-[38%] w-48 rounded-xl border bg-background p-4 shadow-lg"><div className="flex items-center gap-2"><div className="grid size-8 place-items-center rounded-lg bg-foreground text-background"><CircleDot className="size-4" /></div><div><div className="text-xs font-semibold">开始</div><div className="font-mono text-[9px] text-muted-foreground">TRIGGER</div></div></div><p className="mt-3 text-[10px] leading-4 text-muted-foreground">选择数据源或触发方式</p><span className="absolute -right-1.5 top-1/2 size-3 rounded-full border-2 border-background bg-foreground" /></div>
              <div className="absolute left-[calc(12%+12rem)] top-[calc(38%+3.1rem)] h-px w-[18%] bg-border"><ChevronRight className="absolute -right-2 -top-2 size-4 text-muted-foreground" /></div>
              <div className="absolute left-[48%] top-[38%] w-52 rounded-xl border border-dashed bg-background/75 p-4"><div className="flex items-center gap-2"><div className="grid size-8 place-items-center rounded-lg border bg-muted/40"><GitBranch className="size-4 text-muted-foreground" /></div><div><div className="text-xs font-medium text-muted-foreground">添加处理节点</div><div className="font-mono text-[9px] text-muted-foreground/70">SELECT A NODE</div></div></div><p className="mt-3 text-[10px] leading-4 text-muted-foreground">解析、转换、Agent 或条件判断</p></div>
              <div className="absolute bottom-8 left-8 max-w-sm rounded-xl border bg-background/80 p-4 backdrop-blur"><div className="eyebrow-mono">进入画布后的第一步</div><p className="mt-2 text-xs leading-5 text-muted-foreground">选中“开始”节点配置数据来源，然后从右侧端口拉出第一条连接。</p></div>
            </div>
          </div>
        </section>
      </div>
    </PageContainer>
  )
}
