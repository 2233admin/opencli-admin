"use client"

import { Suspense, useEffect, useState, type ComponentType } from "react"
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
  Cpu,
  Database,
  FileCheck2,
  FileUp,
  FolderKanban,
  Inbox,
  LayoutDashboard,
  Monitor,
  MoreHorizontal,
  Network,
  PanelRight,
  Play,
  Plug,
  Plus,
  Radio,
  RefreshCw,
  Rocket,
  Search,
  ShieldCheck,
  Star,
  TerminalSquare,
  UserRoundCheck,
  Workflow,
  X,
} from "lucide-react"

import {
  PrototypeSwitcher,
  type PrototypeVariant,
} from "@/components/prototype/prototype-switcher"
import { WorkflowEditorSession } from "@/components/flow/workflow-editor-session"
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
      { label: "Agent 集群", icon: Bot },
      { label: "设备与算力", icon: Cpu },
      { label: "插件市场", icon: Plug },
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
const projectLifecycleTabs = ["编排", "数据", "运行", "调度", "版本", "设置"]

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
    C: "C · 工作区列表 / 项目编辑器（选定）",
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
  onClick,
}: {
  icon: Icon
  eyebrow: string
  title: string
  detail: string
  tone?: "neutral" | "success" | "warning" | "danger" | "info"
  selected?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
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

function BuilderCanvas({ nodes, selectedNodeIndex, onSelectNode }: { nodes?: ComparisonProfile["nodes"]; selectedNodeIndex?: number; onSelectNode?: (index: number) => void }) {
  const profile = comparisonProfiles.video
  const [firstNode, secondNode, thirdNode, fourthNode, fifthNode, sixthNode] = nodes ?? profile.nodes
  const renderNode = (node: ComparisonNode, index: number) => (
    <WorkflowNode
      {...node}
      selected={selectedNodeIndex === undefined ? node.selected : selectedNodeIndex === index}
      onClick={onSelectNode ? () => onSelectNode(index) : undefined}
    />
  )

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
          <Pill tone="warning"><CircleDot className="size-2.5" aria-hidden="true" />草稿 {profile.draftVersion}</Pill>
          <span className="font-mono text-[9px] text-muted-foreground">未发布改动 4</span>
        </div>
        <div className="flex items-center gap-1.5">
          <IconButton label="搜索节点"><Search className="size-3.5" aria-hidden="true" /></IconButton>
          <IconButton label="更多画布操作"><MoreHorizontal className="size-3.5" aria-hidden="true" /></IconButton>
        </div>
      </div>

      <div className="relative grid min-w-[720px] grid-cols-[150px_24px_160px_24px_160px_24px_160px] items-center px-6 py-20">
        {renderNode(firstNode, 0)}
        <div className="h-px bg-border" aria-hidden="true" />
        {renderNode(secondNode, 1)}
        <div className="h-px bg-border" aria-hidden="true" />
        {renderNode(thirdNode, 2)}
        <div className="h-px bg-destructive/70" aria-hidden="true" />
        {renderNode(fourthNode, 3)}
      </div>

      <div className="relative mx-auto -mt-10 grid max-w-[510px] grid-cols-[1fr_24px_1fr] items-center px-4 pb-10">
        {renderNode(fifthNode, 4)}
        <div className="h-px bg-border" aria-hidden="true" />
        {renderNode(sixthNode, 5)}
      </div>

      <div className="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-lg border border-border bg-background p-1">
        <button type="button" className="rounded-md px-2 py-1 font-mono text-[9px] text-muted-foreground hover:bg-muted">50%</button>
        <button type="button" className="rounded-md px-2 py-1 font-mono text-[9px] text-muted-foreground hover:bg-muted">适应画布</button>
      </div>
    </div>
  )
}

