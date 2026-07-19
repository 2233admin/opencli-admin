'use client'

import type { DashboardStats, OpinionMonitor } from '@/lib/api/types'
import { DonutChart, HorizontalBarChart, type DistributionDatum } from '@/components/visualization/distribution-chart'
import { ConversionFunnel, type ConversionStage } from '@/components/visualization/conversion-funnel'
import { VisualizationCard } from '@/components/visualization/visualization-card'

function percent(value: number, total: number) {
  return total > 0 ? (value / total) * 100 : 0
}

export function OperationalAnalytics({
  stats,
  opinion,
  opinionLoading,
  opinionError,
}: {
  stats: DashboardStats
  opinion?: OpinionMonitor
  opinionLoading: boolean
  opinionError: boolean
}) {
  const otherRuns = Math.max(0, stats.runs.total - stats.runs.success - stats.runs.failed)
  const outcomes: DistributionDatum[] = [
    { key: 'success', label: '成功', value: stats.runs.success, color: 'var(--viz-positive)' },
    { key: 'failed', label: '失败', value: stats.runs.failed, color: 'var(--viz-negative)' },
    { key: 'other', label: '其他', value: otherRuns, color: 'var(--viz-neutral)' },
  ].filter((item) => item.value > 0)

  const windowRecords = opinion?.summary.records ?? 0
  const coverage: ConversionStage[] = opinion
    ? [
        {
          key: 'records',
          label: '进入处理',
          detail: `${opinion.summary.records} 条记录`,
          value: percent(opinion.summary.records, windowRecords),
        },
        {
          key: 'ai',
          label: 'AI 已处理',
          detail: `${opinion.summary.ai_processed} / ${windowRecords} 条记录`,
          value: percent(opinion.summary.ai_processed, windowRecords),
          tone: opinion.summary.ai_processed > 0 ? 'success' : 'warning',
        },
      ]
    : []

  const meaningfulSentiment =
    opinion?.sentiment.filter((item) => !['unknown', '未知'].includes(item.label.toLowerCase())) ?? []
  const opinionDistribution: DistributionDatum[] = (meaningfulSentiment.length
    ? meaningfulSentiment
    : opinion?.tags ?? []
  )
    .slice(0, 6)
    .map((item, index) => ({
      key: `${item.label}-${index}`,
      label: item.label,
      value: item.count,
      color: `var(--chart-${(index % 5) + 1})`,
    }))

  return (
    <section className="grid gap-4 lg:grid-cols-3" aria-label="运营分析可视化">
      <VisualizationCard
        eyebrow="Run outcome"
        title="运行结果分布"
        description="快速判断成功、失败和未完成运行的占比。"
        empty={outcomes.length === 0}
      >
        <DonutChart data={outcomes} ariaLabel="运行结果分布图" centerLabel="运行" />
      </VisualizationCard>
      <VisualizationCard
        eyebrow="Processing funnel"
        title="处理链路转化"
        description={`同一${opinion?.window.range ?? '统计'}窗口内，从入库到 AI 处理。发送日志是事件数，不冒充记录转化率。`}
        loading={opinionLoading}
        error={opinionError}
        empty={!opinionLoading && !opinionError && windowRecords === 0}
        emptyMessage="当前窗口尚无可处理记录"
      >
        <ConversionFunnel stages={coverage} ariaLabel="记录入库与 AI 处理覆盖率" />
      </VisualizationCard>
      <VisualizationCard
        eyebrow="Opinion distribution"
        title="情绪与标签分布"
        description="优先展示明确情绪，只有 unknown 时回退到已有标签。"
        loading={opinionLoading}
        error={opinionError}
        empty={!opinionLoading && !opinionError && opinionDistribution.length === 0}
      >
        <HorizontalBarChart data={opinionDistribution} ariaLabel="舆情情绪与标签分布图" />
      </VisualizationCard>
    </section>
  )
}
