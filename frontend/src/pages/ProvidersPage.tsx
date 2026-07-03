import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { listProviders, createProvider, updateProvider, deleteProvider } from '../api/endpoints'
import type { ModelProvider } from '../api/types'
import { PageLoader } from '../components/LoadingSpinner'
import ErrorAlert from '../components/ErrorAlert'
import Card from '../components/Card'
import DataTable from '../components/DataTable'
import PageHeader from '../components/PageHeader'
import { Button } from '../components/ui/button'
import { Plus, Pencil, Trash2, ToggleLeft, ToggleRight, Eye, EyeOff } from 'lucide-react'

const inputCls =
  'w-full border border-white/8 rounded-lg px-3 py-2 text-sm bg-black/20 text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-primary-500'
const labelCls = 'block text-sm font-medium text-zinc-300 mb-1'

const PROVIDER_TYPE_OPTIONS = [
  { value: 'claude', label: 'Claude (Anthropic)' },
  { value: 'openai', label: 'OpenAI 兼容' },
  { value: 'local',  label: '本地模型（Ollama 等）' },
]

const PROVIDER_PRESETS: Record<string, { base_url: string; label: string }> = {
  openai:    { base_url: 'https://api.openai.com/v1',                   label: 'OpenAI 官方' },
  deepseek:  { base_url: 'https://api.deepseek.com/v1',                 label: 'DeepSeek' },
  kimi:      { base_url: 'https://api.moonshot.cn/v1',                  label: 'Kimi (Moonshot)' },
  glm:       { base_url: 'https://open.bigmodel.cn/api/paas/v4/',       label: 'GLM (智谱)' },
  minimax:   { base_url: 'https://api.minimax.chat/v1',                 label: 'MiniMax' },
  ollama:    { base_url: 'http://localhost:11434',                       label: 'Ollama 本地' },
}

const PROCESSOR_COLORS: Record<string, string> = {
  claude: 'border border-violet-500/40 bg-violet-500/10 text-violet-300',
  openai: 'border border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  local:  'border border-orange-500/40 bg-orange-500/10 text-orange-300',
}

