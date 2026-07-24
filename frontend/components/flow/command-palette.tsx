"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useReactFlow } from "@xyflow/react"
import {
  Boxes,
  CornerDownLeft,
  Database,
  Loader2,
  Network,
  Play,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
  StickyNote,
  Wrench,
} from "lucide-react"
import { NODE_PALETTE } from "@/lib/flow/palette"
import type { PaletteItem } from "@/lib/flow/types"
import type { WorkflowNodeCatalogItem } from "@/lib/workflow/node-catalog"
import { getWorkflowPrimitives, type WorkflowPrimitive } from "@/lib/workflow/node-primitives"
import { workflowNodeDepthFromNetworkStack, workflowNodeLayerAtDepth } from "@/lib/workflow/node-hierarchy"
import { groupPrimitivesForNodeMenu } from "@/lib/workflow/node-menu"
import { getIcon } from "@/lib/flow/icons"
import { useFlowStore } from "@/lib/flow/store"
import { useSettingsStore } from "@/lib/flow/settings-store"
import { primitiveRuntimeCapability, runtimeStatusLabel, runtimeStatusTone } from "@/lib/workflow/capabilities"
import { useWorkflowCapabilities } from "@/lib/workflow/use-workflow-capabilities"
import { generateWorkflowLocally } from "@/lib/flow/local-generate"
import type { LayoutDirection, LayoutEngine } from "@/lib/flow/layout"
import { localizeNodeText } from "@/lib/workflow/node-i18n"
import { cn } from "@/lib/utils"

const AI_EXAMPLES = [
  "用户注册后发送欢迎邮件，24 小时后如果未激活则再次提醒",
  "监听订单创建事件，校验库存，扣减库存并通知仓库发货",
  "收到客服工单，判断优先级，高优先级转人工，其余自动回复",
]

type CommandEntry = {
  id: string
  label: string
  caption: string
  icon: "sparkles" | "network" | "save" | "reset"
  run?: () => void
}

const cmdIcons = {
  sparkles: Sparkles,
  network: Network,
  save: Save,
  reset: RotateCcw,
}

const catalogCategoryLabels: Record<WorkflowNodeCatalogItem["category"], string> = {
  trigger: "开始与触发",
  source: "数据来源",
  processing: "数据处理",
  flow: "流程控制",
  decision: "条件判断",
  control: "质量与审批",
  sink: "数据存储",
  output: "结果交付",
  package: "组合能力",
}

const commonOpenCLISites = [
  "douyin",
  "bilibili",
  "xiaohongshu",
  "weibo",
  "zhihu",
  "twitter",
  "jin10",
] as const

type PaletteTab = "business" | "tools" | "sources" | "start" | "auxiliary"

const paletteTabs: {
  id: PaletteTab
  label: string
  icon: typeof Boxes
}[] = [
  { id: "business", label: "业务节点", icon: Boxes },
  { id: "tools", label: "工具", icon: Wrench },
  { id: "sources", label: "数据源", icon: Database },
  { id: "start", label: "开始", icon: Play },
  { id: "auxiliary", label: "辅助", icon: StickyNote },
]

