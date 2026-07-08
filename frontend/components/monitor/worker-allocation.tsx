'use client'

import { ArrowDownToLine, Send } from 'lucide-react'

import type { WorkerView } from '@/lib/demo/monitor'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'

function loadTone(load: number): string {
  if (load >= 85) return 'text-destructive'
  if (load >= 65) return 'text-warning'
  return 'text-muted-foreground'
}

function WorkerRow({ worker }: { worker: WorkerView }) {
  const LaneIcon = worker.lane === 'collect' ? ArrowDownToLine : Send
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              'size-1.5 shrink-0 rounded-full',
              worker.online ? 'bg-success' : 'bg-muted-foreground/40',
            )}
            aria-hidden
          />
          <LaneIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate font-mono text-xs">{worker.name}</span>
          <Badge variant="outline" className="shrink-0 text-[10px]">
            {worker.region}
          </Badge>
        </div>
        <span className={cn('font-mono text-xs tabular-nums', loadTone(worker.load))}>
          {worker.online ? `${worker.load}%` : '离线'}
        </span>
      </div>
      <Progress value={worker.online ? worker.load : 0} className="h-1" />
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="truncate">{worker.current ?? (worker.online ? '空闲' : '—')}</span>
        <span className="shrink-0 tabular-nums">
          队列 {worker.queue} · 今日 {worker.doneToday}
          {worker.failedToday > 0 ? <span className="text-destructive"> · 失败 {worker.failedToday}</span> : null}
        </span>
      </div>
    </div>
  )
}

export function WorkerAllocation({ workers }: { workers: WorkerView[] }) {
  const collectors = workers.filter((w) => w.lane === 'collect')
  const dispatchers = workers.filter((w) => w.lane === 'dispatch')
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">任务分配 · Worker 负载</CardTitle>
        <CardDescription>采集与发送两条通道的实时分配情况</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {workers.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">暂无 Worker 心跳上报</p>
        ) : null}
        {collectors.length > 0 ? (
          <div className="flex flex-col gap-2">
            <span className="eyebrow-mono">采集通道</span>
            <div className="flex flex-col gap-2">
              {collectors.map((w) => (
                <WorkerRow key={w.id} worker={w} />
              ))}
            </div>
          </div>
        ) : null}
        {dispatchers.length > 0 ? (
          <div className="flex flex-col gap-2">
            <span className="eyebrow-mono">发送通道</span>
            <div className="flex flex-col gap-2">
              {dispatchers.map((w) => (
                <WorkerRow key={w.id} worker={w} />
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
