"use client"

import { useCallback, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react"
import { ReactFlowProvider, useReactFlow, type NodeMouseHandler } from "@xyflow/react"
import { useShallow } from "zustand/react/shallow"
import "@xyflow/react/dist/style.css"

import { useFlowStore } from "@/lib/flow/store"
import { useSettingsStore } from "@/lib/flow/settings-store"
import type { WorkflowNode, WorkflowEdge, ToolMode } from "@/lib/flow/types"
import { CommandStrip } from "./command-strip"
import { CommandPalette } from "./command-palette"
import { NODE_PALETTE } from "@/lib/flow/palette"
import {
  getWorkflowNodeCatalog,
  nativeIntelligenceCatalogItems,
} from "@/lib/workflow/node-catalog"
import { mergeWorkflowNodeCatalog } from "@/lib/workflow/opencli-adapter-catalog"
import { getWorkflowPrimitives } from "@/lib/workflow/node-primitives"
import { groupPrimitivesForNodeMenu } from "@/lib/workflow/node-menu"
import { useWorkflowCapabilities } from "@/lib/workflow/use-workflow-capabilities"
import { useOpenCLIAdapterCatalog } from "@/lib/workflow/use-opencli-adapter-catalog"
import { useWorkflowToolCapabilities } from "@/lib/workflow/use-workflow-tool-capabilities"
import { useWorkflowKeyboardShortcuts } from "./workflow-keyboard-shortcuts"
import {
  useCanvasViewportCompaction,
  useConnectionGuards,
  usePaletteDrop,
  useScissorCanvasHandlers,
  useWorkflowNodeDragHandlers,
  type ShakeState,
} from "./workflow-canvas-interactions"
import { useWorkflowNodeMenuActions, type NodeMenuState } from "./workflow-node-menu-actions"
import { useWorkflowAgentProposal } from "./workflow-agent-proposal"
import { selectEditorCanvasState } from "./workflow-editor-selectors"
import { WorkflowCanvasSurface } from "./workflow-canvas-surface"
import type { WorkflowWorkbenchMode } from "./workflow-workbench-panel"
import {
  isNetworkLocked,
  useApplyWorkflowCapabilities,
  useAutoDismissToast,
  useCompactViewportEffect,
  useCompactViewportMedia,
  useDismissNodeMenu,
  useExitCurrentNetwork,
  useSharedWorkflowImport,
} from "./workflow-editor-effects"

function buildPrimitiveMenuGroups() {
  return groupPrimitivesForNodeMenu(getWorkflowPrimitives())
}

function EditorCanvas({
  documentState,
}: {
  documentState?: "loading" | "saving" | "saved" | "error" | "conflict"
}) {
  const {
    addNodeFromPalette,
    addPrimitiveToNodeNetwork,
    addWorkflowNodeFromCatalog,
    applyWorkflowCapabilities,
    attachToParent,
    autoLayout,
    clearHelperLines,
    clearPendingAgentProposal,
    clearProposalFocus,
    copy,
    cut,
    deleteSelected,
    detachFromParent,
    disconnectNodeConnections,
    duplicate,
    edges,
    enterNodeNetwork,
    exitNodeNetwork,
    focusProposalTargets,
    groupSelection,
    helperLines,
    importWorkflowProject,
    lockNodeInternals,
    networkStack,
    nodes,
    onConnect,
    onEdgesChange,
    onNodesChange,
    paste,
    pendingAgentProposal,
    redo,
    removeEdgesByIds,
    resizeGroupToFit,
    resolveNodeCollisions,
    save,
    selectConnectedComponent,
    setToolMode,
    takeSnapshot,
    toolMode,
    undo,
    unlockNodeInternals,
    updateWorkflowProfile,
    workflowProject,
  } = useFlowStore(useShallow(selectEditorCanvasState))

  const settings = useSettingsStore()

  const { screenToFlowPosition, getInternalNode, setViewport, fitView } = useReactFlow<WorkflowNode, WorkflowEdge>()
  const wrapperRef = useRef<HTMLDivElement>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  const mousePos = useRef({ x: 0, y: 0 })
  const shakeRef = useRef<Map<string, ShakeState>>(new Map())
  const scissorDraggingRef = useRef(false)
  const scissorCutRef = useRef<Set<string>>(new Set())
  const yMomentaryModeRef = useRef<ToolMode | null>(null)
  const [scissorTrail, setScissorTrail] = useState<{ x: number; y: number }[]>([])
  const [toast, setToast] = useState<string | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [paletteAnchor, setPaletteAnchor] = useState<{ x: number; y: number } | null>(null)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false)
  const [runTraceOpen, setRunTraceOpen] = useState(false)
  const [runRequestId, setRunRequestId] = useState(0)
  const [agentDrawerOpen, setAgentDrawerOpen] = useState(false)
  const [nodeManagementOpen, setNodeManagementOpen] = useState(false)
  const [workbenchMode, setWorkbenchMode] = useState<WorkflowWorkbenchMode | null>(null)
  const [zoom, setZoom] = useState(1)
  const [compactViewport, setCompactViewport] = useState(false)
  const [nodeMenu, setNodeMenu] = useState<NodeMenuState | null>(null)
  const { capabilities } = useWorkflowCapabilities(true)
  const {
    items: openCLIAdapterCatalogItems,
    error: openCLIAdapterCatalogError,
    loading: openCLIAdapterCatalogLoading,
  } = useOpenCLIAdapterCatalog(true)
  const {
    tools: nativeIntelligenceTools,
    error: nativeIntelligenceToolsError,
    loading: nativeIntelligenceToolsLoading,
  } = useWorkflowToolCapabilities(true)
  const dopNodeMenuItems = useMemo(
    () =>
      mergeWorkflowNodeCatalog(
        [
          ...getWorkflowNodeCatalog(workflowProject.profile, capabilities),
          ...(workflowProject.profile === "intelligence"
            ? nativeIntelligenceCatalogItems(nativeIntelligenceTools)
            : []),
        ],
        openCLIAdapterCatalogItems.filter((item) => item.profile === workflowProject.profile),
      ),
    [
      workflowProject.profile,
      capabilities,
      openCLIAdapterCatalogItems,
      nativeIntelligenceTools,
    ],
  )
  const [primitiveMenuGroups] = useState(buildPrimitiveMenuGroups)

  const showToast = useCallback((msg: string) => setToast(msg), [])
  const setMiniMapVisible = useCallback((visible: boolean) => settings.set("showMiniMap", visible), [settings])

  useApplyWorkflowCapabilities({ applyWorkflowCapabilities, capabilities, workflowProjectId: workflowProject.id })
  useSharedWorkflowImport({ fitView, showToast })
  useAutoDismissToast(toast, setToast)
  useDismissNodeMenu(nodeMenu, setNodeMenu)
  useCompactViewportMedia(setCompactViewport)
  const applyCompactViewport = useCanvasViewportCompaction({ compactViewport, nodes, setViewport })
  useCompactViewportEffect(applyCompactViewport)

  useWorkflowKeyboardShortcuts({
    autoLayout,
    copy,
    cut,
    deleteSelected,
    duplicate,
    exitNodeNetwork,
    fitView,
    groupSelection,
    mousePosRef: mousePos,
    paste,
    projectSettingsOpen,
    redo,
    save,
    screenToFlowPosition,
    scissorCutRef,
    scissorDraggingRef,
    setInspectorOpen,
    setPaletteOpen,
    setProjectSettingsOpen,
    setScissorTrail,
    setSettingsOpen,
    setToolMode,
    setMiniMapVisible,
    settingsOpen,
    showToast,
    undo,
    yMomentaryModeRef,
  })

  const { onDragOver, onDrop } = usePaletteDrop({ addNodeFromPalette, screenToFlowPosition })
  const { onCanvasMouseDownCapture, onCanvasMouseMoveCapture, onCanvasMouseUpCapture } = useScissorCanvasHandlers({
    cutRef: scissorCutRef,
    draggingRef: scissorDraggingRef,
    removeEdgesByIds,
    setTrail: setScissorTrail,
    showToast,
    toolMode,
    wrapperRef,
  })
  const { onNodeDrag, onNodeDragStop } = useWorkflowNodeDragHandlers({
    attachToParent,
    clearHelperLines,
    detachFromParent,
    disconnectNodeConnections,
    getInternalNode,
    resizeGroupToFit,
    resolveNodeCollisions,
    shakeRef,
    showToast,
  })
  const {
    addDopNodeFromMenu,
    addPrimitiveFromMenu,
    diveIntoNetwork,
    lockInternals,
    unlockInternals,
  } = useWorkflowNodeMenuActions({
    addPrimitiveToNodeNetwork,
    addWorkflowNodeFromCatalog,
    capabilities,
    enterNodeNetwork,
    fitView,
    language: settings.language,
    lockNodeInternals,
    nodeMenu,
    screenToFlowPosition,
    selectConnectedComponent,
    setInspectorOpen,
    setNodeMenu,
    showToast,
    unlockNodeInternals,
  })

  const onNodeDoubleClick: NodeMouseHandler<WorkflowNode> = useCallback(
    (_event: unknown, node: { id: string }) => {
      diveIntoNetwork(node.id)
    },
    [diveIntoNetwork],
  )

  const onNodeClick: NodeMouseHandler<WorkflowNode> = useCallback(() => {
    if (!workbenchMode) setInspectorOpen(true)
  }, [workbenchMode])

  const onNodeContextMenu: NodeMouseHandler<WorkflowNode> = useCallback((event, node) => {
    event.preventDefault()
    event.stopPropagation()
    setPaletteOpen(false)
    setNodeMenu({ nodeId: node.id, x: event.clientX, y: event.clientY })
  }, [])

  const onPaneContextMenu = useCallback((event: ReactMouseEvent<Element> | MouseEvent) => {
    event.preventDefault()
    setPaletteOpen(false)
    setNodeMenu({ x: event.clientX, y: event.clientY })
  }, [])

  const openNodePicker = useCallback(() => {
    const bounds = wrapperRef.current?.getBoundingClientRect()
    setPaletteAnchor(
      bounds
        ? { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }
        : { x: window.innerWidth / 2, y: window.innerHeight / 2 },
    )
    setPaletteOpen(true)
  }, [])

  const openNodePickerFromMenu = useCallback(() => {
    if (!nodeMenu) return
    setPaletteAnchor({ x: nodeMenu.x, y: nodeMenu.y })
    setNodeMenu(null)
    setPaletteOpen(true)
  }, [nodeMenu])

  const addNoteFromMenu = useCallback(() => {
    if (!nodeMenu) return
    const note = NODE_PALETTE.find((item) => item.nodeType === "note")
    if (!note) {
      showToast("未找到注释节点定义")
      setNodeMenu(null)
      return
    }
    addNodeFromPalette(note, screenToFlowPosition({ x: nodeMenu.x, y: nodeMenu.y }))
    setNodeMenu(null)
    showToast("已添加注释")
  }, [addNodeFromPalette, nodeMenu, screenToFlowPosition, showToast])

  const testRunFromMenu = useCallback(() => {
    setNodeMenu(null)
    setRunTraceOpen(true)
    setRunRequestId((current) => current + 1)
    showToast("已启动测试运行")
  }, [showToast])

  const importAppFromMenu = useCallback(() => {
    setNodeMenu(null)
    importInputRef.current?.click()
  }, [])

  const { isValidConnection, onBeforeDelete } = useConnectionGuards({ settings, showToast })

  const isDraw = toolMode === "draw"
  const isScissors = toolMode === "scissors"
  const networkLocked = isNetworkLocked(networkStack, nodes)
  const exitCurrentNetwork = useExitCurrentNetwork({ exitNodeNetwork, fitView, showToast })
  const { acceptProposal, agentProposal, focusProposalOperation, rejectProposal } = useWorkflowAgentProposal({
    clearPendingAgentProposal,
    clearProposalFocus,
    fitView,
    focusProposalTargets,
    importWorkflowProject,
    pendingAgentProposal,
    setAgentDrawerOpen,
    showToast,
  })

  const onCanvasMouseMove = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    mousePos.current = { x: event.clientX, y: event.clientY }
  }, [])

  const toggleCollabProvider = useCallback(() => {
    settings.set("collabProvider", settings.collabProvider === "off" ? "yjs" : "off")
  }, [settings])

  const changeWorkbenchMode = useCallback((mode: WorkflowWorkbenchMode | null) => {
    setWorkbenchMode(mode)
    if (!mode) return
    setInspectorOpen(false)
    setSettingsOpen(false)
    setProjectSettingsOpen(false)
  }, [])

  return (
    <div data-health="workflow-editor" className="flex h-full min-h-0 flex-1 flex-col">
      <CommandStrip
        importInputRef={importInputRef}
        documentState={documentState}
        onOpenPalette={openNodePicker}
        onExported={showToast}
        collab={settings.collabProvider !== "off"}
        onToggleCollab={toggleCollabProvider}
        settingsOpen={settingsOpen}
        onToggleSettings={() => setSettingsOpen((v) => !v)}
        projectSettingsOpen={projectSettingsOpen}
        onToggleProjectSettings={() => setProjectSettingsOpen((v) => !v)}
        runTraceOpen={runTraceOpen}
        onToggleRunTrace={() => setRunTraceOpen((v) => !v)}
        agentDrawerOpen={agentDrawerOpen}
        onToggleAgentDrawer={() => setAgentDrawerOpen((v) => !v)}
        nodeManagementOpen={nodeManagementOpen}
        onToggleNodeManagement={() => setNodeManagementOpen((v) => !v)}
        workbenchMode={workbenchMode}
        onChangeWorkbenchMode={changeWorkbenchMode}
      />
      <div className="flex min-h-0 flex-1">
        <WorkflowCanvasSurface
          acceptProposal={acceptProposal}
          addDopNodeFromMenu={addDopNodeFromMenu}
          addPrimitiveFromMenu={addPrimitiveFromMenu}
          agentDrawerOpen={agentDrawerOpen}
          agentProposal={agentProposal}
          capabilities={capabilities}
          compactViewport={compactViewport}
          diveIntoNetwork={diveIntoNetwork}
          dopNodeMenuItems={dopNodeMenuItems}
          edges={edges}
          exitCurrentNetwork={exitCurrentNetwork}
          focusProposalOperation={focusProposalOperation}
          helperLines={helperLines}
          inspectorOpen={inspectorOpen}
          isDraw={isDraw}
          isScissors={isScissors}
          isValidConnection={isValidConnection}
          lockInternals={lockInternals}
          networkLocked={networkLocked}
          networkStack={networkStack}
          nodeManagementOpen={nodeManagementOpen}
          nodeMenu={nodeMenu}
          nodes={nodes}
          onBeforeDelete={onBeforeDelete}
          onAddNodeFromMenu={openNodePickerFromMenu}
          onAddNoteFromMenu={addNoteFromMenu}
          onImportApp={importAppFromMenu}
          onTestRun={testRunFromMenu}
          onCanvasMouseDownCapture={onCanvasMouseDownCapture}
          onCanvasMouseMoveCapture={onCanvasMouseMoveCapture}
          onCanvasMouseUpCapture={onCanvasMouseUpCapture}
          onConnect={onConnect}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onEdgesChange={onEdgesChange}
          onMouseMove={onCanvasMouseMove}
          onNodeContextMenu={onNodeContextMenu}
          onPaneContextMenu={onPaneContextMenu}
          onNodeClick={onNodeClick}
          onNodeDoubleClick={onNodeDoubleClick}
          onNodeDrag={onNodeDrag}
          onNodeDragStop={onNodeDragStop}
          onNodesChange={onNodesChange}
          onProfileChange={updateWorkflowProfile}
          primitiveMenuGroups={primitiveMenuGroups}
          projectSettingsOpen={projectSettingsOpen}
          rejectProposal={rejectProposal}
          runTraceOpen={runTraceOpen}
          runRequestId={runRequestId}
          scissorTrail={scissorTrail}
          setAgentDrawerOpen={setAgentDrawerOpen}
          setNodeManagementOpen={setNodeManagementOpen}
          settings={settings}
          settingsOpen={settingsOpen}
          takeSnapshot={takeSnapshot}
          toast={toast}
          toolMode={toolMode}
          unlockInternals={unlockInternals}
          workflowProfile={workflowProject.profile}
          workbenchMode={workbenchMode}
          onChangeWorkbenchMode={changeWorkbenchMode}
          wrapperRef={wrapperRef}
          zoom={zoom}
          setZoom={setZoom}
        />
      </div>

      <CommandPalette
        adapterCatalogError={openCLIAdapterCatalogError ?? nativeIntelligenceToolsError}
        adapterCatalogLoading={openCLIAdapterCatalogLoading || nativeIntelligenceToolsLoading}
        catalogItems={dopNodeMenuItems}
        open={paletteOpen}
        onImportApp={() => importInputRef.current?.click()}
        onClose={() => {
          setPaletteOpen(false)
          setPaletteAnchor(null)
        }}
        onMessage={showToast}
        onNodeCreated={() => setInspectorOpen(true)}
        getAnchor={() => screenToFlowPosition(paletteAnchor ?? mousePos.current)}
      />
    </div>
  )
}

export function WorkflowEditor({
  documentState,
}: {
  documentState?: "loading" | "saving" | "saved" | "error" | "conflict"
} = {}) {
  return (
    <ReactFlowProvider>
      <EditorCanvas documentState={documentState} />
    </ReactFlowProvider>
  )
}
