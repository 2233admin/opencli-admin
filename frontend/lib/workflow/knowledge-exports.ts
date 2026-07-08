import type { WorkflowEdge, WorkflowNode } from "@/lib/flow/types"
import { getNodeDisplayId, localizeNodeText } from "./node-i18n"

export type KnowledgeExportProjection = {
  title: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
}

type CanvasNode = {
  id: string
  type: "text"
  text: string
  x: number
  y: number
  width: number
  height: number
  color?: string
}

type CanvasEdge = {
  id: string
  fromNode: string
  toNode: string
  label?: string
  color?: string
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function markdownEscape(value: string): string {
  return value.replace(/\|/g, "\\|").trim()
}

function nodeTitle(node: WorkflowNode): string {
  return localizeNodeText(getNodeDisplayId(node.data), { label: String(node.data.label || node.id) }, "en-US").label
}

function nodeSummary(node: WorkflowNode): string {
  const localized = localizeNodeText(
    getNodeDisplayId(node.data),
    { label: String(node.data.label || node.id), description: node.data.description },
    "en-US",
  )
  const parts = [
    localized.description ?? "",
    typeof node.data.primitiveId === "string" ? `Primitive: ${node.data.primitiveId}` : "",
    sourceAnchorSummary(node),
    runArtifactSummary(node),
    topicCollapseSummary(node),
    typeof node.data.status === "string" ? `Status: ${node.data.status}` : "",
  ].filter(Boolean)
  return parts.join("\n\n")
}

function edgeLabel(edge: WorkflowEdge): string {
  if (edge.data?.semantic?.relationship) return edge.data.semantic.relationship
  return typeof edge.data?.label === "string" && edge.data.label.trim() ? edge.data.label.trim() : "related"
}

function edgeWeight(edge: WorkflowEdge): string {
  const weight = edge.data?.weight
  return typeof weight === "number" ? `${Math.round(Math.max(0, Math.min(1, weight)) * 100)}%` : ""
}

function sourceAnchorSummary(node: WorkflowNode): string {
  const anchor = node.data.sourceAnchor
  if (!anchor) return ""
  const target = anchor.artifactPath ?? anchor.href ?? anchor.selector ?? anchor.runId ?? ""
  return [`Source anchor: ${anchor.kind}:${anchor.label}`, target].filter(Boolean).join("\n")
}

function runArtifactSummary(node: WorkflowNode): string {
  const artifact = node.data.runArtifact
  if (!artifact) return ""
  return `Run artifact: ${artifact.runId}\n${artifact.artifactPath}`
}

function topicCollapseSummary(node: WorkflowNode): string {
  const topic = node.data.topicCollapse
  if (!topic) return ""
  return `Topic package: ${topic.mode} / ${topic.nodeCount} nodes / internals ${topic.packageInternal ? "enabled" : "off"}`
}

function edgeContract(edge: WorkflowEdge): string {
  return typeof edge.data?.contractId === "string" ? edge.data.contractId : ""
}

function edgeReason(edge: WorkflowEdge): string {
  const semantic = edge.data?.semantic
  if (!semantic) return ""
  const confidence = typeof semantic.confidence === "number" ? `confidence ${Math.round(Math.max(0, Math.min(1, semantic.confidence)) * 100)}%` : ""
  return [semantic.reason, confidence, edgeContract(edge)].filter(Boolean).join(" | ")
}

export function exportReactFlowToObsidianCanvas({ title, nodes, edges }: KnowledgeExportProjection): string {
  const canvasNodes: CanvasNode[] = nodes.map((node) => ({
    id: node.id,
    type: "text",
    text: [`# ${nodeTitle(node)}`, nodeSummary(node)].filter(Boolean).join("\n\n"),
    x: Math.round(node.position.x),
    y: Math.round(node.position.y),
    width: Math.round(node.measured?.width ?? node.width ?? 280),
    height: Math.round(node.measured?.height ?? node.height ?? 160),
    color: typeof node.data.color === "string" ? node.data.color : undefined,
  }))
  const nodeIds = new Set(canvasNodes.map((node) => node.id))
  const canvasEdges: CanvasEdge[] = edges
    .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
    .map((edge, index) => ({
      id: edge.id || `edge-${index}`,
      fromNode: edge.source,
      toNode: edge.target,
      label: edgeLabel(edge),
    }))

  return JSON.stringify({ title, nodes: canvasNodes, edges: canvasEdges }, null, 2)
}

export function exportReactFlowToOpml({ title, nodes, edges }: KnowledgeExportProjection): string {
  const titleById = new Map(nodes.map((node) => [node.id, nodeTitle(node)]))
  const nodeOutlines = nodes
    .map((node) => {
      const note = nodeSummary(node)
      return `    <outline text="${xmlEscape(nodeTitle(node))}" _note="${xmlEscape(note)}" />`
    })
    .join("\n")
  const linkOutlines = edges
    .map((edge) => {
      const source = titleById.get(edge.source) ?? edge.source
      const target = titleById.get(edge.target) ?? edge.target
      const metadata = [edgeLabel(edge), edgeWeight(edge) ? `weight ${edgeWeight(edge)}` : "", edgeReason(edge)].filter(Boolean).join(" | ")
      return `    <outline text="${xmlEscape(`${source} -> ${target}`)}" _note="${xmlEscape(metadata)}" />`
    })
    .join("\n")

  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>${xmlEscape(title)}</title>
  </head>
  <body>
    <outline text="${xmlEscape(title)}">
${nodeOutlines}
    </outline>
    <outline text="Links">
${linkOutlines}
    </outline>
  </body>
</opml>`
}

export function exportReactFlowToKnowledgeMarkdown({ title, nodes, edges }: KnowledgeExportProjection): string {
  const titleById = new Map(nodes.map((node) => [node.id, nodeTitle(node)]))
  const lines = [`# ${title}`, "", "## Nodes", ""]

  nodes.forEach((node) => {
    lines.push(`### ${nodeTitle(node)}`, "")
    const summary = nodeSummary(node)
    if (summary) lines.push(summary, "")
    lines.push(`- id: \`${node.id}\``)
    lines.push(`- position: ${Math.round(node.position.x)}, ${Math.round(node.position.y)}`)
    lines.push("")
  })

  lines.push("## Links", "")
  if (edges.length === 0) {
    lines.push("_No links._", "")
  } else {
    lines.push("| Source | Target | Relationship | Weight | Contract / Reason |")
    lines.push("| --- | --- | --- | --- | --- |")
    edges.forEach((edge) => {
      lines.push(
        `| ${markdownEscape(titleById.get(edge.source) ?? edge.source)} | ${markdownEscape(titleById.get(edge.target) ?? edge.target)} | ${markdownEscape(edgeLabel(edge))} | ${edgeWeight(edge)} | ${markdownEscape(edgeReason(edge))} |`,
      )
    })
    lines.push("")
  }

  return lines.join("\n")
}
