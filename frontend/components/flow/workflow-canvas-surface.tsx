"use client"

import { useEffect, type DragEvent, type MouseEvent as ReactMouseEvent, type RefObject } from "react"
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  SelectionMode,
  useStore,
  type IsValidConnection,
  type NodeMouseHandler,
  type OnBeforeDelete,
  type OnConnect,
  type OnEdgesChange,
  type OnNodeDrag,
  type OnNodesChange,
} from "@xyflow/react"

import type { CanvasSettings } from "@/lib/flow/settings-store"
import type { FlowState } from "@/lib/flow/store"
import type { ToolMode, WorkflowEdge, WorkflowNode } from "@/lib/flow/types"
import type { WorkflowCapabilitiesResponse } from "@/lib/workflow/capabilities"
import type { WorkflowNodeCatalogItem } from "@/lib/workflow/node-catalog"
import type { WorkflowPrimitive } from "@/lib/workflow/node-primitives"
import type { AgentProposal } from "@/lib/workflow/proposal"
import type { ProposalFocusTarget } from "@/lib/workflow/proposal-focus"
import { cn } from "@/lib/utils"
import { AgentDrawer } from "./agent-drawer"
import { Collaboration } from "./collaboration"
import { DrawingLayer } from "./drawing-layer"
import EditableEdge from "./edges/editable-edge"
import RoutedEdge from "./edges/routed-edge"
import WorkflowEdge_ from "./edges/workflow-edge"
import { HelperLinesRenderer } from "./helper-lines-renderer"
import { NodeContextMenu } from "./node-context-menu"
import GroupNode from "./nodes/group-node"
import MathNode from "./nodes/math-node"
import NoteNode from "./nodes/note-node"
import ShapeNode from "./nodes/shape-node"
import WorkflowNodeComp from "./nodes/workflow-node"
import type { NodeMenuState } from "./workflow-node-menu-actions"
import {
  NetworkBreadcrumb,
  ScissorTrailOverlay,
  WorkflowFloatingPanels,
  WorkflowToast,
} from "./workflow-editor-overlays"
import { WorkflowMotionRuntime } from "./workflow-motion-runtime"
import type { CanvasPoint } from "./workflow-canvas-geometry"

const nodeTypes = {
  workflow: WorkflowNodeComp,
  note: NoteNode,
  group: GroupNode,
  shape: ShapeNode,
  math: MathNode,
}

const edgeTypes = {
  workflow: WorkflowEdge_,
  editable: EditableEdge,
  routed: RoutedEdge,
}

type PrimitiveMenuGroup = {
  category: string
  label: string
  items: WorkflowPrimitive[]
}

type WorkflowCanvasSurfaceProps = {
  acceptProposal: (proposal: AgentProposal) => void
  addDopNodeFromMenu: (item: WorkflowNodeCatalogItem) => void
  addPrimitiveFromMenu: (item: WorkflowPrimitive, itemIndex: number) => void
  agentDrawerOpen: boolean
  agentProposal: AgentProposal | undefined
  capabilities: WorkflowCapabilitiesResponse | null | undefined
  compactViewport: boolean
  diveIntoNetwork: (nodeId: string) => void
  dopNodeMenuItems: WorkflowNodeCatalogItem[]
  edges: WorkflowEdge[]
  exitCurrentNetwork: () => void
  focusProposalOperation: (focus: ProposalFocusTarget) => void
  helperLines: FlowState["helperLines"]
  inspectorOpen: boolean
  isDraw: boolean
  isScissors: boolean
  isValidConnection: IsValidConnection<WorkflowEdge>
  lockInternals: (nodeId: string) => void
  networkLocked: boolean
  networkStack: FlowState["networkStack"]
  nodeManagementOpen: boolean
  nodeMenu: NodeMenuState | null
  nodes: WorkflowNode[]
  onBeforeDelete: OnBeforeDelete<WorkflowNode, WorkflowEdge>
  onCanvasMouseDownCapture: (event: ReactMouseEvent<HTMLDivElement>) => void
  onCanvasMouseMoveCapture: (event: ReactMouseEvent<HTMLDivElement>) => void
  onCanvasMouseUpCapture: (event: ReactMouseEvent<HTMLDivElement>) => void
  onConnect: OnConnect
  onDragOver: (event: DragEvent) => void
  onDrop: (event: DragEvent) => void
  onEdgesChange: OnEdgesChange<WorkflowEdge>
  onMouseMove: (event: ReactMouseEvent<HTMLDivElement>) => void
  onNodeClick: NodeMouseHandler<WorkflowNode>
  onNodeContextMenu: NodeMouseHandler<WorkflowNode>
  onNodeDoubleClick: NodeMouseHandler<WorkflowNode>
  onPaneContextMenu: (event: ReactMouseEvent<Element> | MouseEvent) => void
  onNodeDrag: OnNodeDrag<WorkflowNode>
  onNodeDragStop: OnNodeDrag<WorkflowNode>
  onNodesChange: OnNodesChange<WorkflowNode>
  onProfileChange: FlowState["updateWorkflowProfile"]
  primitiveMenuGroups: PrimitiveMenuGroup[]
  projectSettingsOpen: boolean
  rejectProposal: () => void
  runTraceOpen: boolean
  scissorTrail: CanvasPoint[]
  selectComponentFromMenu: (nodeId: string) => void
  setAgentDrawerOpen: (open: boolean) => void
  setNodeManagementOpen: (open: boolean) => void
  settings: CanvasSettings
  settingsOpen: boolean
  showNodeInfo: () => void
  showParameters: () => void
  takeSnapshot: () => void
  toast: string | null
  toolMode: ToolMode
  unlockInternals: (nodeId: string) => void
  workflowProfile: FlowState["workflowProject"]["profile"]
  wrapperRef: RefObject<HTMLDivElement | null>
  zoom: number
  setZoom: (zoom: number) => void
}

