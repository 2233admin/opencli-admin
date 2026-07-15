import {
  Activity,
  Bot,
  Database,
  Inbox,
  LayoutDashboard,
  PanelsTopLeft,
  ShieldCheck,
  SquareCheckBig,
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
 * Action-oriented IA: orient in the workbench, build automations, observe
 * execution, then manage the platform.
 * Related resource routes remain available through each destination's tabs.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: '工作台',
    items: [
      { href: '/dashboard', label: '概览', icon: LayoutDashboard },
      { href: '/inbox', label: '待我处理', icon: Inbox, match: ['/inbox', '/notifications'] },
    ],
  },
  {
    label: '构建',
    items: [
      { href: '/studio', label: '工作区', icon: PanelsTopLeft, match: ['/studio', '/canvas'] },
      { href: '/sources', label: '自动化', icon: Workflow, match: ['/sources', '/schedules'] },
      { href: '/agents', label: 'Agent 团队', icon: Bot, match: ['/agents', '/skills'] },
    ],
  },
  {
    label: '运行',
    items: [
      { href: '/tasks', label: '工作项', icon: SquareCheckBig },
      {
        href: '/nodes',
        label: '执行资源',
        icon: Activity,
        match: ['/nodes', '/workers'],
      },
      { href: '/records', label: '成果与数据', icon: Database },
    ],
  },
  {
    label: '管理',
    items: [
      {
        href: '/providers',
        label: '治理与设置',
        icon: ShieldCheck,
        match: ['/providers', '/control/actions'],
      },
    ],
  },
]

/** Labels for every route (incl. tab siblings) used by breadcrumbs. */
export const ROUTE_LABELS: Record<string, string> = {
  '/dashboard': '概览',
  '/inbox': '待我处理',
  '/studio': '工作区',
  '/studio/workflow': '节点工作流',
  '/canvas': '节点工作流（兼容入口）',
  '/sources': '采集来源',
  '/schedules': '触发与调度',
  '/tasks': '工作项',
  '/records': '成果与数据',
  '/notifications': '通知',
  '/agents': '智能体',
  '/skills': '技能',
  '/providers': '模型与连接',
  '/nodes': '执行资源',
  '/workers': 'Worker',
  '/control/actions': '控制与审计',
}