function AttentionRail({ condensed = false }: { condensed?: boolean }) {
  const profile = comparisonProfiles.video
  const primaryWorkItem = profile.workItems[0]
  const relatedRuns = getProjectRuns(profile)

  return (
    <aside className="min-h-0 min-w-0 border-t border-border bg-card/20 xl:flex xl:flex-col xl:border-l xl:border-t-0">
      <div className="flex h-12 items-center justify-between border-b border-border px-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="size-3.5 text-warning" aria-hidden="true" />
          <span className="text-xs font-medium">Inbox · 需要处理</span>
          <Pill tone="warning">{profile.inbox}</Pill>
        </div>
        <IconButton label="关闭上下文栏"><X className="size-3.5" aria-hidden="true" /></IconButton>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <section className="border-b border-border p-3">
          <button
            type="button"
            className={cn(
              "w-full rounded-xl border p-3 text-left",
              profile.alertTone === "danger"
                ? "border-destructive/35 bg-destructive/5 hover:border-destructive/60"
                : "border-warning/35 bg-warning/5 hover:border-warning/60",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <Pill tone={profile.alertTone}>{profile.alertLabel}</Pill>
              <span className="font-mono text-[9px] text-muted-foreground">{profile.alertAge}</span>
            </div>
            <p className="mt-2 text-xs font-medium leading-5">{profile.alertTitle}</p>
            <p className="mt-1 font-mono text-[9px] text-muted-foreground">{profile.alertRunId} · {profile.alertContext}</p>
            <div className="mt-3 flex items-center gap-2 text-[10px]">
              <span>{profile.alertAction}</span><ArrowRight className="size-3" aria-hidden="true" />
            </div>
          </button>
        </section>

        <section className="border-b border-border p-3">
          <SectionTitle eyebrow="Work item" title={primaryWorkItem.id} action={<Pill tone="warning">{primaryWorkItem.status}</Pill>} />
          <p className="mt-2 text-xs leading-5">{primaryWorkItem.title}</p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-[10px]">
            <div className="rounded-lg border border-border bg-background p-2"><span className="block text-muted-foreground">负责人</span><span className="mt-1 block">{profile.owner}</span></div>
            <div className="rounded-lg border border-border bg-background p-2"><span className="block text-muted-foreground">截止时间</span><span className="mt-1 block">{profile.deadline}</span></div>
          </div>
        </section>

        <section className="border-b border-border p-3">
          <SectionTitle eyebrow="Runs" title="关联运行" action={<button type="button" className="text-[10px] text-muted-foreground hover:text-foreground">全部</button>} />
          <div className="mt-2 space-y-1">
            {relatedRuns.slice(0, condensed ? 2 : 3).map((run) => (
              <button key={run.id} type="button" className="flex w-full items-center gap-2 rounded-lg border border-transparent px-2 py-2 text-left hover:border-border hover:bg-background">
                <StatusDot tone={run.tone} />
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
              <div className="min-w-0 flex-1"><p className="text-[10px] font-medium">{profile.evidence} 条{profile.evidenceLabel}</p><p className="mt-1 text-[9px] text-muted-foreground">{profile.evidenceDetail}</p></div>
              <Pill tone="warning">待复核</Pill>
            </div>
            <div className="flex items-start gap-2 rounded-lg border border-border bg-background p-2.5">
              <ShieldCheck className="mt-0.5 size-3.5 text-warning" aria-hidden="true" />
              <div className="min-w-0 flex-1"><p className="text-[10px] font-medium">发布草稿 {profile.draftVersion}</p><p className="mt-1 text-[9px] text-muted-foreground">需要项目所有者批准</p></div>
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

type WorkspaceProject = {
  id: string
  name: string
  category: string
  description: string
  meta: string
  updated: string
  status: string
  tone: "neutral" | "success" | "warning" | "danger" | "info"
  icon: Icon
  owner: string
  tags: string[]
  starred?: boolean
}

type ComparisonNode = {
  icon: Icon
  eyebrow: string
  title: string
  detail: string
  tone?: "neutral" | "success" | "warning" | "danger" | "info"
  selected?: boolean
}

type ProjectRun = {
  id: string
  label: string
  status: string
  time: string
  tone: "neutral" | "success" | "warning" | "danger" | "info"
}

type ComparisonProfile = {
  nodes: [ComparisonNode, ComparisonNode, ComparisonNode, ComparisonNode, ComparisonNode, ComparisonNode]
  nodeCount: string
  runCount: string
  debugRuns: string
  productionRuns: string
  success: string
  inbox: string
  inboxDetail: string
  pluginCount: string
  references: string
  productionVersion: string
  draftVersion: string
  p95: string
  evidence: string
  evidenceLabel: string
  evidenceDetail: string
  alertTitle: string
  alertLabel: string
  alertTone: ProjectRun["tone"]
  alertAge: string
  alertRunId: string
  alertContext: string
  alertAction: string
  alertRunLabel: string
  alertRunStatus: string
  alertRunTime: string
  owner: string
  deadline: string
  workItems: Array<{ id: string; title: string; status: string; priority: string }>
}

const workspaceProjects: WorkspaceProject[] = [
  { id: "video", name: "跨设备视频采集", category: "数据采集", description: "摄像头采集、帧解析、AI 检测、清洗与数据入库。", meta: "3 条工作流 · 2 个数据集", updated: "刚刚更新", status: "有待处理", tone: "warning", icon: Monitor, owner: "设备采集组", tags: ["视频", "局域网"], starred: true },
  { id: "collect", name: "多平台内容采集", category: "数据采集", description: "管理小红书、抖音、微博等独立数据入口。", meta: "5 条工作流 · 1 个数据集", updated: "12 分钟前", status: "健康", tone: "success", icon: Database, owner: "采集平台组", tags: ["网页", "连接器"], starred: true },
  { id: "clean", name: "品牌数据清洗", category: "数据处理", description: "去重、字段归一、实体抽取与质量校验。", meta: "2 条工作流 · 3 个数据集", updated: "1 小时前", status: "健康", tone: "success", icon: Braces, owner: "数据治理组", tags: ["清洗", "质量"] },
  { id: "knowledge", name: "品牌别名与研判规则", category: "知识库", description: "维护品牌实体、风险规则和可追溯研判知识。", meta: "2 条工作流 · 3 个数据集", updated: "今天 09:14", status: "需更新", tone: "warning", icon: Bot, owner: "知识运营组", tags: ["知识", "索引"] },
  { id: "report", name: "风险周报生成", category: "交付", description: "汇总证据与运行结果，生成并审批周报。", meta: "2 条工作流 · 4 类成果", updated: "昨天 18:40", status: "健康", tone: "success", icon: FileCheck2, owner: "内容交付组", tags: ["报告", "审批"] },
  { id: "notify", name: "高风险升级通知", category: "工作流", description: "命中高风险规则后升级通知对应负责人。", meta: "1 条工作流 · 2 个渠道", updated: "7 月 12 日", status: "草稿", tone: "neutral", icon: Radio, owner: "自动化运营组", tags: ["通知", "Agent"] },
]

const comparisonProfiles: Record<string, ComparisonProfile> = {
  video: {
    nodes: [
      { icon: Monitor, eyebrow: "Source", title: "视频采集", detail: "camera.stream", tone: "success" },
      { icon: Braces, eyebrow: "Decode", title: "帧解析", detail: "8 fps · h264", tone: "success" },
      { icon: Bot, eyebrow: "Agent", title: "目标检测", detail: "vision.team.v3", tone: "warning", selected: true },
      { icon: ShieldCheck, eyebrow: "Quality", title: "结果清洗", detail: "37 items pending", tone: "warning" },
      { icon: Database, eyebrow: "Store", title: "数据入库", detail: "partition hourly", tone: "success" },
      { icon: FileCheck2, eyebrow: "Deliver", title: "产物归档", detail: "clips + evidence" },
    ],
    nodeCount: "06", runCount: "48", debugRuns: "3", productionRuns: "45", success: "94.2", inbox: "05", inboxDetail: "离线 1 · 复核 2 · 审批 2", pluginCount: "3", references: "2", productionVersion: "v18", draftVersion: "v19", p95: "8.4s",
    evidence: "186", evidenceLabel: "视频事件", evidenceDetail: "2 条低置信检测等待人工确认",
    alertTitle: "局域网采集设备 CAM-07 心跳中断", alertLabel: "P0 · 设备离线", alertTone: "danger", alertAge: "6 min", alertRunId: "RUN-1842", alertContext: "视频采集节点", alertAction: "查看设备与会话", alertRunLabel: "生产运行", alertRunStatus: "中断", alertRunTime: "10:42",
    owner: "设备采集组", deadline: "今天 14:00",
    workItems: [
      { id: "CLI-248", title: "恢复 CAM-07 视频采集会话", status: "处理中", priority: "P0" },
      { id: "CLI-246", title: "复核低置信目标检测样本", status: "待处理", priority: "P1" },
      { id: "CLI-239", title: "审批局域网算力节点连接策略", status: "待审批", priority: "P1" },
    ],
  },
}

function getProjectRuns(profile: ComparisonProfile): ProjectRun[] {
  const currentRunNumber = Number(profile.alertRunId.replace("RUN-", ""))

  return [
    { id: profile.alertRunId, label: profile.alertRunLabel, status: profile.alertRunStatus, time: profile.alertRunTime, tone: profile.alertTone },
    { id: `RUN-${currentRunNumber - 1}`, label: "生产运行", status: "成功", time: "09:30", tone: "success" },
    { id: `RUN-${currentRunNumber - 2}`, label: "生产运行", status: "成功", time: "08:00", tone: "success" },
  ]
}

const workspaceFilters: Array<{ label: string; value: string; icon: Icon }> = [
  { label: "全部", value: "all", icon: FolderKanban },
  { label: "采集", value: "数据采集", icon: Database },
  { label: "处理", value: "数据处理", icon: Braces },
  { label: "知识库", value: "知识库", icon: Bot },
  { label: "工作流", value: "工作流", icon: Workflow },
  { label: "交付", value: "交付", icon: FileCheck2 },
]

function WorkspaceProjectIndex({ onOpenProject }: { onOpenProject: (project: WorkspaceProject) => void }) {
  const [view, setView] = useState<"all" | "starred" | "mine">("all")
  const [category, setCategory] = useState("all")
  const [query, setQuery] = useState("")
  const normalizedQuery = query.trim().toLowerCase()
  const visibleProjects = workspaceProjects.filter((project) => {
    const matchesView = view === "all" || (view === "starred" && project.starred) || (view === "mine" && ["设备采集组", "数据治理组"].includes(project.owner))
    const matchesCategory = category === "all" || project.category === category
    const haystack = `${project.name} ${project.description} ${project.owner} ${project.tags.join(" ")}`.toLowerCase()
    return matchesView && matchesCategory && (!normalizedQuery || haystack.includes(normalizedQuery))
  })

  return (
    <div className="flex min-h-screen w-full min-w-0 overflow-x-hidden bg-background pb-24 text-foreground">
      <GlobalNav compact />
      <div className="min-w-0 flex-1">
        <MobileHeader />
        <PrototypeNotice variant="C" />
        <main id="prototype-content" className="min-w-0 px-4 py-5 sm:px-6 xl:px-8">
          <header className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <h1 className="text-lg font-semibold tracking-tight">项目</h1>
              <button type="button" className="flex h-8 items-center gap-2 rounded-lg px-2 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"><Boxes className="size-3.5" aria-hidden="true" />品牌风险工作区<ChevronDown className="size-3" aria-hidden="true" /></button>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" className="hidden h-8 items-center gap-2 rounded-lg border border-border px-3 text-[10px] hover:bg-muted sm:flex"><FileUp className="size-3.5" aria-hidden="true" />导入 DSL</button>
              <button type="button" className="flex h-8 items-center gap-2 rounded-lg bg-foreground px-3 text-[10px] font-medium text-background hover:opacity-85 active:translate-y-px"><Plus className="size-3.5" aria-hidden="true" />创建项目<ChevronDown className="size-3" aria-hidden="true" /></button>
            </div>
          </header>

          <section className="mt-5 border-b border-border pb-3" aria-label="项目浏览视图">
            <div className="flex flex-wrap items-center gap-1">
              {([
                ["all", "全部项目"],
                ["starred", "收藏"],
                ["mine", "我负责的"],
              ] as const).map(([value, label]) => (
                <button key={value} type="button" onClick={() => setView(value)} aria-current={view === value ? "page" : undefined} className={cn("h-8 rounded-lg px-3 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground", view === value && "bg-muted font-medium text-foreground")}>{label}</button>
              ))}
              <div className="relative ml-auto min-w-[190px] flex-1 sm:max-w-[280px]">
                <Search className="pointer-events-none absolute left-3 top-2.5 size-3.5 text-muted-foreground" aria-hidden="true" />
                <input value={query} onChange={(event) => setQuery(event.target.value)} type="search" placeholder="搜索名称、标签或负责人" className="h-8 w-full rounded-lg border border-border bg-background pl-8 pr-3 text-[10px] outline-none placeholder:text-muted-foreground focus:border-foreground/30" />
              </div>
            </div>
          </section>

          <section className="mt-3 flex flex-wrap items-center gap-1.5" aria-label="项目筛选">
            {workspaceFilters.map(({ icon: ProjectFilterIcon, label, value }) => (
              <button key={value} type="button" onClick={() => setCategory(value)} aria-pressed={category === value} className={cn("flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground", category === value && "bg-muted text-foreground")}><ProjectFilterIcon className="size-3.5" aria-hidden={true} />{label}</button>
            ))}
            <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
            <button type="button" className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground">标签<ChevronDown className="size-3" aria-hidden="true" /></button>
            <button type="button" className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground">负责人<ChevronDown className="size-3" aria-hidden="true" /></button>
            <button type="button" className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground">健康状态<ChevronDown className="size-3" aria-hidden="true" /></button>
          </section>

          <section className="mt-5">
            <div className="flex items-center justify-between gap-3"><p className="text-xs font-medium">{visibleProjects.length} 个项目</p><button type="button" className="text-[10px] text-muted-foreground hover:text-foreground">最近修改 <ChevronDown className="ml-1 inline size-3" aria-hidden="true" /></button></div>
            {visibleProjects.length ? (
              <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {visibleProjects.map((project) => {
                const ProjectIcon = project.icon
                return (
                  <button key={project.id} type="button" onClick={() => onOpenProject(project)} className="group min-w-0 rounded-xl border border-border/80 bg-card/20 p-3.5 text-left transition-[border-color,background-color] hover:border-foreground/25 hover:bg-card/45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                    <div className="flex items-start justify-between gap-3">
                      <span className="grid size-9 place-items-center rounded-lg bg-muted"><ProjectIcon className="size-4" aria-hidden={true} /></span>
                      <span className="flex items-center gap-2"><span className="inline-flex items-center gap-1 text-[9px] text-muted-foreground"><StatusDot tone={project.tone} />{project.status}</span><Star className={cn("size-3.5 text-muted-foreground", project.starred && "fill-foreground text-foreground")} aria-hidden="true" /></span>
                    </div>
                    <div className="mt-4 flex items-center gap-2"><Eyebrow>{project.category}</Eyebrow><span className="font-mono text-[9px] text-muted-foreground">{project.meta}</span></div>
                    <h2 className="mt-1 truncate text-sm font-semibold">{project.name}</h2>
                    <p className="mt-1 line-clamp-2 min-h-8 text-[10px] leading-4 text-muted-foreground">{project.description}</p>
                    <div className="mt-3 flex flex-wrap gap-1">{project.tags.map((tag) => <span key={tag} className="rounded-md bg-muted px-1.5 py-1 text-[9px] text-muted-foreground">{tag}</span>)}</div>
                    <div className="mt-3 flex items-center justify-between border-t border-border/70 pt-2.5 text-[9px] text-muted-foreground"><span>{project.owner}</span><span>{project.updated}</span></div>
                  </button>
                )
              })}
              </div>
            ) : (
              <div className="mt-8 flex min-h-48 flex-col items-center justify-center rounded-xl border border-dashed border-border text-center"><Search className="size-5 text-muted-foreground" aria-hidden="true" /><p className="mt-3 text-xs font-medium">没有符合条件的项目</p><p className="mt-1 text-[10px] text-muted-foreground">清除搜索或切换筛选条件。</p></div>
            )}
          </section>

          <div className="mt-6 flex items-center justify-center gap-2 border-t border-border pt-4 text-[10px] text-muted-foreground"><FileUp className="size-3.5" aria-hidden="true" />拖入 DSL 创建项目，模板位于“创建项目”流程中</div>
        </main>
      </div>
    </div>
  )
}

function ProjectEditor({ project, onBack }: { project: WorkspaceProject; onBack: () => void }) {
  return (
    <div className="flex h-screen min-h-[760px] w-full min-w-0 overflow-hidden bg-background text-foreground">
      <GlobalNav compact />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileHeader />
        <PrototypeNotice variant="C" />
        <LifecycleHeader
          active="编排"
          compact
          tabs={projectLifecycleTabs}
          contextLabel="项目"
          title={project.name}
          eyebrow={`品牌风险工作区 / ${project.category}项目`}
        />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card/30 px-3 py-2.5 sm:px-4">
            <div className="flex min-w-0 items-center gap-3">
              <button type="button" onClick={onBack} className="flex h-8 shrink-0 items-center gap-2 rounded-lg px-2 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"><ArrowRight className="size-3.5 rotate-180" aria-hidden="true" />返回项目列表</button>
              <span className="h-5 w-px bg-border" aria-hidden="true" />
              <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Eyebrow>Formal workflow editor</Eyebrow><Pill tone="info"><Workflow className="size-2.5" aria-hidden={true} />正式节点系统</Pill><Pill>独立样例态</Pill></div><p className="mt-0.5 truncate text-[10px] text-muted-foreground">{project.name} · 当前复用正式样例图验收交互，项目草稿接线留在后续集成</p></div>
            </div>
            <Pill><Network className="size-2.5" aria-hidden={true} />sourcePort / targetPort / contractId</Pill>
          </div>
          <main id="prototype-content" className="min-h-0 min-w-0 flex-1 overflow-hidden">
            <Suspense fallback={<div className="grid h-full place-items-center text-sm text-muted-foreground">正在加载正式节点编辑器…</div>}>
              <WorkflowEditorSession forceStandalone />
            </Suspense>
          </main>
        </div>
      </div>
    </div>
  )
}

function VariantC({ onProjectOpenChange }: { onProjectOpenChange: (open: boolean) => void }) {
  const [selectedProject, setSelectedProject] = useState<WorkspaceProject | null>(null)

  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [selectedProject])

  if (selectedProject) {
    return <ProjectEditor project={selectedProject} onBack={() => { setSelectedProject(null); onProjectOpenChange(false) }} />
  }

  return <WorkspaceProjectIndex onOpenProject={(project) => { setSelectedProject(project); onProjectOpenChange(true) }} />
}

export function ProductShellPrototype({ initialVariant }: { initialVariant?: string }) {
  const [variant, setVariant] = useState<PrototypeVariant>(() => normalizeVariant(initialVariant))
  const [cProjectOpen, setCProjectOpen] = useState(false)

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

      if (cProjectOpen || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return
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
  }, [cProjectOpen])

  useEffect(() => {
    const url = new URL(window.location.href)
    url.searchParams.set("variant", variant)
    window.history.replaceState(window.history.state, "", url)
  }, [variant])

  return (
    <div className="dark min-h-screen w-full min-w-0 overflow-x-hidden bg-background text-foreground">
      <a href="#prototype-content" className="fixed left-3 top-3 z-[60] -translate-y-20 rounded-lg bg-foreground px-3 py-2 text-xs text-background focus:translate-y-0">跳到主要内容</a>
      {variant === "A" ? <VariantA /> : variant === "B" ? <VariantB /> : <VariantC onProjectOpenChange={setCProjectOpen} />}
      {variant === "C" && cProjectOpen ? null : <PrototypeSwitcher active={variant} onChange={setVariant} />}
    </div>
  )
}
