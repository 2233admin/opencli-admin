"use client"

import { useEffect, useState, type ComponentType } from "react"
import {
  Activity,
  AlertTriangle,
  Archive,
  ArrowRight,
  Bot,
  Boxes,
  Braces,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Code2,
  Database,
  FileCheck2,
  GitBranch,
  Inbox,
  LayoutDashboard,
  ListChecks,
  MoreHorizontal,
  PanelRight,
  Play,
  Plug,
  Radio,
  RefreshCw,
  Rocket,
  Search,
  ShieldCheck,
  Sparkles,
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
    label: "运行基础",
    items: [
      { label: "数据链路", icon: Database },
      { label: "触发与调度", icon: CalendarClock },
      { label: "运行数据", icon: Activity },
    ],
  },
  {
    label: "平台",
    items: [
      { label: "Agent 与执行资源", icon: Bot },
      { label: "集成中心", icon: Plug },
      { label: "治理与设置", icon: ShieldCheck },
    ],
  },
]

const lifecycleTabs = ["总览", "工作项", "编排", "调试运行", "版本", "成果与审计"]

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
    C: "C · 统一闭环（推荐）",
  }[variant]

  return (
    <div className="flex min-h-8 min-w-0 flex-wrap items-center gap-x-3 gap-y-1 overflow-hidden border-b border-warning/25 bg-warning/8 px-3 py-1.5 text-[10px] text-warning sm:px-4">
      <span className="font-mono tracking-[0.14em]">PRODUCT TEMPLATE · STATIC DATA</span>
      <span className="text-warning/70">{direction}</span>
      <span className="ml-auto hidden text-warning/60 md:block">只验证信息架构与操作闭环，不连接真实接口</span>
    </div>
  )
}

