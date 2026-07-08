'use client'

import { useNodes } from '@/lib/api/hooks'
import { formatRelative } from '@/lib/format'
import { BACKEND_HINT, EmptyState, ErrorState, LoadingState } from '@/components/shell/data-states'
import { PageContainer } from '@/components/shell/page-container'
import { RouteTabs, COMPUTE_TABS } from '@/components/shell/route-tabs'
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

export default function NodesPage() {
  const { data, isLoading, isError, error } = useNodes()
  const nodes = data?.data ?? []

  return (
    <PageContainer
      title="节点与 Worker"
      description="边缘浏览器采集节点及其在线状态"
      tabs={<RouteTabs tabs={COMPUTE_TABS} />}
    >
      {isLoading ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState message={(error as Error)?.message} hint={BACKEND_HINT} />
      ) : nodes.length === 0 ? (
        <EmptyState title="暂无节点" description="部署边缘节点代理以扩展浏览器采集能力。" />
      ) : (
        <Card className="overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>标签</TableHead>
                <TableHead>地址</TableHead>
                <TableHead>类型</TableHead>
                <TableHead>模式</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>最近在线</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {nodes.map((n) => (
                <TableRow key={n.id}>
                  <TableCell className="font-medium">{n.label}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{n.url}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{n.node_type === 'docker' ? 'Docker' : 'Shell'}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{n.mode.toUpperCase()}</Badge>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={n.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatRelative(n.last_seen_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </PageContainer>
  )
}
