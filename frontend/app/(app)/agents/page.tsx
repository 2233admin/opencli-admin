'use client'

import { Bot } from 'lucide-react'

import { useAgents } from '@/lib/api/hooks'
import { BACKEND_HINT, EmptyState, ErrorState, LoadingState } from '@/components/shell/data-states'
import { PageContainer } from '@/components/shell/page-container'
import { AUTOMATION_TABS, RouteTabs } from '@/components/shell/route-tabs'
import { StatusBadge } from '@/components/shell/status-badge'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const PROCESSOR_LABEL: Record<string, string> = {
  claude: 'Claude',
  openai: 'OpenAI',
  local: '本地模型',
}

export default function AgentsPage() {
  const { data, isLoading, isError, error } = useAgents()
  const agents = data?.data ?? []

  return (
    <PageContainer
      eyebrow="Automation"
      title="自动化与 Agent"
      description="管理负责分析、判断和富化采集数据的 Agent。"
      tabs={<RouteTabs tabs={AUTOMATION_TABS} />}
    >
      {isLoading ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState message={(error as Error)?.message} hint={BACKEND_HINT} />
      ) : agents.length === 0 ? (
        <EmptyState title="暂无智能体" description="创建 AI 智能体以处理采集到的数据。" />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {agents.map((a) => (
            <Card key={a.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="flex size-8 items-center justify-center rounded-md bg-muted text-chart-3">
                      <Bot className="size-4" />
                    </span>
                    <CardTitle className="text-base">{a.name}</CardTitle>
                  </div>
                  <StatusBadge status={a.enabled ? 'enabled' : 'disabled'} />
                </div>
                {a.description ? (
                  <CardDescription className="line-clamp-2">{a.description}</CardDescription>
                ) : null}
              </CardHeader>
              <CardContent className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{PROCESSOR_LABEL[a.processor_type] ?? a.processor_type}</Badge>
                {a.model ? <Badge variant="outline">{a.model}</Badge> : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </PageContainer>
  )
}
