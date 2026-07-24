'use client'

import { ArrowLeft, Blocks, Database, Search, Send, Sparkles, Workflow } from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { PageContainer } from '@/components/shell/page-container'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useBootstrapWorkspaceProject, useMyWorkspaces } from '@/lib/api/hooks'
import { STUDIO_TEMPLATES, studioAppTypeForTemplate, studioGraphForTemplate, studioSlug, type StudioTemplateId } from '@/lib/workflow/studio-templates'

const CATEGORIES = ['全部', '真实业务测试', '采集与监控', '内容处理', 'Agent 分析', '分发与集成', '完整链路'] as const
const ICONS = { '真实业务测试': Sparkles, '采集与监控': Database, '内容处理': Blocks, 'Agent 分析': Sparkles, '分发与集成': Send, '完整链路': Workflow } as const

export default function StudioTemplatesPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const workspaces = useMyWorkspaces()
  const bootstrapProject = useBootstrapWorkspaceProject()
  const [workspaceId, setWorkspaceId] = useState<string | null>(searchParams.get('workspace'))
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('全部')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<StudioTemplateId | null>(null)
  const [name, setName] = useState('')

  useEffect(() => {
    if (!workspaces.data?.length) return
    if (!workspaceId || !workspaces.data.some((workspace) => workspace.id === workspaceId)) setWorkspaceId(workspaces.data[0].id)
  }, [workspaceId, workspaces.data])
  const visible = useMemo(() => STUDIO_TEMPLATES.filter((template) => {
    const matchesCategory = category === '全部' || template.category === category
    const text = `${template.title} ${template.description} ${template.steps.join(' ')}`.toLowerCase()
    return matchesCategory && text.includes(query.trim().toLowerCase())
  }), [category, query])
  const selectedTemplate = STUDIO_TEMPLATES.find((template) => template.id === selected) ?? null
  const studioHref = workspaceId ? `/studio?workspace=${workspaceId}` : '/studio'

  function selectTemplate(templateId: StudioTemplateId, templateName: string) {
    setSelected(templateId)
    setName(templateName)
  }

  function returnToTemplates() {
    setSelected(null)
  }

  async function createFromTemplate() {
    if (!workspaceId) {
      toast.error('请先选择工作区，再用模板创建项目')
      return
    }
    if (!selected || !name.trim() || bootstrapProject.isPending) return
    try {
      const result = await bootstrapProject.mutateAsync({ workspaceId, data: {
        project: { name: name.trim(), slug: `${studioSlug(name)}-${Date.now().toString(36)}`, description: '由应用模板创建', app_type: studioAppTypeForTemplate(selected) },
        workflow: { name: name.trim(), description: '模板工作流', graph: studioGraphForTemplate(selected, name.trim()) },
      } })
      toast.success('模板已创建，可以继续编排')
      router.push(`/studio/workflow?workspace=${workspaceId}&project=${result.project.id}&workflow=${result.primary_workflow.id}`)
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : '创建失败') }
  }

  return (
    <PageContainer title="从模板创建" eyebrow="Studio · Template library" description="选择一条成熟链路作为起点，再按你的业务修改节点。" className="max-w-none" actions={<Button variant="outline" className="min-h-11" nativeButton={false} render={<Link href={studioHref} />}><ArrowLeft aria-hidden="true" className="size-4" />返回项目</Button>}>
      <div className="overflow-hidden rounded-md border bg-card/25">
        <div className="flex min-h-[680px]">
          <aside className="hidden w-52 shrink-0 border-r bg-muted/15 p-3 md:block">
            <div className="px-3 pb-3 pt-2 text-3xs font-medium uppercase tracking-[0.18em] text-muted-foreground">模板分类</div>
            <nav aria-label="模板分类" className="space-y-1">{CATEGORIES.map((item) => {
              const active = category === item
              return <button key={item} type="button" aria-pressed={active} aria-current={active ? 'true' : undefined} onClick={() => setCategory(item)} className={`flex min-h-11 w-full items-center justify-between rounded-xs px-3 py-2 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${active ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}><span>{item}</span>{item === '全部' ? <span className="font-mono text-3xs">{STUDIO_TEMPLATES.length}</span> : null}</button>
            })}</nav>
            <Link href={workspaceId ? `/studio/new?workspace=${workspaceId}` : '/studio/new'} className="mt-8 flex min-h-11 items-center gap-2 border-t px-3 pt-4 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"><Workflow aria-hidden="true" className="size-3.5" />改用 Agent 创建</Link>
          </aside>
          <section className="min-w-0 flex-1">
            <div className="sticky top-0 z-10 grid min-w-0 gap-3 border-b bg-background/90 p-4 backdrop-blur-xl">
              <div className="flex min-w-0 items-center gap-3">
                <div className="relative min-w-0 flex-1 md:max-w-xl"><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3.5 size-4 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="搜索模板" className="min-h-11 rounded-xs bg-muted/35 pl-9" placeholder="搜索模板、节点或用途…" /></div>
                <span className="shrink-0 font-mono text-3xs text-muted-foreground" aria-live="polite">{visible.length} 个模板</span>
              </div>
              <nav aria-label="移动端模板分类" className="w-full min-w-0 max-w-full overflow-hidden md:hidden">
                <div className="w-full max-w-full overflow-x-auto overscroll-x-contain pb-1">
                  <div className="flex w-max min-w-full gap-1">{CATEGORIES.map((item) => {
                    const active = category === item
                    return <Button key={item} size="sm" variant={active ? 'secondary' : 'ghost'} aria-pressed={active} aria-current={active ? 'true' : undefined} className="min-h-11 shrink-0 px-3" onClick={() => setCategory(item)}>{item}</Button>
                  })}</div>
                </div>
              </nav>
            </div>
            <div className="p-4"><div className="mb-4 flex items-end justify-between"><div><div className="eyebrow-mono">{category}</div><h2 className="mt-1 text-base font-semibold">可复用的执行链路</h2></div></div>
              {visible.length ? <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">{visible.map((template) => {
                const Icon = ICONS[template.category]
                return <button key={template.id} type="button" aria-haspopup="dialog" onClick={() => selectTemplate(template.id, template.title)} className="group flex min-h-48 flex-col rounded-md border bg-background/60 p-4 text-left transition-[border-color,background-color,transform] hover:-translate-y-0.5 hover:border-foreground/25 hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                  <div className="flex items-start gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-md border bg-muted/40"><Icon aria-hidden="true" className="size-4.5" /></div><div className="min-w-0"><h3 className="truncate text-sm font-semibold">{template.title}</h3><Badge variant="outline" className="mt-1 h-5 px-1.5 text-3xs">{template.category}</Badge></div></div>
                  <p className="mt-3 line-clamp-2 text-xs leading-5 text-muted-foreground">{template.description}</p>
                  <div className="mt-4 flex items-center gap-1.5 overflow-hidden">{template.steps.map((step, index) => <div key={step} className="contents"><span className="truncate rounded-sm border bg-muted/25 px-2 py-1 font-mono text-3xs text-muted-foreground">{step}</span>{index < template.steps.length - 1 ? <span className="text-3xs text-muted-foreground/50">→</span> : null}</div>)}</div>
                  <span className="mt-auto border-t pt-3 text-xs font-medium text-foreground">使用此模板 <span aria-hidden="true">→</span></span>
                </button>
              })}</div> : <div className="grid min-h-80 place-items-center rounded-md border border-dashed text-sm text-muted-foreground">没有匹配的模板，换一个关键词试试。</div>}
            </div>
          </section>
        </div>
      </div>
      <Dialog open={selectedTemplate !== null} onOpenChange={(open) => { if (!open && !bootstrapProject.isPending) returnToTemplates() }}>
        <DialogContent className="sm:max-w-md">
          {selectedTemplate ? <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void createFromTemplate() }}>
            <DialogHeader><DialogTitle>用“{selectedTemplate.title}”创建项目</DialogTitle><DialogDescription>确认项目名称后会创建项目和第一份工作流草稿，并直接打开画布继续编排。</DialogDescription></DialogHeader>
            <label className="space-y-2 text-sm"><span>项目名称</span><Input name="project-name" autoComplete="off" className="min-h-11" value={name} onChange={(event) => setName(event.target.value)} /></label>
            {!workspaceId && !workspaces.isLoading ? <p role="status" className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">当前没有可用工作区。返回项目页选择或创建工作区后，即可继续使用这个模板。</p> : null}
            <DialogFooter>
              <Button type="button" variant="outline" className="min-h-11" onClick={returnToTemplates} disabled={bootstrapProject.isPending}>返回模板库</Button>
              {workspaceId ? <Button type="submit" className="min-h-11" disabled={!name.trim() || bootstrapProject.isPending}>{bootstrapProject.isPending ? '正在创建…' : '创建并打开工作流'}</Button> : workspaces.isLoading ? <Button type="button" className="min-h-11" disabled>正在读取工作区…</Button> : <Button className="min-h-11" nativeButton={false} render={<Link href="/studio" />}>返回项目并选择工作区</Button>}
            </DialogFooter>
          </form> : null}
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
