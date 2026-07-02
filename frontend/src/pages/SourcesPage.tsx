import { useState, useEffect, useCallback, useMemo, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  applyNodeChanges,
} from '@xyflow/react'
import type { Edge, Node, NodeChange, NodeProps } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  listSources,
  createSource,
  updateSource,
  deleteSource,
  triggerTask,
  listTasks,
  listSchedules,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  listAgents,
  getChromePool,
  listBrowserBindings,
  getSystemConfig,
  getWsAgentStatus,
  testSourceConnectivity,
} from '../api/endpoints'
import type { CollectionTask, CronSchedule, DataSource } from '../api/types'
import ErrorAlert from '../components/ErrorAlert'
import Card from '../components/Card'
import { Badge } from '../components/ui/badge'
import { Input } from '../components/ui/input'
import { Button } from '@/components/ui/button'
import PageHeader from '../components/PageHeader'
import ChannelConfigForm, { type ChannelType, PRESET_DEFAULT, SITE_LABELS, COMMANDS_BY_SITE } from '../components/ChannelConfigForm'
import { TableSkeleton } from '../components/SkeletonLoader'
import ConfirmDialog from '../components/ConfirmDialog'
import Pagination from '../components/Pagination'
import { MetricTile, OperatorCard, PanelHeader, WorkbenchPanel } from '../components/opencli'
import type { OperatorTone } from '../components/opencli'
import { cn } from '@/lib/utils'
import {
  SOURCE_WORKFLOW_LAYOUT_KEY,
  buildCollectionWorkflow,
  loadWorkflowLayout,
  positionsFromNodes,
  saveWorkflowLayout,
  workflowNodeId,
  type SourceWorkflowStats,
  type WorkflowHealth,
  type WorkflowNodeData,
} from '../lib/collectionWorkflowModel'
import {
  runNodeAction,
  type NodeActionRunRequest,
} from '../lib/nodeActions'
import { isTopologyLabEnabled } from '../labs/topology/flags'
import {
  Activity,
  Braces,
  Cable,
  Calendar,
  CheckCircle2,
  CircleDot,
  Clock,
  Database,
  ExternalLink,
  FileInput,
  Filter,
  Ghost,
  Globe2,
  ListChecks,
  Pencil,
  Play,
  Plus,
  RadioTower,
  RotateCcw,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  Zap,
  type LucideIcon,
} from 'lucide-react'

/** Derive noVNC port from CDP URL using chrome-N hostname convention. */
function chromeNovncPort(cdpUrl: string, basePort = 3010): number {
  try {
    const hostname = new URL(cdpUrl).hostname
    const m = hostname.match(/^chrome(?:-(\d+))?$/)
    const n = m ? parseInt(m[1] ?? '1', 10) : 1
    return basePort + (n - 1)
  } catch {
    return basePort
  }
}

const CHANNEL_TYPES: ChannelType[] = ['opencli', 'rss', 'api', 'web_scraper', 'crawl4ai', 'cli', 'skill']
type FilterType = 'all' | ChannelType

type ActionState = 'loading' | 'ok' | 'err'

const actionStateKey = (nodeId: string, actionId: string) => `${nodeId}:${actionId}`
const makeNodeActionStateKey = (nodeKind: string, entityId: string, actionId: string) =>
  actionStateKey(`${nodeKind}:${entityId}`, actionId)

const CHANNEL_META: Record<ChannelType, {
  label: string
  short: string
  hint: string
  icon: LucideIcon
  tone: OperatorTone
}> = {
  opencli: {
    label: 'OpenCLI',
    short: 'CLI',
    hint: '账号环境 / 浏览器采集',
    icon: RadioTower,
    tone: 'accent',
  },
  rss: {
    label: 'RSS',
    short: 'RSS',
    hint: '订阅流',
    icon: FileInput,
    tone: 'gold',
  },
  api: {
    label: 'API',
    short: 'API',
    hint: '结构化接口',
    icon: Braces,
    tone: 'success',
  },
  web_scraper: {
    label: 'Web',
    short: 'WEB',
    hint: '网页抓取',
    icon: Globe2,
    tone: 'info',
  },
  cli: {
    label: 'Command',
    short: 'CMD',
    hint: '本地命令',
    icon: Cable,
    tone: 'violet',
  },
  skill: {
    label: 'Skill',
    short: 'SK',
    hint: '技能库执行 (record→distill→execute→correct)',
    icon: Sparkles,
    tone: 'gold',
  },
  crawl4ai: {
    label: 'Crawl4AI',
    short: 'C4AI',
    hint: 'JS 渲染页面 + 反爬(独立管理浏览器)',
    icon: Ghost,
    tone: 'violet',
  },
}

function ChannelTypeBadge({ type }: { type: string }) {
  const meta = CHANNEL_META[type as ChannelType]
  return (
    <Badge className={cn('border', meta?.tone ?? 'border-white/14 bg-white/4 text-zinc-300')} variant="outline">
      {meta?.short ?? type}
    </Badge>
  )
}

const inputCls =
  'w-full border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-100 outline-hidden transition-colors placeholder:text-zinc-600 focus:border-primary-500/70 focus:ring-2 focus:ring-primary-500/20 disabled:cursor-not-allowed disabled:opacity-50'
const labelCls = 'telemetry-label mb-1 block'

function defaultConfigForType(type: ChannelType): Record<string, unknown> {
  if (type === 'opencli') {
    return { site: PRESET_DEFAULT.site, command: PRESET_DEFAULT.command, args: PRESET_DEFAULT.args, format: 'json' }
  }
  return {}
}

function genDefaultName(type: ChannelType, config: Record<string, unknown>): string {
  const now = new Date()
  const ts = `${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`
  if (type === 'opencli') {
    const site = (config.site as string) || ''
    const cmd  = (config.command as string) || ''
    const siteLabel = SITE_LABELS[site] || site
    const preset = COMMANDS_BY_SITE[site]?.find((p) => p.command === cmd)
    const cmdLabel = preset ? preset.label.split(' · ').slice(1).join(' · ') : cmd
    return [siteLabel, cmdLabel, ts].filter(Boolean).join('-')
  }
  return `${type}-${ts}`
}

