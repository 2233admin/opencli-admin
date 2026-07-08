"use client"

import { memo, useEffect, useState, type MouseEvent as ReactMouseEvent } from "react"
import { Handle, NodeToolbar, Position, useStore, type NodeProps } from "@xyflow/react"
import { Loader2, Plus, Wand2 } from "lucide-react"
import type { WorkflowNode as WorkflowNodeType } from "@/lib/flow/types"
import { getApiAuthToken } from "@/lib/api/auth-token"
import { useFlowStore } from "@/lib/flow/store"
import { useSettingsStore } from "@/lib/flow/settings-store"
import { draftWorkflowDemand } from "@/lib/workflow/backend-demand-draft"
import { COLLECTION_NEED_CATALOG_ID } from "@/lib/workflow/node-catalog"
import { getNodeDisplayId, localizeNodeText } from "@/lib/workflow/node-i18n"
import { getNodeVisualSignature } from "@/lib/workflow/node-visuals"
import { runtimeStatusLabel, runtimeStatusTone } from "@/lib/workflow/capabilities"
import type { AgentProposal } from "@/lib/workflow/proposal"
import { cn } from "@/lib/utils"

const statusLabels: Record<string, string> = {
  idle: "Idle",
  running: "Running",
  success: "Done",
  error: "Error",
}

const statusDotStyles: Record<string, string> = {
  idle: "border-muted-foreground/50 bg-transparent",
  running: "border-[#ff7a17] bg-[#ff7a17]",
  success: "border-[#4ade80] bg-[#4ade80]",
  error: "border-destructive bg-destructive",
}

const ROW_H = 18

function typeCaption(category: string, nodeType: string) {
  return `${category}::${nodeType}`.toUpperCase()
}

function paramSummary(data: WorkflowNodeType["data"]): string | null {
  if (data.nodeType === "condition" && data.condition) return data.condition
  if (data.fields && data.fields.length > 0) {
    return data.fields
      .slice(0, 2)
      .map((f) => `${f.label}=${f.value}`)
      .join("  ")
  }
  return null
}

const handleCls =
  "!size-1.5 !rounded-[1px] !border !border-background !bg-[#3a3d42] transition-colors hover:!bg-foreground"

type SemanticNodeShape = "card" | "pill" | "input" | "soft" | "decision" | "flag" | "tray"

const shapeClips: Record<SemanticNodeShape, string | undefined> = {
  card: undefined,
  pill: "inset(0 round 999px)",
  input: "polygon(8% 0, 100% 0, 92% 100%, 0 100%)",
  soft: "inset(0 round 18px)",
  decision: "polygon(12% 0, 88% 0, 100% 50%, 88% 100%, 12% 100%, 0 50%)",
  flag: "polygon(0 0, 92% 0, 100% 50%, 92% 100%, 0 100%)",
  tray: "polygon(0 14%, 36% 14%, 40% 0, 60% 0, 64% 14%, 100% 14%, 100% 100%, 0 100%)",
}

function isSemanticNodeShape(value: unknown): value is SemanticNodeShape {
  return typeof value === "string" && value in shapeClips
}

function inferredSemanticShape(data: WorkflowNodeType["data"]): SemanticNodeShape {
  const canonical = data.canonical as { kind?: string; capability?: string } | undefined
  switch (canonical?.kind) {
    case "schedule":
      return "pill"
    case "source":
      return "input"
    case "agent":
      return "soft"
    case "router":
      return "decision"
    case "notify":
      return "flag"
    case "inbox":
      return "tray"
    default:
      return "card"
  }
}

function nodeDisplayShape(data: WorkflowNodeType["data"]): SemanticNodeShape {
  const explicitShape = data.operatorShape ?? data.canvasShape ?? data.nodeShape
  if (isSemanticNodeShape(explicitShape)) return explicitShape
  if (data.useSemanticShape === true) return inferredSemanticShape(data)
  return "card"
}

function shapePadding(shape: SemanticNodeShape) {
  switch (shape) {
    case "pill":
      return "px-4"
    case "input":
      return "pl-5 pr-6"
    case "decision":
      return "px-6"
    case "flag":
      return "pl-4 pr-7"
    case "tray":
      return "px-4 pt-2"
    default:
      return "px-3"
  }
}

