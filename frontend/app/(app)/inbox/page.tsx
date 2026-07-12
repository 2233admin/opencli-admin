'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Bot, Check, ChevronRight, CircleDot, RotateCcw, ShieldCheck, X } from 'lucide-react'
import { toast } from 'sonner'

import { useDecideOperationsApproval, useMyWorkspaces, useOperationsInbox } from '@/lib/api/hooks'
import type { ApprovalDecision, OperationsWorkItem } from '@/lib/api/types'
import { formatRelative } from '@/lib/format'
import { cn } from '@/lib/utils'
import { BACKEND_HINT, EmptyState, ErrorState, LoadingState } from '@/components/shell/data-states'
import { PageContainer } from '@/components/shell/page-container'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

const TYPE_LABEL: Record<OperationsWorkItem['type'], string> = {
  incident: '事件',
  approval: '待审批',
  change_proposal: '变更建议',
  review: '复核',
}

const STATUS_LABEL: Record<OperationsWorkItem['status'], string> = {
  open: '待处理',
  in_progress: '处理中',
  resolved: '已解决',
  closed: '已关闭',
  dismissed: '已忽略',
}

function severityClass(severity: string) {
  if (severity === 'critical') return 'border-red-500/30 bg-red-500/10 text-red-500'
  if (severity === 'high') return 'border-amber-500/30 bg-amber-500/10 text-amber-500'
  if (severity === 'medium') return 'border-sky-500/30 bg-sky-500/10 text-sky-500'
  return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500'
}

function itemTitle(item: OperationsWorkItem) {
  return item.reason || `${TYPE_LABEL[item.type]} · ${item.id.slice(0, 8)}`
}

function Evidence({ evidence }: { evidence: Record<string, unknown> }) {
  const entries = Object.entries(evidence).filter(([key]) => !['decisions', 'approval_grant'].includes(key))
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {entries.map(([key, value]) => (
        <div key={key} className="rounded-lg border bg-muted/20 p-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{key.replaceAll('_', ' ')}</div>
          <div className="mt-2 break-words text-sm leading-6">
            {typeof value === 'string' ? value : <pre className="whitespace-pre-wrap font-mono text-xs">{JSON.stringify(value, null, 2)}</pre>}
          </div>
        </div>
      ))}
      {entries.length === 0 ? <p className="text-sm text-muted-foreground">该事项没有附加证据。</p> : null}
    </div>
  )
}

