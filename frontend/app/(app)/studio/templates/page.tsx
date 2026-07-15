'use client'

import { ArrowLeft, Blocks, Database, Send, Sparkles } from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { PageContainer } from '@/components/shell/page-container'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useCreateProjectWorkflow, useCreateWorkspaceProject, useMyWorkspaces } from '@/lib/api/hooks'
import { STUDIO_TEMPLATES, studioGraphForTemplate, studioSlug, type StudioTemplateId } from '@/lib/workflow/studio-templates'

const ICONS = { collect: Database, process: Blocks, deliver: Send, 'collection-to-consumption': Sparkles } as const

export default function StudioTemplatesPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const workspaces = useMyWorkspaces()
  const createProject = useCreateWorkspaceProject()
  const createWorkflow = useCreateProjectWorkflow()
  const [workspaceId, setWorkspaceId] = useState<string | null>(searchParams.get('workspace'))
  const [selected, setSelected] = useState<StudioTemplateId | null>(null)
  const [name, setName] = useState('')

  useEffect(() => {
    if (!workspaceId && workspaces.data?.length) setWorkspaceId(workspaces.data[0].id)
  }, [workspaceId, workspaces.data])

  async function createFromTemplate() {
    if (!workspaceId || !selected || !name.trim()) return
    try {
      const project = await createProject.mutateAsync({ workspaceId, data: { name: name.trim(), slug: `${studioSlug(name)}-${Date.now().toString(36)}`, description: '由应用模板创建' } })
      const workflow = await createWorkflow.mutateAsync({ workspaceId, projectId: project.id, data: { name: name.trim(), description: '模板工作流', graph: studioGraphForTemplate(selected, name.trim()) } })
      toast.success('模板已创建，可以继续编排')
      router.push(`/studio/workflow?workspace=${workspaceId}&project=${project.id}&workflow=${workflow.id}`)
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : '创建失败')
    }
  }

  return (
    <PageContainer title="应用模板" eyebrow="Studio · Templates" description="先理解模板会搭出什么，再决定是否创建。" className="max-w-none" actions={<Button variant="outline" render={<Link href="/studio" />}><ArrowLeft className="size-4" />返回项目</Button>}>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {STUDIO_TEMPLATES.map((template) => {
          const Icon = ICONS[template.id]
          return <article key={template.id} className="flex min-h-72 flex-col rounded-2xl border bg-card p-5">
            <div className="flex items-start justify-between"><div className="grid size-11 place-items-center rounded-xl bg-muted"><Icon className="size-5" /></div><Badge variant="outline">{template.category}</Badge></div>
            <h2 className="mt-5 text-base font-semibold">{template.title}</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{template.description}</p>
            <ol className="mt-5 space-y-2 border-l pl-4 text-xs text-muted-foreground">{template.steps.map((step, index) => <li key={step}><span className="mr-2 font-mono text-foreground">0{index + 1}</span>{step}</li>)}</ol>
            <Button className="mt-auto" disabled={!workspaceId} onClick={() => { setSelected(template.id); setName(template.title) }}>使用此模板</Button>
          </article>
        })}
      </div>
      <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent><DialogHeader><DialogTitle>创建模板项目</DialogTitle><DialogDescription>确认名称后创建项目和第一份工作流草稿。</DialogDescription></DialogHeader><label className="space-y-2 text-sm"><span>项目名称</span><Input value={name} onChange={(event) => setName(event.target.value)} autoFocus /></label><DialogFooter><Button variant="outline" onClick={() => setSelected(null)}>取消</Button><Button onClick={createFromTemplate} disabled={!name.trim() || createProject.isPending || createWorkflow.isPending}>创建并打开</Button></DialogFooter></DialogContent>
      </Dialog>
    </PageContainer>
  )
}