function NodeStatus({ status }: { status?: string }) {
  if (!status) return null
  const label = statusLabels[status] ?? status
  const showText = status !== "idle"
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground"
      title={`Status: ${label}`}
      aria-label={`Status: ${label}`}
    >
      <span className={cn("size-1.5 rounded-full border", statusDotStyles[status] ?? statusDotStyles.idle)} />
      {showText ? <span>{label}</span> : null}
    </span>
  )
}

function RuntimeCapabilityBadge({ data }: { data: WorkflowNodeType["data"] }) {
  const runtimeCapability = data.runtimeCapability
  if (!runtimeCapability) return null
  return (
    <span
      className={cn(
        "inline-flex max-w-[5.25rem] shrink-0 rounded-[3px] border px-1 py-0.5 font-mono text-[8px] uppercase tracking-[0.08em]",
        runtimeStatusTone(runtimeCapability.status),
      )}
      title={runtimeCapability.reason ?? runtimeCapability.label}
    >
      <span className="truncate">{runtimeStatusLabel(runtimeCapability.status)}</span>
    </span>
  )
}

function numberPercent(value: unknown) {
  return typeof value === "number" ? `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` : null
}

function readMapBadges(data: WorkflowNodeType["data"]) {
  const sourceAnchor = data.sourceAnchor
  const runArtifact = data.runArtifact
  const topicCollapse = data.topicCollapse
  const semantic = data.semantic as { relationship?: unknown; confidence?: unknown } | undefined
  const weight = numberPercent(data.weight)
  const badges: Array<{ key: string; label: string; tone: string }> = []

  if (sourceAnchor && typeof sourceAnchor === "object") badges.push({ key: "anchor", label: "ANCHOR", tone: "text-[#a8d8ff]" })
  if (runArtifact && typeof runArtifact === "object") badges.push({ key: "artifact", label: "ARTIFACT", tone: "text-[#4ade80]" })
  if (topicCollapse && typeof topicCollapse === "object") {
    const state = topicCollapse as { mode?: unknown; nodeCount?: unknown }
    badges.push({
      key: "topic",
      label: `PKG ${state.mode === "locked" ? "LOCK" : "DRAFT"}`,
      tone: state.mode === "locked" ? "text-[#4ade80]" : "text-[#ffb86b]",
    })
  }
  if (semantic && typeof semantic.relationship === "string") {
    const confidence = numberPercent(semantic.confidence)
    badges.push({ key: "semantic", label: confidence ? `SEM ${confidence}` : "SEM", tone: "text-[#d4b5ff]" })
  }
  if (weight) badges.push({ key: "weight", label: `WGT ${weight}`, tone: "text-[#ffb86b]" })

  return badges
}

type CanonicalNodeData = {
  catalogId?: string
  kind?: string
  capability?: string
  params?: Record<string, unknown>
}

function readCanonical(data: WorkflowNodeType["data"]): CanonicalNodeData | undefined {
  const canonical = data.canonical
  return canonical && typeof canonical === "object" && !Array.isArray(canonical)
    ? canonical as CanonicalNodeData
    : undefined
}

function isCollectionNeedData(data: WorkflowNodeType["data"]): boolean {
  const canonical = readCanonical(data)
  if (canonical?.catalogId === COLLECTION_NEED_CATALOG_ID) return true
  if (canonical?.kind !== "schedule" || canonical.capability !== "trigger") return false
  if (canonical.params?.mode === "demand-draft") return true
  return hasNeedShape(canonical?.params) && !hasScheduleShape(canonical?.params)
}

function hasNeedShape(params: Record<string, unknown> | undefined): boolean {
  return typeof params?.text === "string" || typeof params?.locale === "string"
}

function hasScheduleShape(params: Record<string, unknown> | undefined): boolean {
  return typeof params?.interval === "string" || typeof params?.timezone === "string"
}

function stringParam(params: Record<string, unknown> | undefined, key: string, fallback = "") {
  const value = params?.[key]
  return typeof value === "string" ? value : fallback
}

