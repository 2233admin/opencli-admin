import {
  Activity,
  BellRing,
  Blocks,
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
  TableProperties,
  type LucideIcon,
} from 'lucide-react'

export type NavItem = {
  href: string
  label: string
  icon: LucideIcon
  /** extra path prefixes that keep this item highlighted (sibling tab routes) */
  match?: string[]
  /** query values required for the item to be active; null means absent */
  query?: Record<string, string | null>
  /** query values that explicitly prevent the item from being active */
  excludeQuery?: Record<string, string>
}

export type NavGroup = {
  label: string | null
  items: NavItem[]
}

/**
 * Data-node IDE IA. Routes stay stable while the shell groups them by the
 * operator's work: build, move and refine data, run it, then govern runtime.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [
      { href: '/dashboard', label: '概览', icon: LayoutDashboard },
      { href: '/inbox', label: 'Inbox', icon: Inbox },
    ],
  },
  {
    label: '构建',
    items: [
      { href: '/studio', label: '节点工作室', icon: PanelsTopLeft, match: ['/studio'], excludeQuery: { type: 'process' } },
      { href: '/operations-agents', label: '自动化与智能体', icon: ShieldCheck },
    ],
  },
  {
    label: '数据',
    items: [
      { href: '/sources', label: '采集来源', icon: Database },
      { href: '/studio?type=process', label: '清洗与转换', icon: Blocks, query: { type: 'process' } },
      { href: '/records', label: '数据记录', icon: TableProperties },
    ],
  },
  {
    label: '运行',
    items: [
      { href: '/tasks', label: '运行任务', icon: Activity },
      { href: '/schedules', label: '触发与调度', icon: Clock },
      { href: '/notifications', label: '通知规则', icon: BellRing },
    ],
  },
  {
    label: '集成',
    items: [
      { href: '/agents', label: '智能体与技能', icon: Bot, match: ['/agents', '/skills'] },
      { href: '/providers', label: '模型与连接', icon: KeyRound },
    ],
  },
  {
    label: '运行时与治理',
    items: [
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
  '/studio/workflow': '节点工作流',
  '/canvas': '节点工作流（兼容入口）',
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
