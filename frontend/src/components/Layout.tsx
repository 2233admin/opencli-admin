import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom'
import ErrorBoundary from './ErrorBoundary'
import {
  LayoutDashboard,
  Database,
  ListChecks,
  FileText,
  Clock,
  Bell,
  Server,
  Bot,
  Monitor,
  KeyRound,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Home,
  Settings,
  SlidersHorizontal,
  Workflow,
  Sparkles,
  History,
} from 'lucide-react'
import { clsx } from 'clsx'
import { getDashboardStats } from '../api/endpoints'
import CommandPalette from './CommandPalette'
import {
  SETTINGS_EVENT,
  applyThemePreference,
  getThemePreference,
} from '../lib/preferences'
import { isTopologyLabEnabled } from '../labs/topology/flags'

const ROUTE_LABEL_KEYS: Record<string, string> = {
  '/dashboard': 'nav.dashboard',
  '/plans': 'nav.planCanvas',
  '/plans/new': 'nav.planCanvas',
  '/sources': 'nav.sources',
  '/tasks': 'nav.tasks',
  '/records': 'nav.records',
  '/schedules': 'nav.schedules',
  '/notifications': 'nav.notifications',
  '/nodes': 'nav.browsers',
  '/workers': 'nav.workers',
  '/providers': 'nav.providers',
  '/agents': 'nav.agents',
  '/skills': 'nav.skills',
  '/control/actions': 'nav.actionHistory',
  '/settings': 'nav.settings',
}

function Breadcrumb() {
  const { pathname } = useLocation()
  const { t } = useTranslation()
  // /plans/:planId isn't in the exact-match map above (the id is dynamic), but
  // it is still the same Collection Canvas surface as /plans and /plans/new —
  // fall back to a prefix match so opening a saved plan still crumbs sensibly.
  const routeLabelKey = ROUTE_LABEL_KEYS[pathname] ?? (pathname.startsWith('/plans') ? 'nav.planCanvas' : undefined)
  const label = routeLabelKey ? t(routeLabelKey) : ''

  return (
    <div className="mb-4 flex items-center gap-1.5 font-telemetry text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-600">
      <Home size={12} className="shrink-0 text-primary-500" />
      <span>{t('nav.home')}</span>
      {routeLabelKey && (
        <>
          <span className="text-zinc-700">/</span>
          <span className="text-zinc-400">{label}</span>
        </>
      )}
    </div>
  )
}

