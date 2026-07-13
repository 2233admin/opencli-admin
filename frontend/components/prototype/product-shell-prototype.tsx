"use client"

import { useEffect, useState, type ComponentType } from "react"
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Boxes,
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Code2,
  Database,
  FileCheck2,
  Inbox,
  LayoutDashboard,
  MoreHorizontal,
  PanelRight,
  Play,
  Plug,
  Radio,
  RefreshCw,
  Rocket,
  Search,
  ShieldCheck,
  TerminalSquare,
  UserRoundCheck,
  Workflow,
  X,
} from "lucide-react"

import {
  PrototypeSwitcher,
  type PrototypeVariant,
} from "@/components/prototype/prototype-switcher"
import { cn } from "@/lib/utils"

type Icon = ComponentType<{ className?: string; "aria-hidden"?: boolean }>

const navGroups: Array<{
  label: string
  items: Array<{ label: string; icon: Icon; active?: boolean; count?: string }>
}> = [
  {
    label: "处理",
    items: [
      { label: "概览", icon: LayoutDashboard },
      { label: "待我处理", icon: Inbox, count: "5" },
      { label: "工作区", icon: Boxes, active: true },
    ],
  },
  {
    label: "平台能力",
    items: [
      { label: "Agent 与模型", icon: Bot },
      { label: "插件市场", icon: Plug },
      { label: "集成中心", icon: Braces },
    ],
  },
  {
    label: "系统",
    items: [
      { label: "成员与权限", icon: UserRoundCheck },
      { label: "治理与设置", icon: ShieldCheck },
    ],
  },
]

const lifecycleTabs = ["总览", "工作项", "编排", "调试运行", "版本", "成果与审计"]
const projectLifecycleTabs = ["项目概览", "编排", "调试", "发布", "监测"]

const runs = [
  { id: "RUN-1842", label: "调试运行", status: "失败", time: "10:42", tone: "danger" },
  { id: "RUN-1841", label: "生产运行", status: "成功", time: "09:30", tone: "success" },
  { id: "RUN-1840", label: "生产运行", status: "成功", time: "08:00", tone: "success" },
]

const workItems = [
  {
    id: "CLI-248",
    title: "修复小红书采集与复核链路",
    status: "处理中",
    owner: "数据运营组",
    priority: "P0",
    selected: true,
  },
  {
    id: "CLI-246",
    title: "补齐品牌别名词典并回放 24h 数据",
    status: "待处理",
    owner: "研究 Agent",
    priority: "P1",
  },
  {
    id: "CLI-239",
    title: "审批周报自动发布版本 v18",
    status: "待审批",
    owner: "林澈",
    priority: "P1",
  },
  {
    id: "CLI-233",
    title: "优化高风险舆情摘要提示词",
    status: "已完成",
    owner: "内容策略组",
    priority: "P2",
  },
]

const timeline = [
  { time: "10:48", title: "运行失败已转为工作项", detail: "RUN-1842 · 自动关联失败节点与输入快照", icon: AlertTriangle },
  { time: "10:45", title: "生成 12 条候选证据", detail: "其中 2 条需要人工复核", icon: FileCheck2 },
  { time: "10:42", title: "调试运行由林澈发起", detail: "草稿 v19 · 使用 24h 回放样本", icon: Play },
  { time: "09:55", title: "工作项优先级调整为 P0", detail: "原因：连续两次采集缺口", icon: ArrowRight },
]

function normalizeVariant(value?: string): PrototypeVariant {
  return value === "A" || value === "B" || value === "C" ? value : "C"
}

function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground", className)}>
      {children}
    </span>
  )
}

function StatusDot({ tone = "neutral" }: { tone?: "neutral" | "success" | "warning" | "danger" | "info" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "size-1.5 shrink-0 rounded-full bg-muted-foreground",
        tone === "success" && "bg-success",
        tone === "warning" && "bg-warning",
        tone === "danger" && "bg-destructive",
        tone === "info" && "bg-info",
      )}
    />
  )
}

function Pill({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode
  tone?: "neutral" | "success" | "warning" | "danger" | "info"
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1.5 rounded-full border border-border px-2 font-mono text-[10px] text-muted-foreground",
        tone === "success" && "border-success/30 bg-success/10 text-success",
        tone === "warning" && "border-warning/30 bg-warning/10 text-warning",
        tone === "danger" && "border-destructive/30 bg-destructive/10 text-destructive",
        tone === "info" && "border-info/30 bg-info/10 text-info",
        className,
      )}
    >
      {children}
    </span>
  )
}

function IconButton({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      className="grid size-8 shrink-0 place-items-center rounded-lg border border-border bg-background text-muted-foreground hover:border-foreground/30 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {children}
    </button>
  )
}

