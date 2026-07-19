import type { ThroughputPoint } from '@/lib/demo/monitor'
import { Bar, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from 'recharts'

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { VisualizationCard } from '@/components/visualization/visualization-card'

const config = {
  collected: { label: '成功运行', color: 'var(--viz-positive)' },
  failed: { label: '失败运行', color: 'var(--viz-negative)' },
  dispatched: { label: '新增记录', color: 'var(--chart-3)' },
} satisfies ChartConfig

export function ThroughputChart({ data, daily = false }: { data: ThroughputPoint[]; daily?: boolean }) {
  const title = daily ? '近 14 天活动' : '近期处理活动'
  return (
    <VisualizationCard
      title={title}
      description="柱形使用左轴统计运行次数，折线使用右轴统计新增记录，避免混淆单位。"
      empty={data.length === 0}
    >
      <ChartContainer
        config={config}
        className="h-56 w-full"
        role="img"
        aria-label={`${title}：成功和失败运行次数，以及新增记录趋势`}
      >
        <ComposedChart data={data} accessibilityLayer margin={{ left: -12, right: -8, top: 6, bottom: 2 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="time" tickLine={false} axisLine={false} tickMargin={8} minTickGap={36} />
          <YAxis yAxisId="runs" tickLine={false} axisLine={false} tickMargin={4} width={42} />
          <YAxis yAxisId="records" orientation="right" tickLine={false} axisLine={false} width={42} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <ChartLegend content={<ChartLegendContent />} />
          <Bar
            yAxisId="runs"
            dataKey="collected"
            stackId="runs"
            fill="var(--color-collected)"
            radius={[0, 0, 3, 3]}
            isAnimationActive={false}
          />
          <Bar
            yAxisId="runs"
            dataKey="failed"
            stackId="runs"
            fill="var(--color-failed)"
            radius={[3, 3, 0, 0]}
            isAnimationActive={false}
          />
          <Line
            yAxisId="records"
            dataKey="dispatched"
            type="monotone"
            stroke="var(--color-dispatched)"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ChartContainer>
    </VisualizationCard>
  )
}
