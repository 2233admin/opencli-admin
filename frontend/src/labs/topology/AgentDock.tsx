import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Ban, Bot, Check, Loader2, RefreshCw, Send, Sparkles, User, X } from 'lucide-react'
import { toast } from 'sonner'

import { apiClient } from '../../api/client'
import type { ApiResponse } from '../../api/types'
import { cn } from '../../lib/utils'

/* Agent 对话坞 — 采集网络的改动入口。
 * 范式: 图只读, 改动跟 agent 说。agent (后端复用 provider/模型网关 + tool-calling)
 * 决定调工具; 写工具不直接落库, 回一个 proposal, 用户在这里点确认才走 /chat/confirm 落库。
 * 聊天壳目前用现有 primitives + 纯文本渲染 (后端协议是简单 JSON, 之后可平滑换 assistant-ui)。 */

interface ChatMsg {
  role: 'user' | 'assistant'
  content: string
}

interface Proposal {
  tool: string
  args: Record<string, unknown>
  summary: string
  diff: string
}

interface ChatReply {
  type: 'message' | 'proposal'
  content?: string | null
  proposal?: Proposal | null
}

export interface DockContextNode {
  kind: string
  id: string
  title: string
}

/* A re-distill target: the failing skill + its journey_trace_v1 trace. Surfaced
 * when the dock's context is a failing skill (kind === 'skill', optionally with a
 * run's self_eval.passed === false). Reuses the proposal→confirm contract — the
 * 重蒸技能 button shows the SAME amber confirm card, and on confirm POSTs to
 * /skills/{id}/redistill (re-distillation, never an auto-trigger). */
interface RedistillTarget {
  skillId: string
  title: string
  trace: Record<string, unknown>
}

const GREETING: ChatMsg = {
  role: 'assistant',
  content: '我是采集网络助手。想看懂某条采集逻辑、或要改配置(如启停数据源), 直接跟我说。改动会先给你确认再落库。',
}

