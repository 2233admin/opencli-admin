import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { getSkill, redistillSkill, dismissCorrection, rollbackSkill } from '../api/endpoints'
import type { SkillEvidenceEntry } from '../api/types'
import { PageLoader } from '../components/LoadingSpinner'
import ErrorAlert from '../components/ErrorAlert'
import Card from '../components/Card'
import PageHeader from '../components/PageHeader'
import StatusBadge from '../components/StatusBadge'
import { Button } from '@/components/ui/button'
import {
  ArrowLeft, CheckCircle2, RefreshCw, RotateCcw, Sparkles, Undo2, XCircle,
} from 'lucide-react'

const ELEMENT_LABELS: Record<string, string> = {
  preconditions: '前提条件',
  procedure: '步骤',
  milestones: '里程碑',
  terminal_conditions: '完成条件',
  false_terminal_states: '假完成陷阱',
  recovery_policies: '失败恢复',
  anti_drift_boundaries: '防漂移边界',
  red_lines: '红线',
}

const EVIDENCE_META: Record<string, { icon: typeof CheckCircle2; label: string; tone: string }> = {
  distilled: { icon: Sparkles, label: '蒸馏', tone: 'text-primary-300' },
  executed: { icon: CheckCircle2, label: '执行', tone: 'text-zinc-300' },
  corrected: { icon: RefreshCw, label: '重蒸', tone: 'text-amber-300' },
  correction_proposed: { icon: RefreshCw, label: '提案重蒸', tone: 'text-amber-300' },
  correction_dismissed: { icon: XCircle, label: '驳回提案', tone: 'text-zinc-400' },
  rolled_back: { icon: Undo2, label: '回滚', tone: 'text-red-300' },
}

function evidenceSummary(ev: SkillEvidenceEntry): string {
  switch (ev.event) {
    case 'executed':
      return `passed=${String(ev.passed)} outcome=${String(ev.loop_outcome ?? ev.outcome ?? '?')}`
    case 'corrected':
      return `v${String(ev.from_version)} → v${String(ev.to_version)}`
    case 'correction_proposed':
      return `连续 ${Array.isArray(ev.trace_ids) ? ev.trace_ids.length : '?'} 次失败，第 ${String(ev.prior_redistill_count ?? 0)} 次重蒸后`
    case 'rolled_back':
      return `v${String(ev.from_version)} → v${String(ev.to_version)}`
    default:
      return ''
  }
}

type Confirming = 'redistill' | 'dismiss' | 'rollback' | null

/** 技能详情 — 显示 skill_md / 9 要素 / evidence 时间线，操作照抄 AgentDock 的
 * "琥珀色确认卡" 范式（先展示待确认动作，人点确认才真的调 API，绝不自动跑）。*/