function SourceModal({
  initial,
  initialType,
  onClose,
  onSave,
}: {
  initial?: DataSource
  initialType?: ChannelType
  onClose: () => void
  onSave: (data: Partial<DataSource>) => void
}) {
  const { t } = useTranslation()
  const isEdit = !!initial
  const initType: ChannelType = isEdit ? (initial.channel_type as ChannelType) : (initialType ?? 'opencli')

  const initConfig: Record<string, unknown> = isEdit
    ? (initial.channel_config as Record<string, unknown>) ?? {}
    : defaultConfigForType(initType)

  const [channelType, setChannelType] = useState<ChannelType>(initType)
  const [channelConfig, setChannelConfig] = useState<Record<string, unknown>>(initConfig)
  const [configCache, setConfigCache] = useState<Partial<Record<ChannelType, Record<string, unknown>>>>({
    [initType]: initConfig,
  })
  const [name, setName] = useState(isEdit ? initial.name : () => genDefaultName(initType, initConfig))
  const [nameEdited, setNameEdited] = useState(isEdit)
  const [description, setDescription] = useState(isEdit ? (initial.description ?? '') : '')

  const handleConfigChange = (cfg: Record<string, unknown>) => {
    setChannelConfig(cfg)
    setConfigCache((prev) => ({ ...prev, [channelType]: cfg }))
    if (!nameEdited) setName(genDefaultName(channelType, cfg))
  }

  const handleTypeChange = (type: ChannelType) => {
    setConfigCache((prev) => ({ ...prev, [channelType]: channelConfig }))
    const restored = configCache[type] ?? defaultConfigForType(type)
    setChannelType(type)
    setChannelConfig(restored)
    if (!nameEdited) setName(genDefaultName(type, restored))
  }

  const handleSubmit = () => {
    onSave({
      name,
      description,
      channel_type: channelType,
      channel_config: channelConfig,
      enabled: initial?.enabled ?? true,
      tags: initial?.tags ?? [],
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col border border-white/10 bg-zinc-950 shadow-2xl">
        <div className="border-b border-white/10 p-5">
          <p className="telemetry-label">{isEdit ? 'EDIT NODE' : 'NEW NODE'}</p>
          <h2 className="mt-1 text-lg font-semibold text-zinc-50">
            {isEdit ? '编辑采集节点' : `新建 ${CHANNEL_META[initType].label} 节点`}
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            先定节点身份，再补必要参数；采集动作会回到工作台触发。
          </p>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="source-node-name" className={labelCls}>
                {t('common.name')} <span className="text-red-500">*</span>
              </label>
              <input
                id="source-node-name"
                name="source-node-name"
                className={inputCls}
                value={name}
                onChange={(e) => { setName(e.target.value); setNameEdited(true) }}
                placeholder="my-source"
              />
            </div>
            <div>
              <label htmlFor="source-node-channel-type" className={labelCls}>{t('sources.channelType')}</label>
              <select
                id="source-node-channel-type"
                name="source-node-channel-type"
                className={inputCls}
                value={channelType}
                onChange={(e) => handleTypeChange(e.target.value as ChannelType)}
                disabled={isEdit}
              >
                {CHANNEL_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {CHANNEL_META[type].label}{type !== 'opencli' ? '（开发中）' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="source-node-description" className={labelCls}>{t('common.description')}</label>
            <input
              id="source-node-description"
              name="source-node-description"
              className={inputCls}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="给这个节点写一个短备注，方便之后回看"
            />
          </div>

          <div>
            <p className={labelCls}>{t('sources.channelConfig')}</p>
            <div className="border border-white/10 bg-black/25 p-4">
              <ChannelConfigForm
                channelType={channelType}
                config={channelConfig}
                onChange={handleConfigChange}
                sourceId={initial?.id}
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-white/10 p-5">
          <Button
            type="button"
            onClick={onClose}
            variant="outline"
          >
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={!name.trim()}
          >
            {isEdit ? t('common.save') : t('common.create')}
          </Button>
        </div>
      </div>
    </div>
  )
}

function TriggerModal({
  source,
  isAgentMode,
  onClose,
  onTrigger,
}: {
  source: DataSource
  isAgentMode: boolean
  onClose: () => void
  onTrigger: (agentId?: string, parameters?: Record<string, unknown>) => void
}) {
  const { t } = useTranslation()
  const [agentId, setAgentId] = useState('')
  const [chromeEndpoint, setChromeEndpoint] = useState('')
  const [selectedAgentEndpoints, setSelectedAgentEndpoints] = useState<Set<string>>(new Set())

  const { data: agentsData } = useQuery({
    queryKey: ['agents', 'enabled'],
    queryFn: () => listAgents({ enabled: true }),
  })
  const agents = agentsData?.data ?? []

  const { data: chromePool } = useQuery({
    queryKey: ['chrome-pool'],
    queryFn: getChromePool,
    enabled: source.channel_type === 'opencli',
  })
  const chromeEndpoints = chromePool?.endpoints ?? []

  const agentEndpoints = isAgentMode ? chromeEndpoints.filter((ep) => ep.agent_url != null && ep.agent_url !== '') : []
  const showAgentSelector = isAgentMode && agentEndpoints.length > 0
  const showChromeSelector = source.channel_type === 'opencli' && !isAgentMode && chromeEndpoints.length >= 1

  const { data: wsStatus } = useQuery({
    queryKey: ['ws-agent-status'],
    queryFn: getWsAgentStatus,
    enabled: isAgentMode,
    refetchInterval: 10_000,
  })
  const wsConnectedSet = new Set(wsStatus?.connected ?? [])

  const { data: bindingsData } = useQuery({
    queryKey: ['browser-bindings'],
    queryFn: listBrowserBindings,
    enabled: source.channel_type === 'opencli',
  })
  const bindings = bindingsData?.data ?? []

  const endpointBoundSites: Record<string, string[]> = {}
  for (const b of bindings) {
    if (!endpointBoundSites[b.browser_endpoint]) endpointBoundSites[b.browser_endpoint] = []
    endpointBoundSites[b.browser_endpoint].push(b.site)
  }

  useEffect(() => {
    if (isAgentMode) return
    const site = source.channel_config?.site as string | undefined
    if (site) {
      const binding = bindings.find((b) => b.site === site)
      if (binding) { setChromeEndpoint(binding.browser_endpoint); return }
    }
    if (chromeEndpoints.length === 1 && !chromeEndpoint) {
      setChromeEndpoint(chromeEndpoints[0].url)
    }
  }, [chromeEndpoints, bindingsData])

  const toggleAgentEndpoint = (url: string) => {
    setSelectedAgentEndpoints((prev) => {
      const next = new Set(prev)
      if (next.has(url)) next.delete(url)
      else next.add(url)
      return next
    })
  }

  const handleTrigger = () => {
    if (isAgentMode) {
      const endpoints = [...selectedAgentEndpoints]
      if (endpoints.length === 0) {
        onTrigger(agentId || undefined, undefined)
      } else if (endpoints.length === 1) {
        onTrigger(agentId || undefined, { chrome_endpoint: endpoints[0] })
      } else {
        endpoints.forEach((ep) => onTrigger(agentId || undefined, { chrome_endpoint: ep }))
        onClose()
      }
    } else {
      const params: Record<string, unknown> = {}
      if (chromeEndpoint) params.chrome_endpoint = chromeEndpoint
      onTrigger(agentId || undefined, Object.keys(params).length ? params : undefined)
    }
  }

  const triggerLabel = isAgentMode && selectedAgentEndpoints.size > 1
    ? `触发 ${selectedAgentEndpoints.size} 个节点`
    : t('sources.triggerNow')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="telemetry-panel w-full max-w-lg">
        <div className="p-6 border-b border-white/6">
          <h2 className="text-lg font-semibold text-zinc-100">{t('agents.triggerTitle')}</h2>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label htmlFor="trigger-agent-id" className={labelCls}>{t('agents.selectAgent')}</label>
            <select
              id="trigger-agent-id"
              name="trigger-agent-id"
              className={inputCls}
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
            >
              <option value="">{t('agents.noAgent')}</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>[{a.processor_type}] {a.name}</option>
              ))}
            </select>
          </div>

          {showAgentSelector && (
            <div>
              <div className="flex items-center gap-2 mb-1">
                <label className={labelCls} style={{ marginBottom: 0 }}>采集节点</label>
                <span className="px-1.5 py-0.5 rounded-sm text-xs font-medium border border-violet-500/40 bg-violet-500/10 text-violet-300">Agent 模式</span>
              </div>
              <div className="space-y-2">
                {agentEndpoints.map((ep) => {
                  const isWs = ep.agent_protocol === 'ws'
                  const isConnected = isWs ? wsConnectedSet.has(ep.agent_url ?? '') : ep.available
                  const label = (ep.agent_url ?? ep.url).replace(/^https?:\/\//, '')
                  return (
                    <label
                      key={ep.url}
                      className={`flex gap-3 cursor-pointer rounded-lg border px-3 py-2.5 transition-colors ${
                        selectedAgentEndpoints.has(ep.url)
                          ? 'border-primary-500/70 bg-primary-500/10'
                          : 'border-white/8 hover:border-white/16'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedAgentEndpoints.has(ep.url)}
                        onChange={() => toggleAgentEndpoint(ep.url)}
                        className="accent-primary-500 shrink-0 mt-0.5"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-sm font-medium font-mono ${isConnected ? 'text-zinc-300' : 'text-zinc-500'}`}>
                            {label}
                          </span>
                          <span className={`text-xs ${isConnected ? 'text-green-500' : 'text-red-400'}`}>
                            {isConnected ? '● 在线' : '○ 离线'}
                          </span>
                          <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                            isWs
                              ? 'border border-violet-500/40 bg-violet-500/10 text-violet-300'
                              : 'border border-primary-500/40 bg-primary-500/10 text-primary-300'
                          }`}>
                            {isWs ? 'WS' : 'HTTP'}
                          </span>
                        </div>
                      </div>
                    </label>
                  )
                })}
              </div>
              <p className="mt-1 text-xs text-zinc-400">
                {selectedAgentEndpoints.size === 0
                  ? '未选择则自动分配'
                  : `已选 ${selectedAgentEndpoints.size} 个节点，将触发 ${selectedAgentEndpoints.size} 个任务`}
              </p>
            </div>
          )}

          {showChromeSelector && (
            <div>
              <div className="flex items-center gap-2 mb-1">
                <label className={labelCls} style={{ marginBottom: 0 }}>{t('channelConfig.chromeEndpoint')}</label>
                <span className="px-1.5 py-0.5 rounded-sm text-xs font-medium border border-primary-500/40 bg-primary-500/10 text-primary-300">本地模式</span>
              </div>
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer py-1">
                  <input
                    type="radio"
                    name="chrome-ep"
                    value=""
                    checked={chromeEndpoint === ''}
                    onChange={() => setChromeEndpoint('')}
                    className="accent-primary-500 shrink-0"
                  />
                  <span className="text-sm text-zinc-300">{t('channelConfig.chromeEndpointAny')}</span>
                </label>
                {chromeEndpoints.map((ep) => {
                  const novncPort = ep.novnc_port ?? chromeNovncPort(ep.url)
                  const novncUrl = `http://${window.location.hostname}:${novncPort}`
                  const label = ep.url.replace('http://', '').replace(':19222', '')
                  const boundSites = endpointBoundSites[ep.url] ?? []
                  return (
                    <label
                      key={ep.url}
                      className={`flex gap-3 cursor-pointer rounded-lg border px-3 py-2.5 transition-colors ${
                        chromeEndpoint === ep.url
                          ? 'border-primary-500/70 bg-primary-500/10'
                          : 'border-white/8 hover:border-white/16'
                      }`}
                    >
                      <input
                        type="radio"
                        name="chrome-ep"
                        value={ep.url}
                        checked={chromeEndpoint === ep.url}
                        onChange={() => setChromeEndpoint(ep.url)}
                        className="accent-primary-500 shrink-0 mt-0.5"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-sm font-medium ${ep.available ? 'text-zinc-300' : 'text-zinc-500'}`}>
                            {label}
                          </span>
                          <span className={`text-xs ${ep.available ? 'text-green-500' : 'text-red-400'}`}>
                            {ep.available ? '● 在线' : '○ 离线'}
                          </span>
                          <span className={`px-1.5 py-0.5 rounded-sm text-xs font-medium ${ep.mode === 'bridge' ? 'border border-primary-500/40 bg-primary-500/10 text-primary-300' : 'border border-amber-500/40 bg-amber-500/10 text-amber-300'}`}>
                            {ep.mode === 'bridge' ? 'Bridge' : 'CDP'}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                          {boundSites.map((site) => (
                            <span key={site} className="px-1.5 py-0.5 rounded-sm text-xs border border-indigo-500/40 bg-indigo-500/10 text-indigo-300">
                              {SITE_LABELS[site] ?? site}
                            </span>
                          ))}
                          {boundSites.length === 0 && (
                            <span className="text-xs text-zinc-500">暂无绑定站点</span>
                          )}
                          <a
                            href={novncUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="ml-auto text-xs text-primary-400 hover:underline font-mono shrink-0"
                          >
                            noVNC ↗
                          </a>
                        </div>
                      </div>
                    </label>
                  )
                })}
              </div>
              <p className="mt-1 text-xs text-zinc-400">{t('channelConfig.chromeEndpointHint')}</p>
            </div>
          )}
        </div>
        <div className="p-6 border-t border-white/6 flex justify-end gap-3">
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <button
            onClick={handleTrigger}
            className="px-4 py-2 text-sm rounded-lg bg-green-600 text-white hover:bg-green-700"
          >
            {triggerLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

type TestStatus = { state: 'idle' } | { state: 'loading' } | { state: 'ok' } | { state: 'err'; message: string }

function JsonBlock({ data }: { data: Record<string, unknown> }) {
  return (
    <pre className="max-h-64 overflow-auto border border-white/10 bg-black/35 p-3 font-mono text-xs text-zinc-200">
      {JSON.stringify(data, null, 2)}
    </pre>
  )
}

function formatUpdatedAt(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '未同步'
  const diff = Date.now() - date.getTime()
  if (diff >= 0 && diff < 60_000) return '刚刚更新'
  if (diff >= 0 && diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff >= 0 && diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function sourceTarget(source: DataSource) {
  const config = (source.channel_config ?? {}) as Record<string, unknown>
  if (source.channel_type === 'opencli') {
    const site = typeof config.site === 'string' ? config.site : ''
    const command = typeof config.command === 'string' ? config.command : ''
    const siteLabel = site ? (SITE_LABELS[site] ?? site) : ''
    return [siteLabel, command].filter(Boolean).join(' · ') || CHANNEL_META.opencli.hint
  }
  if (source.channel_type === 'rss') {
    return String(config.url ?? config.feed_url ?? config.feedUrl ?? CHANNEL_META.rss.hint)
  }
  if (source.channel_type === 'api') {
    return String(config.endpoint ?? config.url ?? CHANNEL_META.api.hint)
  }
  if (source.channel_type === 'web_scraper') {
    return String(config.url ?? config.start_url ?? config.startUrl ?? CHANNEL_META.web_scraper.hint)
  }
  if (source.channel_type === 'crawl4ai') {
    return String(config.url ?? CHANNEL_META.crawl4ai.hint)
  }
  if (source.channel_type === 'skill') {
    if (config.domain || config.capability) {
      return [config.domain, config.capability].filter(Boolean).join(' / ')
    }
    return config.skill_id ? `skill_id: ${String(config.skill_id).slice(0, 8)}` : CHANNEL_META.skill.hint
  }
  if (source.channel_type === 'cli') {
    return String(config.command ?? CHANNEL_META.cli.hint)
  }
  return source.description || '未配置目标'
}

function SourceNode({
  source,
  selected,
  triggerState,
  onSelect,
  onTrigger,
  onEdit,
  onDelete,
  onToggle,
}: {
  source: DataSource
  selected: boolean
  triggerState?: 'loading' | 'ok' | 'err'
  onSelect: () => void
  onTrigger: () => void
  onEdit: () => void
  onDelete: () => void
  onToggle: () => void
}) {
  const meta = CHANNEL_META[source.channel_type as ChannelType] ?? CHANNEL_META.opencli
  const Icon = meta.icon
  const target = sourceTarget(source)

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    onSelect()
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={handleKeyDown}
      className={cn(
        'group relative cursor-pointer border bg-black/30 p-4 outline-hidden transition-colors',
        'hover:border-primary-500/45 hover:bg-white/4.5 focus-visible:border-primary-500/60 focus-visible:ring-2 focus-visible:ring-primary-500/20',
        selected ? 'border-primary-500/65 bg-primary-500/7.5' : 'border-white/10',
      )}
    >
      <span className={cn('absolute -left-1 top-7 h-2 w-2 border bg-zinc-950', selected ? 'border-primary-400' : 'border-white/20')} />
      <span className={cn('absolute -right-1 top-7 h-2 w-2 border bg-zinc-950', selected ? 'border-primary-400' : 'border-white/20')} />

      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <span className={cn('grid h-10 w-10 shrink-0 place-items-center border', meta.tone)}>
            <Icon size={18} />
          </span>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <h3 className="truncate text-sm font-semibold text-zinc-50" title={source.name}>
                {source.name}
              </h3>
              <ChannelTypeBadge type={source.channel_type} />
            </div>
            <p className="mt-1 line-clamp-2 text-xs text-zinc-500">
              {source.description || meta.hint}
            </p>
          </div>
        </div>
        <span className={cn('mt-1 h-2.5 w-2.5 shrink-0 rounded-full', source.enabled ? 'bg-emerald-400' : 'bg-zinc-600')} />
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-3">
        <div className="min-w-0 border border-white/10 bg-black/20 p-2">
          <p className="telemetry-label">Target</p>
          <p className="mt-1 truncate font-mono text-xs text-zinc-300" title={target}>
            {target}
          </p>
        </div>
        <div className="border border-white/10 bg-black/20 p-2">
          <p className="telemetry-label">State</p>
          <p className={cn('mt-1 text-xs font-medium', source.enabled ? 'text-emerald-200' : 'text-zinc-500')}>
            {source.enabled ? '在线' : '暂停'}
          </p>
        </div>
        <div className="border border-white/10 bg-black/20 p-2">
          <p className="telemetry-label">Updated</p>
          <p className="mt-1 truncate text-xs text-zinc-300">{formatUpdatedAt(source.updated_at)}</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3">
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <Clock size={13} />
          <span className="font-mono">{source.id.slice(0, 8)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            size="xs"
            variant="ghost"
            onClick={(event) => { event.stopPropagation(); onToggle() }}
            title={source.enabled ? '暂停节点' : '启用节点'}
          >
            <CircleDot size={13} />
            {source.enabled ? '暂停' : '启用'}
          </Button>
          <Button
            type="button"
            size="xs"
            variant={triggerState === 'err' ? 'destructive' : triggerState === 'ok' ? 'secondary' : 'ghost'}
            disabled={!!triggerState}
            onClick={(event) => { event.stopPropagation(); onTrigger() }}
            title="立即触发"
          >
            {triggerState === 'loading' ? (
              <span className="inline-block h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
            ) : (
              <Play size={13} />
            )}
            {triggerState === 'ok' ? '已触发' : triggerState === 'err' ? '失败' : '触发'}
          </Button>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            onClick={(event) => { event.stopPropagation(); onEdit() }}
            title="编辑节点"
          >
            <Pencil size={13} />
            编辑
          </Button>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            onClick={(event) => { event.stopPropagation(); onDelete() }}
            title="删除节点"
          >
            <Trash2 size={13} />
          </Button>
        </div>
      </div>
    </div>
  )
}

function SourceInspector({
  source,
  triggerState,
  onTrigger,
  onEdit,
  onDelete,
  onToggle,
}: {
  source: DataSource | null
  triggerState?: 'loading' | 'ok' | 'err'
  onTrigger: () => void
  onEdit: () => void
  onDelete: () => void
  onToggle: () => void
}) {
  const [testStatus, setTestStatus] = useState<TestStatus>({ state: 'idle' })

  useEffect(() => {
    setTestStatus({ state: 'idle' })
  }, [source?.id])

  const handleTest = useCallback(async () => {
    if (!source) return
    setTestStatus({ state: 'loading' })
    try {
      const result = await testSourceConnectivity(source.id)
      if (result.connected) {
        setTestStatus({ state: 'ok' })
      } else {
        const message = result.errors?.join(', ') || '连接失败'
        setTestStatus({ state: 'err', message })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '测试失败'
      setTestStatus({ state: 'err', message })
    }
    setTimeout(() => setTestStatus({ state: 'idle' }), 4000)
  }, [source])

  if (!source) {
    return (
      <aside className="border border-dashed border-white/15 bg-black/20 p-5 xl:sticky xl:top-6">
        <div className="flex min-h-[360px] flex-col items-center justify-center text-center">
          <span className="grid h-12 w-12 place-items-center border border-white/10 bg-white/[0.035] text-zinc-500">
            <Settings2 size={20} />
          </span>
          <p className="mt-4 text-sm font-semibold text-zinc-300">没有选中节点</p>
          <p className="mt-2 max-w-xs text-xs text-zinc-500">
            节点详情、测试结果和触发动作会固定在这里。
          </p>
        </div>
      </aside>
    )
  }

  const meta = CHANNEL_META[source.channel_type as ChannelType] ?? CHANNEL_META.opencli
  const Icon = meta.icon
  const target = sourceTarget(source)

  return (
    <aside className="border border-white/10 bg-black/25 xl:sticky xl:top-6 xl:self-start">
      <PanelHeader
        label="NODE INSPECTOR"
        title={
          <div className="flex min-w-0 items-center gap-3">
            <span className={cn('grid h-9 w-9 shrink-0 place-items-center border', meta.tone)}>
              <Icon size={17} />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold text-zinc-50">{source.name}</h2>
              <p className="mt-1 truncate font-mono text-xs text-zinc-500">{source.id}</p>
            </div>
          </div>
        }
        actions={<ChannelTypeBadge type={source.channel_type} />}
      />

      <div className="space-y-5 p-5">
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="border border-white/10 bg-black/20 p-3">
            <p className="telemetry-label">Status</p>
            <p className={cn('mt-2 font-medium', source.enabled ? 'text-emerald-200' : 'text-zinc-500')}>
              {source.enabled ? '在线' : '暂停'}
            </p>
          </div>
          <div className="border border-white/10 bg-black/20 p-3">
            <p className="telemetry-label">Updated</p>
            <p className="mt-2 truncate text-zinc-300">{formatUpdatedAt(source.updated_at)}</p>
          </div>
        </div>

        <div className="border border-white/10 bg-white/[0.035] p-3">
          <p className="telemetry-label">Target</p>
          <p className="mt-2 wrap-break-word font-mono text-xs text-zinc-300">{target}</p>
          {source.description && (
            <p className="mt-3 border-t border-white/10 pt-3 text-sm text-zinc-400">
              {source.description}
            </p>
          )}
        </div>

        <div className="grid gap-2">
          <Button type="button" onClick={handleTest} disabled={testStatus.state === 'loading'} variant="outline">
            {testStatus.state === 'loading' ? (
              <span className="inline-block h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
            ) : (
              <Zap size={14} />
            )}
            {testStatus.state === 'ok' ? '连接可达' : testStatus.state === 'err' ? '连接失败' : '测试连通'}
          </Button>
          <Button type="button" onClick={onTrigger} disabled={!!triggerState}>
            {triggerState === 'loading' ? (
              <span className="inline-block h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
            ) : (
              <Play size={14} />
            )}
            {triggerState === 'ok' ? '任务已触发' : triggerState === 'err' ? '触发失败' : '触发采集'}
          </Button>
          <div className="grid grid-cols-3 gap-2">
            <Button type="button" variant="outline" onClick={onToggle}>
              <CircleDot size={14} />
              {source.enabled ? '暂停' : '启用'}
            </Button>
            <Button type="button" variant="outline" onClick={onEdit}>
              <Pencil size={14} />
              编辑
            </Button>
            <Button type="button" variant="outline" onClick={onDelete}>
              <Trash2 size={14} />
              删除
            </Button>
          </div>
        </div>

        {testStatus.state === 'err' && (
          <p className="border border-primary-500/25 bg-primary-500/10 px-3 py-2 text-xs text-primary-100">
            {testStatus.message}
          </p>
        )}

        <div>
          <p className="telemetry-label mb-2">Channel config</p>
          <JsonBlock data={(source.channel_config ?? {}) as Record<string, unknown>} />
        </div>

        <div className="border border-white/10 bg-black/20 p-3">
          <p className="telemetry-label">Tags</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {source.tags.length > 0 ? source.tags.map((tag) => (
              <Badge key={tag} variant="secondary">{tag}</Badge>
            )) : (
              <span className="text-xs text-zinc-600">暂无标签</span>
            )}
          </div>
        </div>
      </div>
    </aside>
  )
}

function LegacySourcesPage() {
  const [showAdd, setShowAdd] = useState(false)
  const [draftType, setDraftType] = useState<ChannelType>('opencli')
  const [editSource, setEditSource] = useState<DataSource | null>(null)
  const [triggerSource, setTriggerSource] = useState<DataSource | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<DataSource | null>(null)
  const [page, setPage] = useState(1)
  const [searchQuery, setSearchQuery] = useState('')
  const [channelFilter, setChannelFilter] = useState<FilterType>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const qc = useQueryClient()

  const { data: sysConfig } = useQuery({
    queryKey: ['system-config'],
    queryFn: getSystemConfig,
  })
  const isAgentMode = sysConfig?.collection_mode === 'agent'

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['sources', page],
    queryFn: () => listSources({ page, limit: 20 }),
  })

  const sources = useMemo(() => data?.data ?? [], [data?.data])
  const meta = data?.meta

  const filteredSources = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase()
    return sources.filter((source) => {
      const matchesSearch = normalizedSearch === ''
        || source.name.toLowerCase().includes(normalizedSearch)
        || (source.description ?? '').toLowerCase().includes(normalizedSearch)
        || sourceTarget(source).toLowerCase().includes(normalizedSearch)
      const matchesType = channelFilter === 'all' || source.channel_type === channelFilter
      return matchesSearch && matchesType
    })
  }, [channelFilter, searchQuery, sources])

  const selectedSource = filteredSources.find((source) => source.id === selectedId) ?? filteredSources[0] ?? null
  const selectedPosition = selectedSource
    ? Math.max(1, filteredSources.findIndex((source) => source.id === selectedSource.id) + 1)
    : 0
  const enabledCount = useMemo(() => sources.filter((source) => source.enabled).length, [sources])
  const activeFilterCount = useMemo(() => filteredSources.filter((source) => source.enabled).length, [filteredSources])
  const channelKindCount = useMemo(
    () => new Set(sources.map((source) => source.channel_type)).size,
    [sources],
  )
  const filterChips = useMemo(
    () => [
      { label: '全部', value: 'all' as FilterType, count: sources.length },
      ...CHANNEL_TYPES.map((type) => ({
        label: CHANNEL_META[type].label,
        value: type as FilterType,
        count: sources.filter((source) => source.channel_type === type).length,
      })),
    ],
    [sources],
  )

  useEffect(() => {
    if (filteredSources.length === 0) {
      if (selectedId !== null) setSelectedId(null)
      return
    }
    if (!selectedId || !filteredSources.some((source) => source.id === selectedId)) {
      setSelectedId(filteredSources[0].id)
    }
  }, [filteredSources, selectedId])

  const createMut = useMutation({
    mutationFn: createSource,
    onSuccess: (source) => {
      qc.invalidateQueries({ queryKey: ['sources'] })
      setSelectedId(source.id)
      setShowAdd(false)
      toast.success('采集节点已创建')
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '创建失败'),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<DataSource> }) => updateSource(id, data),
    onSuccess: (source) => {
      qc.invalidateQueries({ queryKey: ['sources'] })
      setSelectedId(source.id)
      setEditSource(null)
      toast.success('采集节点已更新')
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '更新失败'),
  })

  const toggleMut = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => updateSource(id, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sources'] }),
    onError: (err) => toast.error(err instanceof Error ? err.message : '更新失败'),
  })

  const deleteMut = useMutation({
    mutationFn: deleteSource,
    onSuccess: (_data, deletedId) => {
      qc.invalidateQueries({ queryKey: ['sources'] })
      if (selectedId === deletedId) setSelectedId(null)
      toast.success('已删除')
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '删除失败'),
  })

  const [triggerStates, setTriggerStates] = useState<Record<string, 'loading' | 'ok' | 'err'>>({})

  const triggerMut = useMutation({
    mutationFn: ({ id, agentId, parameters }: { id: string; agentId?: string; parameters?: Record<string, unknown> }) =>
      triggerTask(id, parameters ?? {}, agentId),
    onMutate: ({ id }) => setTriggerStates((s) => ({ ...s, [id]: 'loading' })),
    onSuccess: (_data, { id }) => {
      setTriggerStates((s) => ({ ...s, [id]: 'ok' }))
      setTimeout(() => setTriggerStates((s) => { const n = { ...s }; delete n[id]; return n }), 2000)
      setTriggerSource(null)
      toast.success('任务已触发')
    },
    onError: (_err, { id }) => {
      setTriggerStates((s) => ({ ...s, [id]: 'err' }))
      setTimeout(() => setTriggerStates((s) => { const n = { ...s }; delete n[id]; return n }), 3000)
      setTriggerSource(null)
      toast.error(_err instanceof Error ? _err.message : '触发失败')
    },
  })

  const openAddModal = (type: ChannelType = 'opencli') => {
    setDraftType(type)
    setShowAdd(true)
  }

  if (isLoading) return (
    <div className="space-y-5">
      <PageHeader
        title="数据源节点"
        description="用节点方式组织采集入口、账号环境和触发动作。"
        action={
          <Button type="button" onClick={() => openAddModal('opencli')}>
            <Plus size={16} /> 新增节点
          </Button>
        }
      />
      <Card padding={false}><TableSkeleton rows={6} /></Card>
    </div>
  )
  if (error) return <ErrorAlert error={error as Error} onRetry={refetch} />

  return (
    <div className="space-y-5">
      <PageHeader
        title="数据源节点"
        description="把采集入口当成节点管理：先选节点，再看目标、测试、触发和配置。"
        action={
          <Button type="button" onClick={() => openAddModal('opencli')}>
            <Plus size={16} /> 新增节点
          </Button>
        }
      />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricTile
          label="TOTAL NODES"
          value={sources.length}
          sub={`当前页 ${filteredSources.length} 个可见`}
          icon={Database}
          tone="accent"
        />
        <MetricTile
          label="ACTIVE"
          value={enabledCount}
          sub={`${activeFilterCount} 个在当前视图`}
          icon={CheckCircle2}
          tone={enabledCount > 0 ? 'success' : 'neutral'}
        />
        <MetricTile
          label="CHANNELS"
          value={channelKindCount}
          sub={channelFilter === 'all' ? '全部类型' : CHANNEL_META[channelFilter].label}
          icon={Filter}
          tone="neutral"
        />
        <MetricTile
          label="FOCUS"
          value={selectedSource ? `${selectedPosition}/${filteredSources.length}` : 'N/A'}
          sub={selectedSource?.name ?? '未选中'}
          icon={Activity}
          tone={selectedSource ? 'warning' : 'neutral'}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <section className="min-w-0 border border-white/10 bg-black/20">
          <PanelHeader
            label="SOURCE GRAPH"
            title={<h2 className="text-base font-semibold text-zinc-50">采集节点图</h2>}
            description="每个节点都带目标、状态、触发入口和配置摘要。"
            actions={
              <Badge variant="secondary">
                {isAgentMode ? 'Agent mode' : 'Local mode'}
              </Badge>
            }
          />

          <div className="space-y-4 border-b border-white/10 px-5 py-4">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" />
                <Input
                  id="sources-node-search"
                  name="sources-node-search"
                  type="text"
                  placeholder="搜索节点、目标、备注..."
                  value={searchQuery}
                  onChange={(event) => {
                    setSearchQuery(event.target.value)
                    setPage(1)
                  }}
                  className="pl-9"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {filterChips.map((chip) => (
                  <button
                    key={chip.value}
                    type="button"
                    onClick={() => {
                      setChannelFilter(chip.value)
                      setPage(1)
                    }}
                    className={cn(
                      'inline-flex h-9 items-center gap-2 border px-3 font-telemetry text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors',
                      channelFilter === chip.value
                        ? 'border-primary-500/70 bg-primary-500/16 text-white'
                        : 'border-white/10 bg-black/20 text-zinc-400 hover:border-white/22 hover:text-zinc-100',
                    )}
                  >
                    {chip.label}
                    <span className="font-mono text-[10px] text-zinc-500">{chip.count}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
              {CHANNEL_TYPES.map((type) => {
                const nodeMeta = CHANNEL_META[type]
                const Icon = nodeMeta.icon
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => openAddModal(type)}
                    className="group flex min-h-20 flex-col items-start justify-between border border-white/10 bg-black/25 p-3 text-left transition-colors hover:border-primary-500/45 hover:bg-white/4.5"
                  >
                    <span className={cn('grid h-8 w-8 place-items-center border transition-colors', nodeMeta.tone)}>
                      <Icon size={15} />
                    </span>
                    <span className="mt-3 text-xs font-semibold text-zinc-200">{nodeMeta.label}</span>
                    <span className="mt-1 text-[11px] text-zinc-600">{nodeMeta.hint}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="relative min-h-[460px] overflow-hidden p-5">
            <div
              className="pointer-events-none absolute inset-0 opacity-[0.16]"
              style={{
                backgroundImage:
                  'linear-gradient(rgba(255,255,255,.09) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.09) 1px, transparent 1px)',
                backgroundSize: '28px 28px',
              }}
            />
            {filteredSources.length === 0 ? (
              <div className="relative flex min-h-[360px] flex-col items-center justify-center border border-dashed border-white/15 bg-black/25 px-6 text-center">
                <span className="grid h-12 w-12 place-items-center border border-white/10 bg-white/[0.035] text-zinc-500">
                  <Database size={20} />
                </span>
                <h3 className="mt-4 text-sm font-semibold text-zinc-200">
                  {searchQuery || channelFilter !== 'all' ? '没有匹配节点' : '还没有采集节点'}
                </h3>
                <p className="mt-2 max-w-sm text-xs text-zinc-500">
                  {searchQuery || channelFilter !== 'all'
                    ? '换一个筛选条件，或者直接创建新的采集节点。'
                    : '先放一个 OpenCLI、RSS 或 API 节点，后续再把调度和记录串起来。'}
                </p>
                <Button type="button" className="mt-5" onClick={() => openAddModal('opencli')}>
                  <Plus size={15} /> 新增节点
                </Button>
              </div>
            ) : (
              <div className="relative grid gap-4 lg:grid-cols-2">
                {filteredSources.map((source) => (
                  <SourceNode
                    key={source.id}
                    source={source}
                    selected={selectedSource?.id === source.id}
                    triggerState={triggerStates[source.id]}
                    onSelect={() => setSelectedId(source.id)}
                    onTrigger={() => setTriggerSource(source)}
                    onEdit={() => setEditSource(source)}
                    onDelete={() => setDeleteTarget(source)}
                    onToggle={() => toggleMut.mutate({ id: source.id, enabled: !source.enabled })}
                  />
                ))}
              </div>
            )}
          </div>
        </section>

        <SourceInspector
          source={selectedSource}
          triggerState={selectedSource ? triggerStates[selectedSource.id] : undefined}
          onTrigger={() => { if (selectedSource) setTriggerSource(selectedSource) }}
          onEdit={() => { if (selectedSource) setEditSource(selectedSource) }}
          onDelete={() => { if (selectedSource) setDeleteTarget(selectedSource) }}
          onToggle={() => {
            if (selectedSource) toggleMut.mutate({ id: selectedSource.id, enabled: !selectedSource.enabled })
          }}
        />
      </div>

      {meta && (meta.pages > 1 || meta.total > 0) && (
        <div>
          <Pagination
            page={page}
            pages={meta.pages}
            total={meta.total}
            limit={20}
            onChange={setPage}
          />
        </div>
      )}

      {showAdd && (
        <SourceModal
          key={draftType}
          initialType={draftType}
          onClose={() => setShowAdd(false)}
          onSave={(d) => createMut.mutate(d)}
        />
      )}

      {editSource && (
        <SourceModal
          initial={editSource}
          onClose={() => setEditSource(null)}
          onSave={(d) => updateMut.mutate({ id: editSource.id, data: d })}
        />
      )}

      {triggerSource && (
        <TriggerModal
          source={triggerSource}
          isAgentMode={isAgentMode}
          onClose={() => setTriggerSource(null)}
          onTrigger={(agentId, parameters) =>
            triggerMut.mutate({ id: triggerSource.id, agentId, parameters })
          }
        />
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}
        title={`确认删除「${deleteTarget?.name ?? ''}」？`}
        description="此操作不可撤销，数据源将被永久删除。"
        confirmLabel="确认删除"
        variant="destructive"
        onConfirm={() => {
          if (deleteTarget) {
            deleteMut.mutate(deleteTarget.id)
            setDeleteTarget(null)
          }
        }}
      />
    </div>
  )
}

type WorkflowFlowNode = Node<WorkflowNodeData, 'workflowNode'>
type WorkflowFlowEdge = Edge<{ health: WorkflowHealth }>

const workflowNodeTypes = {
  workflowNode: WorkflowNodeView,
}

function WorkflowNodeView({ data, selected }: NodeProps<WorkflowFlowNode>) {
  const meta = data.kind === 'source'
    ? CHANNEL_META[(data.detail.channel_type as ChannelType) ?? 'opencli']
    : null
  const Icon = data.kind === 'source'
    ? meta?.icon ?? Database
    : data.kind === 'schedule'
      ? Calendar
      : ListChecks
  const stats = data.detail.stats as SourceWorkflowStats | undefined

  return (
    <div
      className={cn(
        'relative w-[270px] rounded-lg border bg-zinc-950/95 p-3 text-left shadow-xl backdrop-blur-sm transition-colors',
        selected ? 'border-primary-400 ring-2 ring-primary-400/25' : 'border-white/10 hover:border-white/25',
      )}
    >
      <Handle type="target" position={Position.Left} className="h-2.5! w-2.5! border-zinc-950!" />
      <Handle type="source" position={Position.Right} className="h-2.5! w-2.5! border-zinc-950!" />

      <div className="flex items-start gap-3">
        <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-md border', meta?.tone ?? workflowHealthSoftClass(data.health))}>
          <Icon size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-telemetry text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
              {workflowKindLabel(data.kind)}
            </span>
            <span className={cn('h-2 w-2 rounded-full', workflowHealthDotClass(data.health))} title={workflowHealthLabel(data.health)} />
          </div>
          <h3 className="mt-1 truncate text-sm font-semibold text-zinc-50" title={data.title}>
            {data.title}
          </h3>
          <p className="mt-0.5 truncate font-mono text-xs text-zinc-500" title={data.subtitle}>
            {data.subtitle}
          </p>
        </div>
      </div>

      {data.kind === 'source' && stats ? (
        <div className="mt-3 grid grid-cols-3 gap-1.5 text-[11px]">
          <MiniStat label="Tasks" value={stats.taskCount} />
          <MiniStat label="Plans" value={stats.scheduleCount} />
          <MiniStat label="Fail" value={stats.failedTasks} danger={stats.failedTasks > 0} />
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {[workflowHealthLabel(data.health), ...data.badges].slice(0, 4).map((badge) => (
            <span
              key={badge}
              className="max-w-[112px] truncate rounded-sm border border-white/10 bg-white/4 px-1.5 py-0.5 text-[10px] text-zinc-300"
              title={badge}
            >
              {badge}
            </span>
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-2 text-[10px] text-zinc-600">
        <span className="font-mono">{data.entityId.slice(0, 8)}</span>
        <span>{workflowHealthLabel(data.health)}</span>
      </div>
    </div>
  )
}

function MiniStat({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className="rounded-sm border border-white/10 bg-black/25 px-2 py-1.5">
      <p className="font-telemetry text-[9px] uppercase tracking-[0.12em] text-zinc-600">{label}</p>
      <p className={cn('mt-0.5 font-mono text-xs', danger ? 'text-red-300' : 'text-zinc-200')}>{value}</p>
    </div>
  )
}

function ScheduleModal({
  initial,
  sources,
  defaultSourceId,
  onClose,
  onSave,
}: {
  initial?: CronSchedule
  sources: DataSource[]
  defaultSourceId?: string
  onClose: () => void
  onSave: (data: Partial<CronSchedule>) => void
}) {
  const isEdit = !!initial
  const [sourceId, setSourceId] = useState(initial?.source_id ?? defaultSourceId ?? sources[0]?.id ?? '')
  const [name, setName] = useState(initial?.name ?? 'Daily harvest')
  const [cronExpression, setCronExpression] = useState(initial?.cron_expression ?? '0 9 * * *')
  const [timezone, setTimezone] = useState(initial?.timezone ?? 'Asia/Shanghai')
  const [enabled, setEnabled] = useState(initial?.enabled ?? true)

  const handleSubmit = () => {
    onSave({
      source_id: sourceId,
      agent_id: initial?.agent_id,
      name: name.trim(),
      cron_expression: cronExpression.trim(),
      timezone: timezone.trim() || 'Asia/Shanghai',
      parameters: initial?.parameters ?? {},
      enabled,
      is_one_time: initial?.is_one_time ?? false,
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs">
      <div className="w-full max-w-xl border border-white/10 bg-zinc-950 shadow-2xl">
        <div className="border-b border-white/10 p-5">
          <p className="telemetry-label">{isEdit ? 'EDIT PLAN' : 'NEW PLAN'}</p>
          <h2 className="mt-1 text-lg font-semibold text-zinc-50">
            {isEdit ? '编辑采集计划' : '新增采集计划'}
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            第一版保持轻量：计划只绑定数据源、Cron、时区和启停状态。
          </p>
        </div>

        <div className="space-y-4 p-5">
          <div>
            <label htmlFor="schedule-source-id" className={labelCls}>数据源</label>
            <select
              id="schedule-source-id"
              name="schedule-source-id"
              value={sourceId}
              onChange={(event) => setSourceId(event.target.value)}
              disabled={isEdit}
              className={inputCls}
            >
              {sources.map((source) => (
                <option key={source.id} value={source.id}>{source.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="schedule-name" className={labelCls}>计划名称</label>
            <input
              id="schedule-name"
              name="schedule-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={inputCls}
              placeholder="Daily harvest"
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="schedule-cron" className={labelCls}>Cron</label>
              <input
                id="schedule-cron"
                name="schedule-cron"
                value={cronExpression}
                onChange={(event) => setCronExpression(event.target.value)}
                className={inputCls}
                placeholder="0 9 * * *"
              />
            </div>
            <div>
              <label htmlFor="schedule-timezone" className={labelCls}>Timezone</label>
              <input
                id="schedule-timezone"
                name="schedule-timezone"
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
                className={inputCls}
                placeholder="Asia/Shanghai"
              />
            </div>
          </div>

          <label className="flex cursor-pointer items-center justify-between border border-white/10 bg-black/25 px-3 py-3">
            <span>
              <span className="block text-sm font-medium text-zinc-100">启用计划</span>
              <span className="mt-1 block text-xs text-zinc-500">关闭后保留配置，但不会自动触发。</span>
            </span>
            <input
              type="checkbox"
              name="schedule-enabled"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
              className="h-4 w-4 accent-primary-500"
            />
          </label>
        </div>

        <div className="flex justify-end gap-3 border-t border-white/10 p-5">
          <Button type="button" variant="outline" onClick={onClose}>取消</Button>
          <Button type="button" onClick={handleSubmit} disabled={!sourceId || !name.trim() || !cronExpression.trim()}>
            {isEdit ? '保存计划' : '创建计划'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function WorkflowInspector({
  node,
  source,
  schedule,
  task,
  stats,
  actionStates,
  onRunAction,
  onEditSource,
  onDeleteSource,
  onToggleSource,
  onAddSchedule,
  onEditSchedule,
  onToggleSchedule,
  onDeleteSchedule,
}: {
  node: WorkflowFlowNode | null
  source: DataSource | null
  schedule: CronSchedule | null
  task: CollectionTask | null
  stats?: SourceWorkflowStats
  actionStates: Record<string, ActionState>
  onRunAction: (actionId: string) => void
  onEditSource: () => void
  onDeleteSource: () => void
  onToggleSource: () => void
  onAddSchedule: () => void
  onEditSchedule: () => void
  onToggleSchedule: () => void
  onDeleteSchedule: () => void
}) {
  const [testStatus, setTestStatus] = useState<TestStatus>({ state: 'idle' })

  useEffect(() => {
    setTestStatus({ state: 'idle' })
  }, [source?.id])

  const handleTest = useCallback(async () => {
    if (!source) return
    setTestStatus({ state: 'loading' })
    try {
      const result = await testSourceConnectivity(source.id)
      if (result.connected) {
        setTestStatus({ state: 'ok' })
      } else {
        setTestStatus({ state: 'err', message: result.errors?.join(', ') || '连接失败' })
      }
    } catch (err) {
      setTestStatus({ state: 'err', message: err instanceof Error ? err.message : '测试失败' })
    }
    setTimeout(() => setTestStatus({ state: 'idle' }), 4000)
  }, [source])

  if (!node) {
    return (
      <aside className="border border-dashed border-white/15 bg-black/20 p-5 xl:sticky xl:top-6">
        <div className="flex min-h-[420px] flex-col items-center justify-center text-center">
          <span className="grid h-12 w-12 place-items-center rounded-md border border-white/10 bg-white/[0.035] text-zinc-500">
            <Settings2 size={20} />
          </span>
          <p className="mt-4 text-sm font-semibold text-zinc-300">选择一个节点</p>
          <p className="mt-2 max-w-xs text-xs text-zinc-500">
            右侧会切换源详情、计划详情或最近任务详情。
          </p>
        </div>
      </aside>
    )
  }

  if (node.data.kind === 'schedule' && schedule) {
    return (
      <aside className="border border-white/10 bg-black/25 xl:sticky xl:top-6 xl:self-start">
        <PanelHeader
          label="PLAN INSPECTOR"
          title={<InspectorTitle icon={Calendar} title={schedule.name} subtitle={schedule.id} />}
          actions={<StatePill health={node.data.health} />}
        />
        <div className="space-y-4 p-5">
          <DetailGrid
            items={[
              ['Cron', schedule.cron_expression],
              ['Timezone', schedule.timezone],
              ['Next run', formatDateTime(schedule.next_run_at)],
              ['Last run', formatDateTime(schedule.last_run_at)],
            ]}
          />
          <div className="grid gap-2">
            {isTopologyLabEnabled && (
              <Link className="inline-flex items-center justify-center gap-2 rounded-md bg-cyan-500 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400" to={`/labs/topology?source=${schedule.source_id}`}>
                <ExternalLink size={14} /> 查看全局拓扑
              </Link>
            )}
            <div className="grid grid-cols-3 gap-2">
              <Button type="button" variant="outline" onClick={onToggleSchedule}>
                <CircleDot size={14} /> {schedule.enabled ? '停用' : '启用'}
              </Button>
              <Button type="button" variant="outline" onClick={onEditSchedule}>
                <Pencil size={14} /> 编辑
              </Button>
              <Button type="button" variant="outline" onClick={onDeleteSchedule}>
                <Trash2 size={14} /> 删除
              </Button>
            </div>
          </div>
          <JsonBlock data={schedule.parameters ?? {}} />
        </div>
      </aside>
    )
  }

  if (node.data.kind === 'task' && task && source) {
    return (
      <aside className="border border-white/10 bg-black/25 xl:sticky xl:top-6 xl:self-start">
        <PanelHeader
          label="TASK INSPECTOR"
          title={<InspectorTitle icon={ListChecks} title={task.source_name || source.name} subtitle={task.id} />}
          actions={<StatePill health={node.data.health} />}
        />
        <div className="space-y-4 p-5">
          <DetailGrid
            items={[
              ['Status', task.status],
              ['Trigger', task.trigger_type],
              ['Priority', `P${task.priority}`],
              ['Updated', formatDateTime(task.updated_at)],
            ]}
          />
          {task.error_message && (
            <p className="border border-red-400/25 bg-red-400/10 px-3 py-2 text-xs text-red-100">
              {task.error_message}
            </p>
          )}
          <div className="grid gap-2">
            {node.data.actions.length > 0 ? node.data.actions.map((action) => {
              const actionState = actionStates[actionStateKey(node.id, action.id)]
              return (
                <Button
                  key={action.id}
                  type="button"
                  onClick={() => onRunAction(action.id)}
                  disabled={!!actionState || !action.enabled}
                >
                  {actionState === 'loading' ? (
                    <span className="inline-block h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
                  ) : (
                    <Play size={14} />
                  )}
                  {actionState === 'ok' ? '任务已触发' : actionState === 'err' ? '触发失败' : action.label}
                </Button>
              )
            }) : (
              <Button type="button" onClick={() => onRunAction('')} disabled>无可执行动作</Button>
            )}
            {isTopologyLabEnabled && (
              <Link className="inline-flex items-center justify-center gap-2 rounded-md border border-white/10 px-3 py-2 text-sm font-medium text-zinc-200 hover:bg-white/4" to={`/labs/topology?source=${source.id}`}>
                <ExternalLink size={14} /> 查看全局拓扑
              </Link>
            )}
          </div>
          <JsonBlock data={task.parameters ?? {}} />
        </div>
      </aside>
    )
  }

  if (!source) return null
  const meta = CHANNEL_META[source.channel_type as ChannelType] ?? CHANNEL_META.opencli

  return (
    <aside className="border border-white/10 bg-black/25 xl:sticky xl:top-6 xl:self-start">
      <PanelHeader
        label="SOURCE INSPECTOR"
        title={<InspectorTitle icon={meta.icon} title={source.name} subtitle={source.id} tone={meta.tone} />}
        actions={<ChannelTypeBadge type={source.channel_type} />}
      />
      <div className="space-y-5 p-5">
        <div className="grid grid-cols-2 gap-2 text-xs">
          <MetricBox label="Tasks" value={stats?.taskCount ?? 0} />
          <MetricBox label="Plans" value={`${stats?.enabledScheduleCount ?? 0}/${stats?.scheduleCount ?? 0}`} />
          <MetricBox label="Running" value={stats?.runningTasks ?? 0} />
          <MetricBox label="Failed" value={stats?.failedTasks ?? 0} danger={(stats?.failedTasks ?? 0) > 0} />
        </div>

        <div className="border border-white/10 bg-white/[0.035] p-3">
          <p className="telemetry-label">Target</p>
          <p className="mt-2 wrap-break-word font-mono text-xs text-zinc-300">{sourceTarget(source)}</p>
          {stats?.nextRunAt && (
            <p className="mt-3 border-t border-white/10 pt-3 text-xs text-zinc-400">
              下次执行：{formatDateTime(stats.nextRunAt)}
            </p>
          )}
          {source.description && (
            <p className="mt-3 border-t border-white/10 pt-3 text-sm text-zinc-400">
              {source.description}
            </p>
          )}
        </div>

        <div className="grid gap-2">
          <Link
            className="inline-flex items-center justify-center gap-2 rounded-md border border-white/10 px-3 py-2 text-sm font-medium text-zinc-200 hover:bg-white/4"
            to={`/sources/${source.id}/control-room`}
          >
            <Activity size={14} /> 控制室
          </Link>
          {isTopologyLabEnabled && (
            <Link className="inline-flex items-center justify-center gap-2 rounded-md bg-cyan-500 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400" to={`/labs/topology?source=${source.id}`}>
              <ExternalLink size={14} /> 查看全局拓扑
            </Link>
          )}
          <Button type="button" onClick={onAddSchedule} variant="outline">
            <Calendar size={14} /> 新增计划
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" onClick={handleTest} disabled={testStatus.state === 'loading'} variant="outline">
              {testStatus.state === 'loading' ? (
                <span className="inline-block h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
              ) : (
                <Zap size={14} />
              )}
              {testStatus.state === 'ok' ? '连接可达' : testStatus.state === 'err' ? '连接失败' : '测试'}
            </Button>
            <div className="col-span-1 grid gap-2">
              {node.data.actions.length > 0 ? node.data.actions.map((action) => {
                const actionState = actionStates[actionStateKey(node.id, action.id)]
                return (
                  <Button
                    key={action.id}
                    type="button"
                    onClick={() => onRunAction(action.id)}
                    disabled={!!actionState || !action.enabled}
                    variant="outline"
                  >
                    {actionState === 'loading' ? (
                      <span className="inline-block h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
                    ) : (
                      <Play size={14} />
                    )}
                    {actionState === 'ok' ? '已触发' : actionState === 'err' ? '触发失败' : action.label}
                  </Button>
                )
              }) : (
                <Button type="button" onClick={() => onRunAction('')} disabled>无可执行动作</Button>
              )}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Button type="button" variant="outline" onClick={onToggleSource}>
              <CircleDot size={14} /> {source.enabled ? '暂停' : '启用'}
            </Button>
            <Button type="button" variant="outline" onClick={onEditSource}>
              <Pencil size={14} /> 编辑
            </Button>
            <Button type="button" variant="outline" onClick={onDeleteSource}>
              <Trash2 size={14} /> 删除
            </Button>
          </div>
        </div>

        {testStatus.state === 'err' && (
          <p className="border border-primary-500/25 bg-primary-500/10 px-3 py-2 text-xs text-primary-100">
            {testStatus.message}
          </p>
        )}

        <div>
          <p className="telemetry-label mb-2">Channel config</p>
          <JsonBlock data={(source.channel_config ?? {}) as Record<string, unknown>} />
        </div>
      </div>
    </aside>
  )
}

function InspectorTitle({
  icon: Icon,
  title,
  subtitle,
  tone,
}: {
  icon: LucideIcon
  title: string
  subtitle: string
  tone?: string
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-md border', tone ?? 'border-white/10 bg-white/4 text-zinc-300')}>
        <Icon size={17} />
      </span>
      <div className="min-w-0">
        <h2 className="truncate text-base font-semibold text-zinc-50">{title}</h2>
        <p className="mt-1 truncate font-mono text-xs text-zinc-500">{subtitle}</p>
      </div>
    </div>
  )
}

function DetailGrid({ items }: { items: Array<[string, string | number | undefined]> }) {
  return (
    <div className="grid gap-2 text-xs">
      {items.map(([label, value]) => (
        <div key={label} className="border border-white/10 bg-black/20 p-3">
          <p className="telemetry-label">{label}</p>
          <p className="mt-2 wrap-break-word font-mono text-zinc-300">{value || 'N/A'}</p>
        </div>
      ))}
    </div>
  )
}

function MetricBox({ label, value, danger }: { label: string; value: string | number; danger?: boolean }) {
  return (
    <div className="border border-white/10 bg-black/20 p-3">
      <p className="telemetry-label">{label}</p>
      <p className={cn('mt-2 font-mono text-sm', danger ? 'text-red-300' : 'text-zinc-200')}>{value}</p>
    </div>
  )
}

function StatePill({ health }: { health: WorkflowHealth }) {
  return (
    <span className={cn('rounded-full px-2 py-1 text-xs font-medium', workflowHealthPillClass(health))}>
      {workflowHealthLabel(health)}
    </span>
  )
}

function SourceConfigurationPanel({
  sources,
  statsBySource,
  selectedSourceId,
  actionStates,
  showDiagnosticCanvas,
  onSelect,
  onTrigger,
  onEdit,
  onAddSchedule,
  onToggle,
  onOpenAdd,
  onToggleDiagnosticCanvas,
}: {
  sources: DataSource[]
  statsBySource: Record<string, SourceWorkflowStats>
  selectedSourceId?: string
  actionStates: Record<string, ActionState>
  showDiagnosticCanvas: boolean
  onSelect: (source: DataSource) => void
  onTrigger: (source: DataSource) => void
  onEdit: (source: DataSource) => void
  onAddSchedule: (source: DataSource) => void
  onToggle: (source: DataSource) => void
  onOpenAdd: () => void
  onToggleDiagnosticCanvas: () => void
}) {
  const enabledCount = sources.filter((source) => source.enabled).length
  const scheduleCount = sources.reduce((total, source) => total + (statsBySource[source.id]?.scheduleCount ?? 0), 0)
  const failedCount = sources.reduce((total, source) => total + (statsBySource[source.id]?.failedTasks ?? 0), 0)

  return (
    <WorkbenchPanel
      label="SOURCE CONFIGURATION"
      title="数据源配置台"
      description="这里负责采集源身份、参数、计划和触发；节点关系和跨系统诊断移到拓扑工作台。"
      action={(
        <div className="flex flex-wrap gap-2">
          {isTopologyLabEnabled && (
            <Link to="/labs/topology" className="inline-flex h-9 items-center justify-center gap-2 border border-white/14 bg-black/25 px-3 font-telemetry text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-200 hover:border-white/28 hover:bg-white/7.5">
              <ExternalLink size={14} />
              拓扑工作台
            </Link>
          )}
          <Button type="button" size="sm" variant="outline" onClick={onToggleDiagnosticCanvas}>
            {showDiagnosticCanvas ? '关闭诊断画布' : '打开诊断画布'}
          </Button>
          <Button type="button" size="sm" onClick={onOpenAdd}>
            <Plus size={14} />
            新增数据源
          </Button>
        </div>
      )}
    >
      <div className="border-b border-white/10 p-4">
        <div className="grid gap-3 md:grid-cols-3">
          <OperatorCard
            label="启用数据源"
            value={`${enabledCount}/${sources.length}`}
            hint="这里只看采集源配置"
            icon={Database}
            tone="accent"
          />
          <OperatorCard
            label="采集计划"
            value={scheduleCount}
            hint="计划仍在源上配置"
            icon={Calendar}
            tone="success"
          />
          <OperatorCard
            label="失败任务"
            value={failedCount}
            hint="处理入口在 Run Inbox"
            icon={Filter}
            tone={failedCount > 0 ? 'danger' : 'neutral'}
          />
        </div>
      </div>

      <div className="p-4">
        {sources.length === 0 ? (
          <div className="grid min-h-56 place-items-center border border-dashed border-white/12 bg-black/20 px-6 text-center">
            <div>
              <Database className="mx-auto h-10 w-10 text-zinc-700" />
              <h3 className="mt-4 text-sm font-semibold text-zinc-200">还没有数据源</h3>
              <p className="mt-2 text-sm text-zinc-500">先创建一个 OpenCLI、RSS 或 API 源，再去拓扑工作台看运行关系。</p>
              <Button type="button" className="mt-5" onClick={onOpenAdd}>
                <Plus size={15} />
                新增数据源
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {sources.map((source) => {
              const meta = CHANNEL_META[source.channel_type as ChannelType] ?? CHANNEL_META.opencli
              const Icon = meta.icon
              const stats = statsBySource[source.id]
              const triggerKey = makeNodeActionStateKey('source', source.id, 'source.trigger')
              const triggerState = actionStates[triggerKey]
              return (
                <article
                  key={source.id}
                  data-active={selectedSourceId === source.id}
                  className="min-w-0 border border-white/10 bg-black/20 p-4 data-[active=true]:border-primary-500/65 data-[active=true]:bg-primary-500/7.5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <button type="button" onClick={() => onSelect(source)} className="flex min-w-0 flex-1 items-start gap-3 text-left">
                      <span className={cn('grid h-10 w-10 shrink-0 place-items-center border', meta.tone)}>
                        <Icon size={18} />
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={cn('h-2 w-2 rounded-full', source.enabled ? 'bg-emerald-400' : 'bg-zinc-600')} />
                          <h3 className="truncate text-base font-semibold text-zinc-100">{source.name}</h3>
                        </div>
                        <p className="mt-1 truncate font-code text-xs text-zinc-500">{sourceTarget(source)}</p>
                      </div>
                    </button>
                    <Badge variant="outline" className={cn('border', meta.tone)}>{meta.short}</Badge>
                  </div>

                  <div className="mt-4 grid grid-cols-3 gap-2">
                    <MetricBox label="PLANS" value={stats?.scheduleCount ?? 0} />
                    <MetricBox label="TASKS" value={stats?.taskCount ?? 0} />
                    <MetricBox label="FAILED" value={stats?.failedTasks ?? 0} danger={(stats?.failedTasks ?? 0) > 0} />
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button type="button" size="xs" onClick={() => onTrigger(source)} disabled={triggerState === 'loading'}>
                      {triggerState === 'loading' ? (
                        <span className="inline-block h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
                      ) : (
                        <Play size={13} />
                      )}
                      触发
                    </Button>
                    <Button type="button" size="xs" variant="outline" onClick={() => onAddSchedule(source)}>
                      <Calendar size={13} />
                      计划
                    </Button>
                    <Button type="button" size="xs" variant="ghost" onClick={() => onEdit(source)}>
                      <Pencil size={13} />
                      编辑
                    </Button>
                    <Button type="button" size="xs" variant="ghost" onClick={() => onToggle(source)}>
                      {source.enabled ? '停用' : '启用'}
                    </Button>
                    <Button asChild size="xs" variant="outline">
                      <Link to={`/sources/${source.id}/control-room`}>
                        <Activity size={13} />
                        控制室
                      </Link>
                    </Button>
                  </div>

                  <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-3 text-xs text-zinc-500">
                    <span>最近任务：{stats?.latestTaskStatus ?? 'N/A'}</span>
                    <span>{formatDateTime(stats?.latestTaskUpdatedAt)}</span>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </div>
    </WorkbenchPanel>
  )
}

export default function SourcesPage() {
  const [showAdd, setShowAdd] = useState(false)
  const [draftType, setDraftType] = useState<ChannelType>('opencli')
  const [editSource, setEditSource] = useState<DataSource | null>(null)
  const [pendingActionSource, setPendingActionSource] = useState<{ source: DataSource; actionId: string; payload?: Record<string, unknown> } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<DataSource | null>(null)
  const [scheduleDraftSourceId, setScheduleDraftSourceId] = useState<string | null>(null)
  const [editSchedule, setEditSchedule] = useState<CronSchedule | null>(null)
  const [deleteScheduleTarget, setDeleteScheduleTarget] = useState<CronSchedule | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [channelFilter, setChannelFilter] = useState<FilterType>('all')
  const [showDiagnosticCanvas, setShowDiagnosticCanvas] = useState(false)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [flowNodes, setFlowNodes] = useState<WorkflowFlowNode[]>([])
  const [layoutVersion, setLayoutVersion] = useState(0)
  const [actionStates, setActionStates] = useState<Record<string, ActionState>>({})
  const qc = useQueryClient()

  const { data: sysConfig } = useQuery({
    queryKey: ['system-config'],
    queryFn: getSystemConfig,
  })
  const isAgentMode = sysConfig?.collection_mode === 'agent'

  const sourcesQuery = useQuery({
    queryKey: ['sources', 'canvas'],
    queryFn: () => listSources({ page: 1, limit: 100 }),
    refetchInterval: 30_000,
  })
  const tasksQuery = useQuery({
    queryKey: ['tasks', 'sources-canvas'],
    queryFn: () => listTasks({ limit: 100 }),
    refetchInterval: 10_000,
  })
  const schedulesQuery = useQuery({
    queryKey: ['schedules', 'sources-canvas'],
    queryFn: () => listSchedules(),
    refetchInterval: 30_000,
  })

  const queries = [sourcesQuery, tasksQuery, schedulesQuery]
  const error = queries.find((query) => query.error)?.error
  const isInitialLoading = queries.some((query) => query.isLoading) && flowNodes.length === 0
  const isFetching = queries.some((query) => query.isFetching)

  const sources = useMemo(() => sourcesQuery.data?.data ?? [], [sourcesQuery.data])
  const tasks = useMemo(() => tasksQuery.data?.data ?? [], [tasksQuery.data])
  const schedules = useMemo(() => schedulesQuery.data?.data ?? [], [schedulesQuery.data])
  const sourceMap = useMemo(() => new Map(sources.map((source) => [source.id, source])), [sources])
  const taskMap = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks])
  const scheduleMap = useMemo(() => new Map(schedules.map((schedule) => [schedule.id, schedule])), [schedules])

  const filteredSources = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase()
    return sources.filter((source) => {
      const matchesSearch = normalizedSearch === ''
        || source.name.toLowerCase().includes(normalizedSearch)
        || (source.description ?? '').toLowerCase().includes(normalizedSearch)
        || sourceTarget(source).toLowerCase().includes(normalizedSearch)
      const matchesType = channelFilter === 'all' || source.channel_type === channelFilter
      return matchesSearch && matchesType
    })
  }, [channelFilter, searchQuery, sources])
  const filteredSourceIds = useMemo(() => new Set(filteredSources.map((source) => source.id)), [filteredSources])
  const filteredTasks = useMemo(
    () => tasks.filter((task) => filteredSourceIds.has(task.source_id)),
    [filteredSourceIds, tasks],
  )
  const filteredSchedules = useMemo(
    () => schedules.filter((schedule) => filteredSourceIds.has(schedule.source_id)),
    [filteredSourceIds, schedules],
  )
  const layoutPositions = useMemo(
    () => loadWorkflowLayout(typeof window === 'undefined' ? undefined : window.localStorage),
    [layoutVersion],
  )
  const graph = useMemo(
    () => buildCollectionWorkflow(
      {
        sources: filteredSources,
        tasks: filteredTasks,
        schedules: filteredSchedules,
      },
      { layout: layoutPositions },
    ),
    [filteredSchedules, filteredSources, filteredTasks, layoutPositions],
  )
  const flowEdges = useMemo(() => toWorkflowFlowEdges(graph.edges), [graph.edges])

  const selectedNode = flowNodes.find((node) => node.id === selectedNodeId) ?? null
  const selectedSource = selectedNode ? sourceMap.get(selectedNode.data.sourceId) ?? null : null
  const selectedSchedule = selectedNode?.data.kind === 'schedule'
    ? scheduleMap.get(selectedNode.data.entityId) ?? null
    : null
  const selectedTask = selectedNode?.data.kind === 'task'
    ? taskMap.get(selectedNode.data.entityId) ?? null
    : null
  const selectedStats = selectedSource ? graph.sourceStats[selectedSource.id] : undefined

  const enabledCount = useMemo(() => sources.filter((source) => source.enabled).length, [sources])
  const filterChips = useMemo(
    () => [
      { label: '全部', value: 'all' as FilterType, count: sources.length },
      ...CHANNEL_TYPES.map((type) => ({
        label: CHANNEL_META[type].label,
        value: type as FilterType,
        count: sources.filter((source) => source.channel_type === type).length,
      })),
    ],
    [sources],
  )

  useEffect(() => {
    setFlowNodes(graph.nodes.map(toWorkflowFlowNode))
  }, [graph.nodes])

  useEffect(() => {
    if (selectedNodeId && flowNodes.some((node) => node.id === selectedNodeId)) return
    const next = flowNodes.find((node) => node.data.health === 'failed')
      ?? flowNodes.find((node) => node.data.health === 'warning')
      ?? flowNodes[0]
    setSelectedNodeId(next?.id ?? null)
  }, [flowNodes, selectedNodeId])

  const handleNodesChange = useCallback((changes: NodeChange<WorkflowFlowNode>[]) => {
    const shouldPersist = changes.some((change) => change.type === 'position' && change.dragging === false)
    setFlowNodes((current) => {
      const next = applyNodeChanges(changes, current) as WorkflowFlowNode[]
      if (shouldPersist && typeof window !== 'undefined') {
        saveWorkflowLayout(window.localStorage, positionsFromNodes(next))
        setLayoutVersion((version) => version + 1)
      }
      return next
    })
  }, [])

  const refetchAll = () => {
    for (const query of queries) query.refetch()
  }

  const resetCanvasLayout = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(SOURCE_WORKFLOW_LAYOUT_KEY)
    }
    setLayoutVersion((version) => version + 1)
    toast.success('画布布局已重置')
  }

  const openAddModal = (type: ChannelType = 'opencli') => {
    setDraftType(type)
    setShowAdd(true)
  }

  const createMut = useMutation({
    mutationFn: createSource,
    onSuccess: (source) => {
      qc.invalidateQueries({ queryKey: ['sources'] })
      setSelectedNodeId(workflowNodeId('source', source.id))
      setShowAdd(false)
      toast.success('采集节点已创建')
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '创建失败'),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<DataSource> }) => updateSource(id, data),
    onSuccess: (source) => {
      qc.invalidateQueries({ queryKey: ['sources'] })
      qc.invalidateQueries({ queryKey: ['topology'] })
      setSelectedNodeId(workflowNodeId('source', source.id))
      setEditSource(null)
      toast.success('采集节点已更新')
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '更新失败'),
  })

  const toggleMut = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => updateSource(id, { enabled }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sources'] })
      qc.invalidateQueries({ queryKey: ['topology'] })
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '更新失败'),
  })

  const deleteMut = useMutation({
    mutationFn: deleteSource,
    onSuccess: (_data, deletedId) => {
      qc.invalidateQueries({ queryKey: ['sources'] })
      qc.invalidateQueries({ queryKey: ['topology'] })
      if (selectedNodeId === workflowNodeId('source', deletedId)) setSelectedNodeId(null)
      toast.success('已删除')
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '删除失败'),
  })

  const createScheduleMut = useMutation({
    mutationFn: createSchedule,
    onSuccess: (schedule) => {
      qc.invalidateQueries({ queryKey: ['schedules'] })
      qc.invalidateQueries({ queryKey: ['topology'] })
      setSelectedNodeId(workflowNodeId('schedule', schedule.id))
      setScheduleDraftSourceId(null)
      toast.success('采集计划已创建')
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '创建计划失败'),
  })

  const updateScheduleMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CronSchedule> }) => updateSchedule(id, data),
    onSuccess: (schedule) => {
      qc.invalidateQueries({ queryKey: ['schedules'] })
      qc.invalidateQueries({ queryKey: ['topology'] })
      setSelectedNodeId(workflowNodeId('schedule', schedule.id))
      setEditSchedule(null)
      toast.success('采集计划已更新')
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '更新计划失败'),
  })

  const deleteScheduleMut = useMutation({
    mutationFn: deleteSchedule,
    onSuccess: (_data, deletedId) => {
      qc.invalidateQueries({ queryKey: ['schedules'] })
      qc.invalidateQueries({ queryKey: ['topology'] })
      if (selectedNodeId === workflowNodeId('schedule', deletedId)) setSelectedNodeId(null)
      toast.success('计划已删除')
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '删除计划失败'),
  })

  const runActionMut = useMutation({
    mutationFn: ({ nodeKind, entityId, actionId, payload }: NodeActionRunRequest) =>
      runNodeAction({ nodeKind, entityId, actionId, payload }),
    onMutate: ({ nodeKind, entityId, actionId }) => {
      const key = makeNodeActionStateKey(nodeKind, entityId, actionId)
      setActionStates((states) => ({ ...states, [key]: 'loading' }))
    },
    onSuccess: (result, request) => {
      const key = makeNodeActionStateKey(request.nodeKind, request.entityId, request.actionId)
      const nextState: ActionState = result.ok ? 'ok' : 'err'
      setActionStates((states) => ({ ...states, [key]: nextState }))

      if (!result.ok) {
        toast.error(result.message)
      } else {
        qc.invalidateQueries({ queryKey: ['tasks'] })
        qc.invalidateQueries({ queryKey: ['topology'] })
        qc.invalidateQueries({ queryKey: ['sources'] })
        qc.invalidateQueries({ queryKey: ['schedules'] })
        toast.success(result.message)
      }

      setTimeout(() => {
        setActionStates((states) => {
          const next = { ...states }
          delete next[key]
          return next
        })
      }, 2400)
      setPendingActionSource(null)
    },
    onError: (err, request) => {
      const key = makeNodeActionStateKey(request.nodeKind, request.entityId, request.actionId)
      setActionStates((states) => ({ ...states, [key]: 'err' }))
      setTimeout(() => {
        setActionStates((states) => {
          const next = { ...states }
          delete next[key]
          return next
        })
      }, 3000)
      toast.error(err instanceof Error ? err.message : '执行失败')
      setPendingActionSource(null)
    },
  })

  const runSourceAction = (
    source: DataSource,
    actionId: string,
    payload?: Record<string, unknown>,
  ) => {
    runActionMut.mutate({
      nodeKind: 'source',
      entityId: source.id,
      actionId,
      payload,
    })
  }

  const runTaskAction = (task: CollectionTask, actionId: string) => {
    runActionMut.mutate({
      nodeKind: 'task',
      entityId: task.id,
      actionId,
    })
  }

  const runWorkflowAction = (actionId: string, payload?: Record<string, unknown>) => {
    if (!selectedNode) return
    const action = selectedNode.data.actions.find((item) => item.id === actionId) ?? selectedNode.data.actions[0]
    if (!action || !action.enabled) {
      toast.error('动作暂不可执行')
      return
    }

    if (selectedNode.data.kind === 'source') {
      if (!selectedSource) {
        toast.error('未找到数据源')
        return
      }
      if (action.id === 'source.trigger') {
        setPendingActionSource({ source: selectedSource, actionId: action.id, payload })
        return
      }
      runSourceAction(selectedSource, action.id, payload)
      return
    }

    if (selectedNode.data.kind === 'task') {
      if (!selectedTask) {
        toast.error('未找到任务')
        return
      }
      runTaskAction(selectedTask, action.id)
      return
    }

    // Fallback for unsupported kinds in this canvas path.
    runActionMut.mutate({
      nodeKind: selectedNode.data.kind,
      entityId: String(selectedNode.data.entityId),
      actionId: action.id,
      ...(payload ? { payload } : {}),
    })
  }

  const runPendingSourceAction = (agentId: string | undefined, parameters?: Record<string, unknown>) => {
    if (!pendingActionSource) return
    runSourceAction(
      pendingActionSource.source,
      pendingActionSource.actionId,
      {
        ...(pendingActionSource.payload ?? {}),
        ...(parameters ?? {}),
        ...(agentId ? { agent_id: agentId } : {}),
      },
    )
    setPendingActionSource(null)
  }

  if (isInitialLoading) return (
    <div className="space-y-5">
      <PageHeader
        title="数据源配置"
        description="配置采集源、认证参数和采集计划；拓扑关系进入拓扑工作台处理。"
        action={<Button type="button" onClick={() => openAddModal('opencli')}><Plus size={16} /> 新增数据源</Button>}
      />
      <Card padding={false}><TableSkeleton rows={6} /></Card>
    </div>
  )
  if (error) return <ErrorAlert error={error as Error} onRetry={refetchAll} />

  return (
    <div className="space-y-5">
      <PageHeader
        title="数据源配置"
        description="数据源页只负责源身份、参数和计划；节点关系和运行诊断交给拓扑工作台。"
        action={
          <div className="flex flex-wrap items-center gap-2">
            {selectedSource && (
              <Button type="button" variant="outline" onClick={() => setScheduleDraftSourceId(selectedSource.id)}>
                <Calendar size={16} /> 新增计划
              </Button>
            )}
            <Button type="button" onClick={() => openAddModal('opencli')}>
              <Plus size={16} /> 新增数据源
            </Button>
          </div>
        }
      />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricTile
          label="SOURCES"
          value={sources.length}
          sub={`${enabledCount} 个启用`}
          icon={Database}
          tone="accent"
        />
        <MetricTile
          label="PLANS"
          value={`${graph.summary.enabledSchedules}/${graph.summary.schedules}`}
          sub="启用 / 全部计划"
          icon={Calendar}
          tone={graph.summary.enabledSchedules > 0 ? 'success' : 'neutral'}
        />
      <MetricTile
        label="RUNNING"
        value={graph.summary.runningTasks}
        sub={`${graph.summary.tasks} 个采集任务`}
        icon={Activity}
        tone={graph.summary.runningTasks > 0 ? 'warning' : 'neutral'}
      />
      <MetricTile
        label="FAILED"
        value={graph.summary.failedTasks}
        sub={isFetching ? '正在刷新' : `${filteredSources.length} 个源可见`}
        icon={Filter}
        tone={graph.summary.failedTasks > 0 ? 'danger' : 'neutral'}
      />
    </div>

    <SourceConfigurationPanel
      sources={filteredSources}
      statsBySource={graph.sourceStats}
      selectedSourceId={selectedSource?.id}
      actionStates={actionStates}
      showDiagnosticCanvas={showDiagnosticCanvas}
      onSelect={(source) => setSelectedNodeId(workflowNodeId('source', source.id))}
      onTrigger={(source) => {
        setSelectedNodeId(workflowNodeId('source', source.id))
        setPendingActionSource({ source, actionId: 'source.trigger' })
      }}
      onEdit={setEditSource}
      onAddSchedule={(source) => setScheduleDraftSourceId(source.id)}
      onToggle={(source) => toggleMut.mutate({ id: source.id, enabled: !source.enabled })}
      onOpenAdd={() => openAddModal('opencli')}
      onToggleDiagnosticCanvas={() => setShowDiagnosticCanvas((value) => !value)}
    />

    {showDiagnosticCanvas && (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <section className="min-w-0 overflow-hidden border border-white/10 bg-black/20">
          <PanelHeader
            label="COLLECTION CANVAS"
            title={<h2 className="text-base font-semibold text-zinc-50">采集自由画布</h2>}
            description="拖拽节点会自动保存到本地布局；计划节点复用现有 Cron Schedule API。"
            actions={
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{isAgentMode ? 'Agent mode' : 'Local mode'}</Badge>
                <Button type="button" size="sm" variant="outline" onClick={resetCanvasLayout}>
                  <RotateCcw size={14} /> 重置布局
                </Button>
              </div>
            }
          />

          <div className="space-y-4 border-b border-white/10 px-5 py-4">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" />
                <Input
                  id="sources-canvas-search"
                  name="sources-canvas-search"
                  type="text"
                  placeholder="搜索源、目标、备注..."
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  className="pl-9"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {filterChips.map((chip) => (
                  <button
                    key={chip.value}
                    type="button"
                    onClick={() => setChannelFilter(chip.value)}
                    className={cn(
                      'inline-flex h-9 items-center gap-2 rounded-md border px-3 font-telemetry text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors',
                      channelFilter === chip.value
                        ? 'border-primary-500/70 bg-primary-500/16 text-white'
                        : 'border-white/10 bg-black/20 text-zinc-400 hover:border-white/22 hover:text-zinc-100',
                    )}
                  >
                    {chip.label}
                    <span className="font-mono text-[10px] text-zinc-500">{chip.count}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
              {CHANNEL_TYPES.map((type) => {
                const nodeMeta = CHANNEL_META[type]
                const Icon = nodeMeta.icon
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => openAddModal(type)}
                    className="group flex min-h-20 flex-col items-start justify-between rounded-md border border-white/10 bg-black/25 p-3 text-left transition-colors hover:border-primary-500/45 hover:bg-white/4.5"
                  >
                    <span className={cn('grid h-8 w-8 place-items-center rounded-md border transition-colors', nodeMeta.tone)}>
                      <Icon size={15} />
                    </span>
                    <span className="mt-3 text-xs font-semibold text-zinc-200">{nodeMeta.label}</span>
                    <span className="mt-1 text-[11px] text-zinc-600">{nodeMeta.hint}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="relative h-[calc(100vh-360px)] min-h-[620px] bg-zinc-950">
            {filteredSources.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                <span className="grid h-12 w-12 place-items-center rounded-md border border-white/10 bg-white/[0.035] text-zinc-500">
                  <Database size={20} />
                </span>
                <h3 className="mt-4 text-sm font-semibold text-zinc-200">
                  {searchQuery || channelFilter !== 'all' ? '没有匹配的数据源' : '还没有数据源'}
                </h3>
                <p className="mt-2 max-w-sm text-xs text-zinc-500">
                  {searchQuery || channelFilter !== 'all'
                    ? '换一个筛选条件，或者直接创建新的采集节点。'
                    : '先放一个 OpenCLI、RSS 或 API 节点，再在 Inspector 里挂采集计划。'}
                </p>
                <Button type="button" className="mt-5" onClick={() => openAddModal('opencli')}>
                  <Plus size={15} /> 新增数据源
                </Button>
              </div>
            ) : (
              <ReactFlow
                nodes={flowNodes}
                edges={flowEdges}
                nodeTypes={workflowNodeTypes}
                onNodesChange={handleNodesChange}
                onNodeClick={(_: ReactMouseEvent, node: WorkflowFlowNode) => setSelectedNodeId(node.id)}
                onPaneClick={() => setSelectedNodeId(null)}
                defaultViewport={{ x: 32, y: 96, zoom: 0.82 }}
                minZoom={0.28}
                maxZoom={1.2}
                nodesDraggable
                nodesFocusable
                edgesFocusable
              >
                <Background color="#3f3f46" gap={24} />
                <Controls position="bottom-left" />
                <MiniMap
                  position="bottom-right"
                  nodeColor={(node) => workflowHealthColor((node.data as WorkflowNodeData).health, 'mini')}
                  maskColor="rgba(9, 9, 11, 0.74)"
                  pannable
                  zoomable
                />
                <Panel position="top-left">
                  <div className="rounded-md border border-white/10 bg-zinc-950/90 px-3 py-2 text-xs text-zinc-400 shadow-lg">
                    <span className="font-mono text-zinc-600">{SOURCE_WORKFLOW_LAYOUT_KEY}</span>
                  </div>
                </Panel>
              </ReactFlow>
            )}
          </div>
        </section>

        <WorkflowInspector
          node={selectedNode}
          source={selectedSource}
          schedule={selectedSchedule}
          task={selectedTask}
          stats={selectedStats}
          actionStates={actionStates}
          onRunAction={runWorkflowAction}
          onEditSource={() => { if (selectedSource) setEditSource(selectedSource) }}
          onDeleteSource={() => { if (selectedSource) setDeleteTarget(selectedSource) }}
          onToggleSource={() => {
            if (selectedSource) toggleMut.mutate({ id: selectedSource.id, enabled: !selectedSource.enabled })
          }}
          onAddSchedule={() => { if (selectedSource) setScheduleDraftSourceId(selectedSource.id) }}
          onEditSchedule={() => { if (selectedSchedule) setEditSchedule(selectedSchedule) }}
          onToggleSchedule={() => {
            if (selectedSchedule) {
              updateScheduleMut.mutate({ id: selectedSchedule.id, data: { enabled: !selectedSchedule.enabled } })
            }
          }}
          onDeleteSchedule={() => { if (selectedSchedule) setDeleteScheduleTarget(selectedSchedule) }}
      />
    </div>
    )}

    {showAdd && (
        <SourceModal
          key={draftType}
          initialType={draftType}
          onClose={() => setShowAdd(false)}
          onSave={(data) => createMut.mutate(data)}
        />
      )}

      {editSource && (
        <SourceModal
          initial={editSource}
          onClose={() => setEditSource(null)}
          onSave={(data) => updateMut.mutate({ id: editSource.id, data })}
        />
      )}

      {scheduleDraftSourceId && (
        <ScheduleModal
          sources={sources}
          defaultSourceId={scheduleDraftSourceId}
          onClose={() => setScheduleDraftSourceId(null)}
          onSave={(data) => createScheduleMut.mutate(data)}
        />
      )}

      {editSchedule && (
        <ScheduleModal
          initial={editSchedule}
          sources={sources}
          onClose={() => setEditSchedule(null)}
          onSave={(data) => updateScheduleMut.mutate({ id: editSchedule.id, data })}
        />
      )}

      {pendingActionSource && (
        <TriggerModal
          source={pendingActionSource.source}
          isAgentMode={isAgentMode}
          onClose={() => setPendingActionSource(null)}
          onTrigger={runPendingSourceAction}
        />
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}
        title={`确认删除「${deleteTarget?.name ?? ''}」？`}
        description="此操作不可撤销，数据源将被永久删除。"
        confirmLabel="确认删除"
        variant="destructive"
        onConfirm={() => {
          if (deleteTarget) {
            deleteMut.mutate(deleteTarget.id)
            setDeleteTarget(null)
          }
        }}
      />

      <ConfirmDialog
        open={deleteScheduleTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteScheduleTarget(null) }}
        title={`确认删除计划「${deleteScheduleTarget?.name ?? ''}」？`}
        description="计划会被删除，但历史任务不会被修改。"
        confirmLabel="删除计划"
        variant="destructive"
        onConfirm={() => {
          if (deleteScheduleTarget) {
            deleteScheduleMut.mutate(deleteScheduleTarget.id)
            setDeleteScheduleTarget(null)
          }
        }}
      />
    </div>
  )
}

function toWorkflowFlowNode(node: ReturnType<typeof buildCollectionWorkflow>['nodes'][number]): WorkflowFlowNode {
  return {
    id: node.id,
    type: 'workflowNode',
    position: node.position,
    data: node.data,
  }
}

function toWorkflowFlowEdges(edges: ReturnType<typeof buildCollectionWorkflow>['edges']): WorkflowFlowEdge[] {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    type: 'smoothstep',
    data: { health: edge.health },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: workflowHealthColor(edge.health, 'line'),
    },
    style: {
      stroke: workflowHealthColor(edge.health, 'line'),
      strokeWidth: edge.health === 'failed' ? 2.5 : 1.6,
      strokeDasharray: edge.health === 'unknown' ? '5 5' : undefined,
    },
    labelStyle: {
      fill: '#a1a1aa',
      fontSize: 11,
      fontWeight: 700,
    },
    labelBgStyle: {
      fill: '#09090b',
      fillOpacity: 0.85,
    },
  }))
}

function workflowKindLabel(kind: WorkflowNodeData['kind']) {
  const labels: Record<WorkflowNodeData['kind'], string> = {
    source: 'Source',
    schedule: 'Plan',
    task: 'Task',
  }
  return labels[kind]
}

function workflowHealthLabel(health: WorkflowHealth) {
  const labels: Record<WorkflowHealth, string> = {
    healthy: 'healthy',
    active: 'running',
    warning: 'attention',
    failed: 'failed',
    disabled: 'disabled',
    unknown: 'unknown',
  }
  return labels[health]
}

function workflowHealthColor(health: WorkflowHealth, context: 'line' | 'mini') {
  const colors: Record<WorkflowHealth, string> = {
    healthy: context === 'line' ? '#22c55e' : '#16a34a',
    active: '#38bdf8',
    warning: '#f59e0b',
    failed: '#ef4444',
    disabled: '#71717a',
    unknown: '#a1a1aa',
  }
  return colors[health]
}

function workflowHealthDotClass(health: WorkflowHealth) {
  const classes: Record<WorkflowHealth, string> = {
    healthy: 'bg-emerald-400',
    active: 'bg-sky-400',
    warning: 'bg-amber-400',
    failed: 'bg-red-400',
    disabled: 'bg-zinc-500',
    unknown: 'bg-zinc-300',
  }
  return classes[health]
}

function workflowHealthSoftClass(health: WorkflowHealth) {
  const classes: Record<WorkflowHealth, string> = {
    healthy: 'border-emerald-400/35 bg-emerald-400/10 text-emerald-200',
    active: 'border-sky-400/35 bg-sky-400/10 text-sky-200',
    warning: 'border-amber-400/35 bg-amber-400/10 text-amber-200',
    failed: 'border-red-400/35 bg-red-400/10 text-red-200',
    disabled: 'border-zinc-500/35 bg-zinc-500/10 text-zinc-300',
    unknown: 'border-zinc-500/35 bg-zinc-500/10 text-zinc-300',
  }
  return classes[health]
}

function workflowHealthPillClass(health: WorkflowHealth) {
  const classes: Record<WorkflowHealth, string> = {
    healthy: 'bg-emerald-400/10 text-emerald-300',
    active: 'bg-sky-400/10 text-sky-300',
    warning: 'bg-amber-400/10 text-amber-300',
    failed: 'bg-red-400/10 text-red-300',
    disabled: 'bg-zinc-700 text-zinc-300',
    unknown: 'bg-zinc-700 text-zinc-300',
  }
  return classes[health]
}

function formatDateTime(value?: string | null) {
  if (!value) return 'N/A'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}
