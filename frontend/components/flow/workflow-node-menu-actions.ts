import { useCallback, type Dispatch, type SetStateAction } from "react"

import { useFlowStore } from "@/lib/flow/store"
import { primitiveRuntimeCapability, type WorkflowCapabilitiesResponse } from "@/lib/workflow/capabilities"
import { localizeNodeText, type WorkflowLanguage } from "@/lib/workflow/node-i18n"
import type { WorkflowNodeCatalogItem } from "@/lib/workflow/node-catalog"
import type { WorkflowPrimitive } from "@/lib/workflow/node-primitives"
import type { CanvasPoint } from "./workflow-canvas-geometry"

export type NodeMenuState = { nodeId: string; x: number; y: number }

type FitView = (options?: { padding?: number; duration?: number; nodes?: { id: string }[] }) => unknown

export function useWorkflowNodeMenuActions(options: {
  addPrimitiveNode: (item: WorkflowPrimitive, position: CanvasPoint, runtimeCapability: ReturnType<typeof primitiveRuntimeCapability>) => void
  addWorkflowNodeFromCatalog: (item: WorkflowNodeCatalogItem, position: CanvasPoint) => void
  capabilities: WorkflowCapabilitiesResponse | null | undefined
  enterNodeNetwork: (nodeId: string) => number
  fitView: FitView
  language: WorkflowLanguage
  lockNodeInternals: (nodeId: string) => number
  nodeMenu: NodeMenuState | null
  screenToFlowPosition: (position: CanvasPoint) => CanvasPoint
  selectConnectedComponent: (nodeId: string) => { nodeIds: string[]; edgeIds: string[] }
  setInspectorOpen: Dispatch<SetStateAction<boolean>>
  setNodeMenu: Dispatch<SetStateAction<NodeMenuState | null>>
  showToast: (message: string) => void
  unlockNodeInternals: (nodeId: string) => number
}) {
  const {
    addPrimitiveNode,
    addWorkflowNodeFromCatalog,
    capabilities,
    enterNodeNetwork,
    fitView,
    language,
    lockNodeInternals,
    nodeMenu,
    screenToFlowPosition,
    selectConnectedComponent,
    setInspectorOpen,
    setNodeMenu,
    showToast,
    unlockNodeInternals,
  } = options

  const unlockInternals = useCallback(
    (nodeId: string) => {
      const count = unlockNodeInternals(nodeId)
      showToast(count > 0 ? `已解锁 ${count} 个下层节点` : "这个节点没有可解锁的下层节点")
      setNodeMenu(null)
    },
    [setNodeMenu, showToast, unlockNodeInternals],
  )

  const diveIntoNetwork = useCallback(
    (nodeId: string) => {
      const count = enterNodeNetwork(nodeId)
      showToast(count > 0 ? `Dive into Network: ${count} nodes` : "这个节点没有下层 Network")
      setNodeMenu(null)
      if (count > 0) window.setTimeout(() => void fitView({ padding: 0.24, duration: 180 }), 20)
    },
    [enterNodeNetwork, fitView, setNodeMenu, showToast],
  )

  const addDopNodeFromMenu = useCallback(
    (item: WorkflowNodeCatalogItem) => {
      if (!nodeMenu) return
      const text = localizeNodeText(item.id, { label: item.label, description: item.description }, language)
      addWorkflowNodeFromCatalog(item, screenToFlowPosition({ x: nodeMenu.x + 26, y: nodeMenu.y + 26 }))
      showToast(`已添加 DOP 节点：${text.label}`)
      setNodeMenu(null)
    },
    [addWorkflowNodeFromCatalog, language, nodeMenu, screenToFlowPosition, setNodeMenu, showToast],
  )

  const addPrimitiveFromMenu = useCallback(
    (item: WorkflowPrimitive, itemIndex: number) => {
      if (!nodeMenu) return
      const text = localizeNodeText(item.id, { label: item.label, description: item.description }, language)
      const isInsideNetwork = useFlowStore.getState().networkStack.length > 0
      let position = screenToFlowPosition({ x: nodeMenu.x + 280, y: nodeMenu.y + 26 + itemIndex * 34 })

      if (!isInsideNetwork) {
        const count = enterNodeNetwork(nodeMenu.nodeId)
        if (count > 0) {
          position = { x: 780, y: 96 + itemIndex * 96 }
          window.setTimeout(() => void fitView({ padding: 0.24, duration: 180 }), 20)
        } else {
          showToast("这个节点没有下层 Network，已在当前层添加 draft primitive")
        }
      }

      addPrimitiveNode(item, position, primitiveRuntimeCapability(capabilities, item.id))
      showToast(`已添加原子节点：${text.label}`)
      setNodeMenu(null)
    },
    [addPrimitiveNode, capabilities, enterNodeNetwork, fitView, language, nodeMenu, screenToFlowPosition, setNodeMenu, showToast],
  )

  const lockInternals = useCallback(
    (nodeId: string) => {
      const count = lockNodeInternals(nodeId)
      showToast(count > 0 ? `已收回 ${count} 个下层节点` : "没有已解锁的下层节点")
      setNodeMenu(null)
    },
    [lockNodeInternals, setNodeMenu, showToast],
  )

  const selectComponentFromMenu = useCallback(
    (nodeId: string) => {
      const result = selectConnectedComponent(nodeId)
      showToast(`已选中组件：${result.nodeIds.length} 节点 / ${result.edgeIds.length} 连线`)
      setNodeMenu(null)
      if (result.nodeIds.length > 0) {
        window.setTimeout(() => void fitView({ nodes: result.nodeIds.map((id) => ({ id })), padding: 0.35, duration: 260 }), 20)
      }
    },
    [fitView, selectConnectedComponent, setNodeMenu, showToast],
  )

  const showNodeInfo = useCallback(() => {
    setNodeMenu(null)
    showToast("Node information is in Parameter Interface")
  }, [setNodeMenu, showToast])

  const showParameters = useCallback(() => {
    setNodeMenu(null)
    setInspectorOpen(true)
    showToast("Parameter Interface 已显示")
  }, [setInspectorOpen, setNodeMenu, showToast])

  return {
    addDopNodeFromMenu,
    addPrimitiveFromMenu,
    diveIntoNetwork,
    lockInternals,
    selectComponentFromMenu,
    showNodeInfo,
    showParameters,
    unlockInternals,
  }
}