export default function SkillDetailPage() {
  const { id = '' } = useParams()
  const qc = useQueryClient()
  const [confirming, setConfirming] = useState<Confirming>(null)

  const { data: skill, isLoading, error, refetch } = useQuery({
    queryKey: ['skill', id],
    queryFn: () => getSkill(id),
    enabled: !!id,
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['skill', id] })

  const redistillMut = useMutation({
    mutationFn: () => redistillSkill(id),
    onSuccess: (res) => {
      toast.success(`已重蒸「${skill?.name ?? id}」→ v${res.version}`)
      setConfirming(null)
      invalidate()
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '重蒸失败'),
  })

  const dismissMut = useMutation({
    mutationFn: () => dismissCorrection(id),
    onSuccess: () => {
      toast.success('已驳回纠错提案，计数重置')
      setConfirming(null)
      invalidate()
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '驳回失败'),
  })

  const rollbackMut = useMutation({
    mutationFn: () => rollbackSkill(id),
    onSuccess: (res) => {
      toast.success(`已回滚到 v${res.version}`)
      setConfirming(null)
      invalidate()
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '回滚失败'),
  })

  if (isLoading) return <PageLoader />
  if (error || !skill) return <ErrorAlert error={(error as Error) ?? new Error('技能不存在')} onRetry={refetch} />

  const rollbackRelevant = (skill.evidence ?? []).filter(
    (ev) => ev.event === 'corrected' || ev.event === 'rolled_back',
  )
  const canRollback =
    rollbackRelevant.length > 0 &&
    rollbackRelevant[rollbackRelevant.length - 1].event === 'corrected'
  const anyMutating = redistillMut.isPending || dismissMut.isPending || rollbackMut.isPending

  return (
    <div className="space-y-5">
      <PageHeader
        title={skill.name}
        description={`${skill.domain} / ${skill.capability} — v${skill.version}`}
        action={
          <Link to="/skills">
            <Button type="button" variant="outline">
              <ArrowLeft size={14} /> 返回列表
            </Button>
          </Link>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={skill.status} />
        <span className={skill.enabled ? 'text-xs text-emerald-300' : 'text-xs text-zinc-500'}>
          {skill.enabled ? '已启用' : '已停用'}
        </span>
        {skill.has_open_proposal && (
          <span className="border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-xs text-amber-200">
            有待处理的纠错提案
          </span>
        )}
      </div>

      <Card>
        <p className="telemetry-label mb-2">SKILL.md</p>
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap border border-white/10 bg-black/30 p-3 font-mono text-xs text-zinc-200">
          {skill.skill_md || '(空)'}
        </pre>
      </Card>

      {skill.elements && (
        <Card>
          <p className="telemetry-label mb-3">九要素</p>
          <div className="grid gap-4 md:grid-cols-2">
            {Object.entries(ELEMENT_LABELS).map(([key, label]) => {
              const items = skill.elements?.[key] ?? []
              if (items.length === 0) return null
              return (
                <div key={key}>
                  <p className="text-xs font-semibold text-zinc-300">{label}</p>
                  <ul className="mt-1 space-y-0.5">
                    {items.map((item, i) => (
                      <li key={i} className="text-xs text-zinc-400">· {item}</li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      <Card>
        <p className="telemetry-label mb-3">操作</p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={anyMutating || !!confirming || !skill.last_failing_trace}
            onClick={() => setConfirming('redistill')}
            title={skill.last_failing_trace ? '用最近一次失败轨迹重蒸' : '没有可用的失败轨迹'}
          >
            <RefreshCw size={14} /> 重蒸技能
          </Button>
          {skill.has_open_proposal && (
            <Button
              type="button"
              variant="outline"
              disabled={anyMutating || !!confirming}
              onClick={() => setConfirming('dismiss')}
            >
              <XCircle size={14} /> 驳回提案
            </Button>
          )}
          {canRollback && (
            <Button
              type="button"
              variant="outline"
              disabled={anyMutating || !!confirming}
              onClick={() => setConfirming('rollback')}
            >
              <Undo2 size={14} /> 回滚上一版
            </Button>
          )}
        </div>

        {confirming === 'redistill' && (
          <div className="mt-3 border border-amber-400/25 bg-amber-400/6 px-3 py-2.5">
            <p className="font-mono text-[9px] uppercase tracking-wider text-amber-200/70">待确认重蒸</p>
            <p className="mt-1 text-xs font-semibold text-amber-100">
              用最近一次失败轨迹重新蒸馏「{skill.name}」→ v{skill.version + 1}
            </p>
            <p className="mt-0.5 font-mono text-[11px] text-amber-200/80">旧版本保留，确认后生成新版本。</p>
            <div className="mt-2 flex gap-2">
              <Button type="button" size="sm" disabled={redistillMut.isPending} onClick={() => redistillMut.mutate()}>
                {redistillMut.isPending ? '重蒸中…' : '确认重蒸'}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(null)}>取消</Button>
            </div>
          </div>
        )}

        {confirming === 'dismiss' && (
          <div className="mt-3 border border-amber-400/25 bg-amber-400/6 px-3 py-2.5">
            <p className="font-mono text-[9px] uppercase tracking-wider text-amber-200/70">待确认驳回</p>
            <p className="mt-1 text-xs font-semibold text-amber-100">驳回「{skill.name}」的纠错提案</p>
            <p className="mt-0.5 font-mono text-[11px] text-amber-200/80">
              判定这次连续失败不是真问题，重置计数，技能本身不改动。
            </p>
            <div className="mt-2 flex gap-2">
              <Button type="button" size="sm" disabled={dismissMut.isPending} onClick={() => dismissMut.mutate()}>
                {dismissMut.isPending ? '处理中…' : '确认驳回'}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(null)}>取消</Button>
            </div>
          </div>
        )}

        {confirming === 'rollback' && (
          <div className="mt-3 border border-amber-400/25 bg-amber-400/6 px-3 py-2.5">
            <p className="font-mono text-[9px] uppercase tracking-wider text-amber-200/70">待确认回滚</p>
            <p className="mt-1 text-xs font-semibold text-amber-100">回滚「{skill.name}」到上一版</p>
            <p className="mt-0.5 font-mono text-[11px] text-amber-200/80">
              恢复上一次重蒸前的 skill_md / 九要素，仅能撤销最近一次重蒸。
            </p>
            <div className="mt-2 flex gap-2">
              <Button type="button" size="sm" variant="destructive" disabled={rollbackMut.isPending} onClick={() => rollbackMut.mutate()}>
                {rollbackMut.isPending ? '回滚中…' : '确认回滚'}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(null)}>取消</Button>
            </div>
          </div>
        )}
      </Card>

      <Card padding={false}>
        <p className="telemetry-label px-5 pt-4">演化时间线</p>
        <div className="divide-y divide-white/10">
          {(skill.evidence ?? []).length === 0 && (
            <p className="px-5 py-4 text-sm text-zinc-500">还没有记录。</p>
          )}
          {[...(skill.evidence ?? [])].reverse().map((ev, i) => {
            const meta = EVIDENCE_META[ev.event] ?? { icon: RotateCcw, label: ev.event, tone: 'text-zinc-400' }
            const Icon = meta.icon
            return (
              <div key={i} className="flex items-start gap-3 px-5 py-3">
                <Icon size={14} className={`mt-0.5 shrink-0 ${meta.tone}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-zinc-200">{meta.label}</span>
                    {ev.at && <span className="font-mono text-[11px] text-zinc-500">{String(ev.at)}</span>}
                  </div>
                  <p className="mt-0.5 font-mono text-xs text-zinc-500">{evidenceSummary(ev)}</p>
                </div>
              </div>
            )
          })}
        </div>
      </Card>
    </div>
  )
}