export function AgentDock({
  contextNode,
  onApplied,
  failingTrace = null,
}: {
  contextNode: DockContextNode | null
  onApplied: () => void
  /* Optional failing journey_trace_v1 from a run, passed by the parent run view.
   * When the context is a skill and a trace is available, the 重蒸技能 action can
   * re-distill it. Absent → a minimal context-only trace is used so the
   * human-triggered flow is still exercisable. */
  failingTrace?: Record<string, unknown> | null
}) {
  const [messages, setMessages] = useState<ChatMsg[]>([GREETING])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [redistill, setRedistill] = useState<RedistillTarget | null>(null)
  const [hasOpenProposal, setHasOpenProposal] = useState(false)
  const [dismissTarget, setDismissTarget] = useState<{ skillId: string; title: string } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  /* Best-effort visibility flag for the 驳回纠错 button — refetched whenever
   * the dock's context changes to a skill. Not a user-initiated action, so
   * failures are swallowed rather than surfaced. */
  useEffect(() => {
    setHasOpenProposal(false)
    if (!contextNode || contextNode.kind !== 'skill') return
    let cancelled = false
    apiClient
      .get<ApiResponse<{ has_open_proposal: boolean }>>(`/skills/${contextNode.id}`)
      .then((r) => {
        if (!cancelled) setHasOpenProposal(r.data.data.has_open_proposal)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [contextNode?.id, contextNode?.kind])

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      const el = scrollRef.current
      if (el) el.scrollTop = el.scrollHeight
    })
  }

  const append = (msg: ChatMsg) => {
    setMessages((prev) => [...prev, msg])
    scrollToBottom()
  }

  const send = async () => {
    const text = input.trim()
    if (!text || loading) return
    const userMsg: ChatMsg = { role: 'user', content: text }
    const history = [...messages.filter((m) => m !== GREETING), userMsg]
    append(userMsg)
    setInput('')
    setLoading(true)
    setProposal(null)
    try {
      const reply = await apiClient
        .post<ApiResponse<ChatReply>>('/chat', {
          messages: history.map((m) => ({ role: m.role, content: m.content })),
          context: contextNode ?? undefined,
        })
        .then((r) => r.data.data)

      if (reply.type === 'proposal' && reply.proposal) {
        setProposal(reply.proposal)
        append({ role: 'assistant', content: `我想${reply.proposal.summary}。\n变更: ${reply.proposal.diff}\n确认后才会落库。` })
      } else {
        append({ role: 'assistant', content: reply.content || '(无内容)' })
      }
    } catch (err) {
      const detail = extractDetail(err)
      append({ role: 'assistant', content: `出错了: ${detail}` })
    } finally {
      setLoading(false)
    }
  }

  const confirm = async () => {
    if (!proposal || loading) return
    setLoading(true)
    try {
      await apiClient.post('/chat/confirm', { proposal })
      toast.success(`已${proposal.summary}`)
      append({ role: 'assistant', content: `✅ 已${proposal.summary}, 图已刷新。` })
      setProposal(null)
      onApplied()
    } catch (err) {
      const detail = extractDetail(err)
      toast.error(`落库失败: ${detail}`)
      append({ role: 'assistant', content: `❌ 落库失败: ${detail}` })
    } finally {
      setLoading(false)
    }
  }

  const cancel = () => {
    setProposal(null)
    append({ role: 'assistant', content: '已取消, 没有改动。' })
  }

  /* 重蒸技能 — re-distill a failing skill. Reuses the SAME proposal→confirm
   * contract: clicking opens an amber confirm card (it does NOT auto-fire), and
   * on confirm POSTs the failing trace to /skills/{id}/redistill. */
  const proposeRedistill = () => {
    if (!contextNode || contextNode.kind !== 'skill' || loading) return
    const trace: Record<string, unknown> = failingTrace ?? {
      schema: 'journey_trace_v1',
      trace_id: `dock-${contextNode.id}`,
      label: contextNode.title,
      summary: { domain: 'unknown' },
      steps: [],
      outcome: { status: 'failed', milestones_hit: [], terminal_check: false },
    }
    setProposal(null)
    setDismissTarget(null)
    setRedistill({ skillId: contextNode.id, title: contextNode.title, trace })
  }

  const confirmRedistill = async () => {
    if (!redistill || loading) return
    setLoading(true)
    try {
      const res = await apiClient
        .post<ApiResponse<{ version: number }>>(`/skills/${redistill.skillId}/redistill`, {
          trace: redistill.trace,
        })
        .then((r) => r.data.data)
      toast.success(`已重蒸技能「${redistill.title}」→ v${res.version}`)
      append({ role: 'assistant', content: `✅ 已重蒸技能「${redistill.title}」, 新版本 v${res.version}。` })
      setRedistill(null)
      setHasOpenProposal(false)
      onApplied()
    } catch (err) {
      const detail = extractDetail(err)
      toast.error(`重蒸失败: ${detail}`)
      append({ role: 'assistant', content: `❌ 重蒸失败: ${detail}` })
    } finally {
      setLoading(false)
    }
  }

  const cancelRedistill = () => {
    setRedistill(null)
    append({ role: 'assistant', content: '已取消重蒸, 技能未改动。' })
  }

  /* 驳回纠错 — dismiss an open correction proposal (append correction_dismissed,
   * resets the fail-streak boundary). Same proposal→confirm contract as
   * redistill; POSTs to /skills/{id}/dismiss-correction on confirm. */
  const proposeDismiss = () => {
    if (!contextNode || contextNode.kind !== 'skill' || loading) return
    setProposal(null)
    setRedistill(null)
    setDismissTarget({ skillId: contextNode.id, title: contextNode.title })
  }

  const confirmDismiss = async () => {
    if (!dismissTarget || loading) return
    setLoading(true)
    try {
      await apiClient.post(`/skills/${dismissTarget.skillId}/dismiss-correction`)
      toast.success(`已驳回技能「${dismissTarget.title}」的纠错提案`)
      append({ role: 'assistant', content: `✅ 已驳回「${dismissTarget.title}」的纠错提案, 计数重置。` })
      setDismissTarget(null)
      setHasOpenProposal(false)
      onApplied()
    } catch (err) {
      const detail = extractDetail(err)
      toast.error(`驳回失败: ${detail}`)
      append({ role: 'assistant', content: `❌ 驳回失败: ${detail}` })
    } finally {
      setLoading(false)
    }
  }

  const cancelDismiss = () => {
    setDismissTarget(null)
    append({ role: 'assistant', content: '已取消, 纠错提案仍待处理。' })
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden border border-white/10 bg-[#0a0a0a]">
      {/* header */}
      <div className="flex items-center gap-2 border-b border-white/8 px-3 py-2.5">
        <span className="grid h-7 w-7 place-items-center border border-white/15 bg-white/4 text-zinc-200">
          <Sparkles size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[9px] uppercase tracking-wider text-zinc-500">AGENT 对话坞</p>
          <p className="truncate text-xs font-semibold text-zinc-200">改动入口 · 写前确认</p>
        </div>
        {contextNode && (
          <span className="max-w-[140px] truncate border border-white/10 bg-white/4 px-2 py-0.5 font-mono text-[10px] text-zinc-400" title={`${contextNode.kind}: ${contextNode.title}`}>
            @ {contextNode.title}
          </span>
        )}
        {contextNode?.kind === 'skill' && (
          <button
            type="button"
            onClick={proposeRedistill}
            disabled={loading || !!redistill || !!dismissTarget}
            title="用失败轨迹重新蒸馏这个技能 (version n+1)"
            className="inline-flex shrink-0 items-center gap-1 border border-amber-400/35 bg-amber-400/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-amber-100 transition hover:bg-amber-400/20 disabled:opacity-40"
          >
            <RefreshCw size={11} /> 重蒸技能
          </button>
        )}
        {contextNode?.kind === 'skill' && hasOpenProposal && (
          <button
            type="button"
            onClick={proposeDismiss}
            disabled={loading || !!redistill || !!dismissTarget}
            title="驳回本次纠错提案, 判定失败连续计数不是真问题"
            className="inline-flex shrink-0 items-center gap-1 border border-white/12 bg-white/4 px-2 py-0.5 font-mono text-[10px] font-semibold text-zinc-300 transition hover:border-white/25 hover:bg-white/8 disabled:opacity-40"
          >
            <Ban size={11} /> 驳回纠错
          </button>
        )}
      </div>

      {/* messages */}
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-auto px-3 py-3">
        {messages.map((m, i) => (
          <div key={i} className={cn('flex gap-2', m.role === 'user' && 'flex-row-reverse')}>
            <span
              className={cn(
                'mt-0.5 grid h-6 w-6 shrink-0 place-items-center border text-zinc-300',
                m.role === 'user' ? 'border-sky-400/30 bg-sky-400/10' : 'border-white/12 bg-white/4',
              )}
            >
              {m.role === 'user' ? <User size={12} /> : <Bot size={12} />}
            </span>
            <div
              className={cn(
                'max-w-[82%] whitespace-pre-wrap border px-2.5 py-1.5 text-[12.5px] leading-5',
                m.role === 'user'
                  ? 'border-sky-400/25 bg-sky-400/8 text-sky-50'
                  : 'border-white/10 bg-white/3 text-zinc-200',
              )}
            >
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex items-center gap-2 px-1 text-[11px] text-zinc-500">
            <Loader2 size={12} className="animate-spin" /> 思考中…
          </div>
        )}
      </div>

      {/* 重蒸技能 confirm card — same amber confirm contract as proposals */}
      {redistill && (
        <div className="border-t border-amber-400/25 bg-amber-400/6 px-3 py-2.5">
          <p className="font-mono text-[9px] uppercase tracking-wider text-amber-200/70">待确认重蒸</p>
          <p className="mt-1 text-xs font-semibold text-amber-100">重新蒸馏技能「{redistill.title}」→ version n+1</p>
          <p className="mt-0.5 font-mono text-[11px] text-amber-200/80">用失败轨迹重蒸, 旧版本保留, 确认后生成新版本。</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={confirmRedistill}
              disabled={loading}
              className="inline-flex items-center gap-1 border border-emerald-400/40 bg-emerald-400/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-100 transition hover:bg-emerald-400/25 disabled:opacity-50"
            >
              <Check size={12} /> 确认重蒸
            </button>
            <button
              type="button"
              onClick={cancelRedistill}
              disabled={loading}
              className="inline-flex items-center gap-1 border border-white/12 px-2.5 py-1 text-[11px] text-zinc-300 transition hover:border-white/25 disabled:opacity-50"
            >
              <X size={12} /> 取消
            </button>
          </div>
        </div>
      )}

      {/* 驳回纠错 confirm card — same amber confirm contract as proposals */}
      {dismissTarget && (
        <div className="border-t border-amber-400/25 bg-amber-400/6 px-3 py-2.5">
          <p className="font-mono text-[9px] uppercase tracking-wider text-amber-200/70">待确认驳回</p>
          <p className="mt-1 text-xs font-semibold text-amber-100">驳回技能「{dismissTarget.title}」的纠错提案</p>
          <p className="mt-0.5 font-mono text-[11px] text-amber-200/80">判定这次连续失败不是真问题, 重置计数, 技能本身不改动。</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={confirmDismiss}
              disabled={loading}
              className="inline-flex items-center gap-1 border border-emerald-400/40 bg-emerald-400/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-100 transition hover:bg-emerald-400/25 disabled:opacity-50"
            >
              <Check size={12} /> 确认驳回
            </button>
            <button
              type="button"
              onClick={cancelDismiss}
              disabled={loading}
              className="inline-flex items-center gap-1 border border-white/12 px-2.5 py-1 text-[11px] text-zinc-300 transition hover:border-white/25 disabled:opacity-50"
            >
              <X size={12} /> 取消
            </button>
          </div>
        </div>
      )}

      {/* proposal confirm card */}
      {proposal && (
        <div className="border-t border-amber-400/25 bg-amber-400/6 px-3 py-2.5">
          <p className="font-mono text-[9px] uppercase tracking-wider text-amber-200/70">待确认改动</p>
          <p className="mt-1 text-xs font-semibold text-amber-100">{proposal.summary}</p>
          <p className="mt-0.5 font-mono text-[11px] text-amber-200/80">{proposal.diff}</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={confirm}
              disabled={loading}
              className="inline-flex items-center gap-1 border border-emerald-400/40 bg-emerald-400/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-100 transition hover:bg-emerald-400/25 disabled:opacity-50"
            >
              <Check size={12} /> 确认落库
            </button>
            <button
              type="button"
              onClick={cancel}
              disabled={loading}
              className="inline-flex items-center gap-1 border border-white/12 px-2.5 py-1 text-[11px] text-zinc-300 transition hover:border-white/25 disabled:opacity-50"
            >
              <X size={12} /> 取消
            </button>
          </div>
        </div>
      )}

      {/* composer */}
      <div className="border-t border-white/8 p-2">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            placeholder="跟 agent 说… 例: 停用 demo-binance-funding"
            className="min-h-0 flex-1 resize-none border border-white/12 bg-black/40 px-2.5 py-1.5 text-[12.5px] text-zinc-100 placeholder:text-zinc-600 focus:border-white/30 focus:outline-hidden"
          />
          <button
            type="button"
            onClick={send}
            disabled={loading || !input.trim()}
            className="grid h-9 w-9 shrink-0 place-items-center border border-white/12 bg-white/5 text-zinc-200 transition hover:border-white/30 hover:bg-white/10 disabled:opacity-40"
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}

function extractDetail(err: unknown): string {
  if (err && typeof err === 'object') {
    const resp = (err as { response?: { data?: { detail?: string; error?: string } } }).response
    if (resp?.data?.detail) return resp.data.detail
    if (resp?.data?.error) return resp.data.error
    const msg = (err as { message?: string }).message
    if (msg) return msg
  }
  return String(err)
}
