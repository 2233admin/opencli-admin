"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useReactFlow } from "@xyflow/react"
import { Loader2, Sparkles, Network, Save, RotateCcw, CornerDownLeft } from "lucide-react"
import { NODE_PALETTE } from "@/lib/flow/palette"
import type { PaletteItem } from "@/lib/flow/types"
import { getWorkflowNodeCatalog, type WorkflowNodeCatalogItem } from "@/lib/workflow/node-catalog"
import { getWorkflowPrimitives, type WorkflowPrimitive } from "@/lib/workflow/node-primitives"
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
  const inNodeNetwork = useFlowStore((s) => s.networkStack.length > 0)
  const language = useSettingsStore((s) => s.language)
  const { capabilities } = useWorkflowCapabilities(open)

  useEffect(() => {
    if (open) {
      setQuery("")
      setAiMode(false)
      setAiPrompt("")
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

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
          ? `已添加原子节点：${text.label} (${runtimeStatusLabel(status)})`
          : `已添加原子节点：${text.label}`,
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
  const catalogOperators = getWorkflowNodeCatalog(workflowProfile, capabilities)
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
  const primitiveOperators = getWorkflowPrimitives().filter((item) => {
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
  const filteredOperators = q
    ? NODE_PALETTE.filter(
        (i) => i.label.toLowerCase().includes(q) || i.nodeType.toLowerCase().includes(q),
      )
    : NODE_PALETTE
  const filteredCommands = q ? commands.filter((c) => c.label.toLowerCase().includes(q)) : commands

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-background/85 pt-[15vh]"
      onClick={close}
      onKeyDown={(e) => {
        if (e.key === "Escape") close()
      }}
      role="dialog"
      aria-modal="true"
      aria-label="命令面板"
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
                    const first = filteredCommands[0]
                    if (first) {
                      if (first.id === "ai") setAiMode(true)
                      else first.run?.()
                    } else if (filteredCatalogOperators[0]) {
                      addCatalogOperator(filteredCatalogOperators[0])
                    } else if (primitiveOperators[0]) {
                      addPrimitive(primitiveOperators[0])
                    } else if (filteredOperators[0]) {
                      addOperator(filteredOperators[0])
                    }
                  }
                }}
                placeholder="Add operator, run command..."
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
                    Commands
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

              {filteredCatalogOperators.length > 0 ? (
                <>
                  <p className="px-4 pb-1 pt-3 font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground/60">
                    Package Operators
                  </p>
                  {filteredCatalogOperators.map((item) => {
                    const Icon = getIcon(item.icon)
                    const text = localizeNodeText(item.id, { label: item.label, description: item.description }, language)
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => addCatalogOperator(item)}
                        className="flex w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-accent"
                      >
                        <Icon className="size-3.5 text-[#ff7a17]" />
                        <span className="min-w-0 flex-1 truncate text-sm">{text.label}</span>
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
                    Internal Primitive Components{inNodeNetwork ? " · Current Network" : ""}
                  </p>
                  {primitiveOperators.map((item) => {
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
                </>
              ) : null}

              {filteredOperators.length > 0 ? (
                <>
                  <p className="px-4 pb-1 pt-3 font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground/60">
                    Canvas Blocks
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
                  No results
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
              ⌘+Enter to generate · ESC to go back
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
