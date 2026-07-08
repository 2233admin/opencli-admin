'use client'

import { useControlActions } from '@/lib/api/hooks'
import { formatRelative } from '@/lib/format'
import { BACKEND_HINT, EmptyState, ErrorState, LoadingState } from '@/components/shell/data-states'
import { PageContainer } from '@/components/shell/page-container'
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

export default function ControlActionsPage() {
  const { data, isLoading, isError, error } = useControlActions()
  const actions = data?.data ?? []

  return (
    <PageContainer
      title="控制动作"
      description="控制器的证据台账 — 每一次建议与执行的审计记录"
    >
      {isLoading ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState message={(error as Error)?.message} hint={BACKEND_HINT} />
      ) : actions.length === 0 ? (
        <EmptyState title="暂无控制动作" description="控制器产生建议或执行动作后，记录会显示在此。" />
      ) : (
        <Card className="overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>动作类型</TableHead>
                <TableHead>状态类别</TableHead>
                <TableHead>模式</TableHead>
                <TableHead>是否执行</TableHead>
                <TableHead>结果</TableHead>
                <TableHead>时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {actions.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-mono text-xs font-medium">{a.action_type}</TableCell>
                  <TableCell>
                    <StatusBadge status={a.state} />
                  </TableCell>
                  <TableCell>
                    <Badge variant={a.mode === 'automatic' ? 'default' : 'outline'}>
                      {a.mode === 'automatic' ? '自动' : '建议'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {a.executed ? (
                      <Badge variant="secondary">已执行</Badge>
                    ) : (
                      <span className="text-muted-foreground">未执行</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {a.outcome ? (
                      <StatusBadge status={a.outcome} />
                    ) : (
                      <span className="text-muted-foreground">待评估</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatRelative(a.created_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </PageContainer>
  )
}