function GlobalNav({ compact = false }: { compact?: boolean }) {
  return (
    <aside
      aria-label="主导航"
      className={cn(
        "hidden min-h-0 border-r border-border bg-sidebar lg:flex lg:flex-col",
        compact ? "w-[196px]" : "w-[220px]",
      )}
    >
      <div className="flex h-14 items-center gap-2 border-b border-border px-4">
        <span className="grid size-6 place-items-center rounded-md bg-foreground text-[10px] font-black text-background">O</span>
        <span className="text-sm font-semibold tracking-tight">OpenCLI</span>
        <Pill className="ml-auto">CONTROL</Pill>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto p-3">
        {navGroups.map((group) => (
          <div key={group.label} className="mb-5">
            <Eyebrow className="px-2">{group.label}</Eyebrow>
            <div className="mt-2 space-y-0.5">
              {group.items.map((item) => {
                const NavIcon = item.icon
                return (
                  <button
                    key={item.label}
                    type="button"
                    className={cn(
                      "flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground",
                      item.active && "bg-foreground text-background hover:bg-foreground hover:text-background",
                    )}
                  >
                    <NavIcon className="size-3.5 shrink-0" aria-hidden={true} />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.count ? (
                      <span className={cn("font-mono text-[9px]", item.active ? "text-background/60" : "text-muted-foreground")}>
                        {item.count}
                      </span>
                    ) : null}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-border p-3">
        <button type="button" className="flex w-full items-center gap-2 rounded-lg p-2 text-left hover:bg-muted">
          <span className="grid size-7 place-items-center rounded-full border border-border bg-card text-[10px]">LC</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium">林澈</span>
            <span className="block truncate font-mono text-[9px] text-muted-foreground">OPERATOR</span>
          </span>
          <MoreHorizontal className="size-3.5 text-muted-foreground" aria-hidden="true" />
        </button>
      </div>
    </aside>
  )
}

function MobileHeader() {
  return (
    <div className="flex h-12 min-w-0 items-center justify-between gap-2 border-b border-border px-3 lg:hidden">
      <div className="flex items-center gap-2">
        <span className="grid size-6 place-items-center rounded-md bg-foreground text-[10px] font-black text-background">O</span>
        <span className="text-sm font-semibold">OpenCLI</span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Pill tone="warning" className="hidden min-[360px]:inline-flex">5 待处理</Pill>
        <IconButton label="打开导航"><PanelRight className="size-4" aria-hidden="true" /></IconButton>
      </div>
    </div>
  )
}

function PrototypeNotice({ variant }: { variant: PrototypeVariant }) {
  const direction = {
    A: "A · 编排优先",
    B: "B · 控制面优先",
    C: "C · 工作区 → 项目 → 节点（选定）",
  }[variant]

  return (
    <div className="flex min-h-8 min-w-0 flex-wrap items-center gap-x-3 gap-y-1 overflow-hidden border-b border-warning/25 bg-warning/8 px-3 py-1.5 text-[10px] text-warning sm:px-4">
      <span className="font-mono tracking-[0.14em]">PRODUCT TEMPLATE · STATIC DATA</span>
      <span className="text-warning/70">{direction}</span>
      <span className="ml-auto hidden text-warning/60 md:block">只验证信息架构与操作闭环，不连接真实接口</span>
    </div>
  )
}

function LifecycleHeader({
  active,
  compact = false,
  tabs = lifecycleTabs,
  contextLabel = "项目",
  title = "品牌风险雷达",
  eyebrow = "持续舆情交付 / 品牌风险雷达",
}: {
  active: string
  compact?: boolean
  tabs?: string[]
  contextLabel?: string
  title?: string
  eyebrow?: string
}) {
  return (
    <header className="min-w-0 border-b border-border bg-background">
      <div className={cn("flex min-w-0 flex-wrap items-start justify-between gap-4 px-4", compact ? "py-3" : "py-4")}>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Eyebrow>{eyebrow}</Eyebrow>
            <Pill tone="success"><StatusDot tone="success" />生产中</Pill>
          </div>
          <div className="mt-1.5 flex min-w-0 items-center gap-2">
            <h1 className={cn("truncate font-semibold tracking-tight", compact ? "text-base" : "text-lg")}>{title}</h1>
            <Pill>{contextLabel}</Pill>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" className="hidden h-8 items-center gap-2 rounded-lg border border-border px-3 text-xs hover:bg-muted sm:flex">
            <Play className="size-3.5" aria-hidden="true" /> 调试
          </button>
          <button type="button" className="flex h-8 items-center gap-2 rounded-lg bg-foreground px-3 text-xs font-medium text-background hover:opacity-85">
            <Rocket className="size-3.5" aria-hidden="true" /> 发布
          </button>
        </div>
      </div>

      <div className="overflow-x-auto px-2 sm:px-4">
        <nav className="flex min-w-max" aria-label={`${contextLabel}生命周期`}>
          {tabs.map((tab) => (
            <button
              key={tab}
              type="button"
              aria-current={tab === active ? "page" : undefined}
              className={cn(
                "relative h-9 px-3 text-xs text-muted-foreground hover:text-foreground",
                tab === active && "font-medium text-foreground after:absolute after:inset-x-3 after:bottom-0 after:h-px after:bg-foreground",
              )}
            >
              {tab}
            </button>
          ))}
        </nav>
      </div>
    </header>
  )
}

function SectionTitle({ eyebrow, title, action }: { eyebrow?: string; title: string; action?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-end justify-between gap-3">
      <div className="min-w-0">
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        <h2 className="mt-1 truncate text-sm font-semibold">{title}</h2>
      </div>
      {action}
    </div>
  )
}

function Metric({ label, value, detail, tone }: { label: string; value: string; detail: string; tone?: "success" | "warning" | "danger" }) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-card/40 p-3">
      <Eyebrow>{label}</Eyebrow>
      <div className="mt-2 flex items-end justify-between gap-2">
        <span className="font-mono text-xl font-medium tracking-tight">{value}</span>
        <StatusDot tone={tone} />
      </div>
      <p className="mt-1 truncate text-[10px] text-muted-foreground">{detail}</p>
    </div>
  )
}

function WorkflowNode({
  icon: NodeIcon,
  eyebrow,
  title,
  detail,
  tone = "neutral",
  selected = false,
}: {
  icon: Icon
  eyebrow: string
  title: string
  detail: string
  tone?: "neutral" | "success" | "warning" | "danger" | "info"
  selected?: boolean
}) {
  return (
    <button
      type="button"
      className={cn(
        "relative z-10 w-full rounded-xl border bg-card p-3 text-left hover:border-foreground/30",
        selected ? "border-foreground" : "border-border",
        tone === "danger" && "border-destructive/50 bg-destructive/5",
      )}
    >
      <div className="flex items-start gap-2.5">
        <span className="grid size-7 shrink-0 place-items-center rounded-lg border border-border bg-background">
          <NodeIcon className="size-3.5" aria-hidden={true} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <Eyebrow>{eyebrow}</Eyebrow>
            <StatusDot tone={tone} />
          </span>
          <span className="mt-1 block truncate text-xs font-medium">{title}</span>
          <span className="mt-0.5 block truncate font-mono text-[9px] text-muted-foreground">{detail}</span>
        </span>
      </div>
    </button>
  )
}

function BuilderCanvas() {
  return (
    <div className="relative min-h-[430px] overflow-x-auto overflow-y-hidden rounded-xl border border-border bg-background">
      <div
        className="absolute inset-0 opacity-50"
        aria-hidden="true"
        style={{
          backgroundImage: "radial-gradient(color-mix(in srgb, var(--muted-foreground) 28%, transparent) 0.7px, transparent 0.7px)",
          backgroundSize: "18px 18px",
        }}
      />
      <div className="relative flex items-center justify-between border-b border-border bg-background/90 px-3 py-2 backdrop-blur">
        <div className="flex items-center gap-2">
          <Pill tone="warning"><CircleDot className="size-2.5" aria-hidden="true" />草稿 v19</Pill>
          <span className="font-mono text-[9px] text-muted-foreground">未发布改动 4</span>
        </div>
        <div className="flex items-center gap-1.5">
          <IconButton label="搜索节点"><Search className="size-3.5" aria-hidden="true" /></IconButton>
          <IconButton label="更多画布操作"><MoreHorizontal className="size-3.5" aria-hidden="true" /></IconButton>
        </div>
      </div>

      <div className="relative grid min-w-[720px] grid-cols-[150px_24px_160px_24px_160px_24px_160px] items-center px-6 py-20">
        <WorkflowNode icon={Radio} eyebrow="Trigger" title="每 30 分钟" detail="schedule.production" tone="success" />
        <div className="h-px bg-border" aria-hidden="true" />
        <WorkflowNode icon={Database} eyebrow="Collect" title="多平台采集" detail="5 sources · parallel" tone="success" />
        <div className="h-px bg-border" aria-hidden="true" />
        <WorkflowNode icon={Braces} eyebrow="Transform" title="清洗与实体归一" detail="schema.v4" tone="success" />
        <div className="h-px bg-destructive/70" aria-hidden="true" />
        <WorkflowNode icon={Bot} eyebrow="Agent" title="风险研判" detail="2 items blocked" tone="danger" selected />
      </div>

      <div className="relative mx-auto -mt-10 grid max-w-[510px] grid-cols-[1fr_24px_1fr] items-center px-4 pb-10">
        <WorkflowNode icon={UserRoundCheck} eyebrow="Review" title="人工复核" detail="SLA 30min" tone="warning" />
        <div className="h-px bg-border" aria-hidden="true" />
        <WorkflowNode icon={FileCheck2} eyebrow="Deliver" title="归档与发布" detail="report + evidence" tone="neutral" />
      </div>

      <div className="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-lg border border-border bg-background p-1">
        <button type="button" className="rounded-md px-2 py-1 font-mono text-[9px] text-muted-foreground hover:bg-muted">50%</button>
        <button type="button" className="rounded-md px-2 py-1 font-mono text-[9px] text-muted-foreground hover:bg-muted">适应画布</button>
      </div>
    </div>
  )
}

function AttentionRail({ condensed = false }: { condensed?: boolean }) {
  return (
    <aside className="min-h-0 min-w-0 border-t border-border bg-card/20 xl:flex xl:flex-col xl:border-l xl:border-t-0">
      <div className="flex h-12 items-center justify-between border-b border-border px-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="size-3.5 text-warning" aria-hidden="true" />
          <span className="text-xs font-medium">Inbox · 需要处理</span>
          <Pill tone="warning">3</Pill>
        </div>
        <IconButton label="关闭上下文栏"><X className="size-3.5" aria-hidden="true" /></IconButton>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <section className="border-b border-border p-3">
          <button type="button" className="w-full rounded-xl border border-destructive/35 bg-destructive/5 p-3 text-left hover:border-destructive/60">
            <div className="flex items-center justify-between gap-2">
              <Pill tone="danger">P0 · 运行失败</Pill>
              <span className="font-mono text-[9px] text-muted-foreground">6 min</span>
            </div>
            <p className="mt-2 text-xs font-medium leading-5">小红书采集器连续返回空结果</p>
            <p className="mt-1 font-mono text-[9px] text-muted-foreground">RUN-1842 · 节点 #4</p>
            <div className="mt-3 flex items-center gap-2 text-[10px]">
              <span>查看失败上下文</span><ArrowRight className="size-3" aria-hidden="true" />
            </div>
          </button>
        </section>

        <section className="border-b border-border p-3">
          <SectionTitle eyebrow="Work item" title="CLI-248" action={<Pill tone="warning">处理中</Pill>} />
          <p className="mt-2 text-xs leading-5">修复小红书采集与复核链路</p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-[10px]">
            <div className="rounded-lg border border-border bg-background p-2"><span className="block text-muted-foreground">负责人</span><span className="mt-1 block">数据运营组</span></div>
            <div className="rounded-lg border border-border bg-background p-2"><span className="block text-muted-foreground">截止时间</span><span className="mt-1 block">今天 14:00</span></div>
          </div>
        </section>

        <section className="border-b border-border p-3">
          <SectionTitle eyebrow="Runs" title="关联运行" action={<button type="button" className="text-[10px] text-muted-foreground hover:text-foreground">全部</button>} />
          <div className="mt-2 space-y-1">
            {runs.slice(0, condensed ? 2 : 3).map((run) => (
              <button key={run.id} type="button" className="flex w-full items-center gap-2 rounded-lg border border-transparent px-2 py-2 text-left hover:border-border hover:bg-background">
                <StatusDot tone={run.tone === "danger" ? "danger" : "success"} />
                <span className="min-w-0 flex-1"><span className="block truncate text-[10px]">{run.label}</span><span className="block font-mono text-[9px] text-muted-foreground">{run.id}</span></span>
                <span className="text-[10px]">{run.status}</span>
                <span className="font-mono text-[9px] text-muted-foreground">{run.time}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="p-3">
          <SectionTitle eyebrow="Evidence & approval" title="成果与审批" />
          <div className="mt-2 space-y-2">
            <div className="flex items-start gap-2 rounded-lg border border-border bg-background p-2.5">
              <FileCheck2 className="mt-0.5 size-3.5 text-info" aria-hidden="true" />
              <div className="min-w-0 flex-1"><p className="text-[10px] font-medium">12 条候选证据</p><p className="mt-1 text-[9px] text-muted-foreground">2 条等待人工确认来源有效性</p></div>
              <Pill tone="warning">待复核</Pill>
            </div>
            <div className="flex items-start gap-2 rounded-lg border border-border bg-background p-2.5">
              <ShieldCheck className="mt-0.5 size-3.5 text-warning" aria-hidden="true" />
              <div className="min-w-0 flex-1"><p className="text-[10px] font-medium">发布草稿 v19</p><p className="mt-1 text-[9px] text-muted-foreground">需要项目所有者批准</p></div>
              <Pill tone="warning">待审批</Pill>
            </div>
          </div>
        </section>
      </div>
    </aside>
  )
}

function DebugDock() {
  return (
    <section className="border-t border-border bg-card/30">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <TerminalSquare className="size-3.5" aria-hidden="true" />
          <span className="text-xs font-medium">调试运行</span>
          <Pill tone="danger"><StatusDot tone="danger" />RUN-1842 失败</Pill>
        </div>
        <span className="font-mono text-[9px] text-muted-foreground">草稿 v19 · 回放样本 2026-07-13 10:00</span>
        <div className="ml-auto flex items-center gap-1.5">
          <button type="button" className="flex h-7 items-center gap-1.5 rounded-lg border border-border px-2 text-[10px] hover:bg-muted"><RefreshCw className="size-3" aria-hidden="true" />重试失败节点</button>
          <IconButton label="折叠调试面板"><ChevronDown className="size-3.5" aria-hidden="true" /></IconButton>
        </div>
      </div>
      <div className="grid gap-px bg-border md:grid-cols-[190px_minmax(0,1fr)_240px]">
        <div className="bg-background p-3">
          <Eyebrow>Node trace</Eyebrow>
          <div className="mt-2 space-y-1">
            {["触发器", "多平台采集", "清洗与归一", "风险研判"].map((item, index) => (
              <div key={item} className={cn("flex items-center gap-2 rounded-lg px-2 py-1.5 text-[10px]", index === 3 && "bg-destructive/8 text-destructive")}>
                {index < 3 ? <Check className="size-3 text-success" aria-hidden="true" /> : <X className="size-3" aria-hidden="true" />}
                <span className="flex-1">{item}</span><span className="font-mono text-[9px] text-muted-foreground">{index === 3 ? "4.8s" : `${index + 1}.${index}s`}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-background p-3">
          <Eyebrow>Error output</Eyebrow>
          <pre className="mt-2 overflow-x-auto rounded-lg border border-border bg-black p-3 font-mono text-[9px] leading-5 text-white/70"><code>{`collector.empty_result\nsource: xiaohongshu\nquery: \"OpenCLI 品牌\"\nitems_received: 0\nretryable: true`}</code></pre>
        </div>
        <div className="bg-background p-3">
          <Eyebrow>Run context</Eyebrow>
          <dl className="mt-2 space-y-2 font-mono text-[9px]">
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">模式</dt><dd>DEBUG</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">版本</dt><dd>DRAFT v19</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">耗时</dt><dd>8.42s</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">证据</dt><dd>12 items</dd></div>
          </dl>
        </div>
      </div>
    </section>
  )
}

function VariantA() {
  return (
    <div className="flex min-h-screen w-full min-w-0 overflow-x-hidden bg-background pb-24 text-foreground">
      <GlobalNav compact />
      <div className="min-w-0 flex-1">
        <MobileHeader />
        <PrototypeNotice variant="A" />
        <LifecycleHeader active="编排" compact />
        <div className="grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] xl:grid-cols-[minmax(0,1fr)_300px]">
          <main id="prototype-content" className="min-w-0 p-3 sm:p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Workflow className="size-4" aria-hidden="true" />
                <div><h2 className="text-sm font-semibold">舆情采集与研判主流程</h2><p className="font-mono text-[9px] text-muted-foreground">WORKFLOW · 7 NODES · DRAFT v19</p></div>
              </div>
              <div className="flex items-center gap-2"><Pill tone="success">生产 v18</Pill><Pill tone="warning">草稿 v19</Pill></div>
            </div>
            <BuilderCanvas />
            <DebugDock />
          </main>
          <AttentionRail condensed />
        </div>
      </div>
    </div>
  )
}

function WorkItemRow({ item }: { item: (typeof workItems)[number] }) {
  const tone = item.status === "已完成" ? "success" : item.status === "待审批" ? "warning" : item.priority === "P0" ? "danger" : "neutral"
  return (
    <button
      type="button"
      className={cn(
        "grid w-full grid-cols-[68px_minmax(180px,1fr)_90px_100px_70px] items-center gap-3 border-b border-border px-3 py-3 text-left text-[10px] hover:bg-muted/50",
        item.selected && "bg-muted/70",
      )}
    >
      <span className="font-mono text-muted-foreground">{item.id}</span>
      <span className="truncate text-xs font-medium">{item.title}</span>
      <Pill tone={tone}>{item.status}</Pill>
      <span className="truncate text-muted-foreground">{item.owner}</span>
      <span className={cn("font-mono", item.priority === "P0" && "text-destructive")}>{item.priority}</span>
    </button>
  )
}

function TaskCockpit() {
  return (
    <section className="min-w-0 border-l border-border bg-card/20">
      <div className="border-b border-border p-4">
        <div className="flex flex-wrap items-center gap-2"><Pill tone="danger">P0</Pill><Pill tone="warning">处理中</Pill><Eyebrow>CLI-248</Eyebrow></div>
        <h2 className="mt-3 text-base font-semibold leading-6">修复小红书采集与复核链路</h2>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">连续两次生产运行未采集到目标内容。需要确认数据源状态、回放缺口，并完成证据复核。</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className="flex h-8 items-center gap-2 rounded-lg bg-foreground px-3 text-xs text-background"><Play className="size-3.5" aria-hidden="true" />进入调试</button>
          <button type="button" className="flex h-8 items-center gap-2 rounded-lg border border-border px-3 text-xs hover:bg-muted"><UserRoundCheck className="size-3.5" aria-hidden="true" />提交复核</button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-px border-b border-border bg-border">
        <div className="bg-background p-3"><Eyebrow>Owner</Eyebrow><p className="mt-1 text-[10px]">数据运营组</p></div>
        <div className="bg-background p-3"><Eyebrow>Due</Eyebrow><p className="mt-1 text-[10px]">今天 14:00</p></div>
        <div className="bg-background p-3"><Eyebrow>Runs</Eyebrow><p className="mt-1 font-mono text-[10px]">3 linked</p></div>
      </div>

      <div className="border-b border-border p-4">
        <SectionTitle eyebrow="Execution" title="执行上下文" action={<Pill tone="danger">1 失败</Pill>} />
        <div className="mt-3 rounded-xl border border-border bg-background p-3">
          <div className="flex items-center gap-2"><Workflow className="size-3.5" aria-hidden="true" /><span className="text-xs font-medium">舆情采集与研判主流程</span><Pill className="ml-auto">草稿 v19</Pill></div>
          <div className="mt-3 grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-2">
            <div className="rounded-lg border border-border p-2 text-center text-[9px]">采集</div><ArrowRight className="size-3 text-muted-foreground" aria-hidden="true" /><div className="rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-center text-[9px] text-destructive">研判失败</div><ArrowRight className="size-3 text-muted-foreground" aria-hidden="true" /><div className="rounded-lg border border-border p-2 text-center text-[9px] text-muted-foreground">复核</div>
          </div>
          <button type="button" className="mt-3 flex items-center gap-1.5 text-[10px] hover:underline">打开完整编排 <ArrowRight className="size-3" aria-hidden="true" /></button>
        </div>
      </div>

      <div className="border-b border-border p-4">
        <SectionTitle eyebrow="Runs & evidence" title="运行与证据" />
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-2.5"><StatusDot tone="danger" /><div className="min-w-0 flex-1"><p className="text-[10px] font-medium">RUN-1842 · 调试运行失败</p><p className="mt-0.5 font-mono text-[9px] text-muted-foreground">草稿 v19 · 10:42</p></div><ChevronRight className="size-3.5" aria-hidden="true" /></div>
          <div className="flex items-center gap-2 rounded-lg border border-border bg-background p-2.5"><FileCheck2 className="size-3.5 text-info" aria-hidden="true" /><div className="min-w-0 flex-1"><p className="text-[10px] font-medium">12 条候选证据</p><p className="mt-0.5 text-[9px] text-muted-foreground">2 条待复核</p></div><Pill tone="warning">待处理</Pill></div>
        </div>
      </div>

      <div className="p-4">
        <SectionTitle eyebrow="Activity" title="不可变活动记录" />
        <div className="mt-3 space-y-3">
          {timeline.slice(0, 3).map((event) => {
            const EventIcon = event.icon
            return <div key={event.time} className="flex gap-3"><span className="grid size-6 shrink-0 place-items-center rounded-full border border-border bg-background"><EventIcon className="size-3" aria-hidden="true" /></span><div className="min-w-0 flex-1"><p className="text-[10px] font-medium">{event.title}</p><p className="mt-0.5 truncate text-[9px] text-muted-foreground">{event.detail}</p></div><span className="font-mono text-[9px] text-muted-foreground">{event.time}</span></div>
          })}
        </div>
      </div>
    </section>
  )
}

function VariantB() {
  return (
    <div className="flex min-h-screen w-full min-w-0 overflow-x-hidden bg-background pb-24 text-foreground">
      <GlobalNav />
      <div className="min-w-0 flex-1">
        <MobileHeader />
        <PrototypeNotice variant="B" />
        <LifecycleHeader active="工作项" compact />
        <main id="prototype-content" className="min-w-0">
          <div className="grid border-b border-border sm:grid-cols-2 xl:grid-cols-4">
            <div className="border-b border-border p-4 sm:border-r xl:border-b-0"><Eyebrow>Active work</Eyebrow><p className="mt-2 font-mono text-2xl">12</p><p className="mt-1 text-[10px] text-muted-foreground">3 个需要今天处理</p></div>
            <div className="border-b border-border p-4 xl:border-b-0 xl:border-r"><Eyebrow>Run success</Eyebrow><p className="mt-2 font-mono text-2xl">94.2%</p><p className="mt-1 text-[10px] text-muted-foreground">近 24 小时 · -2.1%</p></div>
            <div className="border-b border-border p-4 sm:border-r sm:border-b-0"><Eyebrow>Evidence review</Eyebrow><p className="mt-2 font-mono text-2xl">18</p><p className="mt-1 text-[10px] text-muted-foreground">2 条超过 SLA</p></div>
            <div className="p-4"><Eyebrow>Approvals</Eyebrow><p className="mt-2 font-mono text-2xl">2</p><p className="mt-1 text-[10px] text-muted-foreground">发布与外部动作</p></div>
          </div>

          <div className="grid min-h-[680px] min-w-0 grid-cols-[minmax(0,1fr)] xl:grid-cols-[minmax(520px,1.15fr)_minmax(420px,0.85fr)]">
            <section className="min-w-0 p-3 sm:p-4">
              <SectionTitle eyebrow="Project control plane" title="项目工作队列" action={<div className="flex gap-2"><IconButton label="搜索工作项"><Search className="size-3.5" aria-hidden="true" /></IconButton><button type="button" className="h-8 rounded-lg bg-foreground px-3 text-xs text-background">新建工作项</button></div>} />
              <div className="mt-4 flex flex-wrap gap-1.5"><Pill className="bg-foreground text-background">全部 24</Pill><Pill>待处理 6</Pill><Pill>处理中 4</Pill><Pill tone="warning">待审批 2</Pill><Pill tone="success">已完成 12</Pill></div>
              <div className="mt-3 overflow-x-auto rounded-xl border border-border">
                <div className="min-w-[650px]">
                  <div className="grid grid-cols-[68px_minmax(180px,1fr)_90px_100px_70px] gap-3 border-b border-border bg-card px-3 py-2"><Eyebrow>ID</Eyebrow><Eyebrow>工作项</Eyebrow><Eyebrow>状态</Eyebrow><Eyebrow>负责人</Eyebrow><Eyebrow>优先级</Eyebrow></div>
                  {workItems.map((item) => <WorkItemRow key={item.id} item={item} />)}
                </div>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <Metric label="Debug / Prod" value="3 / 48" detail="调试运行 / 生产运行" tone="warning" />
                <Metric label="Published" value="v18" detail="草稿 v19 待审批" tone="success" />
                <Metric label="Blocked" value="02" detail="运行与证据各 1" tone="danger" />
              </div>
            </section>
            <TaskCockpit />
          </div>
        </main>
      </div>
    </div>
  )
}

function ProjectNavigator() {
  const projectGroups: Array<{
    label: string
    items: Array<{ label: string; icon: Icon; meta: string; active?: boolean }>
  }> = [
    {
      label: "工作流项目",
      items: [
        { label: "舆情采集与研判", icon: Workflow, meta: "7 节点 · 草稿 v19", active: true },
        { label: "风险周报生成", icon: Workflow, meta: "5 节点 · 生产中" },
        { label: "高风险升级通知", icon: Workflow, meta: "4 节点 · 生产中" },
      ],
    },
    {
      label: "数据项目",
      items: [
        { label: "多平台内容采集", icon: Database, meta: "5 数据源 · 每 30 分钟" },
        { label: "品牌数据清洗", icon: Braces, meta: "schema v4 · 运行中" },
      ],
    },
    {
      label: "知识项目",
      items: [
        { label: "品牌别名与研判规则", icon: Bot, meta: "1,842 条 · 今天更新" },
      ],
    },
  ]

  return (
    <aside className="hidden min-h-0 border-r border-border bg-sidebar xl:flex xl:flex-col">
      <div className="border-b border-border p-3">
        <button type="button" className="mb-2 flex h-8 w-full items-center gap-2 rounded-lg px-2 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground">
          <ArrowRight className="size-3.5 rotate-180" aria-hidden="true" />返回工作区项目列表
        </button>
        <button type="button" className="flex w-full items-center gap-2 rounded-lg border border-border bg-background p-2 text-left hover:border-foreground/25">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-border bg-background"><Boxes className="size-4" aria-hidden="true" /></span>
          <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold">品牌风险工作区</span><span className="mt-0.5 block font-mono text-[9px] text-muted-foreground">6 PROJECTS · 12 MEMBERS</span></span>
          <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden="true" />
        </button>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto p-3" aria-label="工作区项目">
        {projectGroups.map((group) => (
          <div key={group.label} className="mb-5">
            <Eyebrow className="px-2">{group.label}</Eyebrow>
            <div className="mt-1.5 space-y-0.5">
              {group.items.map((item) => {
                const ItemIcon = item.icon
                return (
                  <button
                    key={item.label}
                    type="button"
                    className={cn(
                      "flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground",
                      item.active && "bg-foreground text-background hover:bg-foreground hover:text-background",
                    )}
                  >
                    <ItemIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden={true} />
                    <span className="min-w-0 flex-1"><span className="block truncate font-medium">{item.label}</span><span className={cn("mt-0.5 block truncate font-mono text-[9px]", item.active ? "text-background/60" : "text-muted-foreground")}>{item.meta}</span></span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-border p-3">
        <div className="flex items-center justify-between"><Eyebrow>共享能力</Eyebrow><span className="font-mono text-[9px] text-muted-foreground">8 可用</span></div>
        <div className="mt-2 flex gap-1.5">
          {[Database, Bot, Braces, Plug].map((CapabilityIcon, index) => <span key={index} className="grid size-7 place-items-center rounded-lg border border-border bg-background"><CapabilityIcon className="size-3.5" aria-hidden={true} /></span>)}
        </div>
        <p className="mt-2 text-[9px] leading-4 text-muted-foreground">模型、插件、成员与连接由工作区共享；数据处理按项目拆分。</p>
      </div>
    </aside>
  )
}

function RuntimeVisualization() {
  const bars = [42, 66, 54, 82, 72, 91, 64, 78, 48, 86, 74, 94]

  return (
    <section className="rounded-xl border border-border p-3">
      <SectionTitle eyebrow="Paperclip pattern · runtime" title="本项目生产表现" action={<Pill tone="success">94.2%</Pill>} />
      <div className="mt-4 flex h-24 items-end gap-1.5" aria-label="最近 12 个运行时段成功率柱状图">
        {bars.map((height, index) => (
          <div key={index} className="group flex h-full min-w-0 flex-1 items-end">
            <div
              className={cn("w-full rounded-sm bg-success/45 group-hover:bg-success", index === 8 && "bg-destructive/60 group-hover:bg-destructive")}
              style={{ height: `${height}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between font-mono text-[9px] text-muted-foreground"><span>00:00</span><span>06:00</span><span>12:00</span><span>NOW</span></div>
      <div className="mt-4 grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-border bg-border">
        <div className="bg-background p-2"><Eyebrow>Runs</Eyebrow><p className="mt-1 font-mono text-xs">48</p></div>
        <div className="bg-background p-2"><Eyebrow>P95</Eyebrow><p className="mt-1 font-mono text-xs">8.4s</p></div>
        <div className="bg-background p-2"><Eyebrow>Evidence</Eyebrow><p className="mt-1 font-mono text-xs">186</p></div>
      </div>
    </section>
  )
}

function ProjectWorkQueue() {
  return (
    <section className="rounded-xl border border-border p-3">
      <SectionTitle eyebrow="Linear pattern · work items" title="本项目工作项" action={<button type="button" className="text-[10px] text-muted-foreground hover:text-foreground">查看全部 12</button>} />
      <div className="mt-3 divide-y divide-border">
        {workItems.slice(0, 3).map((item) => (
          <button key={item.id} type="button" className="flex w-full items-center gap-2 py-2.5 text-left hover:bg-muted/40">
            <span className={cn("font-mono text-[9px] text-muted-foreground", item.priority === "P0" && "text-destructive")}>{item.id}</span>
            <span className="min-w-0 flex-1 truncate text-[10px] font-medium">{item.title}</span>
            <Pill tone={item.status === "待审批" ? "warning" : item.priority === "P0" ? "danger" : "neutral"}>{item.status}</Pill>
            <ChevronRight className="size-3 text-muted-foreground" aria-hidden="true" />
          </button>
        ))}
      </div>
    </section>
  )
}

function VariantC() {
  return (
    <div className="flex min-h-screen w-full min-w-0 overflow-x-hidden bg-background pb-24 text-foreground">
      <GlobalNav compact />
      <div className="min-w-0 flex-1">
        <MobileHeader />
        <PrototypeNotice variant="C" />
        <LifecycleHeader
          active="编排"
          compact
          tabs={projectLifecycleTabs}
          contextLabel="项目"
          title="舆情采集与研判"
          eyebrow="品牌风险工作区 / 工作流项目"
        />
        <div className="grid min-h-[760px] min-w-0 grid-cols-[minmax(0,1fr)] xl:grid-cols-[232px_minmax(480px,1fr)_300px]">
          <ProjectNavigator />
          <main id="prototype-content" className="min-w-0 p-3 sm:p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2"><Eyebrow>Workspace / project / node graph</Eyebrow><Pill><Workflow className="size-2.5" aria-hidden="true" />7 节点</Pill></div>
                <h2 className="mt-1 truncate text-base font-semibold">舆情采集与研判</h2>
                <p className="mt-1 text-[10px] text-muted-foreground">当前打开的是一个工作流项目；采集、清洗和知识库由左侧独立项目提供能力</p>
              </div>
              <div className="flex items-center gap-2"><Pill tone="success">生产 v18</Pill><Pill tone="warning">草稿 v19 · 4 改动</Pill></div>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="24h runs" value="48" detail="3 次调试 / 45 次生产" tone="success" />
              <Metric label="Success" value="94.2" detail="较昨日 -2.1%" tone="success" />
              <Metric label="Inbox" value="05" detail="失败 1 · 复核 2 · 审批 2" tone="warning" />
              <Metric label="Nodes" value="07" detail="2 个插件节点" tone="success" />
            </div>

            <section className="mt-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1 rounded-lg border border-border p-1">
                  <button type="button" className="rounded-md bg-foreground px-2.5 py-1.5 text-[10px] text-background">编排</button>
                  <button type="button" className="rounded-md px-2.5 py-1.5 text-[10px] text-muted-foreground hover:bg-muted">变量</button>
                  <button type="button" className="rounded-md px-2.5 py-1.5 text-[10px] text-muted-foreground hover:bg-muted">调试记录</button>
                </div>
                <div className="flex items-center gap-2"><Pill><Plug className="size-2.5" aria-hidden="true" />2 个插件节点</Pill><Pill><Database className="size-2.5" aria-hidden="true" />引用 3 个项目</Pill></div>
              </div>
              <BuilderCanvas />
            </section>

            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              <ProjectWorkQueue />
              <RuntimeVisualization />
            </div>

            <section className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-warning/30 bg-warning/5 p-3"><div className="flex items-center gap-2"><Code2 className="size-3.5 text-warning" aria-hidden="true" /><span className="text-xs font-medium">调试空间</span><Pill tone="warning" className="ml-auto">草稿 v19</Pill></div><p className="mt-2 text-[10px] leading-4 text-muted-foreground">单节点运行、变量检查、样本回放与失败恢复，不计入生产指标。</p></div>
              <div className="rounded-xl border border-success/30 bg-success/5 p-3"><div className="flex items-center gap-2"><Radio className="size-3.5 text-success" aria-hidden="true" /><span className="text-xs font-medium">生产空间</span><Pill tone="success" className="ml-auto">已发布 v18</Pill></div><p className="mt-2 text-[10px] leading-4 text-muted-foreground">由本项目的触发节点或调度启动，只写入本项目的运行、监测和审计记录。</p></div>
            </section>
          </main>
          <AttentionRail />
        </div>
      </div>
    </div>
  )
}

export function ProductShellPrototype({ initialVariant }: { initialVariant?: string }) {
  const [variant, setVariant] = useState<PrototypeVariant>(() => normalizeVariant(initialVariant))

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return
      }

      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
      event.preventDefault()
      const order: PrototypeVariant[] = ["A", "B", "C"]
      setVariant((current) => {
        const currentIndex = order.indexOf(current)
        const delta = event.key === "ArrowLeft" ? -1 : 1
        return order[(currentIndex + delta + order.length) % order.length]
      })
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])

  useEffect(() => {
    const url = new URL(window.location.href)
    url.searchParams.set("variant", variant)
    window.history.replaceState(window.history.state, "", url)
  }, [variant])

  return (
    <div className="dark min-h-screen w-full min-w-0 overflow-x-hidden bg-background text-foreground">
      <a href="#prototype-content" className="fixed left-3 top-3 z-[60] -translate-y-20 rounded-lg bg-foreground px-3 py-2 text-xs text-background focus:translate-y-0">跳到主要内容</a>
      {variant === "A" ? <VariantA /> : variant === "B" ? <VariantB /> : <VariantC />}
      <PrototypeSwitcher active={variant} onChange={setVariant} />
    </div>
  )
}
