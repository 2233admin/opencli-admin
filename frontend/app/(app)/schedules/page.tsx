'use client'

import { useSchedules } from '@/lib/api/hooks'
import { formatDateTime, formatRelative } from '@/lib/format'
import { BACKEND_HINT, EmptyState, ErrorState, LoadingState } from '@/components/shell/data-states'
import { PageContainer } from '@/components/shell/page-container'
import { AUTOMATION_TABS, RouteTabs } from '@/components/shell/route-tabs'
import { StatusBadge } from '@/components/shell/status-badge'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export default function SchedulesPage() {
  const { data, isLoading, isError, error } = useSchedules()
  const schedules = data?.data ?? []

  return (
    <PageContainer
      eyebrow="Automation"
      title="自动化与 Agent"
      description="管理自动化链路的定时触发计划。"
      tabs={<RouteTabs tabs={AUTOMATION_TABS} />}
    >
      {isLoading ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState message={(error as Error)?.message} hint={BACKEND_HINT} />
      ) : schedules.length === 0 ? (
        <EmptyState title="暂无调度" description="创建 Cron 计划以定时触发采集任务。" />
      ) : (
        <Card className="overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>名称</TableHead>
                <TableHead>Cron 表达式</TableHead>
                <TableHead>类型</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>上次运行</TableHead>
                <TableHead>下次运行</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {schedules.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell>
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                      {s.cron_expression}
                    </code>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{s.is_one_time ? '一次性' : '周期'}</Badge>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={s.enabled ? 'enabled' : 'disabled'} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatRelative(s.last_run_at)}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDateTime(s.next_run_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </PageContainer>
  )
}
