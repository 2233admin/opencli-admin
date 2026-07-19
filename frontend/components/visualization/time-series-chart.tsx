'use client'

import { Area, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from 'recharts'

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'

export type TimeSeriesDefinition = {
  key: string
  label: string
  color: string
  variant?: 'area' | 'line'
  dashed?: boolean
}

type TimeSeriesChartProps<TData extends object> = {
  data: TData[]
  xKey: string
  series: TimeSeriesDefinition[]
  ariaLabel: string
  heightClassName?: string
  showLegend?: boolean
}

export function TimeSeriesChart<TData extends object>({
  data,
  xKey,
  series,
  ariaLabel,
  heightClassName = 'h-56',
  showLegend = true,
}: TimeSeriesChartProps<TData>) {
  const config = Object.fromEntries(
    series.map((item) => [item.key, { label: item.label, color: item.color }]),
  ) satisfies ChartConfig

  return (
    <ChartContainer
      config={config}
      className={`${heightClassName} w-full`}
      role="img"
      aria-label={ariaLabel}
    >
      <ComposedChart data={data} margin={{ left: -12, right: 10, top: 6, bottom: 2 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey={xKey} tickLine={false} axisLine={false} tickMargin={8} minTickGap={36} />
        <YAxis tickLine={false} axisLine={false} tickMargin={4} width={42} />
        <ChartTooltip content={<ChartTooltipContent />} />
        {showLegend ? <ChartLegend content={<ChartLegendContent />} /> : null}
        {series.map((item) =>
          item.variant === 'line' ? (
            <Line
              key={item.key}
              dataKey={item.key}
              type="monotone"
              stroke={`var(--color-${item.key})`}
              strokeWidth={1.75}
              strokeDasharray={item.dashed ? '4 3' : undefined}
              dot={false}
              isAnimationActive={false}
            />
          ) : (
            <Area
              key={item.key}
              dataKey={item.key}
              type="monotone"
              fill={`var(--color-${item.key})`}
              fillOpacity={0.12}
              stroke={`var(--color-${item.key})`}
              strokeWidth={1.5}
              isAnimationActive={false}
            />
          ),
        )}
      </ComposedChart>
    </ChartContainer>
  )
}
