"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useReactFlow, getNodesBounds, getViewportForBounds } from "@xyflow/react"
import { toPng } from "html-to-image"
import {
  Undo2,
  Redo2,
  Network,
  Save,
  FolderOpen,
  RotateCcw,
  ImageDown,
  ServerCog,
  Download,
  FileCode2,
  Upload,
  Link2,
  Eraser,
  Users,
  Settings,
  SlidersHorizontal,
  Play,
  Bot,
  ListTree,
  Magnet,
  Scissors,
  MoreHorizontal,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Slider } from "@/components/ui/slider"
import { Label } from "@/components/ui/label"
import { useFlowStore } from "@/lib/flow/store"
import { useSettingsStore } from "@/lib/flow/settings-store"
import { buildShareUrl } from "@/lib/flow/share-state"
import type { LayoutDirection, LayoutEngine } from "@/lib/flow/layout"
import {
  exportReactFlowToWorkflowJson,
  exportReactFlowToWorkflowCanvas,
  exportReactFlowToWorkflowMermaid,
  exportReactFlowToWorkflowMarkdown,
  exportReactFlowToWorkflowOpml,
  importWorkflowJsonToReactFlow,
  importWorkflowMermaidToReactFlow,
} from "@/lib/workflow/io"
import { cn } from "@/lib/utils"

const LAYOUTS: { engine: LayoutEngine; dir: LayoutDirection; label: string }[] = [
  { engine: "elk", dir: "TB", label: "ELK · 纵向（推荐）" },
  { engine: "elk", dir: "LR", label: "ELK · 横向" },
  { engine: "dagre", dir: "TB", label: "Dagre · 从上到下" },
  { engine: "dagre", dir: "LR", label: "Dagre · 从左到右" },
  { engine: "d3-hierarchy", dir: "TB", label: "树状 · 纵向" },
  { engine: "d3-hierarchy", dir: "LR", label: "树状 · 横向" },
  { engine: "d3-force", dir: "TB", label: "力导向 · 自由" },
]

