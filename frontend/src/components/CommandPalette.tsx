import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Command } from 'cmdk'
import {
  Bell,
  Bot,
  Database,
  FileText,
  Gauge,
  KeyRound,
  ListChecks,
  Network,
  Search,
  Server,
  Settings,
  Workflow,
  X,
} from 'lucide-react'

interface CommandAction {
  id: string
  label: string
  hint: string
  keywords: string[]
  to: string
  icon: typeof Gauge
}

export default function CommandPalette() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)

  const actions = useMemo<CommandAction[]>(
    () => [
      {
        id: 'dashboard',
        label: t('nav.dashboard'),
        hint: 'overview health stats',
        keywords: ['dashboard', 'overview', '仪表盘', '概览'],
        to: '/dashboard',
        icon: Gauge,
      },
      {
        id: 'topology',
        label: t('nav.topology'),
        hint: 'node graph data flow',
        keywords: ['topology', 'graph', 'node', 'flow', '拓扑', '节点'],
        to: '/topology',
        icon: Workflow,
      },
      {
        id: 'records',
        label: t('nav.records'),
        hint: 'collected data notebook',
        keywords: ['records', 'data', 'notes', '采集记录', '笔记', '数据'],
        to: '/records',
        icon: FileText,
      },
      {
        id: 'tasks',
        label: t('nav.tasks'),
        hint: 'runs failures events',
        keywords: ['tasks', 'runs', 'failed', '任务', '失败', '运行'],
        to: '/tasks',
        icon: ListChecks,
      },
      {
        id: 'sources',
        label: t('nav.sources'),
        hint: 'channels feeds sites',
        keywords: ['sources', 'channels', 'feeds', '数据源', '来源'],
        to: '/sources',
        icon: Database,
      },
      {
        id: 'nodes',
        label: t('nav.browsers'),
        hint: 'edge collection nodes',
        keywords: ['nodes', 'browser', 'agent', '采集节点', '浏览器'],
        to: '/nodes',
        icon: Network,
      },
      {
        id: 'agents',
        label: t('nav.agents'),
        hint: 'ai processors prompts',
        keywords: ['agents', 'ai', 'prompt', '智能体'],
        to: '/agents',
        icon: Bot,
      },
      {
        id: 'providers',
        label: t('nav.providers'),
        hint: 'model providers keys',
        keywords: ['providers', 'models', 'keys', '模型', '提供商'],
        to: '/providers',
        icon: KeyRound,
      },
      {
        id: 'notifications',
        label: t('nav.notifications'),
        hint: 'webhook ack delivery',
        keywords: ['notifications', 'webhook', 'ack', '通知', '回执'],
        to: '/notifications',
        icon: Bell,
      },
      {
        id: 'settings',
        label: t('nav.settings'),
        hint: t('command.openSettings'),
        keywords: ['settings', 'preferences', 'configure', '设置', '偏好'],
        to: '/settings',
        icon: Settings,
      },
      {
        id: 'workers',
        label: t('nav.workers'),
        hint: 'celery workers chrome pool',
        keywords: ['workers', 'celery', 'chrome', '工作节点'],
        to: '/workers',
        icon: Server,
      },
    ],
    [t],
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen((value) => !value)
      }
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const run = (to: string) => {
    navigate(to)
    setOpen(false)
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/75 px-4 pt-[12vh] backdrop-blur-sm"
      onMouseDown={() => setOpen(false)}
    >
      <Command
        label={t('command.title')}
        shouldFilter
        className="telemetry-panel w-full max-w-2xl text-zinc-100"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-white/10 px-4">
          <Search className="h-4 w-4 text-primary-400" />
          <Command.Input
            autoFocus
            placeholder={t('command.placeholder')}
            className="h-12 min-w-0 flex-1 bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
          />
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="grid h-8 w-8 place-items-center border border-transparent text-zinc-500 hover:border-white/10 hover:bg-white/[0.05] hover:text-zinc-100"
            title={t('common.cancel')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <Command.List className="max-h-[420px] overflow-y-auto p-2">
          <Command.Empty className="px-3 py-8 text-center text-sm text-zinc-500">
            {t('command.empty')}
          </Command.Empty>
          <Command.Group heading={t('command.navigation')} className="text-xs text-zinc-500">
            {actions.map((action) => {
              const Icon = action.icon
              return (
                <Command.Item
                  key={action.id}
                  value={`${action.label} ${action.hint} ${action.keywords.join(' ')}`}
                  onSelect={() => run(action.to)}
                  className="flex cursor-pointer items-center gap-3 border border-transparent px-3 py-2.5 text-sm text-zinc-300 aria-selected:border-primary-500/50 aria-selected:bg-primary-500/15 aria-selected:text-white"
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{action.label}</span>
                  <span className="hidden text-xs text-zinc-600 sm:block">
                    {action.hint}
                  </span>
                </Command.Item>
              )
            })}
          </Command.Group>
        </Command.List>
        <div className="flex items-center justify-between border-t border-white/10 px-4 py-2 font-telemetry text-[11px] uppercase tracking-[0.14em] text-zinc-500">
          <span>{t('command.footer')}</span>
          <span className="font-mono">Esc</span>
        </div>
      </Command>
    </div>
  )
}
