'use client'

import { Bar, BarChart, CartesianGrid, Cell, LabelList, Pie, PieChart, XAxis, YAxis } from 'recharts'

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'

export type DistributionDatum = {
  key: string
  label: string
  value: number
  color: string
}

export function DonutChart({
  data,
  ariaLabel,
  centerLabel = '总计',
}: {
  data: DistributionDatum[]
  ariaLabel: string
  centerLabel?: string
}) {
  const total = data.reduce((sum, item) => sum + item.value, 0)
  const config = Object.fromEntries(
    data.map((item) => [item.key, { label: item.label, color: item.color }]),
  ) satisfies ChartConfig

  return (
    <div className="relative">
      <ChartContainer config={config} className="h-52 w-full" role="img" aria-label={ariaLabel}>
        <PieChart>
          <ChartTooltip content={<ChartTooltipContent nameKey="label" />} />
          <Pie
            data={data}
            dataKey="value"
            nameKey="label"
            innerRadius={54}
            outerRadius={82}
            paddingAngle={2}
            strokeWidth={0}
            isAnimationActive={false}
          >
            {data.map((item) => (
              <Cell key={item.key} fill={item.color} />
            ))}
          </Pie>
        </PieChart>
      </ChartContainer>
      <div className="pointer-events-none absolute inset-0 grid place-items-center text-center" aria-hidden>
        <div>
          <div className="font-mono text-2xl font-semibold tabular-nums">{total.toLocaleString()}</div>
          <div className="text-[10px] text-muted-foreground">{centerLabel}</div>
        </div>
      </div>
      <div className="mt-1 flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs">
        {data.map((item) => (
          <span key={item.key} className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-sm" style={{ backgroundColor: item.color }} aria-hidden />
            <span className="text-muted-foreground">{item.label}</span>
            <span className="font-mono tabular-nums">{item.value}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

export function HorizontalBarChart({
  data,
  ariaLabel,
}: {
  data: DistributionDatum[]
  ariaLabel: string
}) {
  const config = {
    value: { label: '数量', color: 'var(--chart-2)' },
  } satisfies ChartConfig

  return (
    <ChartContainer config={config} className="h-56 w-full" role="img" aria-label={ariaLabel}>
      <BarChart data={data} layout="vertical" margin={{ left: 0, right: 28, top: 4, bottom: 4 }}>
        <CartesianGrid horizontal={false} strokeDasharray="3 3" />
        <XAxis type="number" hide />
        <YAxis
          dataKey="label"
          type="category"
          axisLine={false}
          tickLine={false}
          width={76}
          tickMargin={8}
        />
        <ChartTooltip content={<ChartTooltipContent hideLabel />} />
        <Bar dataKey="value" radius={[0, 4, 4, 0]} isAnimationActive={false}>
          {data.map((item) => (
            <Cell key={item.key} fill={item.color} />
          ))}
          <LabelList dataKey="value" position="right" className="fill-foreground font-mono text-[10px]" />
        </Bar>
      </BarChart>
    </ChartContainer>
  )
}
