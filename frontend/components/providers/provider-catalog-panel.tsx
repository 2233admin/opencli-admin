'use client'

import { useState } from 'react'
import { Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import {
  useAddProviderModel,
  useDeleteProviderModel,
  useProviderModels,
  useSyncProviderModels,
  useUpdateProviderModel,
} from '@/lib/api/hooks'
import type { ModelProvider } from '@/lib/api/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const SOURCE_LABEL: Record<string, string> = {
  discovered: '自动发现',
  manual: '手动添加',
}

// Lazily-mounted panel — only rendered by the parent card while expanded, so
// useProviderModels only fires once the operator actually asks to see it.
export function ProviderCatalogPanel({ provider }: { provider: ModelProvider }) {
  const [newModelId, setNewModelId] = useState('')
  const { data, isLoading, isError, error } = useProviderModels(provider.id)
  const sync = useSyncProviderModels()
  const addModel = useAddProviderModel()
  const updateModel = useUpdateProviderModel()
  const deleteModel = useDeleteProviderModel()

  const models = data?.data ?? []

  const handleSync = () => {
    sync.mutate(provider.id, {
      onSuccess: (result) => {
        toast.success(
          `新增 ${result.added} · 更新 ${result.updated} · 保留手动 ${result.kept_manual} · 清理 ${result.pruned}`,
        )
      },
      onError: (e: Error) => toast.error(e.message),
    })
  }

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault()
    const modelId = newModelId.trim()
    if (!modelId) return
    addModel.mutate(
      { providerId: provider.id, data: { model_id: modelId } },
      {
        onSuccess: () => {
          toast.success('已添加模型')
          setNewModelId('')
        },
        onError: (e: Error) => toast.error(e.message),
      },
    )
  }

  return (
    <div className="flex flex-col gap-3 border-t pt-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">模型目录</span>
        <Button size="xs" variant="outline" disabled={sync.isPending} onClick={handleSync} className="gap-1">
          {sync.isPending ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <RefreshCw className="size-3" />
          )}
          同步
        </Button>
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">加载中…</p>
      ) : isError ? (
        <p className="text-xs text-destructive">{(error as Error)?.message ?? '加载模型目录失败'}</p>
      ) : models.length === 0 ? (
        <p className="text-xs text-muted-foreground">暂无模型，点击「同步」自动发现，或在下方手动添加。</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>模型 ID</TableHead>
              <TableHead>类型</TableHead>
              <TableHead>来源</TableHead>
              <TableHead className="text-right">启用</TableHead>
              <TableHead className="w-8" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {models.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="font-mono text-xs">{m.model_id}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{m.model_type}</TableCell>
                <TableCell>
                  <Badge variant={m.source === 'manual' ? 'outline' : 'secondary'}>
                    {SOURCE_LABEL[m.source] ?? m.source}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Switch
                    checked={m.enabled}
                    disabled={updateModel.isPending}
                    onCheckedChange={(v) =>
                      updateModel.mutate(
                        { providerId: provider.id, modelRowId: m.id, data: { enabled: v } },
                        { onError: (e: Error) => toast.error(e.message) },
                      )
                    }
                    aria-label="启用/停用模型"
                  />
                </TableCell>
                <TableCell>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    disabled={deleteModel.isPending}
                    onClick={() =>
                      deleteModel.mutate(
                        { providerId: provider.id, modelRowId: m.id },
                        {
                          onSuccess: () => toast.success('已删除模型'),
                          onError: (e: Error) => toast.error(e.message),
                        },
                      )
                    }
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <form onSubmit={handleAdd} className="flex items-center gap-2">
        <Input
          value={newModelId}
          onChange={(e) => setNewModelId(e.target.value)}
          placeholder="手动添加 model_id，例如 gpt-4o-mini"
          className="h-7 text-xs"
        />
        <Button
          type="submit"
          size="xs"
          variant="outline"
          disabled={addModel.isPending || !newModelId.trim()}
          className="gap-1"
        >
          <Plus className="size-3" />
          添加
        </Button>
      </form>
    </div>
  )
}
