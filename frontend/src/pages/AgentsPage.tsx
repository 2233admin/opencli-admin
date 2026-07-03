import { useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { listAgents, createAgent, updateAgent, deleteAgent, listProviders } from '../api/endpoints'
import type { AIAgent, ModelProvider } from '../api/types'
import { PageLoader } from '../components/LoadingSpinner'
import ErrorAlert from '../components/ErrorAlert'
import Card from '../components/Card'
import DataTable from '../components/DataTable'
import PageHeader from '../components/PageHeader'
import { COMMANDS_BY_SITE, SITE_EXTRA_FIELDS, SITE_LABELS, SITE_STANDARD_FIELDS } from '../components/ChannelConfigForm'
import { Button } from '../components/ui/button'
import { Plus, Pencil, Trash2, ToggleLeft, ToggleRight } from 'lucide-react'

const PROCESSOR_COLORS: Record<string, string> = {
  claude: 'border border-violet-500/40 bg-violet-500/10 text-violet-300',
  openai: 'border border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  local:  'border border-amber-500/40 bg-amber-500/10 text-amber-300',
}

function ProcessorBadge({ type, processorType }: { type: string; processorType?: string }) {
  const cls = PROCESSOR_COLORS[processorType ?? type] ?? 'border border-white/8 text-zinc-300'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-sm text-xs font-medium ${cls}`}>
      {type}
    </span>
  )
}

const inputCls =
  'w-full border border-white/8 rounded-lg px-3 py-2 text-sm bg-black/20 text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-primary-500'
const labelCls = 'block text-sm font-medium text-zinc-300 mb-1'

// Provider definitions: maps to processor_type + pre-filled config
type Provider = {
  key: string
  label: string
  processor_type: 'claude' | 'openai' | 'local'
  base_url?: string
  default_model: string
  needs_api_key: boolean
  base_url_editable?: boolean
}

const PROVIDERS: Provider[] = [
  { key: 'claude',    label: 'Claude (Anthropic)', processor_type: 'claude',  default_model: 'claude-haiku-4-5-20251001', needs_api_key: true },
  { key: 'openai',    label: 'OpenAI',             processor_type: 'openai',  default_model: 'gpt-4o-mini',               needs_api_key: true },
  { key: 'deepseek',  label: 'DeepSeek',           processor_type: 'openai',  base_url: 'https://api.deepseek.com/v1',    default_model: 'deepseek-chat',        needs_api_key: true },
  { key: 'kimi',      label: 'Kimi (Moonshot)',    processor_type: 'openai',  base_url: 'https://api.moonshot.cn/v1',     default_model: 'moonshot-v1-8k',       needs_api_key: true },
  { key: 'glm',       label: 'GLM (智谱)',         processor_type: 'openai',  base_url: 'https://open.bigmodel.cn/api/paas/v4/', default_model: 'glm-4-flash', needs_api_key: true },
  { key: 'minimax',   label: 'MiniMax',            processor_type: 'openai',  base_url: 'https://api.minimax.chat/v1',    default_model: 'abab6.5s-chat',        needs_api_key: true },
  { key: 'ollama',    label: 'Ollama（本地）',      processor_type: 'local',   base_url: 'http://localhost:11434',         default_model: 'llama3',               needs_api_key: false, base_url_editable: true },
  { key: 'custom',    label: '自定义',              processor_type: 'openai',  base_url: '',                               default_model: '',                     needs_api_key: true,  base_url_editable: true },
]

const PROVIDER_MAP = Object.fromEntries(PROVIDERS.map((p) => [p.key, p]))

// Standard fields always available after normalization
const STANDARD_FIELDS = ['title', 'url', 'content', 'author', 'published_at', 'source_id']

// Chinese descriptions for all known fields (standard + site-specific extra_*)
const FIELD_LABELS: Record<string, string> = {
  // Standard
  source_id:     '数据源 ID',
  title:         '标题',
  url:           '链接',
  content:       '正文',
  author:        '作者',
  published_at:  '发布时间',
  // Common extra
  rank:          '排名',
  id:            '条目 ID',
  likes:         '点赞数',
  score:         '评分',
  comments:      '评论数',
  plays:         '播放量',
  play:          '播放量',
  views:         '浏览量',
  // Bilibili
  danmaku:       '弹幕数',
  // Zhihu
  heat:          '热度',
  answers:       '回答数',
  votes:         '投票数',
  // Weibo
  hot_value:     '热度值',
  category:      '分类',
  label:         '标签',
  // V2EX / HN / Reddit
  subreddit:     '子版块',
  upvotes:       '赞数',
  section:       '栏目',
  // Xueqiu / Finance
  symbol:        '股票代码',
  price:         '价格',
  change:        '涨跌额',
  changePercent: '涨跌幅',
  changePct:     '涨跌幅',
  open:          '开盘价',
  high:          '最高价',
  low:           '最低价',
  volume:        '成交量',
  marketCap:     '市值',
  peRatio:       '市盈率',
  eps:           '每股收益',
  heat_value:    '热度值',
  // SMZDM
  mall:          '商城',
  // Boss
  salary:        '薪资',
  company:       '公司',
  area:          '地区',
  experience:    '工作经验',
  degree:        '学历要求',
  skills:        '技能',
  boss:          'HR',
  // Ctrip
  type:          '类型',
  // Xiaoyuzhou
  subscribers:   '订阅数',
  episodes:      '期数',
  eid:           '单集 ID',
  duration:      '时长',
  // Twitter
  tweets:        '推文数',
  retweets:      '转发数',
  replies:       '回复数',
  // LinkedIn
  location:      '地点',
  // Youtube
  // (views and duration already above)
}

// Preset prompt templates
const PROMPT_PRESETS = [
  {
    key: 'summary',
    label: '内容摘要',
    template: '请对以下内容生成一段简洁的中文摘要（150字以内）：\n\n标题：{{title}}\n作者：{{author}}\n来源：{{source_id}}\n\n正文：\n{{content}}\n\n链接：{{url}}',
  },
  {
    key: 'tags',
    label: '关键标签',
    template: '请从以下内容中提取 3-5 个关键标签，用中文逗号分隔，只输出标签，不要其他内容：\n\n标题：{{title}}\n内容：{{content}}',
  },
  {
    key: 'sentiment',
    label: '情感分析',
    template: '请分析以下内容的情感倾向，按如下格式输出：\n情感：正面/中性/负面\n理由：（一句话解释）\n\n标题：{{title}}\n内容：{{content}}',
  },
  {
    key: 'trending',
    label: '热榜解读',
    template: '以下是一条热榜内容，请简要说明其热度原因和潜在影响（100字以内）：\n\n标题：{{title}}\n热度排名：{{extra_rank}}\n来源：{{source_id}}\n链接：{{url}}',
  },
  {
    key: 'structured',
    label: '结构化提取',
    template: '请从以下内容中提取关键信息，以 JSON 格式输出，包含字段：summary（摘要）、keywords（关键词数组）、entities（实体数组）：\n\n标题：{{title}}\n内容：{{content}}\n链接：{{url}}',
  },
]

// Ordered site groups for the extra-field picker
const SITE_GROUPS = [
  { label: '🇨🇳 国内', sites: ['xiaohongshu', 'bilibili', 'zhihu', 'weibo', 'v2ex', 'xueqiu', 'smzdm', 'boss', 'ctrip', 'xiaoyuzhou'] },
  { label: '🌐 Public', sites: ['hackernews', 'bbc', 'reuters'] },
  { label: '🌍 Global', sites: ['twitter', 'reddit', 'youtube', 'linkedin', 'yahoo-finance', 'barchart'] },
]

function AgentModal({
  initial,
  onClose,
  onSave,
}: {
  initial?: AIAgent
  onClose: () => void
  onSave: (data: Partial<AIAgent>) => void
}) {
  const { t } = useTranslation()
  const isEdit = !!initial
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const { data: providersData } = useQuery({
    queryKey: ['providers'],
    queryFn: listProviders,
  })
  const savedProviders = (providersData?.data ?? []).filter((p) => p.enabled)

  // Derive initial provider key from existing agent data
  const deriveProviderKey = (): string => {
    if (!initial) return 'claude'
    const pt = initial.processor_type
    const bu = (initial.processor_config as Record<string, unknown>)?.base_url as string | undefined
    if (pt === 'claude') return 'claude'
    if (pt === 'local') return 'ollama'
    if (!bu) return 'openai'
    const match = PROVIDERS.find((p) => p.processor_type === 'openai' && p.base_url && bu.startsWith(p.base_url.replace(/\/$/, '').split('/v')[0]))
    return match?.key ?? 'custom'
  }

  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  // useSavedProvider: true = pick from saved providers; false = configure inline
  const [useSavedProvider, setUseSavedProvider] = useState(!!initial?.provider_id)
  const [savedProviderId, setSavedProviderId] = useState(initial?.provider_id ?? '')
  const [providerKey, setProviderKey] = useState(deriveProviderKey)
  const [model, setModel] = useState(initial?.model ?? PROVIDER_MAP['claude'].default_model)
  const [apiKey, setApiKey] = useState((initial?.processor_config as Record<string, unknown>)?.api_key as string ?? '')
  const [baseUrl, setBaseUrl] = useState((initial?.processor_config as Record<string, unknown>)?.base_url as string ?? '')
  const [promptTemplate, setPromptTemplate] = useState(
    initial?.prompt_template ?? PROMPT_PRESETS[0].template
  )
  const [selectedSite, setSelectedSite] = useState('')
  const [selectedCommand, setSelectedCommand] = useState('')

  const provider = PROVIDER_MAP[providerKey] ?? PROVIDERS[0]
  const selectedSavedProvider: ModelProvider | undefined = savedProviders.find((p) => p.id === savedProviderId)

  const handleProviderChange = (key: string) => {
    const p = PROVIDER_MAP[key]
    if (!p) return
    setProviderKey(key)
    setBaseUrl(p.base_url ?? '')
    if (!isEdit) setModel(p.default_model)
  }

  const handleSavedProviderChange = (id: string) => {
    setSavedProviderId(id)
    const p = savedProviders.find((sp) => sp.id === id)
    if (p) {
      if (p.default_model && !isEdit) setModel(p.default_model)
    }
  }

  const insertPlaceholder = (ph: string) => {
    const el = textareaRef.current
    if (!el) {
      setPromptTemplate((prev) => prev + ph)
      return
    }
    const start = el.selectionStart
    const end = el.selectionEnd
    const next = promptTemplate.slice(0, start) + ph + promptTemplate.slice(end)
    setPromptTemplate(next)
    requestAnimationFrame(() => {
      el.selectionStart = el.selectionEnd = start + ph.length
      el.focus()
    })
  }

  const siteCommands = selectedSite ? (COMMANDS_BY_SITE[selectedSite] ?? []) : []
  const siteKey = selectedSite && selectedCommand ? `${selectedSite}:${selectedCommand}` : ''
  const siteStandardFields: string[] | null = siteKey ? (SITE_STANDARD_FIELDS[siteKey] ?? null) : null
  const extraFields = siteKey ? (SITE_EXTRA_FIELDS[siteKey] ?? []) : []

  const handleSiteChange = (site: string) => {
    setSelectedSite(site)
    const cmds = COMMANDS_BY_SITE[site] ?? []
    const firstCmd = cmds[0]?.command ?? ''
    setSelectedCommand(firstCmd)
  }

  const handleSubmit = () => {
    const processorConfig: Record<string, unknown> = {}
    if (!useSavedProvider) {
      if (apiKey) processorConfig.api_key = apiKey
      if (baseUrl) processorConfig.base_url = baseUrl
    }
    const processorType = useSavedProvider
      ? (selectedSavedProvider?.provider_type ?? 'openai')
      : provider.processor_type
    onSave({
      name,
      description: description || undefined,
      processor_type: processorType,
      model: model || undefined,
      prompt_template: promptTemplate,
      processor_config: processorConfig,
      enabled: initial?.enabled ?? true,
      provider_id: useSavedProvider && savedProviderId ? savedProviderId : undefined,
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="border border-white/8 bg-black/20 shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="p-6 border-b border-white/6">
          <h2 className="text-lg font-semibold text-zinc-100">
            {isEdit ? t('agents.editTitle') : t('agents.addTitle')}
          </h2>
        </div>

        <div className="p-6 overflow-y-auto flex-1 space-y-4">
          {/* Name + description */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>
                {t('common.name')} <span className="text-red-500">*</span>
              </label>
              <input
                className={inputCls}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="内容摘要助手"
              />
            </div>
            <div>
              <label className={labelCls}>{t('common.description')}</label>
              <input
                className={inputCls}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('agents.descriptionPlaceholder')}
              />
            </div>
          </div>

          {/* Provider + model + credentials */}
          <div className="rounded-lg border border-white/8 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide">模型配置</p>
              {savedProviders.length > 0 && (
                <div className="flex items-center gap-1.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setUseSavedProvider(false)}
                    className={`px-2 py-0.5 rounded-full transition-colors ${!useSavedProvider ? 'bg-primary-500 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
                  >
                    手动配置
                  </button>
                  <button
                    type="button"
                    onClick={() => setUseSavedProvider(true)}
                    className={`px-2 py-0.5 rounded-full transition-colors ${useSavedProvider ? 'bg-primary-500 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
                  >
                    已保存提供商
                  </button>
                </div>
              )}
            </div>

            {useSavedProvider ? (
              /* Saved provider mode */
              <div className="space-y-3">
                <div>
                  <label className={labelCls}>{t('providers.selectProvider')}</label>
                  <select
                    className={inputCls}
                    value={savedProviderId}
                    onChange={(e) => handleSavedProviderChange(e.target.value)}
                  >
                    <option value="">— {t('providers.selectProvider')} —</option>
                    {savedProviders.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}{p.default_model ? ` · ${p.default_model}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                {selectedSavedProvider && (
                  <div className="bg-black/25 rounded-lg px-3 py-2 text-xs space-y-1">
                    <div className="flex gap-2">
                      <span className="text-zinc-500 w-16">类型</span>
                      <span className="font-medium text-zinc-100">{selectedSavedProvider.provider_type}</span>
                    </div>
                    {selectedSavedProvider.base_url && (
                      <div className="flex gap-2">
                        <span className="text-zinc-500 w-16">Base URL</span>
                        <span className="font-mono text-zinc-300 truncate">{selectedSavedProvider.base_url}</span>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <span className="text-zinc-500 w-16">API Key</span>
                      <span className="text-zinc-300">{selectedSavedProvider.api_key ? '••••••••' : '未配置（读环境变量）'}</span>
                    </div>
                  </div>
                )}
                <div>
                  <label className={labelCls}>
                    {t('agents.model')}
                    <span className="ml-1 text-zinc-500 font-normal text-2xs">（留空使用提供商默认）</span>
                  </label>
                  <input
                    className={inputCls}
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder={selectedSavedProvider?.default_model ?? ''}
                  />
                </div>
              </div>
            ) : (
              /* Inline config mode */
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>{t('agents.provider')}</label>
                    <select
                      className={inputCls}
                      value={providerKey}
                      onChange={(e) => handleProviderChange(e.target.value)}
                    >
                      {PROVIDERS.map((p) => (
                        <option key={p.key} value={p.key}>{p.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>{t('agents.model')}</label>
                    <input
                      className={inputCls}
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      placeholder={provider.default_model}
                    />
                  </div>
                </div>

                {(provider.needs_api_key || provider.base_url_editable) && (
                  <div className="grid grid-cols-2 gap-3">
                    {provider.needs_api_key && (
                      <div>
                        <label className={labelCls}>
                          API Key
                          <span className="ml-1 text-zinc-500 font-normal text-2xs">（可选，留空读环境变量）</span>
                        </label>
                        <input
                          className={inputCls}
                          type="password"
                          value={apiKey}
                          onChange={(e) => setApiKey(e.target.value)}
                          placeholder="sk-..."
                        />
                      </div>
                    )}
                    {provider.base_url_editable && (
                      <div>
                        <label className={labelCls}>Base URL</label>
                        <input
                          className={inputCls}
                          value={baseUrl}
                          onChange={(e) => setBaseUrl(e.target.value)}
                          placeholder={provider.base_url || 'https://api.example.com/v1'}
                        />
                      </div>
                    )}
                  </div>
                )}

                {!provider.needs_api_key && !provider.base_url_editable && provider.base_url && (
                  <p className="text-xs text-zinc-500">
                    接入点：<code className="font-mono">{provider.base_url}</code>
                  </p>
                )}
              </>
            )}
          </div>

          {/* Prompt section */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className={labelCls}>
                {t('agents.promptTemplate')} <span className="text-red-500">*</span>
              </label>
            </div>

            {/* Preset template chips */}
            <div className="flex flex-wrap gap-1.5">
              <span className="text-xs text-zinc-500 self-center mr-1">预设：</span>
              {PROMPT_PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => setPromptTemplate(p.template)}
                  className="px-2.5 py-1 text-xs rounded-full border border-primary-500/40 text-primary-300 hover:bg-primary-500/10 transition-colors"
                >
                  {p.label}
                </button>
              ))}
            </div>

            <textarea
              ref={textareaRef}
              className={`${inputCls} font-mono text-xs`}
              rows={8}
              value={promptTemplate}
              onChange={(e) => setPromptTemplate(e.target.value)}
              placeholder="请分析以下内容：\n\n{{title}}\n{{content}}"
            />

            {/* Placeholder reference panel */}
            <div className="rounded-lg border border-white/8 bg-black/25 p-3 space-y-2.5">
              {/* Site picker */}
              <div className="flex gap-2">
                <select
                  className="flex-1 border border-white/8 rounded-sm px-2 py-1 text-xs bg-black/20 text-zinc-100"
                  value={selectedSite}
                  onChange={(e) => handleSiteChange(e.target.value)}
                >
                  <option value="">— 选择平台预览字段 —</option>
                  {SITE_GROUPS.map((g) => (
                    <optgroup key={g.label} label={g.label}>
                      {g.sites
                        .filter((s) => COMMANDS_BY_SITE[s])
                        .map((s) => (
                          <option key={s} value={s}>{SITE_LABELS[s] ?? s}</option>
                        ))}
                    </optgroup>
                  ))}
                </select>
                {siteCommands.length > 0 && (
                  <select
                    className="flex-1 border border-white/8 rounded-sm px-2 py-1 text-xs bg-black/20 text-zinc-100"
                    value={selectedCommand}
                    onChange={(e) => setSelectedCommand(e.target.value)}
                  >
                    {siteCommands.map((p) => (
                      <option key={p.command} value={p.command}>
                        {p.label.split(' · ').slice(1).join(' · ') || p.command}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Standard fields — dim those not available for the selected site */}
              <div>
                <p className="text-xs font-medium text-zinc-400 mb-1.5">
                  标准字段
                  {siteStandardFields && (
                    <span className="ml-1 font-normal text-zinc-500">（划线表示该站点无此字段）</span>
                  )}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {['source_id', ...STANDARD_FIELDS.filter((f) => f !== 'source_id')].map((f) => {
                    const available = f === 'source_id' || !siteStandardFields || siteStandardFields.includes(f)
                    return (
                      <button
                        key={f}
                        type="button"
                        disabled={!available}
                        onClick={() => insertPlaceholder(`{{${f}}}`)}
                        title={available ? `插入 {{${f}}}` : '该站点无此字段'}
                        className={`px-2 py-1 text-xs rounded border transition-colors text-left ${
                          available
                            ? 'bg-black/20 border-white/8 text-zinc-300 hover:border-primary-400 hover:text-primary-300 cursor-pointer'
                            : 'bg-black/10 border-white/6 text-zinc-600 cursor-not-allowed'
                        }`}
                      >
                        <span className={`block font-mono leading-tight ${!available ? 'line-through' : ''}`}>{`{{${f}}}`}</span>
                        <span className="block text-3xs leading-tight mt-0.5 font-sans opacity-70">{FIELD_LABELS[f] ?? ''}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Extra fields — only shown when site is selected */}
              {siteKey && (
                <div>
                  <p className="text-xs font-medium text-zinc-400 mb-1.5">扩展字段</p>
                  {extraFields.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {extraFields.map((f) => (
                        <button
                          key={f}
                          type="button"
                          onClick={() => insertPlaceholder(`{{extra_${f}}}`)}
                          className="px-2 py-1 text-xs rounded-sm bg-black/20 border border-amber-500/40 text-amber-300 hover:border-amber-400 hover:text-amber-200 transition-colors text-left"
                        >
                          <span className="block font-mono leading-tight">{`{{extra_${f}}}`}</span>
                          <span className="block text-3xs leading-tight mt-0.5 font-sans opacity-70">{FIELD_LABELS[f] ?? ''}</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-zinc-500">无扩展字段</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="p-6 border-t border-white/6 flex justify-end gap-3">
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={!name.trim() || !promptTemplate.trim()}>
            {isEdit ? t('common.save') : t('common.create')}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default function AgentsPage() {
  const { t } = useTranslation()
  const [showAdd, setShowAdd] = useState(false)
  const [editAgent, setEditAgent] = useState<AIAgent | null>(null)
  const qc = useQueryClient()

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['agents'],
    queryFn: () => listAgents(),
  })

  const createMut = useMutation({
    mutationFn: createAgent,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['agents'] }); setShowAdd(false); toast.success('Agent 已保存') },
    onError: (err) => toast.error(err instanceof Error ? err.message : '操作失败'),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<AIAgent> }) => updateAgent(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['agents'] }); setEditAgent(null); toast.success('Agent 已保存') },
    onError: (err) => toast.error(err instanceof Error ? err.message : '操作失败'),
  })

  const toggleMut = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => updateAgent(id, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents'] }),
  })

  const deleteMut = useMutation({
    mutationFn: deleteAgent,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['agents'] }); toast.success('已删除') },
    onError: (err) => toast.error(err instanceof Error ? err.message : '删除失败'),
  })

  if (isLoading) return <PageLoader />
  if (error) return <ErrorAlert error={error as Error} onRetry={refetch} />

  const agents = data?.data ?? []

  return (
    <div>
      <PageHeader
        title={t('agents.title')}
        description={t('agents.description')}
        action={
          <Button onClick={() => setShowAdd(true)}>
            <Plus size={16} /> {t('agents.addAgent')}
          </Button>
        }
      />

      <Card padding={false}>
        <DataTable
          data={agents}
          keyFn={(a) => a.id}
          emptyMessage={t('agents.noAgents')}
          columns={[
            {
              key: 'name',
              header: t('common.name'),
              width: '200px',
              render: (a) => (
                <div>
                  <p className="font-medium">{a.name}</p>
                  {a.description && <p className="text-xs text-zinc-500">{a.description}</p>}
                </div>
              ),
            },
            {
              key: 'type',
              header: t('agents.provider'),
              width: '140px',
              render: (a) => {
                const bu = (a.processor_config as Record<string, unknown>)?.base_url as string | undefined
                const matched = PROVIDERS.find((p) =>
                  p.processor_type === a.processor_type &&
                  (p.base_url ? bu?.startsWith(p.base_url.split('/v')[0]) : !bu)
                )
                return <ProcessorBadge type={matched?.label ?? a.processor_type} processorType={a.processor_type} />
              },
            },
            {
              key: 'model',
              header: t('agents.model'),
              width: '160px',
              render: (a) => (
                <span className="text-xs font-mono text-zinc-300">
                  {a.model ?? '—'}
                </span>
              ),
            },
            {
              key: 'prompt',
              header: t('agents.promptTemplate'),
              render: (a) => (
                <p className="text-xs text-zinc-400 truncate max-w-xs">
                  {a.prompt_template || '—'}
                </p>
              ),
            },
            {
              key: 'status',
              header: t('common.status'),
              width: '70px',
              render: (a) => (
                <span className={`text-xs font-medium ${a.enabled ? 'text-emerald-400' : 'text-zinc-500'}`}>
                  {a.enabled ? t('common.enabled') : t('common.disabled')}
                </span>
              ),
            },
            {
              key: 'actions',
              header: t('common.actions'),
              width: '160px',
              render: (a) => (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => toggleMut.mutate({ id: a.id, enabled: !a.enabled })}
                    className="flex items-center gap-1 px-2 py-1 rounded-sm text-xs hover:bg-white/4 text-zinc-500"
                  >
                    {a.enabled ? <ToggleRight size={12} /> : <ToggleLeft size={12} />}
                    {a.enabled ? t('common.disable') : t('common.enable')}
                  </button>
                  <button
                    onClick={() => setEditAgent(a)}
                    className="flex items-center gap-1 px-2 py-1 rounded-sm text-xs hover:bg-primary-500/10 text-primary-300"
                  >
                    <Pencil size={12} /> 编辑
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(t('agents.confirmDelete', { name: a.name }))) deleteMut.mutate(a.id)
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
        <AgentModal onClose={() => setShowAdd(false)} onSave={(d) => createMut.mutate(d)} />
      )}

      {editAgent && (
        <AgentModal
          initial={editAgent}
          onClose={() => setEditAgent(null)}
          onSave={(d) => updateMut.mutate({ id: editAgent.id, data: d })}
        />
      )}
    </div>
  )
}