export default function Layout() {
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [dark, setDark] = useState(() => getThemePreference() === 'dark')
  const [isNarrow, setIsNarrow] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 767px)').matches : false
  )

  const { data: statsData } = useQuery({
    queryKey: ['dashboard-stats-badge'],
    queryFn: () => getDashboardStats(),
    refetchInterval: 30_000,
  })

  const failedCount = statsData?.tasks?.failed ?? 0

  useEffect(() => {
    applyThemePreference(dark ? 'dark' : 'light')
  }, [dark])

  useEffect(() => {
    const onSettingsChanged = () => {
      setDark(getThemePreference() === 'dark')
    }
    if (typeof window !== 'undefined') {
      window.addEventListener(SETTINGS_EVENT, onSettingsChanged)
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener(SETTINGS_EVENT, onSettingsChanged)
      }
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const mediaQuery = window.matchMedia('(max-width: 767px)')
    const onChange = () => setIsNarrow(mediaQuery.matches)

    onChange()
    mediaQuery.addEventListener('change', onChange)
    return () => mediaQuery.removeEventListener('change', onChange)
  }, [])

  const sidebarCollapsed = collapsed || isNarrow

  type NavItem = { to: string; label: string; icon: typeof Database; stage?: string }
  type NavGroup = { label: string | null; items: NavItem[] }

  const PIPELINE_GROUP: NavGroup = {
    label: '采集管线',
    items: [
      { to: '/sources',       label: t('nav.sources'),       icon: Database,  stage: 'IN' },
      { to: '/schedules',     label: t('nav.schedules'),     icon: Clock,     stage: 'TR' },
      { to: '/tasks',         label: t('nav.tasks'),         icon: ListChecks, stage: 'EX' },
      { to: '/agents',        label: t('nav.agents'),        icon: Bot,       stage: 'PR' },
      { to: '/skills',        label: t('nav.skills'),        icon: Sparkles,  stage: 'SK' },
      { to: '/records',       label: t('nav.records'),       icon: FileText,  stage: 'DB' },
      { to: '/notifications', label: t('nav.notifications'), icon: Bell,      stage: 'OUT' },
    ],
  }
  const INFRA_GROUP: NavGroup = {
    label: '基础设施',
    items: [
      { to: '/nodes',           label: t('nav.browsers'),      icon: Monitor },
      { to: '/workers',         label: t('nav.workers'),       icon: Server },
      { to: '/providers',       label: t('nav.providers'),     icon: KeyRound },
      { to: '/control/actions', label: t('nav.actionHistory'), icon: History },
    ],
  }

  // Folded IA (new design philosophy): the canvas + agent dock are HOME; the
  // 11 CRUD admin pages are demoted into a collapsible "advanced / raw data"
  // drawer. Day-to-day = look at the graph, talk to the agent. Routes kept.
  // ONE Collection Canvas entry per ADR-0008 — it hosts both the global
  // topology overview (formerly its own /labs/topology nav entry) and the
  // per-plan editor as two views/lenses of the same surface, switched inside
  // the page (see pages/PlanCanvasPage.tsx ViewSwitch), not two nav rows.
  // The retired node-kit workbench (/labs/node-kit) is intentionally absent
  // here — component-library demo only, reachable by URL, not product nav
  // (Plan IR issue 09).
  const PRIMARY_ITEMS: NavItem[] = [
    { to: '/plans',     label: t('nav.planCanvas'), icon: Workflow },
    { to: '/dashboard', label: t('nav.dashboard'), icon: LayoutDashboard },
  ]
  const ADVANCED_GROUPS: NavGroup[] = [PIPELINE_GROUP, INFRA_GROUP]

  // Legacy IA (topology lab off): original flat 3-group nav, unchanged.
  const NAV_GROUPS: NavGroup[] = [
    {
      label: null,
      items: [
        { to: '/dashboard', label: t('nav.dashboard'), icon: LayoutDashboard },
        { to: '/plans',     label: t('nav.planCanvas'), icon: Workflow },
      ],
    },
    PIPELINE_GROUP,
    INFRA_GROUP,
  ]

  const renderNavItem = ({ to, label, icon: Icon, stage }: NavItem) => {
    const showBadge = to === '/tasks' && failedCount > 0
    return (
      <NavLink
        key={to}
        to={to}
        className={({ isActive }) =>
          clsx(
            'group flex items-center gap-3 border border-transparent px-3 py-2 text-sm transition-colors',
            isActive
              ? 'border-primary-500/45 bg-primary-500/10 text-white'
              : 'text-zinc-500 hover:border-white/10 hover:bg-white/4 hover:text-zinc-100'
          )
        }
        title={sidebarCollapsed ? label : undefined}
      >
        <Icon size={18} className="shrink-0" />
        {!sidebarCollapsed && (
          <span className="flex flex-1 items-center justify-between gap-2">
            <span className="truncate">{label}</span>
            {showBadge ? (
              <span className="flex h-[18px] min-w-[18px] items-center justify-center border border-primary-500/50 bg-primary-500/20 px-1.5 text-center text-[10px] leading-[18px] text-primary-100">
                {failedCount}
              </span>
            ) : stage ? (
              <span className="shrink-0 font-code text-[9px] tracking-wider text-zinc-600 group-hover:text-zinc-400">
                {stage}
              </span>
            ) : null}
          </span>
        )}
      </NavLink>
    )
  }

  const renderNavGroup = (group: NavGroup, groupIndex: number) => (
    <div key={group.label ?? `group-${groupIndex}`} className="space-y-1">
      {group.label && !sidebarCollapsed && (
        <p className="px-3 pb-1 pt-2 font-telemetry text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-600">
          {group.label}
        </p>
      )}
      {group.label && sidebarCollapsed && (
        <div className="mx-3 my-2 border-t border-white/6" />
      )}
      {group.items.map(renderNavItem)}
    </div>
  )

  return (
    <div className={clsx('flex h-screen overflow-hidden bg-[#070809] text-zinc-100', dark && 'dark')}>
      {/* Sidebar */}
      <aside
        className={clsx(
          'flex flex-col border-r border-white/10 bg-[#050607] text-zinc-100 transition-all duration-200',
          sidebarCollapsed ? 'w-16' : 'w-56'
        )}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 border-b border-white/10 px-4 py-5">
          <span className="grid h-8 w-8 shrink-0 place-items-center border border-primary-500/60 bg-primary-500/10 font-telemetry text-[11px] font-black tracking-[-0.02em] text-primary-100">
            OC
          </span>
          {!sidebarCollapsed && (
            <div className="min-w-0">
              <span className="block truncate font-telemetry text-sm font-semibold uppercase tracking-[0.12em]">
                OpenCLI
              </span>
              <span className="block font-telemetry text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                {t('brand.subtitle')}
              </span>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-3 overflow-y-auto px-2 py-4">
          {isTopologyLabEnabled ? (
            <>
              {/* Primary: canvas + dock are home */}
              <div className="space-y-1">{PRIMARY_ITEMS.map(renderNavItem)}</div>

              {/* Advanced drawer: the 11 CRUD admin pages, collapsed by default */}
              <div className="space-y-1">
                {!sidebarCollapsed && <div className="mx-3 my-2 border-t border-white/6" />}
                <button
                  onClick={() => setAdvancedOpen((o) => !o)}
                  className={clsx(
                    'group flex w-full items-center gap-3 border border-transparent px-3 py-2 text-sm transition-colors',
                    advancedOpen
                      ? 'text-zinc-300'
                      : 'text-zinc-500 hover:border-white/10 hover:bg-white/4 hover:text-zinc-100'
                  )}
                  title={sidebarCollapsed ? t('nav.advanced') : undefined}
                >
                  <SlidersHorizontal size={18} className="shrink-0" />
                  {!sidebarCollapsed && (
                    <span className="flex flex-1 items-center justify-between gap-2">
                      <span className="truncate font-telemetry text-[11px] font-semibold uppercase tracking-[0.14em]">
                        {t('nav.advanced')}
                      </span>
                      {advancedOpen ? (
                        <ChevronDown size={14} className="shrink-0" />
                      ) : (
                        <ChevronRight size={14} className="shrink-0" />
                      )}
                    </span>
                  )}
                </button>
                {advancedOpen && ADVANCED_GROUPS.map(renderNavGroup)}
              </div>
            </>
          ) : (
            NAV_GROUPS.map(renderNavGroup)
          )}
        </nav>

        {/* Bottom controls */}
        <div className="flex flex-col gap-2 border-t border-white/10 px-2 py-3">
          <button
            onClick={() => navigate('/settings')}
            className="flex items-center gap-3 border border-transparent px-3 py-2 text-sm text-zinc-500 transition-colors hover:border-white/10 hover:bg-white/4 hover:text-zinc-100"
          >
            <Settings size={18} />
            {!sidebarCollapsed && <span className="font-medium uppercase tracking-[0.08em]">{t('nav.settings')}</span>}
          </button>

          {/* Collapse toggle */}
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="flex items-center gap-3 border border-transparent px-3 py-2 text-sm text-zinc-500 transition-colors hover:border-white/10 hover:bg-white/4 hover:text-zinc-100"
          >
            {sidebarCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
            {!sidebarCollapsed && <span>{t('nav.collapse')}</span>}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="mission-canvas flex-1 overflow-auto">
        <div className="p-4 md:p-6">
          <ErrorBoundary>
            <div key={location.pathname} className="page-enter">
              <Breadcrumb />
              <Outlet />
            </div>
          </ErrorBoundary>
        </div>
      </main>
      <CommandPalette />
    </div>
  )
}
