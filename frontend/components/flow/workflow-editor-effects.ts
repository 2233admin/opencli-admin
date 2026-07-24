"use client"

import { useCallback, useEffect, type Dispatch, type SetStateAction } from "react"

import { useFlowStore } from "@/lib/flow/store"
import { loadShareStateFromUrl } from "@/lib/flow/share-state"
import type { WorkflowCapabilitiesResponse } from "@/lib/workflow/capabilities"
import type { WorkflowNode } from "@/lib/flow/types"
import type { NodeMenuState } from "./workflow-node-menu-actions"

type FitView = (options?: { padding?: number; duration?: number; nodes?: { id: string }[] }) => unknown
type ShowToast = (message: string) => void

export function isNetworkLocked(networkStack: { nodeId: string; label: string }[], nodes: WorkflowNode[]) {
  return networkStack.length > 0 && nodes.some((node) => node.data.internalLocked === true)
}

export function useApplyWorkflowCapabilities(options: {
  applyWorkflowCapabilities: (capabilities: WorkflowCapabilitiesResponse) => void
  capabilities: WorkflowCapabilitiesResponse | null | undefined
  workflowProjectId: string
}) {
  const { applyWorkflowCapabilities, capabilities, workflowProjectId } = options
  useEffect(() => {
    if (capabilities) applyWorkflowCapabilities(capabilities)
  }, [applyWorkflowCapabilities, capabilities, workflowProjectId])
}

export function useSharedWorkflowImport(options: {
  fitView: FitView
  showToast: ShowToast
}) {
  const { fitView, showToast } = options
  useEffect(() => {
    if (typeof window === "undefined") return
    const shared = loadShareStateFromUrl(window.location.href)
    if (!shared) return
    useFlowStore.setState({
      workflowProject: shared.workflowProject,
      nodes: shared.nodes,
      edges: shared.edges,
      drawings: shared.drawings ?? [],
      networkStack: [],
      helperLines: { snapPosition: {} },
    })
    showToast("已从分享 URL 恢复 workflow")
    window.setTimeout(() => void fitView({ padding: 0.24, duration: 220 }), 30)
  }, [fitView, showToast])
}

export function useAutoDismissToast(toast: string | null, setToast: Dispatch<SetStateAction<string | null>>) {
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 2200)
    return () => clearTimeout(timer)
  }, [setToast, toast])
}

export function useDismissNodeMenu(
  nodeMenu: NodeMenuState | null,
  setNodeMenu: Dispatch<SetStateAction<NodeMenuState | null>>,
) {
  useEffect(() => {
    if (!nodeMenu) return
    const close = () => setNodeMenu(null)
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close()
    }
    window.addEventListener("click", close)
    window.addEventListener("keydown", closeOnEscape)
    return () => {
      window.removeEventListener("click", close)
      window.removeEventListener("keydown", closeOnEscape)
    }
  }, [nodeMenu, setNodeMenu])
}

export function useCompactViewportMedia(setCompactViewport: Dispatch<SetStateAction<boolean>>) {
  useEffect(() => {
    const media = window.matchMedia("(max-width: 640px)")
    const update = () => setCompactViewport(media.matches)
    update()
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
  }, [setCompactViewport])
}

export function useCompactViewportEffect(applyCompactViewport: () => number | undefined) {
  useEffect(() => {
    const timer = applyCompactViewport()
    return () => {
      if (timer) window.clearTimeout(timer)
    }
  }, [applyCompactViewport])
}

export function useExitCurrentNetwork(options: {
  exitNodeNetwork: () => boolean
  fitView: FitView
  showToast: ShowToast
}) {
  const { exitNodeNetwork, fitView, showToast } = options
  return useCallback(() => {
    if (exitNodeNetwork()) {
      showToast("已返回上一层 Network")
      window.setTimeout(() => void fitView({ padding: 0.24, duration: 180 }), 20)
    }
  }, [exitNodeNetwork, fitView, showToast])
}
