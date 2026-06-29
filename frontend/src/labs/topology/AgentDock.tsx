import { useRef, useState, type KeyboardEvent } from 'react'
import { Bot, Check, Loader2, Send, Sparkles, User, X } from 'lucide-react'
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

const GREETING: ChatMsg = {
  role: 'assistant',
  content: '我是采集网络助手。想看懂某条采集逻辑、或要改配置(如启停数据源), 直接跟我说。改动会先给你确认再落库。',
}

export function AgentDock({
  contextNode,
  onApplied,
}: {
  contextNode: DockContextNode | null
  onApplied: () => void
}) {
  const [messages, setMessages] = useState<ChatMsg[]>([GREETING])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

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

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden border border-white/[0.1] bg-[#0a0a0a]">
      {/* header */}
      <div className="flex items-center gap-2 border-b border-white/[0.08] px-3 py-2.5">
        <span className="grid h-7 w-7 place-items-center border border-white/15 bg-white/[0.04] text-zinc-200">
          <Sparkles size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[9px] uppercase tracking-wider text-zinc-500">AGENT 对话坞</p>
          <p className="truncate text-xs font-semibold text-zinc-200">改动入口 · 写前确认</p>
        </div>
        {contextNode && (
          <span className="max-w-[140px] truncate border border-white/10 bg-white/[0.04] px-2 py-0.5 font-mono text-[10px] text-zinc-400" title={`${contextNode.kind}: ${contextNode.title}`}>
            @ {contextNode.title}
          </span>
        )}
      </div>

      {/* messages */}
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-auto px-3 py-3">
        {messages.map((m, i) => (
          <div key={i} className={cn('flex gap-2', m.role === 'user' && 'flex-row-reverse')}>
            <span
              className={cn(
                'mt-0.5 grid h-6 w-6 shrink-0 place-items-center border text-zinc-300',
                m.role === 'user' ? 'border-sky-400/30 bg-sky-400/10' : 'border-white/12 bg-white/[0.04]',
              )}
            >
              {m.role === 'user' ? <User size={12} /> : <Bot size={12} />}
            </span>
            <div
              className={cn(
                'max-w-[82%] whitespace-pre-wrap border px-2.5 py-1.5 text-[12.5px] leading-5',
                m.role === 'user'
                  ? 'border-sky-400/25 bg-sky-400/[0.08] text-sky-50'
                  : 'border-white/10 bg-white/[0.03] text-zinc-200',
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

      {/* proposal confirm card */}
      {proposal && (
        <div className="border-t border-amber-400/25 bg-amber-400/[0.06] px-3 py-2.5">
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
      <div className="border-t border-white/[0.08] p-2">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            placeholder="跟 agent 说… 例: 停用 demo-binance-funding"
            className="min-h-0 flex-1 resize-none border border-white/12 bg-black/40 px-2.5 py-1.5 text-[12.5px] text-zinc-100 placeholder:text-zinc-600 focus:border-white/30 focus:outline-none"
          />
          <button
            type="button"
            onClick={send}
            disabled={loading || !input.trim()}
            className="grid h-9 w-9 shrink-0 place-items-center border border-white/12 bg-white/[0.05] text-zinc-200 transition hover:border-white/30 hover:bg-white/[0.1] disabled:opacity-40"
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
