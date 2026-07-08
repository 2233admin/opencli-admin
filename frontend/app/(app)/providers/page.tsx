'use client'

import { KeyRound } from 'lucide-react'

import { useProviders } from '@/lib/api/hooks'
import { BACKEND_HINT, EmptyState, ErrorState, LoadingState } from '@/components/shell/data-states'
import { PageContainer } from '@/components/shell/page-container'
import { StatusBadge } from '@/components/shell/status-badge'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const TYPE_LABEL: Record<string, string> = {
  claude: 'Claude',
  openai: 'OpenAI',
  local: '本地模型',
}

export default function ProvidersPage() {
  const { data, isLoading, isError, error } = useProviders()
  const providers = data?.data ?? []

  return (
    <PageContainer title="模型供应商" description="AI 模型接入凭证与端点配置">
      {isLoading ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState message={(error as Error)?.message} hint={BACKEND_HINT} />
      ) : providers.length === 0 ? (
        <EmptyState title="暂无供应商" description="添加模型供应商以驱动智能体处理。" />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {providers.map((p) => (
            <Card key={p.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="flex size-8 items-center justify-center rounded-md bg-muted text-primary">
                      <KeyRound className="size-4" />
                    </span>
                    <CardTitle className="text-base">{p.name}</CardTitle>
                  </div>
                  <StatusBadge status={p.enabled ? 'enabled' : 'disabled'} />
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{TYPE_LABEL[p.provider_type] ?? p.provider_type}</Badge>
                  {p.default_model ? <Badge variant="outline">{p.default_model}</Badge> : null}
                </div>
                {p.base_url ? (
                  <p className="truncate font-mono text-xs text-muted-foreground">{p.base_url}</p>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </PageContainer>
  )
}
