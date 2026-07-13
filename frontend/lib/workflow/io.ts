import type { WorkflowEdge, WorkflowNode } from "@/lib/flow/types"
import { exportWorkflowProjectToJson, importWorkflowProjectFromJson } from "./codec"
import { reactFlowToWorkflowProject } from "./from-react-flow"
import { exportWorkflowProjectToMermaid, importWorkflowProjectFromMermaid } from "./mermaid"
import type { WorkflowProject } from "./schema"
import { workflowProjectToReactFlow } from "./to-react-flow"
import type { WorkflowDslFormat, WorkflowTranslationReport } from "./codec"
import {
  exportReactFlowToKnowledgeMarkdown,
  exportReactFlowToObsidianCanvas,
  exportReactFlowToOpml,
} from "./knowledge-exports"

export type ReactFlowProjection = {
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
}

export function exportReactFlowToWorkflowJson(
  baseProject: WorkflowProject,
  projection: ReactFlowProjection,
): string {
  return exportWorkflowProjectToJson(reactFlowToWorkflowProject(baseProject, projection))
}

export function importWorkflowJsonToReactFlow(json: string):
  | { ok: true; project: WorkflowProject; flow: ReactFlowProjection; format: WorkflowDslFormat; report?: WorkflowTranslationReport }
  | { ok: false; error: string } {
  const imported = importWorkflowProjectFromJson(json)
  if (!imported.ok) return imported
  return {
    ok: true,
    project: imported.project,
    flow: workflowProjectToReactFlow(imported.project),
    format: imported.format,
    report: imported.report,
  }
}

export function exportReactFlowToWorkflowMermaid(
  baseProject: WorkflowProject,
  projection: ReactFlowProjection,
): string {
  return exportWorkflowProjectToMermaid(reactFlowToWorkflowProject(baseProject, projection))
}

export function exportReactFlowToWorkflowCanvas(
  baseProject: WorkflowProject,
  projection: ReactFlowProjection,
): string {
  return exportReactFlowToObsidianCanvas({
    title: baseProject.name,
    nodes: projection.nodes,
    edges: projection.edges,
  })
}

export function exportReactFlowToWorkflowOpml(
  baseProject: WorkflowProject,
  projection: ReactFlowProjection,
): string {
  return exportReactFlowToOpml({
    title: baseProject.name,
    nodes: projection.nodes,
    edges: projection.edges,
  })
}

export function exportReactFlowToWorkflowMarkdown(
  baseProject: WorkflowProject,
  projection: ReactFlowProjection,
): string {
  return exportReactFlowToKnowledgeMarkdown({
    title: baseProject.name,
    nodes: projection.nodes,
    edges: projection.edges,
  })
}

export function importWorkflowMermaidToReactFlow(source: string):
  | { ok: true; project: WorkflowProject; flow: ReactFlowProjection }
  | { ok: false; error: string } {
  const imported = importWorkflowProjectFromMermaid(source)
  if (!imported.ok) return imported
  return { ok: true, project: imported.project, flow: workflowProjectToReactFlow(imported.project) }
}
