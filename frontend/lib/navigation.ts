import {
  Activity,
  Bot,
  Database,
  Inbox,
  LayoutDashboard,
  PanelsTopLeft,
  ShieldCheck,
  Sparkles,
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
 * Task-first IA inspired by the control-plane model: start with work that
 * needs attention, then move through execution, outcomes, and governance.
 * Related resource routes remain available through each destination's tabs.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [
      { href: '/dashboard', label: '概览', icon: LayoutDashboard },
      { href: '/inbox', label: '待我处理', icon: Inbox, match: ['/inbox', '/notifications'] },
    ],
  },
  {
    label: '工作',
    items: [
      { href: '/studio', label: '工作区', icon: PanelsTopLeft, match: ['/studio', '/canvas'] },
      { href: '/tasks', label: '工作项', icon: SquareCheckBig },
    ],
  },
  {
    label: '执行与成果',
    items: [
      { href: '/sources', label: '自动化', icon: Workflow, match: ['/sources', '/schedules'] },
      {
        href: '/nodes',
        label: '执行资源',
        icon: Activity,
        match: ['/nodes', '/workers'],
      },
      { href: '/records', label: '成果与数据', icon: Database },
      { href: '/agents', label: 'Agent 团队', icon: Bot, match: ['/agents', '/skills'] },
    ],
  },
  {
    label: '系统',
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

export const CREATE_WORK_ITEM: NavItem = {
  href: '/studio/workflow',
  label: '新建工作',
  icon: Sparkles,
}

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