function LifecycleHeader({ active, compact = false }: { active: string; compact?: boolean }) {
  return (
    <header className="min-w-0 border-b border-border bg-background">
      <div className={cn("flex min-w-0 flex-wrap items-start justify-between gap-4 px-4", compact ? "py-3" : "py-4")}>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Eyebrow>持续舆情交付 / 品牌风险雷达</Eyebrow>
            <Pill tone="success"><StatusDot tone="success" />生产中</Pill>
          </div>
          <div className="mt-1.5 flex min-w-0 items-center gap-2">
            <h1 className={cn("truncate font-semibold tracking-tight", compact ? "text-base" : "text-lg")}>品牌风险雷达</h1>
            <Pill>项目</Pill>
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
        <nav className="flex min-w-max" aria-label="项目生命周期">
          {lifecycleTabs.map((tab) => (
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
          <span className="text-xs font-medium">需要处理</span>
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

function WorkspaceTree() {
  return (
    <aside className="hidden min-h-0 border-r border-border bg-sidebar xl:flex xl:w-[250px] xl:flex-col">
      <div className="flex h-12 items-center justify-between border-b border-border px-3"><Eyebrow>Workspace map</Eyebrow><IconButton label="添加工作区对象"><Sparkles className="size-3.5" aria-hidden="true" /></IconButton></div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 text-[10px]">
        <button type="button" className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-muted"><ChevronDown className="size-3" aria-hidden="true" /><CircleDot className="size-3 text-info" aria-hidden="true" /><span className="font-medium">目标 · 持续舆情交付</span></button>
        <div className="ml-3 border-l border-border pl-3">
          <button type="button" className="flex w-full items-center gap-2 rounded-lg bg-foreground px-2 py-2 text-left text-background"><ChevronDown className="size-3" aria-hidden="true" /><Boxes className="size-3" aria-hidden="true" /><span className="min-w-0 flex-1 truncate">品牌风险雷达</span></button>
          <div className="ml-3 border-l border-border pl-3 pt-1">
            <button type="button" className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-muted"><Workflow className="size-3" aria-hidden="true" /><span className="min-w-0 flex-1 truncate">舆情采集与研判</span><Pill>v19</Pill></button>
            <button type="button" className="flex w-full items-center gap-2 rounded-lg bg-destructive/8 px-2 py-2 text-left text-destructive"><ListChecks className="size-3" aria-hidden="true" /><span className="min-w-0 flex-1 truncate">CLI-248 采集修复</span></button>
            <button type="button" className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-muted"><Activity className="size-3" aria-hidden="true" /><span className="min-w-0 flex-1 truncate">RUN-1842</span><StatusDot tone="danger" /></button>
            <button type="button" className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-muted"><Archive className="size-3" aria-hidden="true" /><span className="min-w-0 flex-1 truncate">证据批次 #88</span><Pill tone="warning">2</Pill></button>
          </div>
          <button type="button" className="mt-1 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-muted-foreground hover:bg-muted hover:text-foreground"><ChevronRight className="size-3" aria-hidden="true" /><Boxes className="size-3" aria-hidden="true" /><span>竞品动态周报</span></button>
        </div>

        <div className="mt-5"><Eyebrow className="px-2">Shared assets</Eyebrow><div className="mt-1"><button type="button" className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-muted"><Database className="size-3" aria-hidden="true" />品牌监测数据链路<Pill className="ml-auto">5</Pill></button><button type="button" className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-muted"><Bot className="size-3" aria-hidden="true" />舆情研究 Agent<Pill className="ml-auto" tone="success">在线</Pill></button></div></div>
      </div>
    </aside>
  )
}

function ExecutionStep({
  number,
  label,
  title,
  detail,
  status,
  active,
  children,
}: {
  number: string
  label: string
  title: string
  detail: string
  status: React.ReactNode
  active?: boolean
  children?: React.ReactNode
}) {
  return (
    <article className={cn("relative rounded-xl border border-border bg-card/30 p-4", active && "border-foreground bg-card")}>
      <div className="flex items-start gap-3">
        <span className={cn("grid size-7 shrink-0 place-items-center rounded-full border border-border bg-background font-mono text-[9px] text-muted-foreground", active && "border-foreground bg-foreground text-background")}>{number}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><Eyebrow>{label}</Eyebrow>{status}</div>
          <h3 className="mt-1 text-sm font-semibold">{title}</h3>
          <p className="mt-1 text-[10px] leading-4 text-muted-foreground">{detail}</p>
          {children}
        </div>
      </div>
    </article>
  )
}

function VariantC() {
  return (
    <div className="flex min-h-screen w-full min-w-0 overflow-x-hidden bg-background pb-24 text-foreground">
      <GlobalNav compact />
      <div className="min-w-0 flex-1">
        <MobileHeader />
        <PrototypeNotice variant="C" />
        <LifecycleHeader active="总览" compact />
        <div className="grid min-h-[760px] min-w-0 grid-cols-[minmax(0,1fr)] xl:grid-cols-[250px_minmax(500px,1fr)_310px]">
          <WorkspaceTree />
          <main id="prototype-content" className="min-w-0 p-3 sm:p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <SectionTitle eyebrow="Unified operating loop" title="从目标到可审计成果" />
              <div className="flex items-center gap-2"><Pill tone="success">生产 v18</Pill><Pill tone="warning">草稿 v19</Pill></div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="Goal health" value="82%" detail="本周目标推进" tone="success" />
              <Metric label="Active work" value="12" detail="3 个需要处理" tone="warning" />
              <Metric label="Run success" value="94.2" detail="生产运行成功率" tone="success" />
              <Metric label="Review SLA" value="18m" detail="平均复核时长" tone="warning" />
            </div>

            <section className="mt-4 rounded-xl border border-border">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-3">
                <div className="flex items-center gap-2"><GitBranch className="size-3.5" aria-hidden="true" /><span className="text-xs font-medium">当前执行主线</span><Pill tone="danger">1 阻塞</Pill></div>
                <div className="flex items-center gap-1 rounded-lg border border-border p-1"><button type="button" className="rounded-md bg-foreground px-2 py-1 font-mono text-[9px] text-background">闭环</button><button type="button" className="rounded-md px-2 py-1 font-mono text-[9px] text-muted-foreground hover:bg-muted">编排</button><button type="button" className="rounded-md px-2 py-1 font-mono text-[9px] text-muted-foreground hover:bg-muted">时间线</button></div>
              </div>

              <div className="relative space-y-3 p-3 sm:p-4 before:absolute before:bottom-8 before:left-[30px] before:top-8 before:w-px before:bg-border sm:before:left-[34px]">
                <ExecutionStep number="01" label="Goal / Project" title="持续舆情交付 · 品牌风险雷达" detail="将品牌风险发现时间控制在 30 分钟内，并保留完整来源证据。" status={<Pill tone="success">在轨</Pill>}>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3"><div className="rounded-lg border border-border bg-background p-2"><Eyebrow>Owner</Eyebrow><p className="mt-1 text-[10px]">品牌运营</p></div><div className="rounded-lg border border-border bg-background p-2"><Eyebrow>Outcome</Eyebrow><p className="mt-1 text-[10px]">每周风险简报</p></div><div className="rounded-lg border border-border bg-background p-2"><Eyebrow>Progress</Eyebrow><p className="mt-1 font-mono text-[10px]">82%</p></div></div>
                </ExecutionStep>

                <ExecutionStep number="02" label="Workflow / Automation" title="舆情采集与研判主流程" detail="数据链路与编排共同定义执行路径；调度只决定何时触发。" status={<><Pill tone="success">生产 v18</Pill><Pill tone="warning">草稿 v19</Pill></>}>
                  <div className="mt-3 grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-2"><div className="rounded-lg border border-border bg-background p-2 text-center text-[9px]">采集</div><ArrowRight className="size-3 text-muted-foreground" aria-hidden="true" /><div className="rounded-lg border border-border bg-background p-2 text-center text-[9px]">研判</div><ArrowRight className="size-3 text-muted-foreground" aria-hidden="true" /><div className="rounded-lg border border-border bg-background p-2 text-center text-[9px]">复核</div></div>
                </ExecutionStep>

                <ExecutionStep number="03" label="Work item / Run" title="CLI-248 · 修复小红书采集与复核链路" detail="工作项描述要解决的问题；运行是一次有输入、状态和输出的执行实例。" status={<Pill tone="danger">P0 阻塞</Pill>} active>
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3"><div className="flex items-center gap-2"><StatusDot tone="danger" /><span className="text-[10px] font-medium">RUN-1842 · 调试运行失败</span></div><p className="mt-2 font-mono text-[9px] text-muted-foreground">collector.empty_result · node #4</p><button type="button" className="mt-3 flex items-center gap-1.5 text-[10px]">打开运行上下文 <ArrowRight className="size-3" aria-hidden="true" /></button></div>
                    <div className="rounded-lg border border-border bg-background p-3"><div className="flex items-center gap-2"><Play className="size-3.5" aria-hidden="true" /><span className="text-[10px] font-medium">下一动作</span></div><p className="mt-2 text-[9px] leading-4 text-muted-foreground">使用 24h 样本回放失败节点，验证数据源恢复后再提交证据复核。</p><div className="mt-3 flex gap-2"><button type="button" className="h-7 rounded-lg bg-foreground px-2 text-[10px] text-background">进入调试</button><button type="button" className="h-7 rounded-lg border border-border px-2 text-[10px]">指派</button></div></div>
                  </div>
                </ExecutionStep>

                <ExecutionStep number="04" label="Evidence / Review / Approval" title="12 条候选证据 · 发布草稿 v19" detail="成果不是运行日志：先形成证据包，再复核质量，最后批准外部动作或生产版本。" status={<Pill tone="warning">2 待复核 · 1 待审批</Pill>}>
                  <div className="mt-3 flex flex-wrap gap-2"><button type="button" className="flex h-7 items-center gap-1.5 rounded-lg border border-border px-2 text-[10px]"><FileCheck2 className="size-3" aria-hidden="true" />打开证据批次</button><button type="button" className="flex h-7 items-center gap-1.5 rounded-lg border border-border px-2 text-[10px]"><ShieldCheck className="size-3" aria-hidden="true" />查看审批</button></div>
                </ExecutionStep>
              </div>
            </section>

            <section className="mt-4 rounded-xl border border-border p-3 sm:p-4">
              <SectionTitle eyebrow="Runtime separation" title="调试与生产不再混在一起" />
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-warning/30 bg-warning/5 p-3"><div className="flex items-center gap-2"><Code2 className="size-3.5 text-warning" aria-hidden="true" /><span className="text-xs font-medium">调试空间</span><Pill tone="warning" className="ml-auto">草稿 v19</Pill></div><p className="mt-2 text-[10px] leading-4 text-muted-foreground">手工输入、单节点回放、变量检查、失败修复。不会污染生产指标。</p></div>
                <div className="rounded-xl border border-success/30 bg-success/5 p-3"><div className="flex items-center gap-2"><Radio className="size-3.5 text-success" aria-hidden="true" /><span className="text-xs font-medium">生产空间</span><Pill tone="success" className="ml-auto">已发布 v18</Pill></div><p className="mt-2 text-[10px] leading-4 text-muted-foreground">由调度或事件触发，形成稳定运行记录、指标和审计轨迹。</p></div>
              </div>
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
