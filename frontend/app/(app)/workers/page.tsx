'use client'

import { useWorkers } from '@/lib/api/hooks'
import { formatRelative } from '@/lib/format'
import { BACKEND_HINT, EmptyState, ErrorState, LoadingState } from '@/components/shell/data-states'
import { PageContainer } from '@/components/shell/page-container'
import { RouteTabs, COMPUTE_TABS } from '@/components/shell/route-tabs'
import { StatusBadge } from '@/components/shell/status-badge'
import { Card } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export default function WorkersPage() {
  const { data, isLoading, isError, error } = useWorkers()
  const workers = data?.data ?? []

  return (
    <PageContainer
      title="节点与 Worker"
      description="Celery 任务执行 Worker 节点"
      tabs={<RouteTabs tabs={COMPUTE_TABS} />}
    >
      {isLoading ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState message={(error as Error)?.message} hint={BACKEND_HINT} />
      ) : workers.length === 0 ? (
        <EmptyState title="暂无 Worker" description="启动 Celery Worker 以并行执行采集任务。" />
      ) : (
        <Card className="overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Worker ID</TableHead>
                <TableHead>主机名</TableHead>
                <TableHead>活跃任务</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>最近心跳</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {workers.map((w) => (
                <TableRow key={w.id}>
                  <TableCell className="font-mono text-xs font-medium">{w.worker_id}</TableCell>
                  <TableCell className="text-muted-foreground">{w.hostname}</TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">{w.active_tasks}</TableCell>
                  <TableCell>
                    <StatusBadge status={w.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatRelative(w.last_heartbeat)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </PageContainer>
  )
}
