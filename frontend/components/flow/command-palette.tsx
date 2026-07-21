"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useReactFlow } from "@xyflow/react"
import { Loader2, Sparkles, Network, Save, RotateCcw, CornerDownLeft, Globe, ArrowLeft } from "lucide-react"
import { NODE_PALETTE } from "@/lib/flow/palette"
import type { PaletteItem } from "@/lib/flow/types"
import {
  getWorkflowNodeCatalog,
  workflowCatalogItemLocked,
  workflowCatalogPluginProvenance,
  type WorkflowNodeCatalogItem,
} from "@/lib/workflow/node-catalog"
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
import {
  fetchWorkflowOpenCLIAdapterNodes,
  workflowCatalogItemForOpenCLIAdapterNode,
  type WorkflowOpenCLIAdapterNode,
} from "@/lib/workflow/backend-opencli-adapter-nodes"

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

export function CommandPalette({
  open,
  onClose,
  onMessage,
  getAnchor,
}: {
  open: boolean
  onClose: () => void
  onMessage?: (msg: string) => void
  getAnchor?: () => { x: number; y: number }
}) {
  const [query, setQuery] = useState("")
  const [aiMode, setAiMode] = useState(false)
  const [aiPrompt, setAiPrompt] = useState("")
  const [loading, setLoading] = useState(false)
  const [opencliLoading, setOpencliLoading] = useState(false)
  const [opencliNodes, setOpencliNodes] = useState<WorkflowOpenCLIAdapterNode[]>([])
  const [opencliSummary, setOpencliSummary] = useState<Record<string, unknown>>({})
  const [selectedOpenCLI, setSelectedOpenCLI] = useState<WorkflowOpenCLIAdapterNode | null>(null)
  const [requiredValues, setRequiredValues] = useState<Record<string, string>>({})
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
  const workflowProfile = useFlowStore((s) => s.workflowProject.profile)
  const networkStackLength = useFlowStore((s) => s.networkStack.length)
  const inNodeNetwork = networkStackLength > 0
  const nodeDepth = workflowNodeDepthFromNetworkStack(networkStackLength)
  const nodeLayer = workflowNodeLayerAtDepth(nodeDepth)
  const language = useSettingsStore((s) => s.language)
  const { capabilities } = useWorkflowCapabilities(open)

  useEffect(() => {
    if (open) {
      setQuery("")
      setAiMode(false)
      setAiPrompt("")
      setSelectedOpenCLI(null)
      setRequiredValues({})
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  useEffect(() => {
    if (!open || opencliNodes.length || opencliLoading) return
    setOpencliLoading(true)
    void fetchWorkflowOpenCLIAdapterNodes({ includeWrite: false, limit: 5000 })
      .then((result) => {
        setOpencliNodes(result.nodes)
        setOpencliSummary(result.summary)
      })
      .finally(() => setOpencliLoading(false))
  }, [open, opencliLoading, opencliNodes.length])

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
      onClose()
    },
    [getAnchor, screenToFlowPosition, addNodeFromPalette, onMessage, onClose],
  )

  const addCatalogOperator = useCallback(
    (item: WorkflowNodeCatalogItem) => {
      if (workflowCatalogItemLocked(item)) {
        onMessage?.(item.runtimeCapability?.reason ?? "该插件能力尚未绑定运行适配器")
        return
      }
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
      onClose()
    },
    [getAnchor, screenToFlowPosition, addWorkflowNodeFromCatalog, language, onMessage, onClose],
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
      onClose()
    },
    [getAnchor, screenToFlowPosition, addPrimitiveNode, capabilities, language, onMessage, onClose],
  )

  const addOpenCLIAdapter = useCallback(
    (item: WorkflowOpenCLIAdapterNode, values: Record<string, string> = {}) => {
      const missing = item.requiredArgs.filter((name) => !values[name]?.trim())
      if (missing.length) {
        setSelectedOpenCLI(item)
        setRequiredValues(values)
        return
      }
      const position =
        getAnchor?.() ??
        screenToFlowPosition({
          x: window.innerWidth / 2,
          y: window.innerHeight / 2,
        })
      addWorkflowNodeFromCatalog(workflowCatalogItemForOpenCLIAdapterNode(item, values), position)
      onMessage?.(`已添加实时 OpenCLI 数据源：${item.label}`)
      onClose()
    },
    [addWorkflowNodeFromCatalog, getAnchor, onClose, onMessage, screenToFlowPosition],
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
  const catalogOperators = inNodeNetwork
    ? []
    : getWorkflowNodeCatalog(workflowProfile, capabilities).filter(
        (item) => item.category === "package" || workflowCatalogPluginProvenance(item) !== null,
      )
  const filteredCatalogOperators = q
    ? catalogOperators.filter(
        (item) => {
          const text = localizeNodeText(item.id, { label: item.label, description: item.description }, language)
          return (
          item.label.toLowerCase().includes(q) ||
          text.label.toLowerCase().includes(q) ||
          (text.description ?? "").toLowerCase().includes(q) ||
          item.kind.toLowerCase().includes(q) ||
          item.capability.toLowerCase().includes(q) ||
          item.keywords.some((keyword) => keyword.toLowerCase().includes(q))
          )
        },
      )
    : catalogOperators
  const filteredOpenCLINodes = (q
    ? opencliNodes.filter((item) => {
        const haystack = `${item.label} ${item.description} ${item.site} ${item.command}`.toLowerCase()
        return haystack.includes(q)
      })
    : opencliNodes
  ).slice(0, q ? 100 : 24)
  const primitiveOperators = (inNodeNetwork ? getWorkflowPrimitives() : []).filter((item) => {
    if (!q) return true
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
  const filteredOperators = q
    ? auxiliaryOperators.filter(
        (i) => i.label.toLowerCase().includes(q) || i.nodeType.toLowerCase().includes(q),
      )
    : auxiliaryOperators
  const filteredCommands = q ? commands.filter((c) => c.label.toLowerCase().includes(q)) : []

  if (!open) return null

  if (selectedOpenCLI) {
    const missingRequired = selectedOpenCLI.requiredArgs.filter((name) => !requiredValues[name]?.trim())
    return (
      <div className="fixed inset-0 z-50 flex items-start justify-center bg-background/85 pt-[15vh]" role="dialog" aria-modal="true" aria-label="配置 OpenCLI 数据源">
        <form
          className="w-[32rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border bg-popover shadow-2xl"
          onSubmit={(event) => {
            event.preventDefault()
            addOpenCLIAdapter(selectedOpenCLI, requiredValues)
          }}
        >
          <div className="flex items-center gap-3 border-b px-4 py-3">
            <button type="button" className="grid size-9 place-items-center rounded-md hover:bg-accent" onClick={() => setSelectedOpenCLI(null)} aria-label="返回数据源列表"><ArrowLeft className="size-4" /></button>
            <div className="min-w-0"><div className="truncate text-sm font-medium">{selectedOpenCLI.label}</div><div className="truncate text-xs text-muted-foreground">配置必填参数后作为实时 Source 加入画布</div></div>
          </div>
          <div className="grid max-h-[50vh] gap-3 overflow-y-auto p-4">
            {selectedOpenCLI.args.filter((arg) => arg.required).map((arg) => (
              <label key={arg.name} className="grid gap-1.5 text-xs">
                <span>{arg.name}<span className="ml-1 text-destructive">*</span></span>
                <input
                  value={requiredValues[arg.name] ?? ""}
                  onChange={(event) => setRequiredValues((current) => ({ ...current, [arg.name]: event.target.value }))}
                  placeholder={arg.help ?? `输入 ${arg.name}`}
                  className="min-h-11 rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/50"
                  autoFocus={selectedOpenCLI.requiredArgs[0] === arg.name}
                />
              </label>
            ))}
          </div>
          <div className="flex justify-end gap-2 border-t p-4"><button type="button" className="min-h-10 rounded-md border px-4 text-xs" onClick={() => setSelectedOpenCLI(null)}>取消</button><button type="submit" className="min-h-10 rounded-md bg-primary px-4 text-xs text-primary-foreground disabled:opacity-50" disabled={missingRequired.length > 0}>添加实时数据源</button></div>
        </form>
      </div>
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-background/85 pt-[15vh]"
      onClick={close}
      onKeyDown={(e) => {
        if (e.key === "Escape") close()
      }}
      role="dialog"
      aria-modal="true"
      aria-label="节点选择器"
    >
      <div
        className="w-[36rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border bg-popover shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {!aiMode ? (
          <>
            <div className="flex items-center gap-2 border-b px-4 py-3">
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                ⌘K
              </span>
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                    if (q && filteredOpenCLINodes[0]) {
                      addOpenCLIAdapter(filteredOpenCLINodes[0])
                    } else if (filteredCatalogOperators[0]) {
                      addCatalogOperator(filteredCatalogOperators[0])
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
                placeholder="搜索节点或操作…"
                className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
                aria-label="搜索命令或节点"
              />
              <kbd className="rounded-sm border px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">
                ESC
              </kbd>
            </div>

            <div className="max-h-[50vh] overflow-y-auto py-2">
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

              {opencliLoading || filteredOpenCLINodes.length > 0 ? (
                <>
                  <p className="flex items-center justify-between px-4 pb-1 pt-3 font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground/60">
                    <span>OpenCLI 实时数据源</span>
                    <span>{opencliLoading ? "读取中…" : `${String(opencliSummary.sourceSlotReady ?? opencliNodes.length)} 可直接运行 · ${opencliNodes.length} 个读命令`}</span>
                  </p>
                  {opencliLoading ? <div className="flex items-center gap-2 px-4 py-3 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />正在读取本机 OpenCLI 目录</div> : filteredOpenCLINodes.map((item) => (
                    <button key={item.id} type="button" onClick={() => addOpenCLIAdapter(item)} className="flex w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-accent">
                      <Globe className="size-3.5 text-[#ff7a17]" />
                      <span className="min-w-0 flex-1"><span className="block truncate text-sm">{item.label}</span><span className="block truncate text-[10px] text-muted-foreground">{item.description || `${item.site} ${item.command}`}</span></span>
                      <span className={cn("rounded-[3px] border px-1 py-0.5 font-mono text-[8px] uppercase tracking-wider", item.requiredArgs.length ? "border-warning/40 text-warning" : "border-success/40 text-success")}>{item.requiredArgs.length ? `${item.requiredArgs.length} 参数` : "实时"}</span>
                    </button>
                  ))}
                  {!opencliLoading && opencliNodes.length > filteredOpenCLINodes.length && !q ? <p className="px-4 py-2 text-center text-[10px] text-muted-foreground">输入站点或命令名可搜索全部 {opencliNodes.length} 个 OpenCLI 读命令</p> : null}
                </>
              ) : null}

              {filteredCatalogOperators.length > 0 ? (
                <>
                  <p className="px-4 pb-1 pt-3 font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground/60">
                    一级业务节点 · Dify 风格
                  </p>
                  {filteredCatalogOperators.map((item) => {
                    const Icon = getIcon(item.icon)
                    const text = localizeNodeText(item.id, { label: item.label, description: item.description }, language)
                    const locked = workflowCatalogItemLocked(item)
                    const provenance = workflowCatalogPluginProvenance(item)
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => addCatalogOperator(item)}
                        disabled={locked}
                        title={locked ? item.runtimeCapability?.reason ?? "等待运行适配器" : undefined}
                        className="flex w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-65 disabled:hover:bg-transparent"
                      >
                        <Icon className="size-3.5 text-[#ff7a17]" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">{text.label}</span>
                          <span className="block truncate text-[10px] text-muted-foreground">
                            {provenance
                              ? `${provenance.providerKey} · ${provenance.version}`
                              : text.description}
                          </span>
                        </span>
                        <span
                          className={cn(
                            "rounded-[3px] border px-1 py-0.5 font-mono text-[8px] uppercase tracking-wider",
                            runtimeStatusTone(item.runtimeCapability?.status),
                          )}
                          title={item.runtimeCapability?.reason ?? item.capability}
                        >
                          {runtimeStatusLabel(item.runtimeCapability?.status)}
                        </span>
                      </button>
                    )
                  })}
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

              {filteredCommands.length === 0 && filteredOpenCLINodes.length === 0 && filteredCatalogOperators.length === 0 && primitiveOperators.length === 0 && filteredOperators.length === 0 ? (
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
