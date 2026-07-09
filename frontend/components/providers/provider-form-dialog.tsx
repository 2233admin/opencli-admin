'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { useCreateProvider, useUpdateProvider } from '@/lib/api/hooks'
import type { ModelProvider, ModelProviderInput } from '@/lib/api/types'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

type ProviderType = ModelProvider['provider_type']

interface FormState {
  name: string
  provider_type: ProviderType
  base_url: string
  api_key: string
  default_model: string
  notes: string
  enabled: boolean
}

const EMPTY_FORM: FormState = {
  name: '',
  provider_type: 'openai',
  base_url: '',
  api_key: '',
  default_model: '',
  notes: '',
  enabled: true,
}

// model-hotel is the user's self-hosted OpenAI-compatible gateway (see
// MEMORY.md model-hotel-5080) — base_url below is a placeholder LAN address,
// the user fills in their real endpoint after applying the preset.
const PRESETS: { key: string; label: string; fill: Partial<FormState> }[] = [
  { key: 'claude', label: 'Claude', fill: { provider_type: 'claude', name: 'Claude', base_url: '' } },
  { key: 'openai', label: 'OpenAI', fill: { provider_type: 'openai', name: 'OpenAI', base_url: '' } },
  {
    key: 'model-hotel',
    label: 'model-hotel',
    fill: { provider_type: 'local', name: 'model-hotel', base_url: 'http://localhost:4000/v1' },
  },
]

function providerToForm(p: ModelProvider): FormState {
  return {
    name: p.name,
    provider_type: p.provider_type,
    base_url: p.base_url ?? '',
    api_key: '',
    default_model: p.default_model ?? '',
    notes: p.notes ?? '',
    enabled: p.enabled,
  }
}

export function ProviderFormDialog({
  mode,
  provider,
  triggerLabel,
  triggerIcon,
  triggerVariant = 'default',
  triggerSize = 'sm',
}: {
  mode: 'create' | 'edit'
  /** Required for mode="edit" — the row being edited, prefills the form. */
  provider?: ModelProvider
  triggerLabel: string
  triggerIcon?: React.ReactNode
  triggerVariant?: React.ComponentProps<typeof Button>['variant']
  triggerSize?: React.ComponentProps<typeof Button>['size']
}) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<FormState>(() => (provider ? providerToForm(provider) : EMPTY_FORM))
  const createMutation = useCreateProvider()
  const updateMutation = useUpdateProvider()
  const pending = createMutation.isPending || updateMutation.isPending

  // Reset the draft to the current server row (or blank) every time the
  // dialog opens, so stale edits from a previous open don't leak in.
  useEffect(() => {
    if (open) {
      setForm(provider ? providerToForm(provider) : EMPTY_FORM)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const applyPreset = (fill: Partial<FormState>) => setForm((f) => ({ ...f, ...fill }))

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) {
      toast.error('请填写供应商名称')
      return
    }

    // ModelProviderInput fields are all optional — omit blanks instead of
    // sending empty strings so PATCH's "unset = don't change" semantics hold
    // (matters most for api_key: blank means "leave the stored key alone").
    const payload: ModelProviderInput = {
      name: form.name.trim(),
      provider_type: form.provider_type,
      enabled: form.enabled,
    }
    if (form.base_url.trim()) payload.base_url = form.base_url.trim()
    if (form.default_model.trim()) payload.default_model = form.default_model.trim()
    if (form.notes.trim()) payload.notes = form.notes.trim()
    if (form.api_key.trim()) payload.api_key = form.api_key.trim()

    const onSuccess = () => {
      toast.success(mode === 'create' ? '已添加供应商' : '已更新供应商')
      setOpen(false)
    }
    const onError = (e: Error) => toast.error(e.message)

    if (mode === 'create') {
      createMutation.mutate(payload, { onSuccess, onError })
    } else if (provider) {
      updateMutation.mutate({ id: provider.id, data: payload }, { onSuccess, onError })
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant={triggerVariant} size={triggerSize} />}>
        {triggerIcon}
        {triggerLabel}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{mode === 'create' ? '添加模型供应商' : '编辑模型供应商'}</DialogTitle>
            <DialogDescription>
              {mode === 'create'
                ? 'AI 模型接入凭证与端点配置。'
                : '留空 API Key 表示不修改已保存的凭证。'}
            </DialogDescription>
          </DialogHeader>

          {mode === 'create' ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">快速填充：</span>
              {PRESETS.map((preset) => (
                <Button
                  key={preset.key}
                  type="button"
                  size="xs"
                  variant="outline"
                  onClick={() => applyPreset(preset.fill)}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
          ) : null}

          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="provider-name">名称</FieldLabel>
              <Input
                id="provider-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                required
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="provider-type">类型</FieldLabel>
              <Select
                value={form.provider_type}
                onValueChange={(v) => setForm((f) => ({ ...f, provider_type: v as ProviderType }))}
              >
                <SelectTrigger id="provider-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="claude">Claude</SelectItem>
                  <SelectItem value="openai">OpenAI</SelectItem>
                  <SelectItem value="local">本地模型</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel htmlFor="provider-base-url">Base URL</FieldLabel>
              <Input
                id="provider-base-url"
                placeholder="http://localhost:4000/v1"
                value={form.base_url}
                onChange={(e) => setForm((f) => ({ ...f, base_url: e.target.value }))}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="provider-api-key">API Key</FieldLabel>
              <Input
                id="provider-api-key"
                type="password"
                placeholder={mode === 'edit' ? '（留空则保持不变）' : 'sk-...'}
                value={form.api_key}
                onChange={(e) => setForm((f) => ({ ...f, api_key: e.target.value }))}
                autoComplete="new-password"
              />
              {mode === 'edit' ? (
                <FieldDescription>
                  当前：{provider?.has_api_key ? (provider.api_key_preview ?? '已配置密钥') : '未配置密钥'}
                </FieldDescription>
              ) : null}
            </Field>

            <Field>
              <FieldLabel htmlFor="provider-default-model">默认模型</FieldLabel>
              <Input
                id="provider-default-model"
                value={form.default_model}
                onChange={(e) => setForm((f) => ({ ...f, default_model: e.target.value }))}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="provider-notes">备注</FieldLabel>
              <Input
                id="provider-notes"
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </Field>

            <Field orientation="horizontal" className="items-center justify-between">
              <FieldLabel htmlFor="provider-enabled">启用</FieldLabel>
              <Switch
                id="provider-enabled"
                checked={form.enabled}
                onCheckedChange={(v) => setForm((f) => ({ ...f, enabled: v }))}
              />
            </Field>
          </FieldGroup>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
