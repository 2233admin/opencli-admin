'use client'

import { use } from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowLeft, ShieldQuestion } from 'lucide-react'

import { useSource, useSourceControlState, useSourceMeasurements } from '@/lib/api/hooks'
import type { SensorConfidence } from '@/lib/api/types'
import { formatDateTime, formatDuration, formatNumber } from '@/lib/format'
import { BACKEND_HINT, EmptyState, ErrorState, LoadingState } from '@/components/shell/data-states'
import { PageContainer } from '@/components/shell/page-container'
import { StatusBadge } from '@/components/shell/status-badge'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'

const CONFIDENCE_META: Record<SensorConfidence, { tone: string; label: string }> = {
  high: { tone: 'text-success', label: '高' },
  medium: { tone: 'text-warning', label: '中' },
  low: { tone: 'text-destructive', label: '低' },
}

const SIGNAL_LABEL: Record<string, string> = {
  run: '运行记录',
  cursor: '游标推进',
  freshness: '新鲜度',
  error_kinds: '错误分类',
  odp: 'ODP 数据面',
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border p-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-lg font-semibold tabular-nums">{value}</span>
    </div>
  )
}

export default function SourceControlRoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const source = useSource(id)
  const control = useSourceControlState(id)
  const measurements = useSourceMeasurements(id, { limit: 20 })

  const cs = control.data
  const m = cs?.measurement
  const confidence = cs?.confidence ? CONFIDENCE_META[cs.confidence] : null

  return (
    <PageContainer
      title={source.data?.name ?? '数据源控制室'}
      description="传感器诚实视图 · 未采集到的信号绝不伪装为健康"
      actions={
        <Link href="/sources" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>
          <ArrowLeft className="size-4" />
          返回列表
        </Link>
      }
    >
      {control.isLoading ? (
        <LoadingState rows={3} />
      ) : control.isError ? (
        <ErrorState message={(control.error as Error)?.message} hint={BACKEND_HINT} />
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">控制状态</CardTitle>
                {cs?.control_state ? (
                  <StatusBadge status={cs.control_state} />
                ) : (
                  <Badge variant="outline">未测量</Badge>
                )}
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex items-center gap-2 text-sm">
                  <ShieldQuestion className="size-4 text-muted-foreground" />
                  <span className="text-muted-foreground">传感器置信度</span>
                  {confidence ? (
                    <span className={`font-semibold ${confidence.tone}`}>{confidence.label}</span>
                  ) : (
                    <span className="font-semibold text-muted-foreground">不可用</span>
                  )}
                </div>

                {m ? (
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Metric label="已接受" value={formatNumber(m.accepted)} />
                    <Metric label="重复" value={formatNumber(m.duplicates)} />
                    <Metric label="拒绝" value={formatNumber(m.rejected)} />
                    <Metric label="错误率" value={`${(m.error_rate * 100).toFixed(1)}%`} />
                    <Metric label="重复率" value={`${(m.duplicate_rate * 100).toFixed(1)}%`} />
                    <Metric label="抓取延迟" value={formatDuration(m.fetch_latency_ms)} />
                  </div>
                ) : (
                  <EmptyState
                    title="尚未产生测量"
                    description="该数据源从未运行，控制状态无法评估。这是合法的“待测量”状态，而非错误。"
                  />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <AlertTriangle className="size-4 text-warning" />
                  缺失信号
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {cs?.sensor_coverage ? (
                  <div className="flex flex-col gap-2">
                    {Object.entries(cs.sensor_coverage).map(([k, ok]) => (
                      <div key={k} className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">{SIGNAL_LABEL[k] ?? k}</span>
                        <StatusBadge status={ok ? 'online' : 'offline'} />
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">暂无传感器覆盖信息。</p>
                )}
                {cs?.missing_signals && cs.missing_signals.length > 0 ? (
                  <div className="rounded-md border border-dashed border-warning/40 bg-warning/5 p-3 text-xs text-muted-foreground">
                    以下信号尚未接入，状态判定据此降级：
                    <div className="mt-2 flex flex-wrap gap-1">
                      {cs.missing_signals.map((sig) => (
                        <Badge key={sig} variant="outline">
                          {SIGNAL_LABEL[sig] ?? sig}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </div>

          <Card className="overflow-hidden py-0">
            <CardHeader className="border-b py-4">
              <CardTitle className="text-base">测量历史</CardTitle>
            </CardHeader>
            {measurements.isLoading ? (
              <div className="p-4">
                <LoadingState rows={3} />
              </div>
            ) : (measurements.data?.data ?? []).length === 0 ? (
              <div className="p-4">
                <EmptyState title="暂无测量记录" description="该数据源尚未产生任何运行测量。" />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>测量时间</TableHead>
                    <TableHead className="text-right">接受</TableHead>
                    <TableHead className="text-right">重复</TableHead>
                    <TableHead className="text-right">错误率</TableHead>
                    <TableHead className="text-right">抓取延迟</TableHead>
                    <TableHead>游标</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(measurements.data?.data ?? []).map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="text-muted-foreground">{formatDateTime(row.measured_at)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(row.accepted)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(row.duplicates)}</TableCell>
                      <TableCell className="text-right tabular-nums">{(row.error_rate * 100).toFixed(1)}%</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {formatDuration(row.fetch_latency_ms)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={row.cursor_advanced ? 'success' : 'disabled'} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </>
      )}
    </PageContainer>
  )
}