export function CommandPalette({
  adapterCatalogError,
  adapterCatalogLoading,
  catalogItems,
  open,
  onClose,
  onMessage,
  onNodeCreated,
  getAnchor,
  screenAnchor,
}: {
  adapterCatalogError?: string | null
  adapterCatalogLoading?: boolean
  catalogItems: WorkflowNodeCatalogItem[]
  open: boolean
  onClose: () => void
  onMessage?: (msg: string) => void
  onNodeCreated?: () => void
  getAnchor?: () => { x: number; y: number }
  screenAnchor?: { x: number; y: number } | null
}) {
  const [query, setQuery] = useState("")
  const [activeTab, setActiveTab] = useState<PaletteTab>("business")
  const [aiMode, setAiMode] = useState(false)
  const [aiPrompt, setAiPrompt] = useState("")
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const aiRef = useRef<HTMLTextAreaElement>(null)

  const { screenToFlowPosition } = useReactFlow()
  const addNodeFromPalette = useFlowStore((s) => s.addNodeFromPalette)
  const addPrimitiveNode = useFlowStore((s) => s.addPrimitiveNode)
  const addWorkflowNodeFromCatalog = useFlowStore((s) => s.addWorkflowNodeFromCatalog)
  const applyGeneratedWorkflow = useFlowStore((s) => s.applyGeneratedWorkflow)
  const autoLayout = useFlowStore((s) => s.autoLayout)
  const save = useFlowStore((s) => s.save)
  const reset = useFlowStore((s) => s.reset)
  const networkStackLength = useFlowStore((s) => s.networkStack.length)
  const inNodeNetwork = networkStackLength > 0
  const nodeDepth = workflowNodeDepthFromNetworkStack(networkStackLength)
  const nodeLayer = workflowNodeLayerAtDepth(nodeDepth)
  const language = useSettingsStore((s) => s.language)
  const { capabilities } = useWorkflowCapabilities(open)

  useEffect(() => {
    if (open) {
      setQuery("")
      setActiveTab(inNodeNetwork ? "tools" : "business")
      setAiMode(false)
      setAiPrompt("")
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [inNodeNetwork, open])

  useEffect(() => {
    if (aiMode) requestAnimationFrame(() => aiRef.current?.focus())
  }, [aiMode])

  const close = useCallback(() => {
    if (!loading) onClose()
  }, [loading, onClose])

  const addOperator = useCallback(
    (item: PaletteItem) => {
      // 优先落在唤出热盒时的光标位置，回退到视口中心
      const position =
        getAnchor?.() ??
        screenToFlowPosition({
          x: window.innerWidth / 2,
          y: window.innerHeight / 2,
        })
      addNodeFromPalette(item, position)
      onMessage?.(`已添加节点：${item.label}`)
      onNodeCreated?.()
      onClose()
    },
    [getAnchor, screenToFlowPosition, addNodeFromPalette, onMessage, onNodeCreated, onClose],
  )

  const addCatalogOperator = useCallback(
    (item: WorkflowNodeCatalogItem) => {
      const position =
        getAnchor?.() ??
        screenToFlowPosition({
          x: window.innerWidth / 2,
          y: window.innerHeight / 2,
        })
      addWorkflowNodeFromCatalog(item, position)
      const text = localizeNodeText(item.id, { label: item.label, description: item.description }, language)
      const status = item.runtimeCapability?.status
      onMessage?.(
        status && status !== "runnable"
          ? `已添加一级业务节点：${text.label} (${runtimeStatusLabel(status)})`
          : `已添加一级业务节点：${text.label}`,
      )
      onNodeCreated?.()
      onClose()
    },
    [getAnchor, screenToFlowPosition, addWorkflowNodeFromCatalog, language, onMessage, onNodeCreated, onClose],
  )

  const addPrimitive = useCallback(
    (item: WorkflowPrimitive) => {
      const position =
        getAnchor?.() ??
        screenToFlowPosition({
          x: window.innerWidth / 2,
          y: window.innerHeight / 2,
        })
      addPrimitiveNode(item, position, primitiveRuntimeCapability(capabilities, item.id))
      const text = localizeNodeText(item.id, { label: item.label, description: item.description }, language)
      onMessage?.(`已添加底层组件：${text.label}`)
      onNodeCreated?.()
      onClose()
    },
    [getAnchor, screenToFlowPosition, addPrimitiveNode, capabilities, language, onMessage, onNodeCreated, onClose],
  )

  const generate = useCallback(
    async (text: string) => {
      if (!text.trim() || loading) return
      setLoading(true)
      try {
        const res = await fetch("/api/generate-workflow", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: text }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data?.detail ?? "failed")
        applyGeneratedWorkflow(data)
        onMessage?.(`已生成工作流：${data.title ?? "未命名"}`)
      } catch {
        const spec = generateWorkflowLocally(text)
        applyGeneratedWorkflow(spec)
        onMessage?.(`已生成工作流（本地引擎）：${spec.title}`)
      } finally {
        setLoading(false)
        onClose()
      }
    },
    [loading, applyGeneratedWorkflow, onMessage, onClose],
  )

  const layoutCommands: { engine: LayoutEngine; dir: LayoutDirection; label: string }[] = [
    { engine: "elk", dir: "TB", label: "Auto Layout · ELK 纵向" },
    { engine: "elk", dir: "LR", label: "Auto Layout · ELK 横向" },
    { engine: "dagre", dir: "TB", label: "Auto Layout · Dagre 纵向" },
    { engine: "dagre", dir: "LR", label: "Auto Layout · Dagre 横向" },
    { engine: "d3-force", dir: "TB", label: "Auto Layout · 力导向" },
  ]

  const commands: CommandEntry[] = useMemo(
    () => [
      {
        id: "ai",
        label: "Generate workflow from description",
        caption: "AI",
        icon: "sparkles",
      },
      ...layoutCommands.map((l) => ({
        id: `layout-${l.engine}-${l.dir}`,
        label: l.label,
        caption: "LAYOUT",
        icon: "network" as const,
        run: () => {
          void autoLayout(l.dir, l.engine, true)
          onMessage?.("已应用自动布局")
          onClose()
        },
      })),
      {
        id: "save",
        label: "Save graph to local",
        caption: "GRAPH",
        icon: "save",
        run: () => {
          save()
          onMessage?.("已保存到本地")
          onClose()
        },
      },
      {
        id: "reset",
        label: "Reset to example graph",
        caption: "GRAPH",
        icon: "reset",
        run: () => {
          reset()
          onMessage?.("已重置为示例")
          onClose()
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [autoLayout, save, reset, onMessage, onClose],
  )

  const q = query.trim().toLowerCase()
  const availableTabs = inNodeNetwork
    ? paletteTabs.filter((tab) => tab.id === "tools" || tab.id === "auxiliary")
    : paletteTabs
  const catalogOperators = inNodeNetwork
    ? []
    : prioritizeCommonSources(
        catalogItems.filter((item) => paletteTabForCatalogItem(item) === activeTab),
      )
  const filteredCatalogOperators = q && !q.startsWith(">")
    ? catalogOperators.filter((item) => {
        const text = localizeNodeText(item.id, { label: item.label, description: item.description }, language)
        return (
          item.label.toLowerCase().includes(q) ||
          text.label.toLowerCase().includes(q) ||
          (text.description ?? "").toLowerCase().includes(q) ||
          item.kind.toLowerCase().includes(q) ||
          item.capability.toLowerCase().includes(q) ||
          item.keywords.some((keyword) => keyword.toLowerCase().includes(q))
        )
      })
    : q.startsWith(">")
      ? []
      : catalogOperators
  const visibleCatalogOperators = filteredCatalogOperators.slice(0, 200)
  const hiddenCatalogCount = filteredCatalogOperators.length - visibleCatalogOperators.length
  const primitiveOperators = (
    inNodeNetwork && activeTab === "tools" ? getWorkflowPrimitives() : []
  ).filter((item) => {
    if (!q || q.startsWith(">")) return !q.startsWith(">")
    const text = localizeNodeText(item.id, { label: item.label, description: item.description }, language)
    return (
      item.label.toLowerCase().includes(q) ||
      text.label.toLowerCase().includes(q) ||
      (text.description ?? "").toLowerCase().includes(q) ||
      item.category.toLowerCase().includes(q) ||
      item.keywords.some((keyword) => keyword.toLowerCase().includes(q))
    )
  })
  const primitiveGroups = groupPrimitivesForNodeMenu(primitiveOperators)
  const auxiliaryOperators = NODE_PALETTE.filter(
    (item) => item.category === "annotation" || item.category === "shape",
  )
  const filteredOperators = activeTab === "auxiliary" && !q.startsWith(">")
    ? q
    ? auxiliaryOperators.filter(
        (i) => i.label.toLowerCase().includes(q) || i.nodeType.toLowerCase().includes(q),
      )
    : auxiliaryOperators
    : []
  const commandQuery = q.startsWith(">") ? q.slice(1).trim() : null
  const filteredCommands = commandQuery === null
    ? []
    : commands.filter((c) => c.label.toLowerCase().includes(commandQuery))
  const visibleCatalogGroups = Array.from(
    visibleCatalogOperators.reduce((groups, item) => {
      const items = groups.get(item.category) ?? []
      items.push(item)
      groups.set(item.category, items)
      return groups
    }, new Map<WorkflowNodeCatalogItem["category"], WorkflowNodeCatalogItem[]>()),
  )
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 bg-background/35"
      onClick={close}
      onKeyDown={(e) => {
        if (e.key === "Escape") close()
      }}
      role="dialog"
      aria-modal="true"
      aria-label="节点选择器"
    >
      <div
        className="absolute w-[25rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border bg-popover shadow-2xl"
        style={{
          left: screenAnchor
            ? Math.max(16, Math.min(screenAnchor.x, window.innerWidth - 416))
            : Math.max(16, window.innerWidth / 2 - 200),
          top: screenAnchor
            ? Math.max(72, Math.min(screenAnchor.y, window.innerHeight - 560))
            : Math.max(72, window.innerHeight * 0.12),
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {!aiMode ? (
          <>
            <div className="px-4 py-3">
              <div className="flex items-center gap-2">
                <Plus className="size-4 text-[#ff7a17]" />
                <span className="text-sm font-medium text-foreground">添加节点</span>
                <span className="ml-auto text-[11px] text-muted-foreground">
                  选择后直接进入配置
                </span>
              </div>
            </div>

            <div
              className="flex min-w-0 gap-0.5 border-b bg-muted/25 px-1 pt-1"
              role="tablist"
              aria-label="节点一级菜单"
            >
              {availableTabs.map((tab) => {
                const Icon = tab.icon
                const selected = activeTab === tab.id
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    aria-controls="node-selector-panel"
                    onClick={() => {
                      setActiveTab(tab.id)
                      setQuery("")
                      requestAnimationFrame(() => inputRef.current?.focus())
                    }}
                    className={cn(
                      "relative flex min-w-0 flex-1 items-center justify-center gap-1 rounded-t-lg px-1.5 py-2 text-[11px] transition-colors",
                      selected
                        ? "bg-popover font-medium text-[#ff7a17]"
                        : "text-muted-foreground hover:bg-background/55 hover:text-foreground",
                    )}
                  >
                    <Icon className="size-3.5 shrink-0" />
                    <span className="truncate">{tab.label}</span>
                    {selected ? (
                      <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-[#ff7a17]" />
                    ) : null}
                  </button>
                )
              })}
            </div>

            <div className="border-b p-2">
              <div className="flex items-center gap-2 rounded-md border bg-background/65 px-3 py-2">
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                      if (visibleCatalogOperators[0]) {
                        addCatalogOperator(visibleCatalogOperators[0])
                      } else if (primitiveOperators[0]) {
                        addPrimitive(primitiveOperators[0])
                      } else if (filteredOperators[0]) {
                        addOperator(filteredOperators[0])
                      } else if (filteredCommands[0]) {
                        const first = filteredCommands[0]
                        if (first.id === "ai") setAiMode(true)
                        else first.run?.()
                      }
                    }
                  }}
                  placeholder={`搜索${availableTabs.find((tab) => tab.id === activeTab)?.label ?? "节点"}；输入 > 搜索画布操作`}
                  className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
                  aria-label="搜索命令或节点"
                />
                <kbd className="rounded-sm border px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">
                  ESC
                </kbd>
              </div>
            </div>

            <div
              id="node-selector-panel"
              role="tabpanel"
              className="max-h-[50vh] min-h-28 overflow-y-auto py-2"
            >
              {adapterCatalogLoading && (activeTab === "tools" || activeTab === "sources") ? (
                <p className="px-4 py-2 text-xs text-muted-foreground">
                  正在同步 OpenCLI 内置适配器…
                </p>
              ) : null}
              {adapterCatalogError && (activeTab === "tools" || activeTab === "sources") ? (
                <p className="px-4 py-2 text-xs text-destructive" title={adapterCatalogError}>
                  OpenCLI 内置适配器目录暂不可用，已保留静态节点。
                </p>
              ) : null}
              {filteredCommands.length > 0 ? (
                <>
                  <p className="px-4 py-1 font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground/60">
                    快捷操作
                  </p>
                  {filteredCommands.map((cmd) => {
                    const Icon = cmdIcons[cmd.icon]
                    const isAi = cmd.id === "ai"
                    return (
                      <button
                        key={cmd.id}
                        type="button"
                        onClick={() => (isAi ? setAiMode(true) : cmd.run?.())}
                        className="flex w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-accent"
                      >
                        <Icon className={cn("size-3.5", isAi ? "text-[#ff7a17]" : "text-muted-foreground")} />
                        <span className="min-w-0 flex-1 truncate text-sm">{cmd.label}</span>
                        <span
                          className={cn(
                            "font-mono text-[9px] uppercase tracking-wider",
                            isAi ? "text-[#ff7a17]" : "text-muted-foreground/50",
                          )}
                        >
                          {cmd.caption}
                        </span>
                      </button>
                    )
                  })}
                </>
              ) : null}

              {visibleCatalogGroups.length > 0 ? (
                <>
                  {visibleCatalogGroups.map(([category, items]) => (
                    <section key={category} className="pb-1">
                      <p className="border-y border-border/60 bg-muted/25 px-4 py-1.5 text-[11px] font-medium text-muted-foreground">
                        {catalogCategoryLabels[category]}
                      </p>
                      {items.map((item) => {
                        const Icon = getIcon(item.icon)
                        const text = localizeNodeText(item.id, { label: item.label, description: item.description }, language)
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => addCatalogOperator(item)}
                            className="group flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-accent"
                          >
                            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border bg-background/70">
                              <Icon className="size-3.5 text-[#ff7a17]" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium text-foreground">{text.label}</span>
                              <span className="mt-0.5 block line-clamp-1 text-[11px] leading-relaxed text-muted-foreground">
                                {text.description}
                              </span>
                            </span>
                            <span
                              className={cn(
                                "mt-1 rounded-[3px] border px-1 py-0.5 font-mono text-[8px] uppercase tracking-wider",
                                runtimeStatusTone(item.runtimeCapability?.status),
                              )}
                              title={item.runtimeCapability?.reason ?? item.capability}
                            >
                              {runtimeStatusLabel(item.runtimeCapability?.status)}
                            </span>
                          </button>
                        )
                      })}
                    </section>
                  ))}
                  {hiddenCatalogCount > 0 ? (
                    <p className="px-4 py-2 text-xs text-muted-foreground">
                      还有 {hiddenCatalogCount} 个结果，请继续输入关键词筛选。
                    </p>
                  ) : null}
                </>
              ) : null}

              {primitiveOperators.length > 0 ? (
                <>
                  <p className="px-4 pb-1 pt-3 font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground/60">
                    L{nodeDepth} · {nodeLayer.label}
                  </p>
                  {primitiveGroups.map((group) => (
                    <div key={group.category}>
                      <p className="border-y border-border/60 bg-muted/30 px-4 py-1.5 text-[11px] font-medium text-muted-foreground">
                        {group.label}
                      </p>
                      {group.items.map((item) => {
                        const Icon = getIcon(item.icon)
                        const text = localizeNodeText(item.id, { label: item.label, description: item.description }, language)
                        const runtimeCapability = primitiveRuntimeCapability(capabilities, item.id)
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => addPrimitive(item)}
                            className="flex w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-accent"
                          >
                            <Icon className="size-3.5 text-muted-foreground" />
                            <span className="min-w-0 flex-1 truncate text-sm">{text.label}</span>
                            <span
                              className={cn(
                                "rounded-[3px] border px-1 py-0.5 font-mono text-[8px] uppercase tracking-wider",
                                runtimeStatusTone(runtimeCapability?.status ?? "design_only"),
                              )}
                              title={runtimeCapability?.reason ?? item.category}
                            >
                              {runtimeStatusLabel(runtimeCapability?.status ?? "design_only")}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  ))}
                </>
              ) : null}

              {filteredOperators.length > 0 ? (
                <>
                  <p className="px-4 pb-1 pt-3 font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground/60">
                    注释与辅助
                  </p>
                  {filteredOperators.map((item) => {
                    const Icon = getIcon(item.icon)
                    return (
                      <button
                        key={`${item.nodeType}-${item.shape ?? item.label}`}
                        type="button"
                        onClick={() => addOperator(item)}
                        className="flex w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-accent"
                      >
                        <Icon className="size-3.5 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate text-sm">{item.label}</span>
                        <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground/50">
                          {(item.shape ?? item.nodeType).toUpperCase()}
                        </span>
                      </button>
                    )
                  })}
                </>
              ) : null}

              {filteredCommands.length === 0 && filteredCatalogOperators.length === 0 && primitiveOperators.length === 0 && filteredOperators.length === 0 ? (
                <p className="px-4 py-6 text-center font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  没有匹配的节点或操作
                </p>
              ) : null}
            </div>
          </>
        ) : (
          <div className="p-4">
            <div className="mb-3 flex items-center gap-2">
              <Sparkles className="size-4 text-[#ff7a17]" />
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#ff7a17]">
                Generate from description
              </span>
            </div>
            <div className="relative">
              <textarea
                ref={aiRef}
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    void generate(aiPrompt)
                  }
                  if (e.key === "Escape") setAiMode(false)
                }}
                placeholder="描述你想要的流程，例如：用户下单后校验库存，成功则通知发货，失败则退款…"
                className="min-h-24 w-full resize-none rounded-md border bg-background p-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-[#ff7a17]/60 focus:outline-none"
                disabled={loading}
              />
              <button
                type="button"
                onClick={() => void generate(aiPrompt)}
                disabled={loading || !aiPrompt.trim()}
                className="absolute bottom-2.5 right-2.5 flex size-7 items-center justify-center rounded-sm bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
                aria-label="生成"
              >
                {loading ? <Loader2 className="size-3.5 animate-spin" /> : <CornerDownLeft className="size-3.5" />}
              </button>
            </div>
            <div className="mt-3 space-y-1">
              {AI_EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  disabled={loading}
                  onClick={() => void generate(ex)}
                  className="block w-full truncate rounded-sm border border-transparent px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:border-border hover:text-foreground disabled:opacity-50"
                >
                  {ex}
                </button>
              ))}
            </div>
            <p className="mt-3 font-mono text-[9px] uppercase tracking-wider text-muted-foreground/50">
              ⌘+Enter 生成 · ESC 返回
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function paletteTabForCatalogItem(item: WorkflowNodeCatalogItem): PaletteTab {
  if (item.category === "package") return "business"
  if (item.category === "trigger") return "start"
  if (item.category === "source") return "sources"
  return "tools"
}

function prioritizeCommonSources(items: WorkflowNodeCatalogItem[]): WorkflowNodeCatalogItem[] {
  return items
    .map((item, index) => ({
      item,
      index,
      rank: commonOpenCLISites.findIndex((site) =>
        item.id.startsWith(`opencli.adapter.${site}.`),
      ),
    }))
    .sort((left, right) => {
      const leftRank = left.rank < 0 ? Number.MAX_SAFE_INTEGER : left.rank
      const rightRank = right.rank < 0 ? Number.MAX_SAFE_INTEGER : right.rank
      return leftRank - rightRank || left.index - right.index
    })
    .map(({ item }) => item)
}
