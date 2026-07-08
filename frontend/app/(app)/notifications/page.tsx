'use client'

import { useNotificationRules } from '@/lib/api/hooks'
import { BACKEND_HINT, EmptyState, ErrorState, LoadingState } from '@/components/shell/data-states'
import { PageContainer } from '@/components/shell/page-container'
import { RouteTabs, RUN_CENTER_TABS } from '@/components/shell/route-tabs'
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

const NOTIFIER_LABEL: Record<string, string> = {
  webhook: 'Webhook',
  email: '邮件',
  slack: 'Slack',
  feishu: '飞书',
  dingtalk: '钉钉',
}

export default function NotificationsPage() {
  const { data, isLoading, isError, error } = useNotificationRules()
  const rules = data?.data ?? []

  return (
    <PageContainer
      title="运行中心"
      description="采集事件触发的通知规则"
      tabs={<RouteTabs tabs={RUN_CENTER_TABS} />}
    >
      {isLoading ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState message={(error as Error)?.message} hint={BACKEND_HINT} />
      ) : rules.length === 0 ? (
        <EmptyState title="暂无通知规则" description="创建规则以在采集事件发生时收到通知。" />
      ) : (
        <Card className="overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>名称</TableHead>
                <TableHead>触发事件</TableHead>
                <TableHead>通知方式</TableHead>
                <TableHead>状态</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell>
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                      {r.trigger_event}
                    </code>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {NOTIFIER_LABEL[r.notifier_type] ?? r.notifier_type}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={r.enabled ? 'enabled' : 'disabled'} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </PageContainer>
  )
}
