'use client'

import { Activity, AlertTriangle, CircleCheck } from 'lucide-react'

import type { FailureItem, StreamTask } from '@/lib/demo/monitor'
import { formatDuration, formatRelative } from '@/lib/format'
import { StatusBadge } from '@/components/shell/status-badge'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

const PHASE_STATUS: Record<StreamTask['phase'], string> = {
  queued: 'queued',
  running: 'running',
  success: 'success',
  failed: 'failed',
}

export function TaskStream({ tasks }: { tasks: StreamTask[] }) {
  return (
    <Card size="sm" className="h-full">
      <CardHeader className="border-b">
        <CardTitle className="text-base">实时任务流</CardTitle>
        <CardDescription>最近排队、执行与完成的采集/发送任务</CardDescription>
        <CardAction>
          <Badge variant="outline" className="font-mono tabular-nums">
            {tasks.length} 项
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        {tasks.length === 0 ? (
          <div
            data-stream-empty
            className="flex min-h-20 items-center gap-3 rounded-lg border border-dashed bg-muted/15 px-4 py-3"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
              <Activity className="size-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium">当前没有排队或运行中的任务</p>
              <p className="mt-0.5 text-xs text-muted-foreground">任务启动后，这里会按时间显示执行状态与产出。</p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table aria-label="最近任务流">
              <TableHeader>
                <TableRow>
                  <TableHead>任务</TableHead>
                  <TableHead>通道</TableHead>
                  <TableHead>Worker</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="text-right">记录数</TableHead>
                  <TableHead className="text-right">耗时</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tasks.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="max-w-52">
                      <span className="block truncate font-medium">{t.title}</span>
                      {t.retries > 0 ? (
                        <span className="text-xs text-warning">重试 ×{t.retries}</span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">
                        {t.lane === 'collect' ? '采集' : '发送'}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{t.workerName}</TableCell>
                    <TableCell>
                      <StatusBadge status={PHASE_STATUS[t.phase]} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {t.phase === 'queued' ? '—' : t.records}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {formatDuration(t.durationMs)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function FailureFeed({ failures }: { failures: FailureItem[] }) {
  return (
    <Card size="sm" className="h-full">
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="size-4 text-destructive" aria-hidden />
          失败与重试
        </CardTitle>
        <CardDescription>需要关注的最近失败任务</CardDescription>
        <CardAction>
          <Badge variant={failures.length ? 'destructive' : 'outline'} className="font-mono tabular-nums">
            {failures.length} 项
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {failures.length === 0 ? (
          <div className="flex min-h-20 items-center gap-3 rounded-lg border border-dashed bg-muted/15 px-4 py-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-success/10 text-success">
              <CircleCheck className="size-4" aria-hidden />
            </span>
            <div>
              <p className="text-sm font-medium">当前没有失败任务</p>
              <p className="mt-0.5 text-xs text-muted-foreground">异常任务出现后会集中显示在这里。</p>
            </div>
          </div>
        ) : (
          failures.map((f) => (
            <div key={f.id} className="flex flex-col gap-1 rounded-lg border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{f.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{formatRelative(new Date(f.at).toISOString())}</span>
              </div>
              <p className="text-xs text-destructive">{f.error}</p>
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="font-mono">{f.workerName}</span>
                <span>
                  {f.lane === 'collect' ? '采集' : '发送'}
                  {f.retries > 0 ? ` · 已重试 ${f.retries} 次` : ' · 未重试'}
                </span>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}
