import { useCallback, type Dispatch, type SetStateAction } from "react"

import { useFlowStore } from "@/lib/flow/store"
import { primitiveRuntimeCapability, type WorkflowCapabilitiesResponse } from "@/lib/workflow/capabilities"
import { localizeNodeText, type WorkflowLanguage } from "@/lib/workflow/node-i18n"
import type { WorkflowNodeCatalogItem } from "@/lib/workflow/node-catalog"
import type { WorkflowPrimitive } from "@/lib/workflow/node-primitives"
import { NODE_NETWORK_DEPTH_LIMIT_REACHED } from "@/lib/workflow/node-hierarchy"
import type { CanvasPoint } from "./workflow-canvas-geometry"

export type NodeMenuState = { nodeId?: string; x: number; y: number }

type FitView = (options?: { padding?: number; duration?: number; nodes?: { id: string }[] }) => unknown

export function useWorkflowNodeMenuActions(options: {
  addPrimitiveToNodeNetwork: (
    nodeId: string,
    item: WorkflowPrimitive,
    position: CanvasPoint,
    runtimeCapability: ReturnType<typeof primitiveRuntimeCapability>,
  ) => number
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
    addPrimitiveToNodeNetwork,
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
      showToast(
        count === NODE_NETWORK_DEPTH_LIMIT_REACHED
          ? "已到第 4 层原子节点，不能继续下钻"
          : count > 0
            ? `进入下层网络：${count} 个节点`
            : "这个节点没有下层网络",
      )
      setNodeMenu(null)
      if (count > 0) window.setTimeout(() => void fitView({ padding: 0.24, duration: 180 }), 20)
    },
    [enterNodeNetwork, fitView, setNodeMenu, showToast],
  )

  const addDopNodeFromMenu = useCallback(
    (item: WorkflowNodeCatalogItem) => {
      if (!nodeMenu) return
      if (useFlowStore.getState().networkStack.length > 0) {
        showToast("一级业务节点只能添加到工作流根层")
        setNodeMenu(null)
        return
      }
      const text = localizeNodeText(item.id, { label: item.label, description: item.description }, language)
      addWorkflowNodeFromCatalog(item, screenToFlowPosition({ x: nodeMenu.x + 26, y: nodeMenu.y + 26 }))
      setInspectorOpen(true)
      showToast(`已添加一级业务节点：${text.label}`)
      setNodeMenu(null)
    },
    [addWorkflowNodeFromCatalog, language, nodeMenu, screenToFlowPosition, setInspectorOpen, setNodeMenu, showToast],
  )

  const addPrimitiveFromMenu = useCallback(
    (item: WorkflowPrimitive, itemIndex: number) => {
      if (!nodeMenu?.nodeId) return
      const text = localizeNodeText(item.id, { label: item.label, description: item.description }, language)
      const count = addPrimitiveToNodeNetwork(
        nodeMenu.nodeId,
        item,
        { x: 780, y: 96 + itemIndex * 96 },
        primitiveRuntimeCapability(capabilities, item.id),
      )
      if (count === NODE_NETWORK_DEPTH_LIMIT_REACHED) {
        showToast("已到第 4 层原子节点，不能继续添加下层节点")
        setNodeMenu(null)
        return
      }
      if (count <= 0) {
        showToast("无法进入这个节点的下层 Network")
        setNodeMenu(null)
        return
      }

      showToast(`已添加原子节点：${text.label}`)
      setNodeMenu(null)
      window.setTimeout(() => void fitView({ padding: 0.24, duration: 180 }), 20)
    },
    [addPrimitiveToNodeNetwork, capabilities, fitView, language, nodeMenu, setNodeMenu, showToast],
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