export default function OperationsInboxPage() {
  const workspaces = useMyWorkspaces()
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [status, setStatus] = useState('open')
  const inbox = useOperationsInbox(workspaceId, status || undefined)
  const decide = useDecideOperationsApproval()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [reason, setReason] = useState('')

  useEffect(() => {
    if (!workspaceId && workspaces.data?.length) setWorkspaceId(workspaces.data[0].id)
  }, [workspaceId, workspaces.data])

  const items = useMemo(() => inbox.data?.data ?? [], [inbox.data?.data])
  useEffect(() => {
    if (!items.length) setSelectedId(null)
    else if (!selectedId || !items.some((item) => item.id === selectedId)) setSelectedId(items[0].id)
  }, [items, selectedId])

  const selected = items.find((item) => item.id === selectedId) ?? null
  const relatedProposal = useMemo(() => {
    if (!selected) return null
    const proposalId = selected.proposal_id || selected.parent_id
    return items.find((item) => item.id === proposalId) ?? null
  }, [items, selected])
  const detail = selected?.type === 'approval' && relatedProposal ? relatedProposal : selected

  async function submitDecision(decision: ApprovalDecision) {
    if (!workspaceId || selected?.type !== 'approval' || !reason.trim()) return
    try {
      const result = await decide.mutateAsync({ workspaceId, approvalId: selected.id, decision, reason: reason.trim() })
      setReason('')
      toast.success(
        decision === 'approve'
          ? result.execution_state === 'awaiting_actuator' ? '已批准，等待 Actuator 执行' : '已记录批准'
          : decision === 'reject' ? '已拒绝该变更' : '已退回修改',
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '操作失败')
    }
  }

  return (
    <PageContainer
      eyebrow="Operations / Human gate"
      title="操作收件箱"
      description="集中查看 Operations Agent 建议、风险证据与人工审批"
      actions={workspaces.data?.length ? (
        <select
          value={workspaceId ?? ''}
          onChange={(event) => setWorkspaceId(event.target.value)}
          className="h-8 rounded-full border bg-background px-3 font-mono text-xs outline-none focus-visible:ring-2"
          aria-label="选择 Workspace"
        >
          {workspaces.data.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
        </select>
      ) : null}
    >
      {workspaces.isLoading ? <LoadingState rows={3} /> : workspaces.isError ? (
        <ErrorState message={(workspaces.error as Error)?.message} hint={BACKEND_HINT} />
      ) : !workspaces.data?.length ? (
        <EmptyState title="尚未加入 Workspace" description="创建 Workspace 或由管理员添加成员后，Operations Inbox 会显示在这里。" />
      ) : (
        <>
          <div className="flex flex-wrap gap-2 border-b pb-4">
            {[['open', '待处理'], ['in_progress', '处理中'], ['', '全部']].map(([value, label]) => (
              <Button key={label} size="sm" variant={status === value ? 'default' : 'outline'} onClick={() => setStatus(value)}>{label}</Button>
            ))}
            <Badge variant="outline" className="ml-auto font-mono">{inbox.data?.meta?.total ?? 0} items</Badge>
          </div>

          {inbox.isLoading ? <LoadingState rows={5} /> : inbox.isError ? (
            <ErrorState message={(inbox.error as Error)?.message} hint={BACKEND_HINT} />
          ) : items.length === 0 ? (
            <EmptyState title="Inbox 已清空" description="当前筛选条件下没有需要处理的 Operations 事项。" />
          ) : (
            <div className="grid min-h-[620px] overflow-hidden rounded-xl border lg:grid-cols-[360px_1fr]">
              <div className="border-b bg-muted/10 lg:border-r lg:border-b-0">
                <div className="border-b px-4 py-3 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Shared queue</div>
                <div className="divide-y">
                  {items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => { setSelectedId(item.id); setReason('') }}
                      className={cn('flex w-full gap-3 p-4 text-left hover:bg-muted/50', selectedId === item.id && 'bg-muted')}
                    >
                      <span className={cn('mt-1 size-2 shrink-0 rounded-full', item.status === 'open' ? 'bg-amber-400' : 'bg-sky-400')} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">{itemTitle(item)}</span>
                          <ChevronRight className="ml-auto size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                        </span>
                        <span className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                          <span>{TYPE_LABEL[item.type]}</span>
                          <span>·</span>
                          <span>{STATUS_LABEL[item.status]}</span>
                          <span className="ml-auto">{formatRelative(item.created_at)}</span>
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {selected && detail ? (
                <div className="flex min-w-0 flex-col">
                  <div className="border-b p-5 md:p-6">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{TYPE_LABEL[selected.type]}</Badge>
                      <Badge variant="outline" className={severityClass(detail.severity)}>{detail.severity.toUpperCase()}</Badge>
                      <Badge variant="secondary">{STATUS_LABEL[selected.status]}</Badge>
                    </div>
                    <h2 className="mt-4 max-w-3xl text-xl leading-8">{itemTitle(detail)}</h2>
                    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 font-mono text-xs text-muted-foreground">
                      <span className="flex items-center gap-1.5"><Bot className="size-3.5" />{detail.author_actor_id || 'system'}</span>
                      <span className="flex items-center gap-1.5"><CircleDot className="size-3.5" />{detail.id}</span>
                    </div>
                  </div>
                  <div className="flex-1 space-y-6 p-5 md:p-6">
                    <section>
                      <h3 className="mb-3 flex items-center gap-2 text-sm font-medium"><ShieldCheck className="size-4 text-emerald-500" />变更证据</h3>
                      <Evidence evidence={detail.evidence} />
                    </section>
                    {selected.type === 'approval' && ['open', 'in_progress'].includes(selected.status) ? (
                      <section className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-4">
                        <div className="mb-3 flex items-center gap-2 text-sm font-medium"><AlertTriangle className="size-4 text-amber-500" />人工 Gate 决策</div>
                        <Textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="填写决策依据（必填，将写入审计记录）" maxLength={2000} />
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button onClick={() => submitDecision('approve')} disabled={!reason.trim() || decide.isPending}><Check />批准</Button>
                          <Button variant="outline" onClick={() => submitDecision('request_changes')} disabled={!reason.trim() || decide.isPending}><RotateCcw />退回修改</Button>
                          <Button variant="destructive" className="ml-auto" onClick={() => submitDecision('reject')} disabled={!reason.trim() || decide.isPending}><X />拒绝</Button>
                        </div>
                        <p className="mt-3 text-xs text-muted-foreground">批准只产生带版本绑定的 Approval Grant；任何 Agent 都不能绕过 Actuator。</p>
                      </section>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </>
      )}
    </PageContainer>
  )
}
