'use client'

import { Bot, Check, ChevronRight, Clock3, CornerDownLeft, Database, LoaderCircle, Mail, Plus, Sparkles, Workflow, X } from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { PageContainer } from '@/components/shell/page-container'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useCreateProjectWorkflow, useCreateWorkspaceProject, useMyWorkspaces } from '@/lib/api/hooks'
import type { GeneratedWorkflowSpec } from '@/lib/flow/types'
import { generateWorkflowLocally } from '@/lib/flow/local-generate'
import { generatedSpecToWorkflowProject } from '@/lib/workflow/generated-project'
import { studioGraphForTemplate, studioSlug } from '@/lib/workflow/studio-templates'

const STARTERS = ['每天汇总 AI 行业新闻，提取重点后发到我的邮箱', '监控竞品官网和社交平台，发现重要变化后生成简报', '每天早上整理关注主题的新内容，只发送首次出现的信息']
type Message = { role: 'agent' | 'user'; content: string }
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function NewAgentStudioPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const workspaces = useMyWorkspaces()
  const createProject = useCreateWorkspaceProject()
  const createWorkflow = useCreateProjectWorkflow()
  const [workspaceId, setWorkspaceId] = useState<string | null>(searchParams.get('workspace'))
  const [messages, setMessages] = useState<Message[]>([{ role: 'agent', content: '先告诉我：这个项目要持续完成什么工作？可以写清数据从哪里来、需要怎样判断、最后交付到哪里。' }])
  const [input, setInput] = useState('')
  const [spec, setSpec] = useState<GeneratedWorkflowSpec | null>(null)
  const [name, setName] = useState('')
  const [deliveryEmail, setDeliveryEmail] = useState('')
  const [generating, setGenerating] = useState(false)

  useEffect(() => { if (!workspaceId && workspaces.data?.length) setWorkspaceId(workspaces.data[0].id) }, [workspaceId, workspaces.data])
  const userRequirements = useMemo(() => messages.filter((message) => message.role === 'user').map((message) => message.content), [messages])
  const requirementText = userRequirements.join('；')
  const inferredEmail = requirementText.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/)?.[0] ?? ''
  const finalEmail = deliveryEmail.trim() || inferredEmail
  const emailReady = EMAIL_PATTERN.test(finalEmail)
  const sourceReady = /(网站|网页|RSS|公众号|微博|知乎|小红书|新闻|平台|来源|竞品|链接|https?:\/\/)/i.test(requirementText)
  const scheduleReady = /(每天|每周|每月|每小时|分钟|早上|晚上|定时|实时|工作日|周末)/.test(requirementText)
  const readiness = [sourceReady, scheduleReady, emailReady].filter(Boolean).length

  async function askAgent(text = input) {
    const requirement = text.trim()
    if (!requirement || generating) return
    const nextRequirements = [...userRequirements, requirement]
    setMessages((current) => [...current, { role: 'user', content: requirement }])
    setInput('')
    setGenerating(true)
    try {
      let generated: GeneratedWorkflowSpec
      let localFallback = false
      try {
        const response = await fetch('/api/generate-workflow', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: nextRequirements.join('\n补充要求：') }) })
        const payload = await response.json()
        if (!response.ok) throw new Error(payload?.message ?? 'Agent generation failed')
        generated = payload as GeneratedWorkflowSpec
      } catch {
        generated = generateWorkflowLocally(nextRequirements.join('；'))
        localFallback = true
      }
      setSpec(generated)
      setName(generated.title)
      setMessages((current) => [...current, { role: 'agent', content: `我把需求整理成 ${generated.nodes.length} 个节点、${generated.edges.length} 条连接。${localFallback ? '当前使用本地推理引擎生成，' : ''}你可以继续补充条件，或确认右侧方案。` }])
    } finally { setGenerating(false) }
  }

  async function persistProject(useBlank = false) {
    if (!workspaceId || !(name.trim() || useBlank) || (!useBlank && !emailReady)) return
    const finalName = name.trim() || '未命名项目'
    try {
      const project = await createProject.mutateAsync({ workspaceId, data: { name: finalName, slug: `${studioSlug(finalName)}-${Date.now().toString(36)}`, description: userRequirements.join('；') || '从空白画布创建' } })
      const graph = spec && !useBlank ? generatedSpecToWorkflowProject(spec, finalName, { deliveryEmail: finalEmail }) : studioGraphForTemplate('blank', finalName)
      const workflow = await createWorkflow.mutateAsync({ workspaceId, projectId: project.id, data: { name: finalName, description: userRequirements.join('；') || '空白工作流', graph } })
      toast.success(spec && !useBlank ? '项目草稿已保存，下一步可检查并激活' : '空白项目已创建')
      router.push(`/studio/workflow?workspace=${workspaceId}&project=${project.id}&workflow=${workflow.id}${useBlank ? '&guide=blank' : ''}`)
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : '创建失败') }
  }

  return (
    <PageContainer title="与 Agent 创建监测项目" eyebrow="Studio · Agent builder" description="说清楚关注什么、多久检查一次、简报发到哪里。Agent 会整理成可检查、可激活的项目草稿。" className="max-w-none" actions={<Button size="icon" variant="ghost" nativeButton={false} render={<Link href="/studio" />} aria-label="关闭"><X className="size-4" /></Button>}>
      <div className="grid min-h-[700px] overflow-hidden rounded-2xl border bg-card/25 xl:grid-cols-[minmax(400px,0.82fr)_minmax(620px,1.4fr)]">
        <section className="flex min-h-0 flex-col border-b xl:border-b-0 xl:border-r">
          <div className="border-b p-5"><div className="flex items-center gap-3"><div className="grid size-10 place-items-center rounded-xl bg-foreground text-background"><Bot className="size-5" /></div><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-3"><h2 className="text-sm font-semibold">OpenCLI 项目 Agent</h2><span className="font-mono text-[9px] text-muted-foreground">{readiness}/3 已明确</span></div><div className="mt-0.5 flex items-center gap-1.5 font-mono text-[9px] text-muted-foreground"><span className="size-1.5 rounded-full bg-emerald-500" />正在整理项目要求</div></div></div><div className="mt-4 grid grid-cols-3 gap-2">{[{ ready: sourceReady, label: '数据来源', Icon: Database }, { ready: scheduleReady, label: '检查频率', Icon: Clock3 }, { ready: emailReady, label: '收件邮箱', Icon: Mail }].map(({ ready, label, Icon }) => <div key={label} className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-[10px] ${ready ? 'border-emerald-500/25 bg-emerald-500/5 text-foreground' : 'bg-background/40 text-muted-foreground'}`}><Icon className="size-3" />{label}{ready ? <Check className="ml-auto size-3 text-emerald-500" /> : null}</div>)}</div></div>
          <div className="flex-1 space-y-4 overflow-y-auto p-5">{messages.map((message, index) => <div key={`${message.role}-${index}`} className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : ''}`}>{message.role === 'agent' ? <div className="mt-1 grid size-7 shrink-0 place-items-center rounded-lg border bg-background"><Sparkles className="size-3.5" /></div> : null}<div className={`max-w-[85%] rounded-xl px-3.5 py-3 text-xs leading-5 ${message.role === 'user' ? 'bg-foreground text-background' : 'border bg-background/70 text-muted-foreground'}`}>{message.content}</div></div>)}{generating ? <div className="flex items-center gap-3 text-xs text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />正在拆解目标、选择节点并检查连接…</div> : null}</div>
          {!userRequirements.length ? <div className="px-5 pb-3"><div className="mb-2 font-mono text-[9px] text-muted-foreground">从一个例子开始</div><div className="space-y-1">{STARTERS.map((starter) => <button key={starter} type="button" onClick={() => void askAgent(starter)} className="flex w-full items-center justify-between rounded-lg border bg-background/50 px-3 py-2 text-left text-[11px] text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground"><span className="truncate">{starter}</span><ChevronRight className="size-3 shrink-0" /></button>)}</div></div> : null}
          <div className="border-t p-4"><label className="mb-3 block space-y-1.5 text-xs"><span className="flex items-center justify-between font-medium">简报收件邮箱 <span className="font-normal text-muted-foreground">P0 交付方式</span></span><Input value={deliveryEmail} onChange={(event) => setDeliveryEmail(event.target.value)} placeholder={inferredEmail || 'name@example.com'} inputMode="email" className={`h-9 bg-background ${deliveryEmail && !emailReady ? 'border-destructive' : ''}`} />{deliveryEmail && !emailReady ? <span className="text-[10px] text-destructive">请输入有效邮箱地址</span> : null}</label><div className="rounded-xl border bg-background p-2 focus-within:ring-2 focus-within:ring-ring/40"><Textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void askAgent() } }} className="min-h-20 resize-none border-0 bg-transparent p-2 shadow-none focus-visible:ring-0" placeholder={spec ? '继续补充：增加条件、修改来源或调整输出…' : '描述你希望项目持续完成的工作…'} /><div className="flex items-center justify-between px-1"><span className="font-mono text-[9px] text-muted-foreground">ENTER 发送 · SHIFT+ENTER 换行</span><Button size="icon" onClick={() => void askAgent()} disabled={!input.trim() || generating} aria-label="发送需求"><CornerDownLeft className="size-4" /></Button></div></div><div className="mt-3 flex items-center justify-between"><Link href={`/studio/templates?workspace=${workspaceId ?? ''}`} className="text-xs text-muted-foreground hover:text-foreground">从模板开始</Link><button type="button" onClick={() => void persistProject(true)} disabled={!workspaceId || createProject.isPending || createWorkflow.isPending} className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50">跳过 Agent，直接空白</button></div></div>
        </section>

        <section className="relative min-h-[560px] overflow-hidden bg-muted/10" aria-label="Agent 工作流方案">
          <div className="absolute inset-0 opacity-45 [background-image:radial-gradient(circle_at_center,hsl(var(--border))_1px,transparent_1px)] [background-size:22px_22px]" />
          <div className="relative flex h-full flex-col"><div className="flex items-center justify-between border-b bg-background/75 px-6 py-4 backdrop-blur"><div><div className="text-xs font-semibold">{spec ? 'Agent 生成的项目方案' : '等待需求'}</div><div className="mt-0.5 font-mono text-[9px] text-muted-foreground">{spec ? `${spec.nodes.length} NODES · ${spec.edges.length} CONNECTIONS` : 'DESCRIBE → GENERATE → CONFIRM'}</div></div>{spec ? <Badge variant="outline">可编辑草稿</Badge> : null}</div>
            {spec ? <div className="flex min-h-0 flex-1 flex-col"><div className="border-b bg-background/35 p-5"><label className="block max-w-lg space-y-2 text-xs"><span className="font-medium">项目名称</span><Input value={name} onChange={(event) => setName(event.target.value)} className="h-10 rounded-xl bg-background" /></label></div><div className="flex-1 overflow-auto p-8"><div className="mx-auto flex min-w-max items-center justify-center gap-5 py-16">{spec.nodes.map((node, index) => <div key={node.id} className="contents"><article className="relative w-48 rounded-xl border bg-background p-4 shadow-lg"><div className="flex items-center gap-2"><div className="grid size-8 place-items-center rounded-lg bg-muted"><Workflow className="size-3.5" /></div><div className="min-w-0"><div className="truncate text-xs font-semibold">{node.label}</div><div className="font-mono text-[9px] text-muted-foreground">{node.type.toUpperCase()}</div></div></div><p className="mt-3 line-clamp-2 text-[10px] leading-4 text-muted-foreground">{node.description}</p></article>{index < spec.nodes.length - 1 ? <div className="flex items-center text-muted-foreground"><div className="h-px w-8 bg-border" /><ChevronRight className="-ml-1 size-4" /></div> : null}</div>)}</div></div><div className="flex items-center justify-between border-t bg-background/75 px-6 py-4 backdrop-blur"><p className="max-w-md text-[10px] leading-4 text-muted-foreground">这里先保存项目草稿和邮箱交付配置；检查来源与频率后，再正式激活运行。</p><Button onClick={() => void persistProject()} disabled={!name.trim() || !emailReady || createProject.isPending || createWorkflow.isPending}><Plus className="size-4" />保存项目草稿</Button></div></div> : <div className="grid flex-1 place-items-center p-10"><div className="max-w-md text-center"><div className="mx-auto grid size-14 place-items-center rounded-2xl border bg-background"><Sparkles className="size-5 text-muted-foreground" /></div><h3 className="mt-5 text-sm font-semibold">项目从一次对话开始</h3><p className="mt-2 text-xs leading-5 text-muted-foreground">先说关注什么。Agent 会继续确认来源、检查频率和收件邮箱，再生成第一版项目草稿。</p></div></div>}
          </div>
        </section>
      </div>
    </PageContainer>
  )
}
