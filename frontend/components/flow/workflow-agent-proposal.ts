import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react"

import { useFlowStore } from "@/lib/flow/store"
import { acceptAgentProposal, type AgentProposal } from "@/lib/workflow/proposal"
import type { ProposalFocusTarget } from "@/lib/workflow/proposal-focus"

type FitView = (options?: { padding?: number; duration?: number; nodes?: { id: string }[] }) => unknown

export function useWorkflowAgentProposal(options: {
  clearPendingAgentProposal: () => void
  clearProposalFocus: () => void
  fitView: FitView
  focusProposalTargets: (nodeIds: string[], edgeIds: string[]) => void
  importWorkflowProject: (project: ReturnType<typeof acceptAgentProposal>) => void
  pendingAgentProposal: AgentProposal | null | undefined
  setAgentDrawerOpen: Dispatch<SetStateAction<boolean>>
  showToast: (message: string) => void
}) {
  const {
    clearPendingAgentProposal,
    clearProposalFocus,
    fitView,
    focusProposalTargets,
    importWorkflowProject,
    pendingAgentProposal,
    setAgentDrawerOpen,
    showToast,
  } = options
  const [agentProposal, setAgentProposal] = useState<AgentProposal | undefined>(undefined)

  const acceptProposal = useCallback(
    (proposal: AgentProposal) => {
      try {
        importWorkflowProject(acceptAgentProposal(useFlowStore.getState().workflowProject, proposal))
        showToast("Agent proposal accepted")
        setAgentDrawerOpen(false)
        setAgentProposal(undefined)
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Agent proposal failed")
      }
    },
    [importWorkflowProject, setAgentDrawerOpen, showToast],
  )

  const rejectProposal = useCallback(() => {
    showToast("Agent proposal rejected")
    clearProposalFocus()
    setAgentDrawerOpen(false)
    setAgentProposal(undefined)
  }, [clearProposalFocus, setAgentDrawerOpen, showToast])

  const presentAgentProposal = useCallback(
    (proposal: AgentProposal) => {
      setAgentProposal(proposal)
      setAgentDrawerOpen(true)
      showToast("Demand proposal ready")
    },
    [setAgentDrawerOpen, showToast],
  )

  useEffect(() => {
    if (!pendingAgentProposal) return
    presentAgentProposal(pendingAgentProposal)
    clearPendingAgentProposal()
  }, [clearPendingAgentProposal, pendingAgentProposal, presentAgentProposal])

  const focusProposalOperation = useCallback(
    (focus: ProposalFocusTarget) => {
      focusProposalTargets(focus.nodeIds, focus.edgeIds)
      if (focus.nodeIds.length > 0) {
        window.setTimeout(() => void fitView({ nodes: focus.nodeIds.map((id) => ({ id })), padding: 0.35, duration: 280 }), 20)
      }
    },
    [fitView, focusProposalTargets],
  )

  return { acceptProposal, agentProposal, focusProposalOperation, rejectProposal }
}
