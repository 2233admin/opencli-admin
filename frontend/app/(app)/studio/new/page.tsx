'use client'

import { ArrowLeft, MousePointerClick, Network, Play } from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { PageContainer } from '@/components/shell/page-container'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useCreateProjectWorkflow, useCreateWorkspaceProject, useMyWorkspaces } from '@/lib/api/hooks'
import { studioGraphForTemplate, studioSlug } from '@/lib/workflow/studio-templates'

const GUIDE = [
  { icon: MousePointerClick, title: '放入第一个节点', description: '画布会保留一个起始节点，先选择它的数据来源。' },
  { icon: Network, title: '连接处理步骤', description: '从节点端口拖出连线，逐步补齐处理和发送逻辑。' },
  { icon: Play, title: '试运行再发布', description: '先运行样例数据，确认每个节点输出后再发布。' },
]

export default function NewBlankStudioPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const workspaces = useMyWorkspaces()
  const createProject = useCreateWorkspaceProject()
  const createWorkflow = useCreateProjectWorkflow()
  const [workspaceId, setWorkspaceId] = useState<string | null>(searchParams.get('workspace'))
  const [name, setName] = useState('未命名项目')

  useEffect(() => {
    if (!workspaceId && workspaces.data?.length) setWorkspaceId(workspaces.data[0].id)
  }, [workspaceId, workspaces.data])

  async function createBlank() {
    if (!workspaceId || !name.trim()) return
    try {
      const project = await createProject.mutateAsync({ workspaceId, data: { name: name.trim(), slug: `${studioSlug(name)}-${Date.now().toString(36)}`, description: '从空白画布创建' } })
      const workflow = await createWorkflow.mutateAsync({ workspaceId, projectId: project.id, data: { name: name.trim(), description: '空白工作流', graph: studioGraphForTemplate('blank', name.trim()) } })
      toast.success('空白项目已创建')
      router.push(`/studio/workflow?workspace=${workspaceId}&project=${project.id}&workflow=${workflow.id}&guide=blank`)
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : '创建失败')
    }
  }

  return (
    <PageContainer title="从空白开始" eyebrow="Studio · New" description="不是把你直接丢进空画布：先建立项目，再按三个动作完成第一条链路。" className="max-w-5xl" actions={<Button variant="outline" render={<Link href="/studio" />}><ArrowLeft className="size-4" />返回项目</Button>}>
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <section className="rounded-2xl border bg-card p-6"><div className="eyebrow-mono">STEP 01 · 命名</div><h2 className="mt-2 text-lg font-semibold">先给这条工作流一个明确目标</h2><p className="mt-1 text-sm text-muted-foreground">名称会同时用于项目和第一份工作流草稿，进入画布后仍可修改。</p><label className="mt-6 block space-y-2 text-sm"><span>项目名称</span><Input value={name} onChange={(event) => setName(event.target.value)} autoFocus /></label><Button className="mt-6" onClick={createBlank} disabled={!workspaceId || !name.trim() || createProject.isPending || createWorkflow.isPending}>创建并进入引导画布</Button></section>
        <aside className="rounded-2xl border bg-muted/20 p-5"><div className="eyebrow-mono">接下来怎么做</div><div className="mt-5 space-y-5">{GUIDE.map(({ icon: Icon, title, description }, index) => <div key={title} className="flex gap-3"><div className="grid size-9 shrink-0 place-items-center rounded-lg border bg-background"><Icon className="size-4" /></div><div><div className="text-xs font-mono text-muted-foreground">0{index + 1}</div><h3 className="text-sm font-medium">{title}</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p></div></div>)}</div></aside>
      </div>
    </PageContainer>
  )
}
