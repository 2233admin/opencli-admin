'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, KeyRound, Loader2, Pencil, Plug, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { useDeleteProvider, useProviders, useTestProvider } from '@/lib/api/hooks'
import type { ConnectionTestResult, ModelProvider } from '@/lib/api/types'
import { ProviderCatalogPanel } from '@/components/providers/provider-catalog-panel'
import { ProviderFormDialog } from '@/components/providers/provider-form-dialog'
import { BACKEND_HINT, EmptyState, ErrorState, LoadingState } from '@/components/shell/data-states'
import { StatusBadge } from '@/components/shell/status-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const TYPE_LABEL: Record<string, string> = {
  claude: 'Claude',
  openai: 'OpenAI',
  local: '本地兼容',
}

export function ProviderManagementPanel() {
  const { data, isLoading, isError, error } = useProviders()
  const providers = data?.data ?? []
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<Record<string, ConnectionTestResult>>({})
  const testMutation = useTestProvider()
  const deleteMutation = useDeleteProvider()

  const handleTest = (provider: ModelProvider) => {
    testMutation.mutate(provider.id, {
      onSuccess: (result) => setTestResults((current) => ({ ...current, [provider.id]: result })),
      onError: (cause: Error) => toast.error(cause.message),
    })
  }

  const handleDelete = (provider: ModelProvider) => {
    if (confirmDeleteId !== provider.id) {
      setConfirmDeleteId(provider.id)
      return
    }
    deleteMutation.mutate(provider.id, {
      onSuccess: () => {
        toast.success('已删除供应商')
        setConfirmDeleteId(null)
      },
      onError: (cause: Error) => toast.error(cause.message),
    })
  }

  if (isLoading) return <LoadingState />
  if (isError) return <ErrorState message={(error as Error)?.message} hint={BACKEND_HINT} />

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">供应商</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            管理连接档案。模型会从供应商自动获取，手动目录放在展开项中。
          </p>
        </div>
        <ProviderFormDialog
          mode="create"
          triggerLabel="添加供应商"
          triggerIcon={<Plus className="size-4" />}
        />
      </div>

      {providers.length === 0 ? (
        <EmptyState title="暂无供应商" description="添加一个供应商后，系统会自动获取可用模型。" />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {providers.map((provider) => {
            const expanded = expandedId === provider.id
            const testResult = testResults[provider.id]
            const testing = testMutation.isPending && testMutation.variables === provider.id

            return (
              <Card key={provider.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-primary">
                        <KeyRound className="size-4" />
                      </span>
                      <div className="min-w-0">
                        <CardTitle className="truncate text-sm">{provider.name}</CardTitle>
                        <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                          {provider.base_url || '官方默认地址'}
                        </p>
                      </div>
                    </div>
                    <StatusBadge status={provider.enabled ? 'enabled' : 'disabled'} />
                  </div>
                </CardHeader>

                <CardContent className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">
                      {TYPE_LABEL[provider.provider_type] ?? provider.provider_type}
                    </Badge>
                    {provider.default_model ? (
                      <Badge variant="outline">{provider.default_model}</Badge>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/15 px-3 py-2.5">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <KeyRound className="size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <p className="text-xs font-medium">访问凭证</p>
                        <p className="text-xs text-muted-foreground">
                          {provider.has_api_key ? 'API Key 已安全保存' : '尚未配置 API Key'}
                        </p>
                      </div>
                    </div>
                    <ProviderFormDialog
                      mode="edit"
                      provider={provider}
                      triggerLabel={provider.has_api_key ? '更新密钥' : '配置密钥'}
                      triggerVariant="outline"
                      triggerSize="xs"
                    />
                  </div>

                  {testResult ? (
                    <p className={testResult.ok ? 'text-xs text-success' : 'text-xs text-destructive'}>
                      {testResult.ok
                        ? `连接正常 · ${testResult.latency_ms ?? '—'}ms`
                        : testResult.error ?? '连接失败'}
                    </p>
                  ) : null}

                  <div className="flex flex-wrap items-center gap-1.5">
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={testing}
                      onClick={() => handleTest(provider)}
                      className="gap-1"
                    >
                      {testing ? <Loader2 className="size-3 animate-spin" /> : <Plug className="size-3" />}
                      测试
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => setExpandedId(expanded ? null : provider.id)}
                      className="gap-1"
                    >
                      {expanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                      模型
                    </Button>
                    <ProviderFormDialog
                      mode="edit"
                      provider={provider}
                      triggerLabel="连接设置"
                      triggerIcon={<Pencil className="size-3" />}
                      triggerVariant="ghost"
                      triggerSize="xs"
                    />
                    <Button
                      size="xs"
                      variant={confirmDeleteId === provider.id ? 'destructive' : 'ghost'}
                      disabled={deleteMutation.isPending}
                      onClick={() => handleDelete(provider)}
                      className="gap-1"
                    >
                      <Trash2 className="size-3" />
                      {confirmDeleteId === provider.id ? '确认删除' : '删除'}
                    </Button>
                  </div>

                  {expanded ? <ProviderCatalogPanel provider={provider} /> : null}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
