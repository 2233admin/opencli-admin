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
import { getWorkflowNodeCatalog } from "@/lib/workflow/node-catalog"
import { getWorkflowPrimitives } from "@/lib/workflow/node-primitives"
import { groupPrimitivesForNodeMenu } from "@/lib/workflow/node-menu"
import { useWorkflowCapabilities } from "@/lib/workflow/use-workflow-capabilities"
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

function EditorCanvas() {
  const {
    addNodeFromPalette,
    addPrimitiveNode,
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
  const mousePos = useRef({ x: 0, y: 0 })
  const shakeRef = useRef<Map<string, ShakeState>>(new Map())
  const scissorDraggingRef = useRef(false)
  const scissorCutRef = useRef<Set<string>>(new Set())
  const yMomentaryModeRef = useRef<ToolMode | null>(null)
  const [scissorTrail, setScissorTrail] = useState<{ x: number; y: number }[]>([])
  const [toast, setToast] = useState<string | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false)
  const [runTraceOpen, setRunTraceOpen] = useState(false)
  const [agentDrawerOpen, setAgentDrawerOpen] = useState(false)
  const [nodeManagementOpen, setNodeManagementOpen] = useState(false)
  const [compactViewport, setCompactViewport] = useState(false)
  const [nodeMenu, setNodeMenu] = useState<NodeMenuState | null>(null)
  const { capabilities } = useWorkflowCapabilities(true)
  const dopNodeMenuItems = useMemo(
    () => getWorkflowNodeCatalog(workflowProject.profile, capabilities),
    [workflowProject.profile, capabilities],
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
    selectComponentFromMenu,
    showNodeInfo,
    showParameters,
    unlockInternals,
  } = useWorkflowNodeMenuActions({
    addPrimitiveNode,
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

  const onNodeContextMenu: NodeMouseHandler<WorkflowNode> = useCallback((event, node) => {
    event.preventDefault()
    event.stopPropagation()
    setNodeMenu({ nodeId: node.id, x: event.clientX, y: event.clientY })
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

  return (
    <div data-health="workflow-editor" className="flex h-full min-h-0 flex-1 flex-col">
      <CommandStrip
        onOpenPalette={() => setPaletteOpen(true)}
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
          onCanvasMouseDownCapture={onCanvasMouseDownCapture}
          onCanvasMouseMoveCapture={onCanvasMouseMoveCapture}
          onCanvasMouseUpCapture={onCanvasMouseUpCapture}
          onConnect={onConnect}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onEdgesChange={onEdgesChange}
          onMouseMove={onCanvasMouseMove}
          onNodeContextMenu={onNodeContextMenu}
          onNodeDoubleClick={onNodeDoubleClick}
          onNodeDrag={onNodeDrag}
          onNodeDragStop={onNodeDragStop}
          onNodesChange={onNodesChange}
          onProfileChange={updateWorkflowProfile}
          primitiveMenuGroups={primitiveMenuGroups}
          projectSettingsOpen={projectSettingsOpen}
          rejectProposal={rejectProposal}
          runTraceOpen={runTraceOpen}
          scissorTrail={scissorTrail}
          selectComponentFromMenu={selectComponentFromMenu}
          setAgentDrawerOpen={setAgentDrawerOpen}
          setNodeManagementOpen={setNodeManagementOpen}
          settings={settings}
          settingsOpen={settingsOpen}
          showNodeInfo={showNodeInfo}
          showParameters={showParameters}
          takeSnapshot={takeSnapshot}
          toast={toast}
          toolMode={toolMode}
          unlockInternals={unlockInternals}
          workflowProfile={workflowProject.profile}
          wrapperRef={wrapperRef}
        />
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onMessage={showToast}
        getAnchor={() => screenToFlowPosition(mousePos.current)}
      />
    </div>
  )
}

export function WorkflowEditor() {
  return (
    <ReactFlowProvider>
      <EditorCanvas />
    </ReactFlowProvider>
  )
}
