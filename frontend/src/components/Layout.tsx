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
  Chrome,
  Network,
  KeyRound,
  ChevronLeft,
  ChevronRight,
  Home,
  Settings,
} from 'lucide-react'
import { clsx } from 'clsx'
import { getDashboardStats } from '../api/endpoints'
import CommandPalette from './CommandPalette'
import {
  SETTINGS_EVENT,
  applyThemePreference,
  getThemePreference,
} from '../lib/preferences'

const ROUTE_LABEL_KEYS: Record<string, string> = {
  '/dashboard': 'nav.dashboard',
  '/topology': 'nav.topology',
  '/sources': 'nav.sources',
  '/tasks': 'nav.tasks',
  '/records': 'nav.records',
  '/schedules': 'nav.schedules',
  '/notifications': 'nav.notifications',
  '/nodes': 'nav.browsers',
  '/workers': 'nav.workers',
  '/providers': 'nav.providers',
  '/agents': 'nav.agents',
  '/settings': 'nav.settings',
}

function Breadcrumb() {
  const { pathname } = useLocation()
  const { t } = useTranslation()
  const routeLabelKey = ROUTE_LABEL_KEYS[pathname]
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

  const NAV_ITEMS = [
    { to: '/dashboard',      label: t('nav.dashboard'),     icon: LayoutDashboard },
    { to: '/topology',       label: t('nav.topology'),      icon: Network },
    { to: '/sources',        label: t('nav.sources'),       icon: Database },
    { to: '/tasks',          label: t('nav.tasks'),         icon: ListChecks },
    { to: '/records',        label: t('nav.records'),       icon: FileText },
    { to: '/schedules',      label: t('nav.schedules'),     icon: Clock },
    { to: '/agents',         label: t('nav.agents'),        icon: Bot },
    { to: '/providers',      label: t('nav.providers'),     icon: KeyRound },
    { to: '/nodes',          label: t('nav.browsers'),      icon: Chrome },
    { to: '/notifications',  label: t('nav.notifications'), icon: Bell },
    { to: '/workers',        label: t('nav.workers'),       icon: Server },
  ]

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
        <nav className="flex-1 space-y-1 px-2 py-4">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => {
            const isTasksItem = to === '/tasks'
            const showBadge = isTasksItem && failedCount > 0

            return (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  clsx(
                    'group flex items-center gap-3 border border-transparent px-3 py-2 text-sm transition-colors',
                    isActive
                      ? 'border-primary-500/45 bg-primary-500/10 text-white'
                      : 'text-zinc-500 hover:border-white/10 hover:bg-white/[0.04] hover:text-zinc-100'
                  )
                }
                title={sidebarCollapsed ? label : undefined}
              >
                <Icon size={18} className="shrink-0" />
                {!sidebarCollapsed && (
                  <span className="flex-1 flex items-center justify-between">
                    <span className="truncate">{label}</span>
                    {showBadge && (
                      <span className="flex h-[18px] min-w-[18px] items-center justify-center border border-primary-500/50 bg-primary-500/20 px-1.5 text-center text-[10px] leading-[18px] text-primary-100">
                        {failedCount}
                      </span>
                    )}
                  </span>
                )}
              </NavLink>
            )
          })}
        </nav>

        {/* Bottom controls */}
        <div className="flex flex-col gap-2 border-t border-white/10 px-2 py-3">
          <button
            onClick={() => navigate('/settings')}
            className="flex items-center gap-3 border border-transparent px-3 py-2 text-sm text-zinc-500 transition-colors hover:border-white/10 hover:bg-white/[0.04] hover:text-zinc-100"
          >
            <Settings size={18} />
            {!sidebarCollapsed && <span className="font-medium uppercase tracking-[0.08em]">{t('nav.settings')}</span>}
          </button>

          {/* Collapse toggle */}
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="flex items-center gap-3 border border-transparent px-3 py-2 text-sm text-zinc-500 transition-colors hover:border-white/10 hover:bg-white/[0.04] hover:text-zinc-100"
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