function minimapNodeColor(node: { selected?: boolean }) {
  return node.selected ? "#e8e8e6" : "#3a3d42"
}

function zoomBucket(zoom: number) {
  if (zoom < 0.5) return "low"
  if (zoom > 1.4) return "high"
  return "mid"
}

function panOnDragValue(settings: CanvasSettings, interactionLocked: boolean) {
  return settings.panOnDrag && !interactionLocked ? [1, 2] : false
}

function flowInteractionProps(settings: CanvasSettings, interactionLocked: boolean) {
  if (settings.touchMode) {
    return { panOnDrag: [1, 2] as number[], panOnScroll: true, selectionOnDrag: false }
  }
  return {
    panOnDrag: panOnDragValue(settings, interactionLocked),
    panOnScroll: settings.panOnScroll && !interactionLocked,
    selectionOnDrag: settings.selectionOnDrag && !interactionLocked,
  }
}

/** Live zoom bridge so nodes can render at different detail levels. */
function ZoomProvider({ onZoom }: { onZoom: (z: number) => void }) {
  const zoom = useStore((s) => s.transform[2])
  useEffect(() => {
    onZoom(zoom)
  }, [zoom, onZoom])
  return null
}

function OptionalBackground({ visible }: { visible: boolean }) {
  if (!visible) return null
  return <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#26282c" />
}

function OptionalControls({ visible }: { visible: boolean }) {
  if (!visible) return null
  return <Controls className="!rounded-md !border !border-border !bg-card [&_button]:!border-border [&_button]:!bg-card [&_button:hover]:!bg-accent [&_button]:!fill-muted-foreground" />
}

function OptionalMiniMap({ visible }: { visible: boolean }) {
  if (!visible) return null
  return (
    <MiniMap
      pannable
      zoomable
      nodeColor={minimapNodeColor}
      className="!rounded-md !border !border-border !bg-card"
      maskColor="rgb(10 10 10 / 0.75)"
    />
  )
}

function NodeMenuOverlay({
  addDopNodeFromMenu,
  addPrimitiveFromMenu,
  capabilities,
  diveIntoNetwork,
  dopNodeMenuItems,
  lockInternals,
  menu,
  primitiveMenuGroups,
  showDopOperators,
  selectComponentFromMenu,
  settings,
  showNodeInfo,
  showParameters,
  unlockInternals,
  wrapperElement,
}: {
  addDopNodeFromMenu: (item: WorkflowNodeCatalogItem) => void
  addPrimitiveFromMenu: (item: WorkflowPrimitive, itemIndex: number) => void
  capabilities: WorkflowCapabilitiesResponse | null | undefined
  diveIntoNetwork: (nodeId: string) => void
  dopNodeMenuItems: WorkflowNodeCatalogItem[]
  lockInternals: (nodeId: string) => void
  menu: NodeMenuState | null
  primitiveMenuGroups: PrimitiveMenuGroup[]
  showDopOperators: boolean
  selectComponentFromMenu: (nodeId: string) => void
  settings: CanvasSettings
  showNodeInfo: () => void
  showParameters: () => void
  unlockInternals: (nodeId: string) => void
  wrapperElement: HTMLElement | null
}) {
  if (!menu) return null
  return (
    <NodeContextMenu
      capabilities={capabilities}
      dopNodeMenuItems={dopNodeMenuItems}
      language={settings.language}
      menu={menu}
      onAddDopNode={addDopNodeFromMenu}
      onAddPrimitive={addPrimitiveFromMenu}
      onDiveIntoNetwork={diveIntoNetwork}
      onLockInternals={lockInternals}
      onSelectComponent={selectComponentFromMenu}
      onShowNodeInfo={showNodeInfo}
      onShowParameters={showParameters}
      onUnlockInternals={unlockInternals}
      primitiveMenuGroups={primitiveMenuGroups}
      showDopOperators={showDopOperators}
      wrapperElement={wrapperElement}
    />
  )
}