function withDemandNodeUpdate(
  proposal: AgentProposal,
  nodeId: string,
  text: string,
  locale: string,
): AgentProposal {
  return {
    ...proposal,
    title: `Assemble from Collection Need: ${text.slice(0, 36)}`,
    validationEvidence: [
      {
        id: "collection-need-node-input",
        label: "Collection Need node input",
        passed: true,
        details: "User demand is captured on the Canvas node; runtime resources remain implicit.",
      },
      ...proposal.validationEvidence,
    ],
    operations: [
      {
        type: "updateNodeParams",
        nodeId,
        params: { text, locale, mode: "demand-draft" },
      },
      ...proposal.operations,
    ],
  }
}

function MiniNetworkPreview({ data }: { data: WorkflowNodeType["data"] }) {
  const miniNetwork = data.miniNetwork
  if (!miniNetwork || typeof miniNetwork !== "object") return null
  const preview = miniNetwork as { nodes?: unknown; edges?: unknown; mode?: unknown }
  const nodes = typeof preview.nodes === "number" ? preview.nodes : 3
  const edges = typeof preview.edges === "number" ? preview.edges : Math.max(0, nodes - 1)

  return (
    <div
      className="mt-1.5 grid h-7 grid-cols-[auto_1fr_auto] items-center gap-1.5 rounded-sm border border-border/70 bg-background/45 px-1.5"
      title="Node-internal mini network"
    >
      <span className="font-mono text-[8px] uppercase tracking-[0.1em] text-muted-foreground">NET</span>
      <div className="relative h-4">
        <span className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-border" aria-hidden />
        {Array.from({ length: Math.min(4, Math.max(2, nodes)) }).map((_, index, arr) => (
          <span
            key={index}
            className="absolute top-1/2 size-1.5 -translate-y-1/2 rounded-full border border-[#a8d8ff] bg-card"
            style={{ left: `${(index / Math.max(1, arr.length - 1)) * 100}%` }}
            aria-hidden
          />
        ))}
      </div>
      <span className="font-mono text-[8px] text-muted-foreground">
        {nodes}/{edges}
      </span>
    </div>
  )
}

