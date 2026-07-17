"use client"

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react"

import { useFlowStore } from "@/lib/flow/store"
import { getApiAuthToken } from "@/lib/api/auth-token"
import {
  fetchWorkflowEvidenceBatches,
  fetchWorkflowEvidenceProjection,
  fetchWorkflowRunProjection,
  replayWorkflowRunEventStream,
} from "@/lib/workflow/backend-runs"
import type { WorkflowRunProjection } from "@/lib/workflow/backend-runs"
import type { WorkflowCapabilitiesResponse } from "@/lib/workflow/capabilities"
import { loadShareStateFromUrl } from "@/lib/flow/share-state"
import { emptyEvidenceWorkbenchState, type EvidenceWorkbenchState } from "@/lib/workflow/evidence-workbench"
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
    window.addEventListener("click", close)
    window.addEventListener("keydown", close)
    return () => {
      window.removeEventListener("click", close)
      window.removeEventListener("keydown", close)
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

export function useWorkflowResultSubscription(options: {
  projection: WorkflowRunProjection | null
  setWorkbenchState: Dispatch<SetStateAction<EvidenceWorkbenchState>>
}) {
  const { projection: requestedProjection, setWorkbenchState } = options
  const [, setActiveProjection] = useState<WorkflowRunProjection | null>(requestedProjection)
  const applyWorkflowNodeRunEvent = useFlowStore((state) => state.applyWorkflowNodeRunEvent)
  const applyWorkflowRunProjection = useFlowStore((state) => state.applyWorkflowRunProjection)
  const applyWorkflowEvidenceBatchProjection = useFlowStore(
    (state) => state.applyWorkflowEvidenceBatchProjection,
  )

  useEffect(() => {
    if (!requestedProjection?.runId) {
      setActiveProjection(null)
      setWorkbenchState(emptyEvidenceWorkbenchState())
      return
    }

    const runId = requestedProjection.runId
    const controller = new AbortController()
    const token = getApiAuthToken()
    const authorization = token ? `Bearer ${token}` : null
    setWorkbenchState((current) => ({ ...current, status: "loading", error: null }))

    void (async () => {
      try {
        const latestProjection = await fetchWorkflowRunProjection(runId, { authorization })
        applyWorkflowRunProjection(latestProjection)
        const replay = await replayWorkflowRunEventStream(runId, {
          authorization,
          signal: controller.signal,
        })
        if (controller.signal.aborted) return
        for (const event of replay.events) applyWorkflowNodeRunEvent(event)
        if (replay.projection) {
          setActiveProjection(replay.projection)
          applyWorkflowRunProjection(replay.projection)
        }

        const [batchList, evidenceProjection] = await Promise.all([
          fetchWorkflowEvidenceBatches(runId, { authorization }),
          fetchWorkflowEvidenceProjection(runId, {
            authorization,
            include: ["clusters", "missingSources", "summaries", "conflicts"],
          }),
        ])
        if (controller.signal.aborted) return
        applyWorkflowEvidenceBatchProjection(evidenceProjection, batchList.batches)
        setWorkbenchState({
          status: "ready",
          projection: evidenceProjection,
          batches: batchList.batches,
          selectedBatchId: null,
          error: null,
        })
      } catch (error) {
        if (controller.signal.aborted) return
        setWorkbenchState((current) => ({
          ...current,
          status: "error",
          error: error instanceof Error ? error.message : "Workflow result subscription failed",
        }))
      }
    })()

    return () => controller.abort()
  }, [
    applyWorkflowEvidenceBatchProjection,
    applyWorkflowNodeRunEvent,
    applyWorkflowRunProjection,
    requestedProjection?.runId,
    setWorkbenchState,
  ])
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