function CanvasLayers({
  helperLines,
  settings,
  setZoom,
}: {
  helperLines: FlowState["helperLines"]
  settings: CanvasSettings
  setZoom: (zoom: number) => void
}) {
  return (
    <>
      <ZoomProvider onZoom={setZoom} />
      <OptionalBackground visible={settings.showBackground} />
      <OptionalControls visible={settings.showControls} />
      <OptionalMiniMap visible={settings.showMiniMap} />
      <HelperLinesRenderer lines={helperLines} />
      <WorkflowMotionRuntime interaction={helperLines.interaction} />
      <DrawingLayer />
      <Collaboration />
    </>
  )
}

export function WorkflowCanvasSurface(props: WorkflowCanvasSurfaceProps) {
  const interactionLocked = props.isDraw || props.isScissors
  const flowInteraction = flowInteractionProps(props.settings, interactionLocked)
  return (
    <div
      ref={props.wrapperRef}
      className="relative min-w-0 flex-1"
      onMouseDownCapture={props.onCanvasMouseDownCapture}
      onMouseMoveCapture={props.onCanvasMouseMoveCapture}
      onMouseUpCapture={props.onCanvasMouseUpCapture}
      onMouseMove={props.onMouseMove}
      data-zoom-bucket={zoomBucket(props.zoom)}
    >
      <ReactFlow
        nodes={props.nodes}
        edges={props.edges}
        onNodesChange={props.onNodesChange}
        onEdgesChange={props.onEdgesChange}
        onConnect={props.onConnect}
        onNodeDragStart={props.takeSnapshot}
        onNodeDrag={props.onNodeDrag}
        onNodeDragStop={props.onNodeDragStop}
        onNodeClick={props.onNodeClick}
        onNodeDoubleClick={props.onNodeDoubleClick}
        onNodeContextMenu={props.onNodeContextMenu}
        onPaneContextMenu={props.onPaneContextMenu}
        onDrop={props.onDrop}
        onDragOver={props.onDragOver}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={{ type: "workflow", animated: true }}
        fitView
        fitViewOptions={{ padding: props.compactViewport ? 0.24 : 0.15, minZoom: props.compactViewport ? 0.62 : 0.2 }}
        isValidConnection={props.isValidConnection}
        onBeforeDelete={props.onBeforeDelete}
        nodesDraggable={props.settings.nodesDraggable && !interactionLocked}
        nodesConnectable={props.settings.nodesConnectable && !props.isScissors}
        elementsSelectable={props.settings.elementsSelectable}
        zoomOnScroll={props.settings.zoomOnScroll}
        zoomOnPinch={props.settings.zoomOnPinch}
        zoomOnDoubleClick={props.settings.zoomOnDoubleClick}
        panOnScroll={flowInteraction.panOnScroll}
        panOnDrag={flowInteraction.panOnDrag}
        selectionOnDrag={flowInteraction.selectionOnDrag}
        selectionMode={SelectionMode.Partial}
        proOptions={{ hideAttribution: true }}
        minZoom={0.2}
        maxZoom={2}
        className={cn("bg-background", props.isScissors && "cursor-crosshair")}
        data-tool-mode={props.toolMode}
      >
        <CanvasLayers helperLines={props.helperLines} settings={props.settings} setZoom={props.setZoom} />
      </ReactFlow>

      <ScissorTrailOverlay active={props.isScissors} points={props.scissorTrail} />
      <NetworkBreadcrumb locked={props.networkLocked} networkStack={props.networkStack} onExit={props.exitCurrentNetwork} />

      <NodeMenuOverlay
        addDopNodeFromMenu={props.addDopNodeFromMenu}
        addPrimitiveFromMenu={props.addPrimitiveFromMenu}
        capabilities={props.capabilities}
        diveIntoNetwork={props.diveIntoNetwork}
        dopNodeMenuItems={props.dopNodeMenuItems}
        lockInternals={props.lockInternals}
        menu={props.nodeMenu}
        primitiveMenuGroups={props.primitiveMenuGroups}
        showDopOperators={props.networkStack.length === 0}
        selectComponentFromMenu={props.selectComponentFromMenu}
        settings={props.settings}
        showNodeInfo={props.showNodeInfo}
        showParameters={props.showParameters}
        unlockInternals={props.unlockInternals}
        wrapperElement={props.wrapperRef.current}
      />

      <WorkflowFloatingPanels
        inspectorOpen={props.inspectorOpen}
        nodeManagementOpen={props.nodeManagementOpen}
        onCloseNodeManagement={() => props.setNodeManagementOpen(false)}
        onProfileChange={props.onProfileChange}
        projectSettingsOpen={props.projectSettingsOpen}
        runTraceOpen={props.runTraceOpen}
        settingsOpen={props.settingsOpen}
        workflowProfile={props.workflowProfile}
      />

      <AgentDrawer
        open={props.agentDrawerOpen}
        proposal={props.agentProposal}
        onAccept={props.acceptProposal}
        onReject={props.rejectProposal}
        onFocusOperation={props.focusProposalOperation}
        onClose={() => props.setAgentDrawerOpen(false)}
      />

      <WorkflowToast message={props.toast} />
    </div>
  )
}
