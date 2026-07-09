'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, KeyRound, Loader2, Pencil, Plug, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { useDeleteProvider, useProviders, useTestProvider } from '@/lib/api/hooks'
import type { ConnectionTestResult, ModelProvider } from '@/lib/api/types'
import { ModelDefaultsCard } from '@/components/providers/model-defaults-card'
import { ProviderCatalogPanel } from '@/components/providers/provider-catalog-panel'
import { ProviderFormDialog } from '@/components/providers/provider-form-dialog'
import { BACKEND_HINT, EmptyState, ErrorState, LoadingState } from '@/components/shell/data-states'
import { PageContainer } from '@/components/shell/page-container'
import { StatusBadge } from '@/components/shell/status-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const TYPE_LABEL: Record<string, string> = {
  claude: 'Claude',
  openai: 'OpenAI',
  local: '本地模型',
}

export default function ProvidersPage() {
  const { data, isLoading, isError, error } = useProviders()
  const providers = data?.data ?? []

  // Expand/test/delete-confirm state all live only for the current page
  // session — none of this is persisted server-side (GET /providers never
  // returns a last-test-result field), which matches the backend contract.
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<Record<string, ConnectionTestResult>>({})

  const testMutation = useTestProvider()
  const deleteMutation = useDeleteProvider()

  const handleTest = (p: ModelProvider) => {
    testMutation.mutate(p.id, {
      onSuccess: (result) => setTestResults((prev) => ({ ...prev, [p.id]: result })),
      onError: (e: Error) => toast.error(e.message),
    })
  }

  const handleDelete = (p: ModelProvider) => {
    if (confirmDeleteId !== p.id) {
      setConfirmDeleteId(p.id)
      return
    }
    deleteMutation.mutate(p.id, {
      onSuccess: () => {
        toast.success('已删除供应商')
        setConfirmDeleteId(null)
      },
      onError: (e: Error) => toast.error(e.message),
    })
  }

  return (
    <PageContainer
      title="模型供应商"
      description="AI 模型接入凭证与端点配置"
      actions={
        <ProviderFormDialog mode="create" triggerLabel="添加供应商" triggerIcon={<Plus className="size-4" />} />
      }
    >
      {isLoading ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState message={(error as Error)?.message} hint={BACKEND_HINT} />
      ) : providers.length === 0 ? (
        <EmptyState title="暂无供应商" description="添加模型供应商以驱动智能体处理。" />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {providers.map((p) => {
              const expanded = expandedId === p.id
              const testResult = testResults[p.id]
              const testing = testMutation.isPending && testMutation.variables === p.id

              return (
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
                  <CardContent className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">{TYPE_LABEL[p.provider_type] ?? p.provider_type}</Badge>
                      {p.default_model ? <Badge variant="outline">{p.default_model}</Badge> : null}
                      {p.has_api_key ? (
                        <Badge variant="outline" className="font-mono">
                          {p.api_key_preview ?? '已配置密钥'}
                        </Badge>
                      ) : (
                        <Badge variant="destructive">未配置密钥</Badge>
                      )}
                    </div>
                    {p.base_url ? (
                      <p className="truncate font-mono text-xs text-muted-foreground">{p.base_url}</p>
                    ) : null}

                    {testResult ? (
                      <p className={testResult.ok ? 'text-xs text-success' : 'text-xs text-destructive'}>
                        {testResult.ok
                          ? `连接正常 · 延迟 ${testResult.latency_ms ?? '—'}ms`
                          : testResult.error ?? '连接失败'}
                      </p>
                    ) : null}

                    <div className="flex flex-wrap items-center gap-1.5">
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={testing}
                        onClick={() => handleTest(p)}
                        className="gap-1"
                      >
                        {testing ? <Loader2 className="size-3 animate-spin" /> : <Plug className="size-3" />}
                        测试连接
                      </Button>
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => setExpandedId(expanded ? null : p.id)}
                        className="gap-1"
                      >
                        {expanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                        模型目录
                      </Button>
                      <ProviderFormDialog
                        mode="edit"
                        provider={p}
                        triggerLabel="编辑"
                        triggerIcon={<Pencil className="size-3" />}
                        triggerVariant="ghost"
                        triggerSize="xs"
                      />
                      <Button
                        size="xs"
                        variant={confirmDeleteId === p.id ? 'destructive' : 'ghost'}
                        disabled={deleteMutation.isPending}
                        onClick={() => handleDelete(p)}
                        className="gap-1"
                      >
                        <Trash2 className="size-3" />
                        {confirmDeleteId === p.id ? '确认删除？' : '删除'}
                      </Button>
                    </div>

                    {expanded ? <ProviderCatalogPanel provider={p} /> : null}
                  </CardContent>
                </Card>
              )
            })}
          </div>

          <ModelDefaultsCard providers={providers} />
        </>
      )}
    </PageContainer>
  )
}