function downloadText(filename: string, data: string, type: string) {
  const blob = new Blob([data], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.download = filename
  a.href = url
  a.click()
  URL.revokeObjectURL(url)
}

function IconAction({
  label,
  onClick,
  disabled,
  active,
  children,
}: {
  label: string
  onClick?: () => void
  disabled?: boolean
  active?: boolean
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "size-7 text-muted-foreground hover:text-foreground",
              active && "bg-accent text-foreground",
            )}
            onClick={onClick}
            disabled={disabled}
            aria-label={label}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function CommandStrip({
  onOpenPalette,
  onExported,
  collab,
  onToggleCollab,
  settingsOpen,
  onToggleSettings,
  projectSettingsOpen,
  onToggleProjectSettings,
  runTraceOpen,
  onToggleRunTrace,
  agentDrawerOpen,
  onToggleAgentDrawer,
  nodeManagementOpen,
  onToggleNodeManagement,
}: {
  onOpenPalette: () => void
  onExported?: (msg: string) => void
  collab?: boolean
  onToggleCollab?: () => void
  settingsOpen?: boolean
  onToggleSettings?: () => void
  projectSettingsOpen?: boolean
  onToggleProjectSettings?: () => void
  runTraceOpen?: boolean
  onToggleRunTrace?: () => void
  agentDrawerOpen?: boolean
  onToggleAgentDrawer?: () => void
  nodeManagementOpen?: boolean
  onToggleNodeManagement?: () => void
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { getNodes } = useReactFlow()

  const undo = useFlowStore((s) => s.undo)
  const redo = useFlowStore((s) => s.redo)
  const canUndo = useFlowStore((s) => s.past.length > 0)
  const canRedo = useFlowStore((s) => s.future.length > 0)
  const nodeCount = useFlowStore((s) => s.nodes.length)
  const edgeCount = useFlowStore((s) => s.edges.length)
  const workflowProjectName = useFlowStore((s) => s.workflowProject.name)
  const networkDepth = useFlowStore((s) => s.networkStack.length)
  const selectedNodeId = useFlowStore((s) => s.nodes.find((node) => node.selected)?.id)
  const selectedNodeCount = useFlowStore((s) => s.nodes.reduce((count, node) => count + (node.selected ? 1 : 0), 0))
  const selectedEdgeCount = useFlowStore((s) => s.edges.reduce((count, edge) => count + (edge.selected ? 1 : 0), 0))
  const autoLayout = useFlowStore((s) => s.autoLayout)
  const selectConnectedComponent = useFlowStore((s) => s.selectConnectedComponent)
  const save = useFlowStore((s) => s.save)
  const load = useFlowStore((s) => s.load)
  const reset = useFlowStore((s) => s.reset)
  const importFlow = useFlowStore((s) => s.importFlow)
  const importWorkflowProject = useFlowStore((s) => s.importWorkflowProject)
  const snapToHelperLines = useSettingsStore((s) => s.snapToHelperLines)
  const setCanvasSetting = useSettingsStore((s) => s.set)

  const toolMode = useFlowStore((s) => s.toolMode)
  const setToolMode = useFlowStore((s) => s.setToolMode)
  const penColor = useFlowStore((s) => s.penColor)
  const setPenColor = useFlowStore((s) => s.setPenColor)
  const penSize = useFlowStore((s) => s.penSize)
  const setPenSize = useFlowStore((s) => s.setPenSize)
  const clearDrawings = useFlowStore((s) => s.clearDrawings)

  const isDirty = canUndo
  const [shareUrlLoaded, setShareUrlLoaded] = useState(false)

  useEffect(() => {
    if (typeof window === "undefined") return
    setShareUrlLoaded(new URLSearchParams(window.location.search).has("flow"))
  }, [])

  const exportImage = useCallback(() => {
    const nodes = getNodes()
    if (nodes.length === 0) return
    const bounds = getNodesBounds(nodes)
    const width = 1600
    const height = 1000
    const viewport = getViewportForBounds(bounds, width, height, 0.5, 2, 0.15)
    const el = document.querySelector<HTMLElement>(".react-flow__viewport")
    if (!el) return
    const bg = getComputedStyle(document.documentElement).getPropertyValue("--background").trim()
    toPng(el, {
      backgroundColor: bg || "#0a0a0a",
      width,
      height,
      style: {
        width: `${width}px`,
        height: `${height}px`,
        transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
      },
    }).then((dataUrl) => {
      const a = document.createElement("a")
      a.download = `workflow-${Date.now()}.png`
      a.href = dataUrl
      a.click()
      onExported?.("已导出为 PNG 图片")
    })
  }, [getNodes, onExported])

  const exportServerImage = useCallback(async () => {
    const { nodes, edges } = useFlowStore.getState()
    if (nodes.length === 0) return
    try {
      const res = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodes, edges }),
      })
      if (!res.ok) throw new Error("failed")
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.download = `workflow-server-${Date.now()}.svg`
      a.href = url
      a.click()
      URL.revokeObjectURL(url)
      onExported?.("已由服务端生成 SVG 图像")
    } catch {
      onExported?.("服务端成图失败")
    }
  }, [onExported])

  const exportJson = useCallback(() => {
    const { workflowProject, nodes, edges } = useFlowStore.getState()
    const data = exportReactFlowToWorkflowJson(workflowProject, { nodes, edges })
    downloadText(`workflow-${Date.now()}.json`, data, "application/json")
    onExported?.("已导出为 JSON 文件")
  }, [onExported])

  const exportMermaid = useCallback(() => {
    const { workflowProject, nodes, edges } = useFlowStore.getState()
    const data = exportReactFlowToWorkflowMermaid(workflowProject, { nodes, edges })
    downloadText(`workflow-${Date.now()}.mmd`, data, "text/plain")
    onExported?.("已导出为 Mermaid 文件")
  }, [onExported])

  const exportCanvas = useCallback(() => {
    const { workflowProject, nodes, edges } = useFlowStore.getState()
    const data = exportReactFlowToWorkflowCanvas(workflowProject, { nodes, edges })
    downloadText(`workflow-${Date.now()}.canvas`, data, "application/json")
    onExported?.("已导出为 Obsidian Canvas")
  }, [onExported])

  const exportOpml = useCallback(() => {
    const { workflowProject, nodes, edges } = useFlowStore.getState()
    const data = exportReactFlowToWorkflowOpml(workflowProject, { nodes, edges })
    downloadText(`workflow-${Date.now()}.opml`, data, "text/xml")
    onExported?.("已导出为 OPML")
  }, [onExported])

  const exportMarkdown = useCallback(() => {
    const { workflowProject, nodes, edges } = useFlowStore.getState()
    const data = exportReactFlowToWorkflowMarkdown(workflowProject, { nodes, edges })
    downloadText(`workflow-${Date.now()}.md`, data, "text/markdown")
    onExported?.("已导出为 Markdown")
  }, [onExported])

  const copyShareUrl = useCallback(async () => {
    if (typeof window === "undefined") return
    const { workflowProject, nodes, edges, drawings } = useFlowStore.getState()
    const url = buildShareUrl({ workflowProject, nodes, edges, drawings }, window.location.href)
    try {
      await navigator.clipboard.writeText(url)
      window.history.replaceState(null, "", url)
      setShareUrlLoaded(true)
      onExported?.("已复制压缩分享 URL")
    } catch {
      window.history.replaceState(null, "", url)
      setShareUrlLoaded(true)
      onExported?.("已写入地址栏分享 URL")
    }
  }, [onExported])

  const selectActiveComponent = useCallback(() => {
    const anchorId = selectedNodeId
    if (!anchorId) {
      onExported?.("先选中一个节点，再选择连通组件")
      return
    }
    const result = selectConnectedComponent(anchorId)
    onExported?.(`已选中连通组件：${result.nodeIds.length} 节点 / ${result.edgeIds.length} 连线`)
  }, [onExported, selectConnectedComponent, selectedNodeId])

  const onImportFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = () => {
        const raw = reader.result as string
        const workflow = importWorkflowJsonToReactFlow(raw)
        if (workflow.ok) {
          importWorkflowProject(workflow.project)
          onExported?.(
            workflow.format === "n8n"
              ? `已翻译 n8n workflow：${workflow.report?.nodeCount ?? workflow.project.nodes.length} 节点 / ${workflow.report?.edgeCount ?? workflow.project.edges.length} 连线`
              : "已导入 canonical workflow",
          )
          return
        }

        const mermaid = importWorkflowMermaidToReactFlow(raw)
        if (mermaid.ok) {
          importWorkflowProject(mermaid.project)
          onExported?.("已导入 Mermaid workflow draft")
          return
        }

        try {
          importFlow(JSON.parse(raw))
          onExported?.("已导入旧版画布 JSON")
        } catch {
          onExported?.(workflow.error)
        }
      }
      reader.readAsText(file)
      e.target.value = ""
    },
    [importFlow, importWorkflowProject, onExported],
  )

  return (
    <header
      data-health="command-strip"
      className="grid h-12 shrink-0 grid-cols-[minmax(108px,176px)_minmax(224px,1fr)_auto] items-center gap-2 overflow-hidden border-b bg-background px-2 lg:grid-cols-[minmax(150px,220px)_minmax(248px,1fr)_auto] lg:gap-3 xl:gap-4"
    >
      <nav aria-label="路径" className="flex min-w-0 items-center gap-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-sm border border-border bg-card font-mono text-[11px] font-semibold text-foreground">
          K
        </span>
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold text-foreground">{workflowProjectName}</div>
          <div
            className="hidden truncate text-[10px] text-muted-foreground lg:block"
            title={networkDepth > 0 ? "封包内部网络 · 添加和连接内部节点" : "顶层封包网络 · 双击封包进入内部"}
          >
            {networkDepth > 0 ? "封包内部网络 · 添加和连接内部节点" : "顶层封包网络 · 双击封包进入内部"}
          </div>
        </div>
      </nav>

      <div className="flex min-w-0 items-center justify-center gap-2 px-1">
        <div className="flex items-center rounded-sm border border-border bg-card p-0.5 font-mono text-[10px] uppercase tracking-[0.1em]">
          <button
            type="button"
            onClick={() => setToolMode("select")}
            className={cn(
              "rounded-[3px] px-2 py-1 transition-colors",
              toolMode === "select"
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Select
          </button>
          <button
            type="button"
            onClick={() => setToolMode(toolMode === "scissors" ? "select" : "scissors")}
            className={cn(
              "flex items-center gap-1 rounded-[3px] px-2 py-1 transition-colors",
              toolMode === "scissors"
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
            aria-label="剪刀工具"
            title="剪刀工具 (Y)"
          >
            <Scissors className="size-3" />
            <span className="hidden sm:inline">Cut</span>
          </button>
          <Popover>
            <PopoverTrigger
              render={
                <button
                  type="button"
                  onClick={() => setToolMode("draw")}
                  className={cn(
                    "rounded-[3px] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] transition-colors",
                    toolMode === "draw"
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Draw
                </button>
              }
            />
            <PopoverContent className="w-56 space-y-3" align="start">
            <div className="space-y-2">
              <Label className="font-mono text-[10px] uppercase tracking-wider">Stroke Color</Label>
              <div className="flex flex-wrap gap-1.5">
                {["var(--foreground)", "#8a8f98", "#ff7a17", "#4ade80", "#a0c3ec", "#f87171"].map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setPenColor(c)}
                    className={cn(
                      "size-6 rounded-sm border transition-transform hover:scale-110",
                      penColor === c ? "border-foreground" : "border-transparent",
                    )}
                    style={{ backgroundColor: c }}
                    aria-label={`选择颜色 ${c}`}
                  />
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label className="font-mono text-[10px] uppercase tracking-wider">Size · {penSize}px</Label>
              <Slider value={[penSize]} min={1} max={20} step={1} onValueChange={(v) => setPenSize(Array.isArray(v) ? v[0] : v)} />
            </div>
            <Button variant="outline" size="sm" className="w-full gap-1.5" onClick={clearDrawings}>
              <Eraser className="size-3.5" />
              清除所有笔迹
            </Button>
            </PopoverContent>
          </Popover>
        </div>
        <button
          type="button"
          onClick={onOpenPalette}
          className="flex h-8 min-w-10 shrink-0 items-center justify-center gap-2 rounded-sm border border-border bg-card px-2 text-xs text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground min-[1281px]:px-2.5"
          aria-label="添加节点"
          title="添加节点（也可以在空白画布右键）"
        >
          <span className="text-sm text-foreground">＋</span>
          <span className="hidden truncate min-[1281px]:inline">添加节点</span>
        </button>
      </div>

      <div className="flex min-w-0 items-center justify-end gap-1.5 xl:gap-2">
        <div className="hidden min-w-0 items-center gap-1.5 rounded-sm border border-border bg-card px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground xl:flex">
          <span className="whitespace-nowrap">N {nodeCount} · E {edgeCount}</span>
          <span className={cn("whitespace-nowrap", isDirty ? "text-[#ff7a17]" : "text-[#4ade80]")}>
            {isDirty ? "Dirty" : "Clean"}
          </span>
          {selectedNodeCount > 0 || selectedEdgeCount > 0 ? (
            <span className="whitespace-nowrap text-[#a8d8ff]">Sel {selectedNodeCount}+{selectedEdgeCount}</span>
          ) : null}
          {shareUrlLoaded ? <span className="text-[#a8d8ff]">URL</span> : null}
          <span className="text-muted-foreground/50">V1.0</span>
        </div>

        <div className="hidden shrink-0 items-center rounded-sm border border-border bg-card p-0.5 lg:flex">
          <IconAction label="撤销 (Ctrl+Z)" onClick={undo} disabled={!canUndo}>
            <Undo2 className="size-3.5" />
          </IconAction>
          <IconAction label="重做 (Ctrl+Shift+Z)" onClick={redo} disabled={!canRedo}>
            <Redo2 className="size-3.5" />
          </IconAction>
        </div>

        <div className="hidden shrink-0 items-center rounded-sm border border-border bg-card p-0.5 xl:flex">

        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger
              render={
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-muted-foreground hover:text-foreground"
                      aria-label="自动布局"
                    />
                  }
                />
              }
            >
              <Network className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent>自动布局</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="font-mono text-[10px] uppercase tracking-wider">
                Layout Engine
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            {LAYOUTS.map((l) => (
              <DropdownMenuItem
                key={l.label}
                onClick={() => {
                  void autoLayout(l.dir, l.engine, true)
                  onExported?.(`已应用 ${l.label}`)
                }}
              >
                {l.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <IconAction
          label="选择当前连通组件"
          disabled={selectedNodeCount === 0}
          active={selectedNodeCount > 1 || selectedEdgeCount > 0}
          onClick={selectActiveComponent}
        >
          <Network className="size-3.5" />
        </IconAction>
        </div>

        <div className="hidden shrink-0 items-center rounded-sm border border-border bg-card p-0.5 lg:flex">
        <IconAction
          label="保存到本地"
          onClick={() => {
            save()
            onExported?.("已保存到本地")
          }}
        >
          <Save className="size-3.5" />
        </IconAction>
        <IconAction
          label="恢复上次保存"
          onClick={() => {
            const ok = load()
            onExported?.(ok ? "已恢复上次保存" : "没有找到保存记录")
          }}
        >
          <FolderOpen className="size-3.5" />
        </IconAction>

        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger
              render={
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-muted-foreground hover:text-foreground"
                      aria-label="导入导出"
                    />
                  }
                />
              }
            >
              <Download className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent>导入 / 导出</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={exportImage}>
              <ImageDown className="size-3.5" />
              导出 PNG 图片
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void exportServerImage()}>
              <ServerCog className="size-3.5" />
              服务端成图 (SVG)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={exportJson}>
              <Download className="size-3.5" />
              导出 JSON
            </DropdownMenuItem>
            <DropdownMenuItem onClick={exportMermaid}>
              <FileCode2 className="size-3.5" />
              导出 Mermaid
            </DropdownMenuItem>
            <DropdownMenuItem onClick={exportCanvas}>
              <FileCode2 className="size-3.5" />
              导出 Obsidian Canvas
            </DropdownMenuItem>
            <DropdownMenuItem onClick={exportOpml}>
              <FileCode2 className="size-3.5" />
              导出 OPML
            </DropdownMenuItem>
            <DropdownMenuItem onClick={exportMarkdown}>
              <FileCode2 className="size-3.5" />
              导出 Markdown
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void copyShareUrl()}>
              <Link2 className="size-3.5" />
              复制压缩分享 URL
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
              <Upload className="size-3.5" />
              导入 JSON / Mermaid / n8n
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                reset()
                onExported?.("已恢复默认封包网络")
              }}
              variant="destructive"
            >
              <RotateCcw className="size-3.5" />
              恢复默认封包网络
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <IconAction label="复制压缩分享 URL" active={shareUrlLoaded} onClick={() => void copyShareUrl()}>
          <Link2 className="size-3.5" />
        </IconAction>
        </div>

        <div className="hidden shrink-0 items-center rounded-sm border border-border bg-card p-0.5 xl:flex">
        <IconAction label="多用户实时协作 (Yjs)" active={collab} onClick={onToggleCollab}>
          <Users className="size-3.5" />
        </IconAction>
        <IconAction label="Project Settings" active={projectSettingsOpen} onClick={onToggleProjectSettings}>
          <SlidersHorizontal className="size-3.5" />
        </IconAction>
        <IconAction label="Run Trace" active={runTraceOpen} onClick={onToggleRunTrace}>
          <Play className="size-3.5" />
        </IconAction>
        <IconAction label="Agent Proposals" active={agentDrawerOpen} onClick={onToggleAgentDrawer}>
          <Bot className="size-3.5" />
        </IconAction>
        <IconAction label="Node Management" active={nodeManagementOpen} onClick={onToggleNodeManagement}>
          <ListTree className="size-3.5" />
        </IconAction>
        </div>

        <div className="hidden shrink-0 items-center rounded-sm border border-border bg-card p-0.5 2xl:flex">
        <IconAction
          label={snapToHelperLines ? "关闭吸附" : "开启吸附"}
          active={snapToHelperLines}
          onClick={() => setCanvasSetting("snapToHelperLines", !snapToHelperLines)}
        >
          <Magnet className="size-3.5" />
        </IconAction>
        <IconAction label="交互设置" active={settingsOpen} onClick={onToggleSettings}>
          <Settings className="size-3.5" />
        </IconAction>
        </div>

        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger
              render={
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 shrink-0 rounded-sm border border-border bg-card text-muted-foreground hover:text-foreground xl:hidden"
                      aria-label="更多工具"
                    />
                  }
                />
              }
            >
              <MoreHorizontal className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent>更多工具</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="font-mono text-[10px] uppercase tracking-wider">
                Overflow Tools
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => void autoLayout("TB", "elk", true)}>
              <Network className="size-3.5" />
              ELK 自动布局
            </DropdownMenuItem>
            <DropdownMenuItem disabled={selectedNodeCount === 0} onClick={selectActiveComponent}>
              <Network className="size-3.5" />
              选择连通组件
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onToggleCollab}>
              <Users className="size-3.5" />
              {collab ? "关闭协作" : "开启协作"}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onToggleProjectSettings}>
              <SlidersHorizontal className="size-3.5" />
              Project Settings
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onToggleRunTrace}>
              <Play className="size-3.5" />
              Run Trace
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onToggleAgentDrawer}>
              <Bot className="size-3.5" />
              Agent Proposals
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onToggleNodeManagement}>
              <ListTree className="size-3.5" />
              Node Management
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setCanvasSetting("snapToHelperLines", !snapToHelperLines)}>
              <Magnet className="size-3.5" />
              {snapToHelperLines ? "关闭吸附" : "开启吸附"}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onToggleSettings}>
              <Settings className="size-3.5" />
              交互设置
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <input ref={fileInputRef} type="file" accept="application/json,.json,.mmd,text/plain" className="hidden" onChange={onImportFile} />
    </header>
  )
}
