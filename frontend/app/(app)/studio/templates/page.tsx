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

const CATEGORIES = ['全部', '采集与监控', '内容处理', 'Agent 分析', '分发与集成', '完整链路'] as const
const ICONS = { '采集与监控': Database, '内容处理': Blocks, 'Agent 分析': Sparkles, '分发与集成': Send, '完整链路': Workflow } as const

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

  useEffect(() => { if (!workspaceId && workspaces.data?.length) setWorkspaceId(workspaces.data[0].id) }, [workspaceId, workspaces.data])
  const visible = useMemo(() => STUDIO_TEMPLATES.filter((template) => {
    const matchesCategory = category === '全部' || template.category === category
    const text = `${template.title} ${template.description} ${template.steps.join(' ')}`.toLowerCase()
    return matchesCategory && text.includes(query.trim().toLowerCase())
  }), [category, query])

  async function createFromTemplate() {
    if (!workspaceId || !selected || !name.trim()) return
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
    <PageContainer title="从模板创建" eyebrow="Studio · Template library" description="选择一条成熟链路作为起点，再按你的业务修改节点。" className="max-w-none" actions={<Button variant="outline" nativeButton={false} render={<Link href="/studio" />}><ArrowLeft className="size-4" />返回项目</Button>}>
      <div className="overflow-hidden rounded-2xl border bg-card/25">
        <div className="flex min-h-[680px]">
          <aside className="hidden w-52 shrink-0 border-r bg-muted/15 p-3 md:block">
            <div className="px-3 pb-3 pt-2 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">模板分类</div>
            <nav className="space-y-1">{CATEGORIES.map((item) => <button key={item} type="button" onClick={() => setCategory(item)} className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs transition-colors ${category === item ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}><span>{item}</span>{item === '全部' ? <span className="font-mono text-[10px]">{STUDIO_TEMPLATES.length}</span> : null}</button>)}</nav>
            <Link href={`/studio/new?workspace=${workspaceId ?? ''}`} className="mt-8 flex items-center gap-2 border-t px-3 pt-4 text-xs text-muted-foreground transition-colors hover:text-foreground"><Workflow className="size-3.5" />不使用模板</Link>
          </aside>
          <section className="min-w-0 flex-1">
            <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b bg-background/90 p-4 backdrop-blur-xl">
              <div className="relative min-w-64 flex-1 md:max-w-xl"><Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} className="rounded-xl bg-muted/35 pl-9" placeholder="搜索模板、节点或用途" /></div>
              <div className="flex gap-1 overflow-x-auto md:hidden">{CATEGORIES.slice(0, 4).map((item) => <Button key={item} size="sm" variant={category === item ? 'secondary' : 'ghost'} onClick={() => setCategory(item)}>{item}</Button>)}</div>
              <span className="ml-auto font-mono text-[10px] text-muted-foreground">{visible.length} TEMPLATES</span>
            </div>
            <div className="p-4"><div className="mb-4 flex items-end justify-between"><div><div className="eyebrow-mono">{category}</div><h2 className="mt-1 text-base font-semibold">可复用的执行链路</h2></div></div>
              {visible.length ? <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">{visible.map((template) => {
                const Icon = ICONS[template.category]
                return <button key={template.id} type="button" disabled={!workspaceId} onClick={() => { setSelected(template.id); setName(template.title) }} className="group min-h-44 rounded-xl border bg-background/60 p-4 text-left transition-[border-color,background-color,transform] hover:-translate-y-0.5 hover:border-foreground/25 hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                  <div className="flex items-start gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-xl border bg-muted/40"><Icon className="size-4.5" /></div><div className="min-w-0"><h3 className="truncate text-sm font-semibold">{template.title}</h3><Badge variant="outline" className="mt-1 h-5 px-1.5 text-[9px]">{template.category}</Badge></div></div>
                  <p className="mt-3 line-clamp-2 text-xs leading-5 text-muted-foreground">{template.description}</p>
                  <div className="mt-4 flex items-center gap-1.5 overflow-hidden">{template.steps.map((step, index) => <div key={step} className="contents"><span className="truncate rounded-md border bg-muted/25 px-2 py-1 font-mono text-[9px] text-muted-foreground">{step}</span>{index < template.steps.length - 1 ? <span className="text-[10px] text-muted-foreground/50">→</span> : null}</div>)}</div>
                </button>
              })}</div> : <div className="grid min-h-80 place-items-center rounded-xl border border-dashed text-sm text-muted-foreground">没有匹配的模板，换一个关键词试试。</div>}
            </div>
          </section>
        </div>
      </div>
      <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}><DialogContent><DialogHeader><DialogTitle>用这个模板创建项目</DialogTitle><DialogDescription>模板会生成项目和第一份工作流草稿，所有节点都可以继续修改。</DialogDescription></DialogHeader><label className="space-y-2 text-sm"><span>项目名称</span><Input value={name} onChange={(event) => setName(event.target.value)} autoFocus /></label><DialogFooter><Button variant="outline" onClick={() => setSelected(null)}>取消</Button><Button onClick={createFromTemplate} disabled={!name.trim() || bootstrapProject.isPending}>创建并打开</Button></DialogFooter></DialogContent></Dialog>
    </PageContainer>
  )
}
