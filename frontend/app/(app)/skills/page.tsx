'use client'

import { useSkills } from '@/lib/api/hooks'
import { formatNumber } from '@/lib/format'
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

export default function SkillsPage() {
  const { data, isLoading, isError, error } = useSkills()
  const skills = data?.data ?? []

  return (
    <PageContainer
      eyebrow="Automation"
      title="自动化与 Agent"
      description="管理录制、蒸馏和纠错循环产出的浏览器技能。"
      tabs={<RouteTabs tabs={AUTOMATION_TABS} />}
    >
      {isLoading ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState message={(error as Error)?.message} hint={BACKEND_HINT} />
      ) : skills.length === 0 ? (
        <EmptyState title="暂无技能" description="录制一次浏览器操作演示以蒸馏出可复用技能。" />
      ) : (
        <Card className="overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>名称</TableHead>
                <TableHead>领域 / 能力</TableHead>
                <TableHead>版本</TableHead>
                <TableHead>证据数</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>待处理提案</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {skills.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    <span className="font-mono text-xs">{s.domain}</span>
                    <span className="mx-1 text-muted-foreground/50">/</span>
                    <span className="font-mono text-xs">{s.capability}</span>
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">v{s.version}</TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {formatNumber(s.evidence_count)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={s.enabled ? 'enabled' : 'disabled'} />
                  </TableCell>
                  <TableCell>
                    {s.has_open_proposal ? (
                      <Badge variant="secondary" className="bg-warning/10 text-warning">
                        待复核
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
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
