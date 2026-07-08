'use client'

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts'

import type { ThroughputPoint } from '@/lib/demo/monitor'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'

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
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{daily ? '近 14 天活动' : '采集 / 发送吞吐'}</CardTitle>
        <CardDescription>
          {daily ? '每日运行与新增记录趋势' : '近 30 分钟每分钟任务完成量'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-56 w-full">
          <AreaChart data={data} margin={{ left: -12, right: 8, top: 4 }}>
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
            <XAxis dataKey="time" tickLine={false} axisLine={false} tickMargin={8} minTickGap={40} />
            <YAxis tickLine={false} axisLine={false} tickMargin={4} width={40} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Area
              dataKey="collected"
              type="monotone"
              fill="url(#fillCollected)"
              stroke="var(--color-collected)"
              strokeWidth={1.5}
              isAnimationActive={false}
            />
            <Area
              dataKey="dispatched"
              type="monotone"
              fill="url(#fillDispatched)"
              stroke="var(--color-dispatched)"
              strokeWidth={1.5}
              isAnimationActive={false}
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