function ProviderModal({
  initial,
  onClose,
  onSave,
}: {
  initial?: ModelProvider
  onClose: () => void
  onSave: (data: Partial<ModelProvider>) => void
}) {
  const { t } = useTranslation()
  const isEdit = !!initial

  const [name, setName] = useState(initial?.name ?? '')
  const [providerType, setProviderType] = useState<string>(initial?.provider_type ?? 'openai')
  const [baseUrl, setBaseUrl] = useState(initial?.base_url ?? '')
  const [apiKey, setApiKey] = useState(initial?.api_key ?? '')
  const [defaultModel, setDefaultModel] = useState(initial?.default_model ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [showKey, setShowKey] = useState(false)

  const applyPreset = (presetKey: string) => {
    const p = PROVIDER_PRESETS[presetKey]
    if (!p) return
    setBaseUrl(p.base_url)
    if (!name) setName(p.label)
    if (presetKey === 'ollama') setProviderType('local')
    else setProviderType('openai')
  }

  const handleSave = () => {
    onSave({
      name,
      provider_type: providerType as ModelProvider['provider_type'],
      base_url: baseUrl || undefined,
      api_key: apiKey || undefined,
      default_model: defaultModel || undefined,
      notes: notes || undefined,
      enabled: initial?.enabled ?? true,
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="telemetry-panel w-full max-w-lg">
        <div className="p-6 border-b border-white/6">
          <h2 className="text-lg font-semibold text-zinc-100">
            {isEdit ? t('providers.editTitle') : t('providers.addTitle')}
          </h2>
        </div>

        <div className="p-6 space-y-4">
          {/* Quick presets */}
          {!isEdit && (
            <div>
              <label className={labelCls}>{t('providers.quickPreset')}</label>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(PROVIDER_PRESETS).map(([key, p]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => applyPreset(key)}
                    className="px-2.5 py-1 text-xs rounded-full border border-primary-500/40 text-primary-300 hover:bg-primary-500/10 transition-colors"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Name */}
          <div>
            <label className={labelCls}>
              {t('common.name')} <span className="text-red-500">*</span>
            </label>
            <input
              className={inputCls}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('providers.namePlaceholder')}
            />
          </div>

          {/* Provider type */}
          <div>
            <label className={labelCls}>{t('providers.providerType')}</label>
            <select
              className={inputCls}
              value={providerType}
              onChange={(e) => setProviderType(e.target.value)}
            >
              {PROVIDER_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Base URL */}
          <div>
            <label className={labelCls}>
              Base URL
              <span className="ml-1 text-zinc-500 font-normal text-2xs">（OpenAI 兼容接口地址）</span>
            </label>
            <input
              className={inputCls}
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.example.com/v1"
            />
          </div>

          {/* API Key */}
          <div>
            <label className={labelCls}>API Key</label>
            <div className="relative">
              <input
                className={`${inputCls} pr-9`}
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
              >
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          {/* Default model + Notes */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>{t('providers.defaultModel')}</label>
              <input
                className={inputCls}
                value={defaultModel}
                onChange={(e) => setDefaultModel(e.target.value)}
                placeholder="gpt-4o-mini"
              />
            </div>
            <div>
              <label className={labelCls}>{t('common.description')}</label>
              <input
                className={inputCls}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t('providers.notesPlaceholder')}
              />
            </div>
          </div>
        </div>

        <div className="p-6 border-t border-white/6 flex justify-end gap-3">
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSave} disabled={!name.trim()}>
            {isEdit ? t('common.save') : t('common.create')}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default function ProvidersPage() {
  const { t } = useTranslation()
  const [showAdd, setShowAdd] = useState(false)
  const [editProvider, setEditProvider] = useState<ModelProvider | null>(null)
  const qc = useQueryClient()

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['providers'],
    queryFn: listProviders,
  })

  const createMut = useMutation({
    mutationFn: createProvider,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['providers'] }); setShowAdd(false); toast.success('模型服务商已保存') },
    onError: (err) => toast.error(err instanceof Error ? err.message : '操作失败'),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<ModelProvider> }) => updateProvider(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['providers'] }); setEditProvider(null); toast.success('模型服务商已保存') },
    onError: (err) => toast.error(err instanceof Error ? err.message : '操作失败'),
  })

  const toggleMut = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => updateProvider(id, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['providers'] }),
  })

  const deleteMut = useMutation({
    mutationFn: deleteProvider,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['providers'] }); toast.success('已删除') },
    onError: (err) => toast.error(err instanceof Error ? err.message : '删除失败'),
  })

  if (isLoading) return <PageLoader />
  if (error) return <ErrorAlert error={error as Error} onRetry={refetch} />

  const providers = data?.data ?? []

  return (
    <div>
      <PageHeader
        title={t('providers.title')}
        description={t('providers.description')}
        action={
          <Button onClick={() => setShowAdd(true)}>
            <Plus size={16} /> {t('providers.addProvider')}
          </Button>
        }
      />

      <Card padding={false}>
        <DataTable
          data={providers}
          keyFn={(p) => p.id}
          emptyMessage={t('providers.noProviders')}
          columns={[
            {
              key: 'name',
              header: t('common.name'),
              width: '200px',
              render: (p) => (
                <div>
                  <p className="font-medium text-zinc-100">{p.name}</p>
                  {p.notes && <p className="text-xs text-zinc-500">{p.notes}</p>}
                </div>
              ),
            },
            {
              key: 'type',
              header: t('providers.providerType'),
              width: '130px',
              render: (p) => (
                <span className={`inline-flex items-center px-2 py-0.5 rounded-sm text-xs font-medium ${PROCESSOR_COLORS[p.provider_type] ?? 'border border-white/8 bg-black/20 text-zinc-300'}`}>
                  {p.provider_type}
                </span>
              ),
            },
            {
              key: 'base_url',
              header: 'Base URL',
              render: (p) => (
                <span className="text-xs font-mono text-zinc-400">
                  {p.base_url ?? '—'}
                </span>
              ),
            },
            {
              key: 'model',
              header: t('providers.defaultModel'),
              width: '140px',
              render: (p) => (
                <span className="text-xs font-mono text-zinc-300">
                  {p.default_model ?? '—'}
                </span>
              ),
            },
            {
              key: 'api_key',
              header: 'API Key',
              width: '100px',
              render: (p) => (
                <span className="text-xs text-zinc-500">
                  {p.api_key ? '••••••••' : '—'}
                </span>
              ),
            },
            {
              key: 'status',
              header: t('common.status'),
              width: '70px',
              render: (p) => (
                <span className={`text-xs font-medium ${p.enabled ? 'text-emerald-400' : 'text-zinc-500'}`}>
                  {p.enabled ? t('common.enabled') : t('common.disabled')}
                </span>
              ),
            },
            {
              key: 'actions',
              header: t('common.actions'),
              width: '160px',
              render: (p) => (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => toggleMut.mutate({ id: p.id, enabled: !p.enabled })}
                    className="flex items-center gap-1 px-2 py-1 rounded-sm text-xs hover:bg-white/4 text-zinc-500"
                  >
                    {p.enabled ? <ToggleRight size={12} /> : <ToggleLeft size={12} />}
                    {p.enabled ? t('common.disable') : t('common.enable')}
                  </button>
                  <button
                    onClick={() => setEditProvider(p)}
                    className="flex items-center gap-1 px-2 py-1 rounded-sm text-xs hover:bg-primary-500/10 text-primary-300"
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(t('providers.confirmDelete', { name: p.name }))) deleteMut.mutate(p.id)
                    }}
                    className="flex items-center gap-1 px-2 py-1 rounded-sm text-xs hover:bg-red-500/10 text-red-400"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ),
            },
          ]}
        />
      </Card>

      {showAdd && (
        <ProviderModal onClose={() => setShowAdd(false)} onSave={(d) => createMut.mutate(d)} />
      )}
      {editProvider && (
        <ProviderModal
          initial={editProvider}
          onClose={() => setEditProvider(null)}
          onSave={(d) => updateMut.mutate({ id: editProvider.id, data: d })}
        />
      )}
    </div>
  )
}