function WorkflowNodeComponent({ id, data, selected }: NodeProps<WorkflowNodeType>) {
  const isCondition = data.nodeType === "condition"
  const proposalFocused = data.proposalFocused === true
  const internalLocked = data.internalLocked === true
  const internalDraft = data.internalDraft === true
  const addChildNode = useFlowStore((s) => s.addChildNode)
  const workflowProject = useFlowStore((s) => s.workflowProject)
  const updateWorkflowNodeParams = useFlowStore((s) => s.updateWorkflowNodeParams)
  const queueAgentProposal = useFlowStore((s) => s.queueAgentProposal)
  const contextualZoom = useSettingsStore((s) => s.contextualZoom)
  const language = useSettingsStore((s) => s.language)
  const zoom = useStore((s) => s.transform[2])
  const canonical = readCanonical(data)
  const displayId = getNodeDisplayId(data)
  const isCollectionNeed = displayId === COLLECTION_NEED_CATALOG_ID || isCollectionNeedData(data)
  const demandParams = canonical?.params
  const demandTextValue = stringParam(demandParams, "text", "抓小红书热帖")
  const demandLocale = stringParam(demandParams, "locale", "zh-CN")
  const [draftText, setDraftText] = useState(demandTextValue)
  const [draftStatus, setDraftStatus] = useState<"idle" | "running" | "error">("idle")
  const [draftError, setDraftError] = useState<string | null>(null)

  useEffect(() => {
    setDraftText(demandTextValue)
  }, [demandTextValue])
  // Contextual Zoom: <0.5 = icon only, 0.5-1 = compact, >1 = full
  const detail: "low" | "mid" | "high" = !contextualZoom
    ? "high"
    : zoom < 0.5
      ? "low"
      : zoom < 1
        ? "mid"
        : "high"

  const primitivePorts = Array.isArray(data.primitivePorts)
    ? (data.primitivePorts as Array<{ id: string; direction: string; type: string }>)
    : []
  const primitiveOutputs = primitivePorts
    .filter((port) => port.direction === "output")
    .map((port) => ({ id: port.id, label: port.id, accent: port.type === "assertion" ? "#4ade80" : undefined }))
  const primitiveInputs = primitivePorts.filter((port) => port.direction === "input")
  const outputs: { id?: string; label: string; accent?: string }[] = primitiveOutputs.length > 0
    ? primitiveOutputs
    : isCondition
      ? [
          { id: "true", label: "true", accent: "#4ade80" },
          { id: "false", label: "false", accent: "#f87171" },
        ]
      : isCollectionNeed
        ? [{ id: "out", label: "need" }]
      : [{ label: "out" }]

  const summary = paramSummary(data)
  const nodeShape = nodeDisplayShape(data)
  const clipPath = shapeClips[nodeShape]
  const borderColor = selected ? "var(--foreground)" : proposalFocused ? "#ff7a17" : "var(--border)"
  const localized = localizeNodeText(displayId, { label: data.label, description: data.description }, language)
  const visual = getNodeVisualSignature(data)
  const mapBadges = readMapBadges(data)
  const nodeStyle = {
    clipPath,
    borderRadius: clipPath ? undefined : 6,
    "--node-stripe": visual.stripe,
  } as React.CSSProperties

  const sourceHandleStyle = (i: number) =>
    outputs.length === 1
      ? { left: "50%" }
      : { left: `${((i + 1) / (outputs.length + 1)) * 100}%` }

  const assembleCollectionNeed = async (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const text = draftText.trim()
    if (!text) {
      setDraftStatus("error")
      setDraftError("Need is required")
      return
    }

    setDraftStatus("running")
    setDraftError(null)
    const locale = demandLocale || "zh-CN"
    const projectForDraft = {
      ...workflowProject,
      nodes: workflowProject.nodes.map((node) =>
        node.id === id
          ? { ...node, params: { ...node.params, text, locale, mode: "demand-draft" } }
          : node,
      ),
    }

    try {
      updateWorkflowNodeParams(id, { text, locale, mode: "demand-draft" })
      const token = getApiAuthToken()
      const authorization = token ? `Bearer ${token}` : null
      const proposal = await draftWorkflowDemand(projectForDraft, text, { authorization, locale })
      queueAgentProposal(withDemandNodeUpdate(proposal, id, text, locale))
      setDraftStatus("idle")
    } catch (error) {
      setDraftStatus("error")
      setDraftError(error instanceof Error ? error.message : "Demand assembly failed")
    }
  }

  if (detail === "low") {
    return (
      <div
        data-workflow-node="true"
        data-status={data.status ?? "idle"}
        data-runtime-status={data.runtimeCapability?.status ?? "unknown"}
        data-selected={selected ? "true" : "false"}
        data-package-state={internalLocked ? "locked" : internalDraft ? "draft" : "canonical"}
        className={cn(
          "workflow-node-card flex size-12 items-center justify-center bg-card text-card-foreground ring-1 transition-colors",
          selected ? "ring-foreground/40" : "ring-border",
          proposalFocused && "ring-2 ring-[#ff7a17]/45",
        )}
        style={nodeStyle}
        title={`${localized.label} · ${runtimeStatusLabel(data.runtimeCapability?.status)}`}
      >
        <span className="workflow-node-mini-code">{visual.code}</span>
        <Handle type="target" id={primitiveInputs[0]?.id} position={Position.Top} className={handleCls} />
        {outputs.map((out) => (
          <Handle
            key={out.id ?? "out"}
            id={out.id}
            type="source"
            position={Position.Bottom}
            className={handleCls}
            style={sourceHandleStyle(outputs.indexOf(out))}
          />
        ))}
      </div>
    )
  }

  return (
    <div
      data-workflow-node="true"
      data-status={data.status ?? "idle"}
      data-runtime-status={data.runtimeCapability?.status ?? "unknown"}
      data-selected={selected ? "true" : "false"}
      data-package-state={internalLocked ? "locked" : internalDraft ? "draft" : "canonical"}
      className={cn(
        "workflow-node-card group relative overflow-hidden bg-card text-card-foreground transition-colors",
        "w-[204px]",
        selected ? "ring-1 ring-foreground/30" : "ring-1 ring-border hover:ring-[#3a3d42]",
        proposalFocused && "ring-2 ring-[#ff7a17]/40",
      )}
      style={{
        ...nodeStyle,
        outline: `1px solid ${borderColor}`,
        outlineOffset: "-1px",
      }}
    >
      <NodeToolbar isVisible={selected && detail === "high"} position={Position.Bottom} offset={8}>
        <button
          type="button"
          onClick={() => addChildNode(id)}
          className="flex items-center gap-1 rounded-sm border bg-popover px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
        >
          <Plus className="size-3" />
          Add Child
        </button>
      </NodeToolbar>

      <div className={cn("flex min-h-[72px] gap-2 py-2", shapePadding(nodeShape))}>
        <div className="workflow-node-sigil flex w-10 shrink-0 flex-col items-center justify-center gap-1 border-r border-border/70 pr-2">
          <span className="font-mono text-[13px] font-semibold leading-none text-foreground" aria-hidden>
            {visual.glyph}
          </span>
          <span className="max-w-9 truncate font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground/90">
            {visual.code}
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1.5">
            <span className="truncate font-mono text-[9px] uppercase tracking-[0.08em] text-muted-foreground/80">
              {internalLocked ? "LOCKED PACKAGE" : internalDraft ? "DRAFT INTERNAL" : typeCaption(data.category, data.nodeType)}
            </span>
            <span className="flex min-w-0 shrink-0 items-center gap-1">
              <RuntimeCapabilityBadge data={data} />
              <NodeStatus status={data.status} />
            </span>
          </div>

          <p className="mt-1 truncate text-[13px] font-medium leading-tight">{localized.label}</p>

          {detail === "high" && summary ? (
            <code className="mt-1 block truncate font-mono text-[10px] leading-tight text-muted-foreground">
              {summary}
            </code>
          ) : null}

          {detail === "high" && isCollectionNeed ? (
            <div className="nodrag nopan mt-2 space-y-1.5" onPointerDown={(event) => event.stopPropagation()}>
              <div className="rounded-[3px] border border-border/70 bg-background/45 px-2 py-1.5">
                <p className="line-clamp-2 font-mono text-[10px] leading-snug text-foreground">{draftText}</p>
              </div>
              <button
                type="button"
                onClick={assembleCollectionNeed}
                disabled={draftStatus === "running"}
                className="flex h-6 w-full items-center justify-center gap-1.5 rounded-[3px] border border-border bg-background/80 font-mono text-[9px] uppercase tracking-[0.08em] text-foreground transition-colors hover:border-foreground/40 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
              >
                {draftStatus === "running" ? <Loader2 className="size-3 animate-spin" /> : <Wand2 className="size-3" />}
                Assemble
              </button>
              {draftError ? (
                <p className="line-clamp-2 font-mono text-[9px] leading-snug text-destructive">{draftError}</p>
              ) : null}
            </div>
          ) : null}

          {detail === "high" && mapBadges.length > 0 ? (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {mapBadges.map((badge) => (
                <span
                  key={badge.key}
                  className={cn(
                    "rounded-[3px] border border-border/70 bg-background/45 px-1 py-0.5 font-mono text-[8px] uppercase tracking-[0.08em]",
                    badge.tone,
                  )}
                >
                  {badge.label}
                </span>
              ))}
            </div>
          ) : null}

          {detail === "high" ? <MiniNetworkPreview data={data} /> : null}
        </div>
      </div>

      {detail === "high" ? (
        <div className="border-t border-border/80 py-0.5">
          {outputs.map((out, i) => (
            <div
              key={out.id ?? "out"}
              className={cn("flex items-center justify-between font-mono text-[10px] text-muted-foreground", shapePadding(nodeShape))}
              style={{ height: ROW_H }}
            >
              <span>{i === 0 ? (primitiveInputs[0]?.id ?? "in") : ""}</span>
              <span className="flex items-center gap-1.5">
                {out.label}
                {out.accent ? (
                  <span
                    className="size-1.5 rounded-full"
                    style={{ backgroundColor: out.accent }}
                    aria-hidden
                  />
                ) : null}
              </span>
            </div>
          ))}
        </div>
      ) : null}


      {/* handles aligned to port rows */}
      <Handle
        type="target"
        id={primitiveInputs[0]?.id}
        position={Position.Top}
        className={handleCls}
        style={{ left: "50%" }}
      />
      {outputs.map((out, i) => (
        <Handle
          key={out.id ?? "out"}
          id={out.id}
          type="source"
          position={Position.Bottom}
          className={handleCls}
          style={sourceHandleStyle(i)}
        />
      ))}
    </div>
  )
}

export default memo(WorkflowNodeComponent)
