import {
  Activity,
  Bot,
  Clock,
  Database,
  History,
  KeyRound,
  LayoutDashboard,
  Monitor,
  PanelsTopLeft,
  Inbox,
  Settings,
  ShieldCheck,
  Workflow,
  type LucideIcon,
} from 'lucide-react'

export type NavItem = {
  href: string
  label: string
  icon: LucideIcon
  /** extra path prefixes that keep this item highlighted (sibling tab routes) */
  match?: string[]
}

export type NavGroup = {
  label: string | null
  items: NavItem[]
}

/**
 * Data-node IDE IA. Routes stay stable while the shell groups them by the
 * operator's work: build workflows, move data, then observe the runtime.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [
      { href: '/dashboard', label: '概览', icon: LayoutDashboard },
      { href: '/studio', label: '工作室', icon: PanelsTopLeft },
      { href: '/inbox', label: 'Inbox', icon: Inbox },
    ],
  },
  {
    label: '构建',
    items: [
      { href: '/canvas', label: '节点工作流', icon: Workflow },
      { href: '/operations-agents', label: '自动化与智能体', icon: ShieldCheck },
    ],
  },
  {
    label: '数据链路',
    items: [
      { href: '/sources', label: '采集来源', icon: Database },
      { href: '/schedules', label: '触发与调度', icon: Clock },
      {
        href: '/tasks',
        label: '运行与数据',
        icon: Activity,
        match: ['/tasks', '/records', '/notifications'],
      },
    ],
  },
  {
    label: '集成与运行时',
    items: [
      { href: '/agents', label: '智能体与技能', icon: Bot, match: ['/agents', '/skills'] },
      { href: '/providers', label: '模型与连接', icon: KeyRound },
      { href: '/nodes', label: '节点与 Worker', icon: Monitor, match: ['/nodes', '/workers'] },
      { href: '/control/actions', label: '控制与审计', icon: History },
    ],
  },
  {
    label: null,
    items: [{ href: '/settings', label: '设置', icon: Settings }],
  },
]

/** Labels for every route (incl. tab siblings) used by breadcrumbs. */
export const ROUTE_LABELS: Record<string, string> = {
  '/dashboard': '概览',
  '/studio': '工作室',
  '/canvas': '节点工作流',
  '/inbox': 'Inbox',
  '/operations-agents': '自动化与智能体',
  '/sources': '采集来源',
  '/schedules': '触发与调度',
  '/tasks': '任务',
  '/records': '记录',
  '/notifications': '通知',
  '/agents': '智能体',
  '/skills': '技能',
  '/providers': '模型与连接',
  '/nodes': '浏览器节点',
  '/workers': 'Worker',
  '/control/actions': '控制与审计',
  '/settings': '设置',
}
