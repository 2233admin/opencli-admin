import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { listSkills, getChromePool, recordStart, recordStop, distillSkill } from '../api/endpoints'
import { PageLoader } from '../components/LoadingSpinner'
import ErrorAlert from '../components/ErrorAlert'
import Card from '../components/Card'
import DataTable from '../components/DataTable'
import StatusBadge from '../components/StatusBadge'
import PageHeader from '../components/PageHeader'
import Pagination from '../components/Pagination'
import { Badge } from '../components/ui/badge'
import { Button } from '@/components/ui/button'
import { AlertTriangle, CheckCircle2, Sparkles, Video, XCircle } from 'lucide-react'

type WizardStep = 'form' | 'recording' | 'review'

interface RecordStep {
  index: number
  verb: string | null
  target?: unknown
  args?: Record<string, unknown>
  error?: string | null
}

/** "录这站" 向导 — record 腿 (2026-07-01 addendum, ADR-0003)。人对着一个真实、
 * 有头的 Chrome 操作一遍，机械捕获（零 LLM），停止后审查步骤列表，确认才蒸馏
 * 成技能。三步：填 domain/capability + 选 Chrome 端点 → 录制中（标记成功/失败）
 * → 审查步骤列表 + 确认蒸馏。*/
function RecordWizard({ onClose, onDistilled }: { onClose: () => void; onDistilled: (skillId: string) => void }) {
  const [step, setStep] = useState<WizardStep>('form')
  const [domain, setDomain] = useState('')
  const [capability, setCapability] = useState('')
  const [cdpEndpoint, setCdpEndpoint] = useState('')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [trace, setTrace] = useState<Record<string, unknown> | null>(null)

  const { data: chromePool } = useQuery({ queryKey: ['chrome-pool'], queryFn: getChromePool })
  const endpoints = chromePool?.endpoints ?? []

  const startMut = useMutation({
    mutationFn: () => recordStart({ domain, capability, cdp_endpoint: cdpEndpoint || undefined }),
    onSuccess: (res) => {
      setSessionId(res.session_id)
      setStep('recording')
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '无法开始录制'),
  })

  const stopMut = useMutation({
    mutationFn: (status: 'success' | 'failed') => {
      if (!sessionId) throw new Error('no active session')
      return recordStop(sessionId, { status })
    },
    onSuccess: (t) => {
      setTrace(t)
      setStep('review')
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '停止录制失败'),
  })

  const distillMut = useMutation({
    mutationFn: () => {
      if (!trace) throw new Error('no trace to distill')
      return distillSkill({ trace, domain, capability })
    },
    onSuccess: (skill) => {
      toast.success(`已蒸馏出技能「${skill.name}」`)
      onDistilled(skill.id)
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '蒸馏失败'),
  })

  const steps = (trace?.steps as RecordStep[] | undefined) ?? []

  // Recording holds the pool's per-endpoint mutex for the session's lifetime,
  // released only by /stop — closing mid-recording without calling it leaks
  // that Chrome endpoint until the backend restarts.
  const handleClose = () => {
    if (step === 'recording' && sessionId) {
      recordStop(sessionId, { status: 'failed' }).catch(() => {})
    }
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col border border-white/10 bg-zinc-950 shadow-2xl">
        <div className="border-b border-white/10 p-5">
          <p className="telemetry-label">
            {step === 'form' ? 'STEP 1 · 开始' : step === 'recording' ? 'STEP 2 · 录制中' : 'STEP 3 · 审查'}
          </p>
          <h2 className="mt-1 flex items-center gap-2 text-lg font-semibold text-zinc-50">
            <Video size={17} /> 录这站
          </h2>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {step === 'form' && (
            <>
              <p className="text-sm text-zinc-400">
                填技能身份 + 选一个已注册的 Chrome 端点。开始后去那个 Chrome 窗口里正常操作一遍，机械捕获，不用管它。
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="telemetry-label mb-1 block" htmlFor="record-domain">domain</label>
                  <input
                    id="record-domain"
                    className="w-full border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-primary-500/70"
                    value={domain}
                    onChange={(e) => setDomain(e.target.value)}
                    placeholder="example.com"
                  />
                </div>
                <div>
                  <label className="telemetry-label mb-1 block" htmlFor="record-capability">capability</label>
                  <input
                    id="record-capability"
                    className="w-full border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-primary-500/70"
                    value={capability}
                    onChange={(e) => setCapability(e.target.value)}
                    placeholder="open-list"
                  />
                </div>
              </div>
              <div>
                <label className="telemetry-label mb-1 block" htmlFor="record-endpoint">Chrome 端点</label>
                <select
                  id="record-endpoint"
                  className="w-full border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-primary-500/70"
                  value={cdpEndpoint}
                  onChange={(e) => setCdpEndpoint(e.target.value)}
                >
                  <option value="">— 自动选一个可用的 —</option>
                  {endpoints.map((ep) => (
                    <option key={ep.url} value={ep.url}>
                      {ep.url} {ep.available ? '(在线)' : '(离线)'}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          {step === 'recording' && (
            <div className="flex flex-col items-center gap-4 py-6 text-center">
              <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-red-500" />
              <p className="text-sm text-zinc-300">
                正在录制 — 去 Chrome 窗口里正常操作这个任务，完成后回来点下面的按钮。
              </p>
              <p className="font-mono text-xs text-zinc-500">session: {sessionId}</p>
            </div>
          )}

          {step === 'review' && (
            <>
              <p className="text-sm text-zinc-400">捕获到 {steps.length} 个步骤，确认无误后蒸馏成技能：</p>
              <div className="max-h-72 overflow-y-auto border border-white/10 bg-black/20">
                {steps.map((s, i) => (
                  <div key={i} className="flex items-start gap-3 border-b border-white/5 px-3 py-2 last:border-0">
                    <span className="font-mono text-xs text-zinc-600">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <span className="font-mono text-xs font-semibold text-primary-300">{s.verb}</span>
                      {s.target != null && (
                        <span className="ml-2 truncate text-xs text-zinc-400">{String(s.target)}</span>
                      )}
                      {s.error && <p className="mt-0.5 text-xs text-red-300">{s.error}</p>}
                    </div>
                  </div>
                ))}
                {steps.length === 0 && <p className="px-3 py-4 text-sm text-zinc-500">没有捕获到任何操作。</p>}
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end gap-3 border-t border-white/10 p-5">
          <Button type="button" variant="outline" onClick={handleClose}>取消</Button>
          {step === 'form' && (
            <Button
              type="button"
              disabled={!domain.trim() || !capability.trim() || startMut.isPending}
              onClick={() => startMut.mutate()}
            >
              {startMut.isPending ? '连接中…' : '开始录制'}
            </Button>
          )}
          {step === 'recording' && (
            <>
              <Button
                type="button"
                variant="destructive"
                disabled={stopMut.isPending}
                onClick={() => stopMut.mutate('failed')}
              >
                <XCircle size={14} /> 标记失败并停止
              </Button>
              <Button type="button" disabled={stopMut.isPending} onClick={() => stopMut.mutate('success')}>
                <CheckCircle2 size={14} /> 标记成功并停止
              </Button>
            </>
          )}
          {step === 'review' && (
            <Button type="button" disabled={distillMut.isPending || steps.length === 0} onClick={() => distillMut.mutate()}>
              {distillMut.isPending ? '蒸馏中…' : '蒸馏成技能'}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

/** 技能列表 — record→distill→execute→correct 闭环的入口页 (ADR-0003).
 * 之前只有 AgentDock 的重蒸/驳回按钮存在（依赖 dock 已经把上下文设成某个
 * skill 才能点到），这里是人第一次能看到"库里到底有哪些技能、谁在等你处理"
 * 的地方，点一行进详情页操作重蒸/驳回/回滚；"录这站"是新技能唯一的产生入口
 * （此前只能手写 journey_trace_v1 JSON 喂 API）。*/
export default function SkillsPage() {
  const [page, setPage] = useState(1)
  const [wizardOpen, setWizardOpen] = useState(false)
  const navigate = useNavigate()

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['skills', page],
    queryFn: () => listSkills({ page, limit: 20 }),
  })

  const skills = data?.data ?? []
  const meta = data?.meta
  const openProposalCount = skills.filter((s) => s.has_open_proposal).length

  if (isLoading) return <PageLoader />
  if (error) return <ErrorAlert error={error as Error} onRetry={refetch} />

  return (
    <div className="space-y-5">
      <PageHeader
        title="技能库"
        description="每个技能 = 从一次演示蒸馏出来的 SKILL.md，执行会自评、连续失败会自动提案重蒸（人确认才真的重蒸)。"
        action={
          <Button type="button" onClick={() => setWizardOpen(true)}>
            <Video size={16} /> 录这站
          </Button>
        }
      />

      {openProposalCount > 0 && (
        <div className="flex items-center gap-3 border border-amber-400/25 bg-amber-400/[0.06] px-4 py-3">
          <AlertTriangle size={16} className="shrink-0 text-amber-300" />
          <p className="text-sm text-amber-100">
            {openProposalCount} 个技能有待处理的纠错提案 — 点进详情页重蒸或驳回。
          </p>
        </div>
      )}

      <Card padding={false}>
        <DataTable
          data={skills}
          keyFn={(s) => s.id}
          emptyMessage="还没有技能 — 点右上角「录这站」，或等自动执行环跑出第一个 skill。"
          columns={[
            {
              key: 'name',
              header: '技能',
              render: (s) => (
                <Link to={`/skills/${s.id}`} className="min-w-0 hover:underline">
                  <div className="flex items-center gap-2">
                    <Sparkles size={13} className="shrink-0 text-primary-400" />
                    <span className="truncate text-sm font-medium text-zinc-100">{s.name}</span>
                    {s.has_open_proposal && (
                      <Badge variant="outline" className="border-amber-400/40 bg-amber-400/10 text-amber-200">
                        待处理
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 truncate font-mono text-xs text-zinc-500">
                    {s.domain} / {s.capability}
                  </p>
                </Link>
              ),
            },
            {
              key: 'version', header: '版本', width: '80px',
              render: (s) => <span className="font-mono text-xs text-zinc-400">v{s.version}</span>,
            },
            {
              key: 'status', header: '状态', width: '100px',
              render: (s) => <StatusBadge status={s.status} />,
            },
            {
              key: 'enabled', header: '启用', width: '80px',
              render: (s) => (
                <span className={s.enabled ? 'text-emerald-300' : 'text-zinc-500'}>
                  {s.enabled ? '是' : '否'}
                </span>
              ),
            },
            {
              key: 'evidence', header: '记录数', width: '90px',
              render: (s) => <span className="text-xs text-zinc-400">{s.evidence_count}</span>,
            },
          ]}
        />
      </Card>

      {meta && (meta.pages > 1 || meta.total > 0) && (
        <Pagination page={page} pages={meta.pages} total={meta.total} limit={20} onChange={setPage} />
      )}

      {wizardOpen && (
        <RecordWizard
          onClose={() => setWizardOpen(false)}
          onDistilled={(skillId) => {
            setWizardOpen(false)
            navigate(`/skills/${skillId}`)
          }}
        />
      )}
    </div>
  )
}
