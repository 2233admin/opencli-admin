'use client'

import { ArrowUpRight } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'

import { useTasks } from '@/lib/api/hooks'
import { formatRelative } from '@/lib/format'
import { BACKEND_HINT, EmptyState, ErrorState, LoadingState } from '@/components/shell/data-states'
import { PageContainer } from '@/components/shell/page-container'
import { ACTION_CENTER_TABS, RouteTabs } from '@/components/shell/route-tabs'
import { StatusBadge } from '@/components/shell/status-badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

const STATUS_FILTERS: { key: string; label: string }[] = [
  { key: '', label: '全部' },
  { key: 'running', label: '运行中' },
  { key: 'completed', label: '已完成' },
  { key: 'failed', label: '失败' },
  { key: 'pending', label: '等待中' },
]

export default function TasksPage() {
  const [status, setStatus] = useState('')
  const { data, isLoading, isError, error } = useTasks(status ? { status } : undefined)
  const tasks = data?.data ?? []

  return (
    <PageContainer
      eyebrow="Task history"
      title="任务与通知"
      description="查看所有采集工作项及其执行状态；需要立即处理的异常会进入待处理视图。"
      tabs={<RouteTabs tabs={ACTION_CENTER_TABS} />}
      actions={
        <div className="flex items-center gap-1 rounded-md border p-0.5">
          {STATUS_FILTERS.map((f) => (
            <Button
              key={f.key}
              size="sm"
              variant={status === f.key ? 'secondary' : 'ghost'}
              className="h-7"
              onClick={() => setStatus(f.key)}
            >
              {f.label}
            </Button>
          ))}
        </div>
      }
    >
      {isLoading ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState message={(error as Error)?.message} hint={BACKEND_HINT} />
      ) : tasks.length === 0 ? (
        <EmptyState title="暂无任务" description="触发采集后，任务会显示在此。" />
      ) : (
        <Card className="overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>数据源</TableHead>
                <TableHead>触发方式</TableHead>
                <TableHead>优先级</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>创建时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.map((t) => (
                <TableRow key={t.id} className="group">
                  <TableCell className="font-medium">
                    <Link href={`/tasks/${t.id}`} className="flex items-center gap-2 hover:underline">
                      <span>{t.source_name ?? t.source_id}</span>
                      <ArrowUpRight className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{t.trigger_type}</TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">{t.priority}</TableCell>
                  <TableCell>
                    <StatusBadge status={t.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatRelative(t.created_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </PageContainer>
  )
}
