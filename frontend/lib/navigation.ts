import {
  Activity,
  Bot,
  Clock,
  Database,
  History,
  KeyRound,
  LayoutDashboard,
  Monitor,
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
 * Task-oriented IA: related views are merged into hub entries and linked
 * with in-page RouteTabs (任务/记录/通知 → 运行中心; 智能体/技能 → 能力;
 * 节点/Worker → 算力), so the sidebar stays short and scannable.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [
      { href: '/dashboard', label: '概览', icon: LayoutDashboard },
      { href: '/canvas', label: '采集画布', icon: Workflow },
    ],
  },
  {
    label: '采集',
    items: [
      { href: '/sources', label: '数据源', icon: Database },
      { href: '/schedules', label: '调度', icon: Clock },
      {
        href: '/tasks',
        label: '运行中心',
        icon: Activity,
        match: ['/tasks', '/records', '/notifications'],
      },
    ],
  },
  {
    label: '能力',
    items: [
      { href: '/agents', label: '智能体与技能', icon: Bot, match: ['/agents', '/skills'] },
      { href: '/providers', label: '模型供应商', icon: KeyRound },
    ],
  },
  {
    label: '算力',
    items: [
      { href: '/nodes', label: '节点与 Worker', icon: Monitor, match: ['/nodes', '/workers'] },
      { href: '/control/actions', label: '控制动作', icon: History },
    ],
  },
]

/** Labels for every route (incl. tab siblings) used by breadcrumbs. */
export const ROUTE_LABELS: Record<string, string> = {
  '/dashboard': '概览',
  '/canvas': '采集画布',
  '/sources': '数据源',
  '/schedules': '调度',
  '/tasks': '任务',
  '/records': '记录',
  '/notifications': '通知',
  '/agents': '智能体',
  '/skills': '技能',
  '/providers': '模型供应商',
  '/nodes': '浏览器节点',
  '/workers': 'Worker',
  '/control/actions': '控制动作',
}
