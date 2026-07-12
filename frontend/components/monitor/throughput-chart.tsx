'use client'

import { useMemo, useState } from 'react'
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { Activity, DatabaseZap } from 'lucide-react'

import type { ThroughputPoint } from '@/lib/demo/monitor'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import { Button } from '@/components/ui/button'

const STRESS_POINT_COUNT = 5_000

/**
 * Deterministic 5k-point fixture for visual/performance verification.
 * The chart composition follows Tremor Raw's Apache-2.0 AreaChart recipe:
 * https://github.com/tremorlabs/tremor/tree/main/src/components/AreaChart
 */
function createStressSeries(): ThroughputPoint[] {
  return Array.from({ length: STRESS_POINT_COUNT }, (_, index) => {
    const wave = Math.sin(index / 41) * 18 + Math.sin(index / 113) * 9
    const burst = index % 487 < 32 ? 24 * (1 - (index % 487) / 32) : 0
    const collected = Math.max(3, Math.round(62 + wave + burst))

    return {
      time: String(index + 1),
      collected,
      dispatched: Math.max(2, Math.round(collected * 0.84 + Math.cos(index / 29) * 6)),
      failed: index % 173 === 0 ? 4 + (index % 3) : 0,
    }
  })
}

const liveConfig = {
  collected: { label: '采集', color: 'var(--chart-1)' },
  dispatched: { label: '发送', color: 'var(--chart-3)' },
  failed: { label: '失败', color: 'var(--destructive)' },
} satisfies ChartConfig

const dailyConfig = {
  collected: { label: '成功运行', color: 'var(--chart-1)' },
  dispatched: { label: '新增记录', color: 'var(--chart-3)' },
  failed: { label: '失败运行', color: 'var(--destructive)' },
} satisfies ChartConfig

export function ThroughputChart({ data, daily = false }: { data: ThroughputPoint[]; daily?: boolean }) {
  const chartConfig = daily ? dailyConfig : liveConfig
  const [stressMode, setStressMode] = useState(false)
  const stressSeries = useMemo(() => createStressSeries(), [])
  const chartData = stressMode ? stressSeries : data

  return (
    <Card data-testid="throughput-chart" data-point-count={chartData.length}>
      <CardHeader className="gap-1">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="size-4 text-muted-foreground" aria-hidden />
            {daily ? '近 14 天活动' : '采集 / 发送吞吐'}
          </CardTitle>
          <CardDescription className="mt-1">
            {stressMode
              ? '完整渲染 5,000 条确定性模拟时序数据，用于前端压力验证'
              : daily
                ? '每日运行与新增记录趋势'
                : '近 30 分钟每分钟任务完成量'}
          </CardDescription>
        </div>
        <CardAction>
          <Button
            type="button"
            size="sm"
            variant={stressMode ? 'secondary' : 'outline'}
            className="gap-1.5"
            aria-pressed={stressMode}
            onClick={() => setStressMode((active) => !active)}
          >
            <DatabaseZap className="size-3.5" aria-hidden />
            {stressMode ? '返回实时数据' : '5,000 点压力测试'}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-64 w-full" initialDimension={{ width: 720, height: 256 }}>
          <AreaChart data={chartData} margin={{ left: -12, right: 8, top: 4 }} accessibilityLayer>
            <defs>
              <linearGradient id="fillCollected" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-collected)" stopOpacity={0.35} />
                <stop offset="95%" stopColor="var(--color-collected)" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="fillDispatched" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-dispatched)" stopOpacity={0.35} />
                <stop offset="95%" stopColor="var(--color-dispatched)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis
              dataKey="time"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={40}
              tickFormatter={stressMode ? (value) => `#${value}` : undefined}
            />
            <YAxis tickLine={false} axisLine={false} tickMargin={4} width={40} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Area
              dataKey="collected"
              type="monotone"
              fill="url(#fillCollected)"
              stroke="var(--color-collected)"
              strokeWidth={1.5}
              isAnimationActive={false}
              connectNulls
            />
            <Area
              dataKey="dispatched"
              type="monotone"
              fill="url(#fillDispatched)"
              stroke="var(--color-dispatched)"
              strokeWidth={1.5}
              isAnimationActive={false}
              connectNulls
            />
            <Area
              dataKey="failed"
              type="monotone"
              fill="transparent"
              stroke="var(--color-failed)"
              strokeWidth={1}
              strokeDasharray="4 3"
              isAnimationActive={false}
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
