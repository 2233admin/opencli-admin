"use client"

import { useLayoutEffect, useMemo, useRef } from "react"
import gsap from "gsap"
import { Flip } from "gsap/Flip"

import { Inspector } from "./inspector"
import { InteractionSettingsPanel } from "./interaction-settings-panel"
import { ProjectSettingsPanel } from "./project-settings-panel"
import { RunTracePanel } from "./run-trace-panel"
import { NodeManagementPanel } from "./node-management-panel"
import { cn } from "@/lib/utils"
import type { CanvasPoint } from "./workflow-canvas-geometry"
import type { WorkflowProfile } from "@/lib/workflow/schema"

gsap.registerPlugin(Flip)

type NetworkStackEntry = { nodeId: string; label: string }

export function ScissorTrailOverlay({ active, points }: { active: boolean; points: CanvasPoint[] }) {
  if (!active || points.length <= 1) return null
  const polylinePoints = points.map((point) => `${point.x},${point.y}`).join(" ")
  return (
    <svg className="pointer-events-none absolute inset-0 z-30 h-full w-full overflow-visible">
      <polyline
        points={polylinePoints}
        fill="none"
        stroke="var(--background)"
        strokeWidth={7}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.9}
      />
      <polyline
        points={polylinePoints}
        className="workflow-scissor-trail"
        fill="none"
        stroke="#ff7a17"
        strokeWidth={2}
        strokeDasharray="7 5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function NetworkBreadcrumb({
  locked,
  networkStack,
  onExit,
}: {
  locked: boolean
  networkStack: NetworkStackEntry[]
  onExit: () => void
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const previousState = useRef<ReturnType<typeof Flip.getState> | null>(null)
  const previousKeys = useRef<Set<string>>(new Set())
  const pathKey = useMemo(
    () => networkStack.map((entry) => entry.nodeId).join("/"),
    [networkStack],
  )

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) {
      previousState.current = null
      previousKeys.current = new Set()
      return
    }

    const targets = Array.from(root.querySelectorAll<HTMLElement>("[data-network-flip-key]"))
    const nextState = Flip.getState(targets)
    const currentKeys = new Set(targets.map((target) => target.dataset.networkFlipKey ?? ""))
    const entered = targets.filter(
      (target) => !previousKeys.current.has(target.dataset.networkFlipKey ?? ""),
    )
    const context = gsap.context(() => {
      if (previousState.current) {
        Flip.from(previousState.current, {
          targets,
          duration: 0.28,
          ease: "power2.inOut",
          nested: true,
          simple: true,
        })
      } else {
        gsap.fromTo(root, { autoAlpha: 0, y: -8 }, { autoAlpha: 1, y: 0, duration: 0.22 })
      }
      if (previousState.current && entered.length > 0) {
        gsap.fromTo(
          entered,
          { autoAlpha: 0, x: -5 },
          { autoAlpha: 1, x: 0, duration: 0.18, stagger: 0.025, ease: "power2.out" },
        )
      }
    }, root)

    previousState.current = nextState
    previousKeys.current = currentKeys
    return () => context.revert()
  }, [locked, pathKey])

  if (networkStack.length === 0) return null
  return (
    <div ref={rootRef} data-network-flip-key="panel" className="workflow-floating-panel absolute left-3 top-3 z-40 flex items-center gap-2 rounded-md border bg-popover px-2.5 py-2 font-mono text-[10px] uppercase tracking-[0.12em] shadow-lg">
      <button
        type="button"
        className="rounded-sm border border-border bg-background px-2 py-1 text-foreground transition-colors hover:bg-accent"
        onClick={onExit}
      >
        ← Up
      </button>
      <span className="text-muted-foreground/60">/</span>
      <span className="text-muted-foreground">obj</span>
      {networkStack.map((entry) => (
        <span key={entry.nodeId} data-network-flip-key={entry.nodeId} className="flex items-center gap-1">
          <span className="text-muted-foreground/60">/</span>
          <span className="text-foreground">{entry.label}</span>
        </span>
      ))}
      <span className={cn("rounded-sm border px-1.5 py-0.5", locked ? "border-[#d97706]/50 text-[#d97706]" : "border-[#2f9e44]/50 text-[#2f9e44]")}>
        {locked ? "LOCKED" : "DRAFT"}
      </span>
      <span className="ml-1 text-muted-foreground/60">Esc / Backspace</span>
    </div>
  )
}

export function WorkflowFloatingPanels({
  inspectorOpen,
  nodeManagementOpen,
  onCloseNodeManagement,
  onProfileChange,
  projectSettingsOpen,
  runTraceOpen,
  settingsOpen,
  workflowProfile,
}: {
  inspectorOpen: boolean
  nodeManagementOpen: boolean
  onCloseNodeManagement: () => void
  onProfileChange: (profile: WorkflowProfile) => void
  projectSettingsOpen: boolean
  runTraceOpen: boolean
  settingsOpen: boolean
  workflowProfile: WorkflowProfile
}) {
  return (
    <>
      {runTraceOpen ? (
        <div className={cn("workflow-floating-panel absolute top-3 z-40", nodeManagementOpen ? "left-[28.75rem]" : "left-3")}>
          <RunTracePanel />
        </div>
      ) : null}

      {nodeManagementOpen ? <NodeManagementPanel onClose={onCloseNodeManagement} /> : null}

      {projectSettingsOpen ? (
        <div className="workflow-floating-panel absolute bottom-3 right-3 top-3 z-40">
          <ProjectSettingsPanel profile={workflowProfile} onProfileChange={onProfileChange} />
        </div>
      ) : settingsOpen ? (
        <div className="workflow-floating-panel contents">
          <InteractionSettingsPanel />
        </div>
      ) : inspectorOpen ? (
        <div className="workflow-floating-panel contents">
          <Inspector />
        </div>
      ) : null}
    </>
  )
}

export function WorkflowToast({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <div className="workflow-toast pointer-events-none absolute bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-md border bg-popover px-4 py-2 font-mono text-xs shadow-lg">
      {message}
    </div>
  )
}
