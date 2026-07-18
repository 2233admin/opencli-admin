'use client'

import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react'
import { toast } from 'sonner'

import { useModelDefaults, useProviderModels, usePutModelDefault } from '@/lib/api/hooks'
import type { ModelDefaultCandidate, ModelProvider, ModelRole } from '@/lib/api/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'

const ROLE_META: Record<ModelRole, { label: string; description: string }> = {
  chat: { label: '对话', description: 'Agent 对话使用的模型' },
  executor: { label: '执行', description: '自动化执行使用的模型' },
  enrichment: { label: '内容处理', description: '提取、总结和内容处理使用的模型' },
}

const ROLES: ModelRole[] = ['chat', 'executor', 'enrichment']

function candidatesEqual(a: ModelDefaultCandidate[], b: ModelDefaultCandidate[]) {
  if (a.length !== b.length) return false
  return a.every((c, i) => c.provider_id === b[i].provider_id && c.model_id === b[i].model_id)
}

function RoleEditor({
  role,
  initialCandidates,
  providers,
}: {
  role: ModelRole
  initialCandidates: ModelDefaultCandidate[]
  providers: ModelProvider[]
}) {
  const [candidates, setCandidates] = useState<ModelDefaultCandidate[]>(initialCandidates)
  const [synced, setSynced] = useState<ModelDefaultCandidate[]>(initialCandidates)
  const [pickerProviderId, setPickerProviderId] = useState('')
  const [pickerModelId, setPickerModelId] = useState('')
  const putDefault = usePutModelDefault()
  // Only fetch the picker provider's catalog once one is actually chosen —
  // falls back to a free-text model_id input if the catalog hasn't loaded.
  const providerModels = useProviderModels(pickerProviderId || null)

  // Re-seed the draft whenever the server-backed value for this role changes
  // (e.g. after a save elsewhere invalidates ['model-defaults']).
  useEffect(() => {
    setCandidates(initialCandidates)
    setSynced(initialCandidates)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(initialCandidates)])

  const providerName = (id: string) => providers.find((p) => p.id === id)?.name ?? id

  const move = (index: number, dir: -1 | 1) => {
    setCandidates((list) => {
      const target = index + dir
      if (target < 0 || target >= list.length) return list
      const next = [...list]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  const remove = (index: number) => setCandidates((list) => list.filter((_, i) => i !== index))

  const add = () => {
    if (!pickerProviderId || !pickerModelId.trim()) return
    setCandidates((list) => [...list, { provider_id: pickerProviderId, model_id: pickerModelId.trim() }])
    setPickerModelId('')
  }

  const dirty = !candidatesEqual(candidates, synced)
  const availableModels = providerModels.data?.data ?? []

  const save = () => {
    putDefault.mutate(
      { role, candidates },
      {
        onSuccess: (result) => {
          toast.success(`已保存「${ROLE_META[role].label}」模型路由`)
          setSynced(result.candidates)
        },
        onError: (e: Error) => toast.error(e.message),
      },
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <span className="text-sm font-medium">{ROLE_META[role].label}</span>
          <span className="ml-2 text-xs text-muted-foreground">{ROLE_META[role].description}</span>
        </div>
        <Button size="xs" disabled={!dirty || putDefault.isPending} onClick={save}>
          {putDefault.isPending ? '保存中…' : '保存'}
        </Button>
      </div>

      {candidates.length === 0 ? (
        <p className="text-xs text-muted-foreground">尚未配置候选模型。</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {candidates.map((c, i) => (
            <li
              key={`${c.provider_id}-${c.model_id}-${i}`}
              className="flex items-center gap-2 rounded-md border px-2 py-1 text-xs"
            >
              <span className="text-muted-foreground">{i + 1}.</span>
              <span className="flex-1 truncate">
                {providerName(c.provider_id)} · <span className="font-mono">{c.model_id}</span>
              </span>
              <Button size="icon-xs" variant="ghost" disabled={i === 0} onClick={() => move(i, -1)}>
                <ArrowUp className="size-3" />
              </Button>
              <Button
                size="icon-xs"
                variant="ghost"
                disabled={i === candidates.length - 1}
                onClick={() => move(i, 1)}
              >
                <ArrowDown className="size-3" />
              </Button>
              <Button size="icon-xs" variant="ghost" onClick={() => remove(i)}>
                <X className="size-3" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={pickerProviderId}
          onValueChange={(v) => {
            setPickerProviderId(v as string)
            setPickerModelId('')
          }}
        >
          <SelectTrigger size="sm" className="w-40">
            <SelectValue placeholder="选择供应商" />
          </SelectTrigger>
          <SelectContent>
            {providers.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {pickerProviderId && availableModels.length > 0 ? (
          <Select value={pickerModelId} onValueChange={(v) => setPickerModelId(v as string)}>
            <SelectTrigger size="sm" className="w-48">
              <SelectValue placeholder="选择模型" />
            </SelectTrigger>
            <SelectContent>
              {availableModels.map((m) => (
                <SelectItem key={m.id} value={m.model_id}>
                  {m.model_id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            value={pickerModelId}
            onChange={(e) => setPickerModelId(e.target.value)}
            placeholder="model_id"
            className="h-7 w-48 text-xs"
          />
        )}

        <Button
          size="xs"
          variant="outline"
          disabled={!pickerProviderId || !pickerModelId.trim()}
          onClick={add}
          className="gap-1"
        >
          <Plus className="size-3" />
          添加候选
        </Button>
      </div>
    </div>
  )
}

export function ModelDefaultsCard({ providers }: { providers: ModelProvider[] }) {
  const { data, isLoading, isError, error } = useModelDefaults()
  const defaultsByRole = new Map((data?.data ?? []).map((d) => [d.role, d.candidates]))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">高级模型路由</CardTitle>
        <CardDescription>
          可选设置。只有需要按场景拆分模型或配置故障转移时才需要修改。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {isLoading ? (
          <p className="text-xs text-muted-foreground">加载中…</p>
        ) : isError ? (
          <p className="text-xs text-destructive">{(error as Error)?.message ?? '加载失败'}</p>
        ) : (
          ROLES.map((role, i) => (
            <div key={role}>
              {i > 0 ? <Separator className="mb-4" /> : null}
              <RoleEditor role={role} initialCandidates={defaultsByRole.get(role) ?? []} providers={providers} />
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}
