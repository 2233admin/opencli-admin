'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, ChevronDown, Eye, EyeOff, KeyRound, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import {
  useCreateProvider,
  useDiscoverProviderModels,
  useProviderModels,
  useSyncProviderModels,
  useUpdateProvider,
} from '@/lib/api/hooks'
import type { ModelProvider, ModelProviderInput } from '@/lib/api/types'
import { getProviderPreset, type ProviderPreset } from '@/lib/provider-presets'
import {
  ProviderPresetMark,
  ProviderPresetPicker,
} from '@/components/providers/provider-preset-picker'
import { Badge } from '@/components/ui/badge'
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
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import styles from './provider-form-dialog.module.css'

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

function providerToForm(provider: ModelProvider): FormState {
  return {
    name: provider.name,
    provider_type: provider.provider_type,
    base_url: provider.base_url ?? '',
    api_key: '',
    default_model: provider.default_model ?? '',
    notes: provider.notes ?? '',
    enabled: provider.enabled,
  }
}

export function ProviderFormDialog({
  mode,
  provider,
  triggerLabel,
  triggerIcon,
  triggerVariant = 'default',
  triggerSize = 'sm',
  initialPresetKey,
  controlledOpen,
  onControlledOpenChange,
  hideTrigger = false,
}: {
  mode: 'create' | 'edit'
  provider?: ModelProvider
  triggerLabel: string
  triggerIcon?: React.ReactNode
  triggerVariant?: React.ComponentProps<typeof Button>['variant']
  triggerSize?: React.ComponentProps<typeof Button>['size']
  initialPresetKey?: string | null
  controlledOpen?: boolean
  onControlledOpenChange?: (open: boolean) => void
  hideTrigger?: boolean
}) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = onControlledOpenChange ?? setInternalOpen
  const [form, setForm] = useState<FormState>(() => (provider ? providerToForm(provider) : EMPTY_FORM))
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null)
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([])
  const [showApiKey, setShowApiKey] = useState(false)
  const [modelsChecked, setModelsChecked] = useState(false)
  const createMutation = useCreateProvider()
  const updateMutation = useUpdateProvider()
  const discoverMutation = useDiscoverProviderModels()
  const syncMutation = useSyncProviderModels()
  const savedModels = useProviderModels(mode === 'edit' && open && provider ? provider.id : null)
  const availableModels =
    mode === 'edit'
      ? (savedModels.data?.data ?? []).filter((model) => model.enabled).map((model) => model.model_id)
      : discoveredModels
  const modelOptions =
    form.default_model && !availableModels.includes(form.default_model)
      ? [form.default_model, ...availableModels]
      : availableModels

  const pending = createMutation.isPending || updateMutation.isPending
  const fetchingModels = discoverMutation.isPending || syncMutation.isPending
  const activePreset = mode === 'create' ? getProviderPreset(selectedPreset) : undefined
  const credentialRequired =
    mode === 'create' && Boolean(activePreset) && activePreset?.provider_type !== 'local'
  const canFetchModels =
    mode === 'edit' || form.provider_type === 'local' || Boolean(form.api_key.trim())

  useEffect(() => {
    if (!open) return
    const initialPreset = mode === 'create' ? getProviderPreset(initialPresetKey) : undefined
    setForm(
      provider
        ? providerToForm(provider)
        : initialPreset
          ? {
              ...EMPTY_FORM,
              name: initialPreset.name,
              provider_type: initialPreset.provider_type,
              base_url: initialPreset.base_url,
              default_model: initialPreset.default_model ?? '',
            }
          : EMPTY_FORM,
    )
    setSelectedPreset(provider ? provider.provider_type : initialPreset?.key ?? null)
    setDiscoveredModels([])
    setShowApiKey(false)
    setModelsChecked(false)
  }, [initialPresetKey, mode, open, provider])

  const applyPreset = (preset: ProviderPreset) => {
    setSelectedPreset(preset.key)
    setDiscoveredModels([])
    setModelsChecked(false)
    setForm((current) => ({
      ...current,
      name: preset.name,
      provider_type: preset.provider_type,
      base_url: preset.base_url,
      api_key: '',
      default_model: preset.default_model ?? '',
    }))
  }

  const handleFetchModels = async () => {
    try {
      if (mode === 'edit' && provider) {
        const result = await syncMutation.mutateAsync(provider.id)
        const total = result.added + result.updated
        setModelsChecked(true)
        toast.success(total > 0 ? `已获取 ${total} 个模型` : '模型目录已是最新')
        return
      }

      const models = await discoverMutation.mutateAsync({
        provider_type: form.provider_type,
        ...(form.base_url.trim() ? { base_url: form.base_url.trim() } : {}),
        ...(form.api_key.trim() ? { api_key: form.api_key.trim() } : {}),
      })
      setDiscoveredModels(models)
      setModelsChecked(true)
      if (!form.default_model && models[0]) {
        setForm((current) => ({ ...current, default_model: models[0] }))
      }
      toast.success(models.length > 0 ? `已获取 ${models.length} 个模型` : '服务未返回模型')
    } catch (error) {
      setModelsChecked(false)
      toast.error((error as Error).message)
    }
  }

  const finish = (message: string) => {
    toast.success(message)
    setOpen(false)
  }

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!form.name.trim()) {
      toast.error('请填写供应商名称')
      return
    }
    if (credentialRequired && !form.api_key.trim()) {
      toast.error('请先填写 API Key')
      return
    }

    const payload: ModelProviderInput = {
      name: form.name.trim(),
      provider_type: form.provider_type,
      enabled: form.enabled,
    }
    if (form.base_url.trim()) payload.base_url = form.base_url.trim()
    if (form.default_model.trim()) payload.default_model = form.default_model.trim()
    if (form.notes.trim()) payload.notes = form.notes.trim()
    if (form.api_key.trim()) payload.api_key = form.api_key.trim()

    const onError = (error: Error) => toast.error(error.message)

    if (mode === 'create') {
      createMutation.mutate(payload, {
        onSuccess: async (created) => {
          try {
            await syncMutation.mutateAsync(created.id)
            finish('供应商已添加，模型目录已同步')
          } catch {
            finish('供应商已添加，可稍后重新获取模型')
          }
        },
        onError,
      })
      return
    }

    if (provider) {
      updateMutation.mutate(
        { id: provider.id, data: payload },
        { onSuccess: () => finish('供应商已更新'), onError },
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!hideTrigger ? (
        <DialogTrigger render={<Button variant={triggerVariant} size={triggerSize} />}>
          {triggerIcon}
          {triggerLabel}
        </DialogTrigger>
      ) : null}
      <DialogContent
        overlayClassName={styles.overlay}
        className={`${styles.motion} max-h-[88vh] overflow-y-auto sm:max-w-2xl`}
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>
              {mode === 'create'
                ? initialPresetKey
                  ? `连接 ${getProviderPreset(initialPresetKey)?.name ?? '供应商'}`
                  : '添加供应商'
                : '编辑供应商'}
            </DialogTitle>
            <DialogDescription>
              {mode === 'create'
                ? initialPresetKey
                  ? activePreset?.category === 'coding_plan'
                    ? '使用套餐专属 Key 验证连接，模型会自动读取。'
                    : '输入密钥并验证连接，模型会自动读取。'
                  : '选择预设并填写连接信息，模型 ID 会从服务端自动获取。'
                : '更新连接信息或重新同步模型目录。'}
            </DialogDescription>
          </DialogHeader>

          {mode === 'create' && !initialPresetKey ? (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">选择供应商</span>
              <ProviderPresetPicker
                compact
                selectedKey={selectedPreset}
                onSelect={applyPreset}
              />
            </div>
          ) : null}

          {activePreset ? (
            <div className="flex items-center gap-3 rounded-xl border bg-muted/20 px-4 py-3">
              <ProviderPresetMark preset={activePreset} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{activePreset.name}</span>
                  <Badge variant="outline" className="font-normal">
                    {activePreset.category === 'coding_plan'
                      ? 'Coding Plan'
                      : activePreset.provider_type === 'local'
                        ? '本地服务'
                        : 'OpenAI Compatible'}
                  </Badge>
                </div>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {form.base_url || '使用供应商官方地址'}
                </p>
              </div>
            </div>
          ) : null}

          <FieldGroup className="gap-5">
            <Field>
              <div className="flex items-center justify-between gap-3">
                <FieldLabel htmlFor="provider-api-key" className="gap-2">
                  <KeyRound className="size-4 text-primary" />
                  {form.provider_type === 'local' ? '访问密钥（可选）' : '输入 API Key'}
                </FieldLabel>
                {mode === 'edit' && provider?.has_api_key ? (
                  <span className="text-xs text-emerald-600 dark:text-emerald-400">
                    已保存密钥
                  </span>
                ) : null}
              </div>
              <InputGroup className="h-11">
                <InputGroupInput
                  id="provider-api-key"
                  type={showApiKey ? 'text' : 'password'}
                  placeholder={mode === 'edit' ? '留空则继续使用现有密钥' : '粘贴你的 API Key'}
                  value={form.api_key}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, api_key: event.target.value }))
                  }
                  autoComplete="new-password"
                  autoFocus={Boolean(initialPresetKey)}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    size="icon-xs"
                    aria-label={showApiKey ? '隐藏 API Key' : '显示 API Key'}
                    onClick={() => setShowApiKey((current) => !current)}
                  >
                    {showApiKey ? <EyeOff /> : <Eye />}
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
              {mode === 'create' && activePreset?.credentialHint ? (
                <FieldDescription>{activePreset.credentialHint}</FieldDescription>
              ) : mode === 'edit' ? (
                <FieldDescription>
                  {provider?.has_api_key
                    ? '密钥已保存且不会回显；留空表示继续使用现有密钥。'
                    : '当前没有保存密钥。'}
                </FieldDescription>
              ) : (
                <FieldDescription>密钥只用于连接该服务，保存后不会再次显示。</FieldDescription>
              )}
              <Button
                type="button"
                size="lg"
                disabled={fetchingModels || !canFetchModels}
                onClick={handleFetchModels}
                className="mt-1 w-full"
              >
                {fetchingModels ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : modelsChecked ? (
                  <CheckCircle2 className="size-4 text-emerald-600" />
                ) : (
                  <KeyRound className="size-4" />
                )}
                {fetchingModels
                  ? '正在验证连接…'
                  : modelsChecked
                    ? '连接可用，重新获取模型'
                    : '验证连接并获取模型'}
              </Button>
              {!canFetchModels ? (
                <FieldDescription className="text-center">
                  填写 API Key 后即可验证，无需先保存。
                </FieldDescription>
              ) : null}
            </Field>

            <Field>
              <FieldLabel htmlFor="provider-default-model">选择默认模型</FieldLabel>

              {modelOptions.length > 0 ? (
                <Select
                  value={form.default_model}
                  onValueChange={(value) =>
                    setForm((current) => ({ ...current, default_model: value as string }))
                  }
                >
                  <SelectTrigger id="provider-default-model" className="w-full">
                    <SelectValue placeholder="选择模型" />
                  </SelectTrigger>
                  <SelectContent>
                    {modelOptions.map((model) => (
                      <SelectItem key={model} value={model}>
                        {model}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div className="flex min-h-11 items-center rounded-lg border border-dashed bg-muted/15 px-3 text-sm text-muted-foreground">
                  验证连接后，可用模型会自动出现在这里。
                </div>
              )}
              <FieldDescription>
                {modelsChecked
                  ? `已读取 ${availableModels.length} 个可用模型。`
                  : activePreset?.default_model
                    ? '已带入该服务的推荐模型，验证后可切换。'
                    : '系统会从服务端读取模型 ID，不需要手动查找。'}
              </FieldDescription>
            </Field>
          </FieldGroup>

          <details className="group rounded-lg border bg-muted/15">
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium">
              连接设置
              <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <div className="grid gap-4 border-t p-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="provider-name">连接名称</FieldLabel>
                  <Input
                    id="provider-name"
                    value={form.name}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, name: event.target.value }))
                    }
                    required
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="provider-base-url">API 地址</FieldLabel>
                  <Input
                    id="provider-base-url"
                    placeholder="使用官方地址时可留空"
                    value={form.base_url}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, base_url: event.target.value }))
                    }
                  />
                </Field>
              </div>

              <Field>
                <FieldLabel htmlFor="provider-type">协议类型</FieldLabel>
                <Select
                  value={form.provider_type}
                  onValueChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      provider_type: value as ProviderType,
                      default_model: '',
                    }))
                  }
                >
                  <SelectTrigger id="provider-type" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai">OpenAI Compatible</SelectItem>
                    <SelectItem value="claude">Anthropic</SelectItem>
                    <SelectItem value="local">本地 OpenAI Compatible</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              <Field>
                <FieldLabel htmlFor="provider-manual-model">手动模型 ID</FieldLabel>
                <Input
                  id="provider-manual-model"
                  placeholder="仅在自动获取失败时填写"
                  value={form.default_model}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, default_model: event.target.value }))
                  }
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="provider-notes">备注</FieldLabel>
                <Input
                  id="provider-notes"
                  value={form.notes}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, notes: event.target.value }))
                  }
                />
              </Field>

              <Field orientation="horizontal" className="items-center justify-between">
                <FieldLabel htmlFor="provider-enabled">启用供应商</FieldLabel>
                <Switch
                  id="provider-enabled"
                  checked={form.enabled}
                  onCheckedChange={(value) =>
                    setForm((current) => ({ ...current, enabled: value }))
                  }
                />
              </Field>
            </div>
          </details>

          <DialogFooter>
            <Button
              type="submit"
              disabled={pending || (credentialRequired && !form.api_key.trim())}
            >
              {pending ? '保存中…' : mode === 'create' ? '添加并启用' : '保存更改'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
